'use strict';

// 矿洞夺宝 · 账户版
//
// 三块：
//   1. 账户与大厅：注册、登录、多局大厅、用户管理、系统设置（public/index.html）
//   2. 原版游戏页面：web/ 的 React 应用，构建到 public/game/，接口在 /v3/api/
//   3. 游戏规则：vendor/worker/room.mjs（和线上游戏站同一份 MineRoom），存储用 JSON 文件
//
// 多局：每一局都是独立的 MineRoom，互不影响。管理员可以开任意多局；房主（host）按设置限量开。
// 领取不走 hb.lafi.sh：游戏站签的凭证由本服务自己校验，校验通过就把积分记到账户上。

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { Accounts, ROLES, DEFAULT_SETTINGS } = require('./server/accounts');
const { RoundStore, uidOf, MINOR } = require('./server/rounds');
const { createStorage } = require('./server/storage');
const { createGitSync } = require('./server/git-sync');

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_COOKIE = 'mg_session';
const TICKET_TTL_MS = 2 * 60 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * 卷第一次挂上来时是空的，仓库里带着的数据会被遮住。
 * 所以镜像里另存一份种子数据（seed/），数据目录为空时复制过去：
 * 第一次部署带着账号和历史，之后的部署用卷里最新的那份。
 */
function seedDataDir() {
  const seedDir = process.env.SEED_DIR ? path.resolve(process.env.SEED_DIR) : path.join(ROOT, 'seed');
  if (!fs.existsSync(seedDir)) return;
  if (path.resolve(seedDir) === path.resolve(DATA_DIR)) return;
  let copied = 0;
  for (const file of ['users.json', 'settings.json', 'rounds.json']) {
    const target = path.join(DATA_DIR, file);
    const source = path.join(seedDir, file);
    if (fs.existsSync(target) || !fs.existsSync(source)) continue;
    fs.copyFileSync(source, target);
    copied += 1;
  }
  if (copied > 0) console.log(`[seed] 数据目录是空的，从 ${seedDir} 恢复了 ${copied} 个文件`);
}

seedDataDir();

/** 数据一变就写回仓库（免费版没有数据库时靠它保住数据）。 */
const gitSync = createGitSync({ dataDir: DATA_DIR });

const storage = createStorage({
  dataDir: DATA_DIR,
  onWrite: (file) => {
    if (file === 'users.json' || file === 'settings.json' || file === 'rounds.json') gitSync.schedule();
  },
});

const accounts = new Accounts(DATA_DIR, { storage });
const secret = process.env.TICKET_KEY || crypto.randomBytes(32).toString('hex');

// ---------------------------------------------------------------------------
// 局记录（历史 + 正在进行的）
// ---------------------------------------------------------------------------

const roundsFile = path.join(DATA_DIR, 'rounds.json');
let roundLog = [];

function saveRoundLog() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${roundsFile}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(roundLog, null, 2), 'utf8');
  try {
    if (fs.existsSync(roundsFile)) fs.copyFileSync(roundsFile, `${roundsFile}.bak`);
  } catch {
    // 备份失败不影响保存
  }
  fs.renameSync(temp, roundsFile);
  gitSync.schedule();
}

let nextNumber = 1;

const rounds = new RoundStore({
  dataDir: DATA_DIR,
  secret,
  onCredit: async (accountId, points, round) => {
    await accounts.credit(accountId, points);
    if (round) {
      const entry = roundLog.find((item) => item.id === round.roundId);
      if (entry) {
        entry.paid = Math.round((entry.paid + points) * 100) / 100;
        entry.claims = (entry.claims ?? 0) + 1;
        saveRoundLog();
      }
    }
  },
});

/**
 * 启动时把数据读进来：账号、设置、局记录。
 * 有 DATABASE_URL 走数据库；没有就从容器里的 data/ 读（那份是仓库 checkout 出来的，
 * 也就是上一次写回仓库的数据）。
 */
async function initData() {
  await storage.init();
  await accounts.load();
  await accounts.ensureAdmin(ADMIN_USERNAME, ADMIN_PASSWORD);

  if (storage.kind === 'postgres') {
    roundLog = await storage.loadRounds();
  } else {
    try {
      const list = JSON.parse(fs.readFileSync(roundsFile, 'utf8'));
      roundLog = Array.isArray(list) ? list : [];
    } catch {
      roundLog = [];
    }
  }
  // 服务重启后，上一轮没跑完的标成结束（房间状态是内存里的，重启就没了）
  let changed = false;
  for (const entry of roundLog) {
    if (entry.status === 'playing') {
      entry.status = 'ended';
      entry.endedAt = new Date().toISOString();
      entry.endReason = '服务重启，未完成的一局已结束';
      changed = true;
    }
  }
  if (changed) {
    saveRoundLog();
    if (storage.kind === 'postgres') await storage.saveRounds(roundLog);
  }
  nextNumber = roundLog.reduce((max, entry) => Math.max(max, Number(entry.number) || 0), 0) + 1;
  console.log(`[boot] 账号 ${accounts.users.size} 个，历史 ${roundLog.length} 局，下一局编号 ${nextNumber}`);
}

/** 存局记录：数据库和文件都写（免费版文件会随 git-sync 写回仓库）。 */
async function persistRoundLog() {
  saveRoundLog();
  if (storage.kind === 'postgres') await storage.saveRounds(roundLog);
}

/** 正在进行的局：roundId → Round（RoundStore 里也有一份）。 */
const liveRounds = () => rounds.all().filter((round) => round.info.status === 'active');

// ---------------------------------------------------------------------------
// 票据：账户版自己的，2 小时有效；票据里带 roundId，一局一张
// ---------------------------------------------------------------------------

function signTicket(accountId, roundId) {
  const body = Buffer.from(JSON.stringify({ sub: accountId, hb: roundId, exp: Date.now() + TICKET_TTL_MS })).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(`ticket:${body}`).digest('base64url');
  return `${body}.${mac}`;
}

function readTicket(text) {
  const [body, mac, extra] = String(text ?? '').split('.');
  if (!body || !mac || extra !== undefined) return null;
  const expected = crypto.createHmac('sha256', secret).update(`ticket:${body}`).digest('base64url');
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!claims.exp || claims.exp < Date.now()) return null;
    const user = accounts.users.get(claims.sub);
    if (!user || user.disabled) return null;
    const round = rounds.get(claims.hb);
    if (!round || round.info.status !== 'active') return null;
    return { user, claims, round };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

function currentUser(req) {
  return accounts.fromToken(cookies(req)[SESSION_COOKIE]);
}

function setSession(req, res, user) {
  const token = accounts.issue(user);
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1';
  res.setHeader(
    'set-cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}${secure ? '; Secure' : ''}`,
  );
}

function clearSession(req, res) {
  accounts.revoke(cookies(req)[SESSION_COOKIE]);
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error('请求太大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON 格式不正确'));
      }
    });
    req.on('error', reject);
  });
}

function serveFile(res, file) {
  fs.readFile(file, (error, content) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(content);
  });
}

function serveStatic(res, pathname) {
  const resolved = path.resolve(PUBLIC_DIR, `.${decodeURIComponent(pathname)}`);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return serveFile(res, path.join(resolved, 'index.html'));
  }
  serveFile(res, resolved);
}

// ---------------------------------------------------------------------------
// 局的公开信息
// ---------------------------------------------------------------------------

function roundSummary(round) {
  const game = round.room.game;
  const rules = game?.rules ?? {};
  return {
    id: round.roundId,
    number: round.number,
    title: round.config?.title || `第 ${round.number} 局`,
    status: round.info.status === 'active' && !game?.over ? 'playing' : 'ended',
    ownerId: round.ownerId ?? null,
    ownerName: round.ownerName ?? '管理员',
    total: Number(round.info.pool) || 0,
    remaining: Math.max(0, (Number(round.info.pool) || 0) - (game?.used ?? 0)),
    price: (rules.smallReward ?? 0) / MINOR,
    players: game?.stats?.players ?? 0,
    claimed: game?.stats?.claimed ?? 0,
    chances: rules.initialChances ?? 0,
    startedAt: Date.parse(round.info.openedAt),
    deadlineAt: round.info.deadlineAt ? Date.parse(round.info.deadlineAt) : null,
    endReason: round.endReason ?? '',
    config: round.config ?? {},
  };
}

function roundSummaries() {
  return liveRounds()
    .map(roundSummary)
    .sort((a, b) => a.startedAt - b.startedAt);
}

/** 大厅显示：进行中的 + 最近结束的几局（让玩家看到“这局结束了”）。 */
function lobbyRounds() {
  const live = roundSummaries();
  const liveIds = new Set(live.map((round) => round.id));
  const ended = roundLog
    .filter((entry) => entry.status === 'ended' && !liveIds.has(entry.id))
    .slice(-8)
    .map((entry) => ({
      id: entry.id,
      number: entry.number,
      title: entry.title || `第 ${entry.number} 局`,
      status: 'ended',
      ownerId: entry.ownerId ?? null,
      ownerName: entry.ownerName ?? '管理员',
      total: entry.total ?? 0,
      remaining: 0,
      price: 0,
      players: 0,
      claimed: entry.claims ?? 0,
      chances: entry.config?.chances ?? 0,
      startedAt: Date.parse(entry.startedAt),
      deadlineAt: null,
      endReason: entry.endReason ?? '',
      config: entry.config ?? {},
    }));
  return [...live, ...ended];
}

/** 这个人进过这一局没有。 */
function joined(round, user) {
  if (!round || !user) return false;
  return round.room.players.has(uidOf(user.id));
}

/** 这个人现在在哪些局里。 */
function joinedRounds(user) {
  if (!user) return [];
  return liveRounds()
    .filter((round) => joined(round, user))
    .map((round) => round.roundId);
}

/** 校验一局的配置；管理员放宽，房主按设置收窄。 */
function normalizeConfig(input = {}, user) {
  const settings = accounts.settings;
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(number)));
  };
  const maxChances = Math.max(99, settings.maxChances || 999);
  const maxTotal = Math.max(1000, settings.maxTotal || 1_000_000);
  const total = clamp(input.total, 10, maxTotal, 1000);
  const players = clamp(input.players, 1, 2000, 10);
  const chances = clamp(input.chances, 1, maxChances, 20);
  const durationMinutes = clamp(input.durationMinutes, 1, 1440 * 7, 30);
  const interval = [1, 3, 10, 30].includes(Number(input.interval)) ? Number(input.interval) : 1;
  const eyeEvery = [2, 3, 5].includes(Number(input.eyeEvery)) ? Number(input.eyeEvery) : 3;
  const creeper = [0, 30, 60, 120, 180, 300].includes(Number(input.creeper)) ? Number(input.creeper) : 60;
  const level = ['easy', 'normal', 'tough'].includes(input.level) ? input.level : 'normal';
  const rewardMode = input.rewardMode === 'price' ? 'price' : 'pool';
  const smallReward = clamp(input.smallReward, 1, maxTotal, 10);
  const title = String(input.title ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 30);
  return {
    title: title || '',
    total,
    players,
    chances,
    durationMinutes,
    interval,
    eyeEvery,
    creeper,
    level,
    rewardMode,
    smallReward,
    maxChances,
  };
}

async function startRound(config, user) {
  const permission = accounts.canStartRound(user);
  if (!permission.ok) throw new Error(permission.message);
  if (permission.limit > 0) {
    const mine = rounds.openRoundsOf(user.id).length;
    if (mine >= permission.limit) {
      throw new Error(`你同时最多开 ${permission.limit} 局，先结束一局再开`);
    }
  }
  const normalized = normalizeConfig(config, user);
  const round = await rounds.open({
    number: nextNumber++,
    config: normalized,
    startedAt: Date.now(),
    durationMinutes: normalized.durationMinutes,
    owner: user,
  });
  roundLog.push({
    id: round.roundId,
    number: round.number,
    title: normalized.title || `第 ${round.number} 局`,
    status: 'playing',
    ownerId: user.id,
    ownerName: user.username,
    startedAt: new Date().toISOString(),
    endedAt: null,
    endReason: '',
    total: normalized.total,
    paid: 0,
    claims: 0,
    config: normalized,
  });
  await persistRoundLog();
  await accounts.countRound(user.id);
  return round;
}

async function endRound(round, reason, user) {
  if (!round) return null;
  if (user && user.role !== 'admin' && round.ownerId !== user.id) {
    throw new Error('只能结束自己开的局');
  }
  await rounds.close(round.roundId, reason);
  // 通知游戏里开着页面的人：这一局结束了（网页收到 over 会弹收益卡）
  round.broadcast({
    type: 'drain',
    uids: [],
    left: 0,
    over: true,
    ended: true,
    reason,
  });
  const entry = roundLog.find((item) => item.id === round.roundId);
  if (entry) {
    entry.status = 'ended';
    entry.endedAt = new Date().toISOString();
    entry.endReason = reason;
    await persistRoundLog();
  }
  return round;
}

// ---------------------------------------------------------------------------
// 原版页面的接口（/v3/api/*）：形状照 vendor/worker/index.mjs
// ---------------------------------------------------------------------------

async function handleGameApi(req, res, url) {
  const route = `${req.method} ${url.pathname.slice('/v3/api'.length)}`;

  if (route === 'GET /nonce') {
    return sendJson(res, 200, { nonce: crypto.randomBytes(12).toString('base64url') });
  }

  if (route === 'POST /hello') {
    const user = currentUser(req);
    if (!user) return sendJson(res, 401, { message: '请先登录' });
    // 原版页面用 ?hb=红包编号 认局；账户版用 ?round=局编号，hb 也认
    const roundId = url.searchParams.get('round') || url.searchParams.get('hb') || '';
    const round = rounds.get(roundId);
    if (!round) return sendJson(res, 409, { message: '没有这一局，可能已经结束了' });
    if (round.info.status !== 'active') return sendJson(res, 409, { message: '这一局已经结束了' });
    const uid = round.remember(user);
    const now = Date.now();
    const state = await round.room.state(round.info, uid, user.username, now);
    return sendJson(res, 200, { ticket: signTicket(user.id, round.roundId), uid, ...state });
  }

  const ticket = readTicket((req.headers.authorization ?? '').replace(/^Ticket /, ''));
  if (!ticket) return sendJson(res, 401, { message: '票据过期了，请重新进入矿洞' });
  const { user, round } = ticket;
  const uid = round.remember(user);
  const info = round.info;
  const now = Date.now();

  try {
    if (route === 'GET /state') {
      return sendJson(res, 200, await round.room.state(info, uid, user.username, now));
    }
    if (route === 'GET /summary') {
      return sendJson(res, 200, await round.room.summary(info, uid, user.username));
    }
    if (route === 'GET /since') {
      const seq = Number(url.searchParams.get('seq'));
      if (!Number.isSafeInteger(seq) || seq < 0) return sendJson(res, 400, { message: '序号不对' });
      return sendJson(res, 200, await round.room.since(info, uid, user.username, seq, now));
    }
    if (route === 'POST /dig') {
      const body = await readBody(req);
      const cardId = Number(body.cardId);
      const index = Number(body.index);
      if (!Number.isSafeInteger(cardId) || !Number.isSafeInteger(index)) return sendJson(res, 400, { message: '格子不对' });
      const result = await round.room.dig(info, uid, user.username, { cardId, index }, now, { compact: body.v === 2 });
      round.broadcast(result.cell ?? result.broadcast);
      return sendJson(res, 200, result.answer);
    }
    if (route === 'POST /use') {
      const body = await readBody(req);
      const number = (value) => (value == null ? undefined : Number(value));
      const cardId = number(body.cardId);
      const index = number(body.index);
      if (typeof body.item !== 'string' || [cardId, index].some((v) => v !== undefined && !Number.isSafeInteger(v))) {
        return sendJson(res, 400, { message: '道具或格子不对' });
      }
      const result = await round.room.use(info, uid, user.username, {
        item: body.item,
        cardId,
        index,
        ...(typeof body.choice === 'string' ? { choice: body.choice } : {}),
      }, now);
      for (const [v1, v2] of result.pushes ?? []) round.broadcast(v2 ?? v1);
      return sendJson(res, 200, result.answer);
    }
    if (route === 'POST /creeper') {
      return sendJson(res, 200, await round.room.creeper(info, uid, user.username, now));
    }
    if (route === 'POST /claim') {
      const result = await round.room.claim(info, uid, user.username, now);
      round.broadcast(result.broadcast);
      return sendJson(res, 200, result.answer);
    }
  } catch (error) {
    const status = error?.status ?? 500;
    console.error('[game api]', route, error);
    return sendJson(res, status, { message: error?.message ?? '游戏站出了点问题，稍后再试' });
  }

  return sendJson(res, 404, { message: '没有这个接口' });
}

// ---------------------------------------------------------------------------
// 账户版给网页用的 hb 接口（/api/hb/*）
// ---------------------------------------------------------------------------

function hongbaoOf(round, game) {
  return {
    id: round.roundId,
    title: round.config?.title || `矿洞夺宝 · 第 ${round.number} 局`,
    url: '/game/',
    code: true,
    status: round.info.status === 'active' && !game.over ? 'active' : 'ended',
    endedByCode: false,
    unit: '积分',
    step: '0.01',
    points: null,
    shares: null,
    pool: round.info.pool,
    unclaimed: (game.left / MINOR).toFixed(2),
    deadlineAt: round.info.deadlineAt,
    judged: game.stats.claimed,
    sender: { name: round.ownerName ?? '管理员', avatar: null },
    params: {},
  };
}

async function handleHbApi(req, res, url) {
  const user = currentUser(req);
  if (!user) return sendJson(res, 401, { message: '请先登录' });

  // 网页用 ?round= / ?hb= 指定是哪一局；没给就用他最近进过的那一局
  const asked = url.searchParams.get('round') || url.searchParams.get('hb') || '';
  const pick = () => {
    if (asked) return rounds.get(asked);
    const joinedIds = joinedRounds(user);
    if (joinedIds.length > 0) return rounds.get(joinedIds[joinedIds.length - 1]);
    const live = liveRounds();
    return live.length === 1 ? live[0] : null;
  };

  if (url.pathname === '/api/hb/ready' || url.pathname === '/api/hb/me') {
    const round = pick();
    if (!round) return sendJson(res, 409, { message: '没有可以进入的局' });
    const uid = round.remember(user);
    const game = await round.room.state(round.info, uid, user.username, Date.now());
    const body = {
      me: toHbMe(game.me, user),
      hongbao: hongbaoOf(round, game.game),
      round: roundSummary(round),
    };
    if (url.pathname === '/api/hb/ready') {
      return sendJson(res, 200, {
        ...body,
        viewer: { signedIn: true, name: user.username, avatar: null },
        clock: 0,
        rules: game.game.rules,
      });
    }
    return sendJson(res, 200, body);
  }

  if (url.pathname === '/api/hb/identity') {
    const round = pick();
    return sendJson(res, 200, {
      token: signTicket(user.id, round?.roundId ?? 'none'),
      user: { id: user.id, username: user.username, level: null },
    });
  }

  if (url.pathname === '/api/hb/submit' && req.method === 'POST') {
    const body = await readBody(req);
    const round = pick();
    if (!round) return sendJson(res, 409, { message: '没有可以领取的局' });
    const result = await round.credit(user.id, String(body.input ?? ''));
    if (!result) return sendJson(res, 400, { message: '凭证对不上' });
    const uid = round.remember(user);
    const game = await round.room.state(round.info, uid, user.username, Date.now());
    const amount = result.points.toFixed(2);
    return sendJson(res, 200, {
      claimed: result.points > 0,
      amount,
      unit: '积分',
      reply: result.points > 0 ? `领取 ${amount} 积分，已存入账户` : '这一局没有奖励',
      pending: '0.00',
      settled: true,
      accountPoints: accounts.public(accounts.users.get(user.id)).points,
      me: toHbMe(game.me, user),
    });
  }

  return sendJson(res, 404, { message: '接口不存在' });
}

/** MineRoom 的 privatePlayer → 原版网页的 Me。 */
function toHbMe(me, user) {
  return {
    signedIn: true,
    name: user.username,
    avatar: null,
    open: me.status === 'playing',
    ...(me.status === 'claimed' ? { why: 'already_claimed' } : {}),
    cooldownUntil: me.coolingMs ? Date.now() + me.coolingMs : null,
    claim: me.status === 'claimed' ? { amount: (me.points / MINOR).toFixed(2), unit: '积分', payment: 'paid' } : null,
    registered: false,
    pending: (me.points / MINOR).toFixed(2),
    settled: me.status === 'claimed',
    ...me,
  };
}

// ---------------------------------------------------------------------------
// 大厅接口（/api/*）
// ---------------------------------------------------------------------------

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) {
    sendJson(res, 401, { ok: false, message: '请先登录' });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    sendJson(res, 403, { ok: false, message: '只有管理员可以操作' });
    return null;
  }
  return user;
}

async function handleLobbyApi(req, res, url) {
  const pathname = url.pathname;

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const user = await accounts.register(body.username, body.password);
      setSession(req, res, user);
      return sendJson(res, 200, { ok: true, user: accounts.public(user), rounds: lobbyRounds() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, message: error.message });
    }
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    let user;
    try {
      user = await accounts.login(body.username, body.password);
    } catch (error) {
      return sendJson(res, 403, { ok: false, message: error.message });
    }
    if (!user) return sendJson(res, 401, { ok: false, message: '用户名或密码不对' });
    setSession(req, res, user);
    return sendJson(res, 200, { ok: true, user: accounts.public(user), rounds: lobbyRounds() });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    clearSession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  const user = currentUser(req);

  if (pathname === '/api/auth/me') {
    return sendJson(res, 200, {
      ok: true,
      user: user ? accounts.public(user) : null,
      rounds: lobbyRounds(),
      joined: user ? joinedRounds(user) : [],
      settings: user?.role === 'admin' ? accounts.settings : undefined,
      permission: user ? accounts.canStartRound(user) : null,
    });
  }

  if (pathname === '/api/meta') {
    return sendJson(res, 200, {
      ok: true,
      rounds: lobbyRounds(),
      settings: user?.role === 'admin' ? accounts.settings : undefined,
      defaults: {
        title: '', total: 1000, players: 10, chances: 20, durationMinutes: 30,
        interval: 1, eyeEvery: 3, creeper: 60, level: 'normal', rewardMode: 'pool', smallReward: 10,
      },
      limits: {
        maxChances: Math.max(99, accounts.settings.maxChances || 999),
        maxTotal: Math.max(1000, accounts.settings.maxTotal || 1_000_000),
      },
    });
  }

  if (pathname === '/api/rounds' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, rounds: lobbyRounds(), joined: user ? joinedRounds(user) : [] });
  }

  if (pathname === '/api/round/join' && req.method === 'POST') {
    if (!user) return sendJson(res, 401, { ok: false, message: '请先登录' });
    const body = await readBody(req);
    const round = rounds.get(body.roundId ?? url.searchParams.get('round') ?? '');
    if (!round) return sendJson(res, 409, { ok: false, message: '没有这一局，可能已经结束了' });
    if (round.info.status !== 'active') return sendJson(res, 409, { ok: false, message: '这一局已经结束了' });
    const uid = round.remember(user);
    await round.room.state(round.info, uid, user.username, Date.now());
    return sendJson(res, 200, { ok: true, round: roundSummary(round), joined: joinedRounds(user) });
  }

  if (pathname === '/api/round/start' && req.method === 'POST') {
    if (!user) return sendJson(res, 401, { ok: false, message: '请先登录' });
    const body = await readBody(req);
    try {
      const round = await startRound(body.config ?? {}, user);
      return sendJson(res, 200, { ok: true, round: roundSummary(round), rounds: lobbyRounds() });
    } catch (error) {
      return sendJson(res, 409, { ok: false, message: error.message });
    }
  }

  if (pathname === '/api/round/end' && req.method === 'POST') {
    if (!user) return sendJson(res, 401, { ok: false, message: '请先登录' });
    const body = await readBody(req);
    const round = rounds.get(body.roundId ?? '');
    if (!round) return sendJson(res, 404, { ok: false, message: '没有这一局' });
    try {
      await endRound(round, body.reason || '房主结束了本局', user);
      return sendJson(res, 200, { ok: true, rounds: lobbyRounds() });
    } catch (error) {
      return sendJson(res, 403, { ok: false, message: error.message });
    }
  }

  // ---- 用户管理（管理员） ----

  if (pathname === '/api/admin/users' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, { ok: true, users: accounts.list(), settings: accounts.settings });
  }

  if (pathname === '/api/admin/users/update' && req.method === 'POST') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const target = accounts.users.get(body.userId ?? '');
    if (!target) return sendJson(res, 404, { ok: false, message: '没有这个用户' });
    try {
      if (body.role !== undefined) await accounts.setRole(target.id, body.role);
      if (body.disabled !== undefined) await accounts.setDisabled(target.id, body.disabled);
      if (body.maxRounds !== undefined) await accounts.setMaxRounds(target.id, body.maxRounds);
      if (body.password) await accounts.resetPassword(target.id, body.password);
      if (body.points !== undefined) await accounts.setPoints(target.id, body.points);
      if (body.adjust !== undefined) await accounts.adjustPoints(target.id, body.adjust);
      return sendJson(res, 200, { ok: true, user: accounts.public(accounts.users.get(target.id)), users: accounts.list() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, message: error.message });
    }
  }

  if (pathname === '/api/admin/users/delete' && req.method === 'POST') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    if (body.userId === admin.id) return sendJson(res, 400, { ok: false, message: '不能删除自己' });
    const target = accounts.users.get(body.userId ?? '');
    if (!target) return sendJson(res, 404, { ok: false, message: '没有这个用户' });
    if (target.role === 'admin' && accounts.adminCount() <= 1) {
      return sendJson(res, 400, { ok: false, message: '至少要留一个管理员' });
    }
    await accounts.remove(target.id);
    return sendJson(res, 200, { ok: true, users: accounts.list() });
  }

  if (pathname === '/api/admin/settings' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const settings = await accounts.updateSettings(body.settings ?? body);
    return sendJson(res, 200, { ok: true, settings });
  }

  if (pathname === '/api/admin/overview' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, {
      ok: true,
      users: accounts.list(),
      rounds: lobbyRounds(),
      history: roundLog.slice().reverse().slice(0, 50),
      settings: accounts.settings,
      storage: { kind: storage.kind },
      sync: gitSync.status,
    });
  }

  // 手动把数据写回仓库（部署前点一下，确保最新数据在仓库里）
  if (pathname === '/api/admin/sync' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const result = await gitSync.flush();
    return sendJson(res, result.ok ? 200 : 400, { ok: result.ok, ...result, sync: gitSync.status });
  }

  if (pathname === '/api/admin/round/end' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const round = rounds.get(body.roundId ?? '');
    if (!round) return sendJson(res, 404, { ok: false, message: '没有这一局' });
    await endRound(round, '管理员结束了本局', null);
    return sendJson(res, 200, { ok: true, rounds: lobbyRounds() });
  }

  return sendJson(res, 404, { ok: false, message: '接口不存在' });
}

// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    // 健康检查：Railway / 负载均衡 / 监控用，不需要登录，也不碰数据库
    if (url.pathname === '/healthz' || url.pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        uptime: Math.round(process.uptime()),
        storage: storage.kind,
        users: accounts.users.size,
        rounds: liveRounds().length,
      });
    }
    if (url.pathname.startsWith('/v3/api/')) return await handleGameApi(req, res, url);
    if (url.pathname.startsWith('/api/hb/')) return await handleHbApi(req, res, url);
    if (url.pathname.startsWith('/api/')) return await handleLobbyApi(req, res, url);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return serveStatic(res, '/index.html');
    }
    return serveStatic(res, url.pathname);
  } catch (error) {
    console.error('[server]', error);
    sendJson(res, 500, { ok: false, message: '服务器错误' });
  }
});

// 实时推送：原版页面用 WebSocket 收别人的挖掘
const { WebSocketServer } = require('./server/ws');
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  socket.on('error', () => {
    try {
      socket.destroy();
    } catch {
      // 已经没了
    }
  });
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  if (!url.pathname.startsWith('/v3/api/live') && !url.pathname.startsWith('/v3/api/presence')) {
    socket.destroy();
    return;
  }
  const ticket = readTicket(url.searchParams.get('ticket') ?? '');
  if (!ticket) {
    try {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    } catch {
      // 已经断了
    }
    socket.destroy();
    return;
  }
  const { round } = ticket;
  wss.handleUpgrade(request, socket, head, (ws) => {
    const who = { uid: uidOf(ticket.user.id), name: ticket.user.username };
    if (url.pathname.startsWith('/v3/api/presence')) {
      // 在场：别人的指针、谁在看哪张卡、表情。用原版 PresenceRoom 的规则。
      void round.joinPresence(ws, who);
      ws.on('message', (data) => {
        const text = String(data);
        if (text === 'ping') ws.send('pong');
        void round.presenceMessage(ws, text);
      });
      ws.on('close', () => void round.leavePresence(ws));
      return;
    }
    round.clients.add(ws);
    ws.on('close', () => round.clients.delete(ws));
  });
});

// 兜底：任何漏网的 socket 错误都不许带崩进程
process.on('uncaughtException', (error) => {
  console.error('[uncaught]', error);
});
process.on('unhandledRejection', (error) => {
  console.error('[unhandled]', error);
});

// 每秒推进：不领的人、到点的截止
setInterval(() => {
  rounds.tickAll().catch((error) => console.error('[tick]', error));
  for (const round of liveRounds()) {
    if (round.room.game?.over) {
      void endRound(round, '奖池分完', null).catch(() => {});
    }
  }
}, 1000).unref();

// 退出前把没推上去的数据推一次（免费版靠它把数据写回仓库）
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[shutdown] ${signal}，先把数据推上去`);
  try {
    await gitSync.flush();
  } catch (error) {
    console.error('[shutdown] 同步失败：', error.message);
  }
  try {
    await storage.close();
  } catch {
    // 忽略
  }
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// 先把数据读进来（账号、设置、历史局），再开始接请求
initData()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`矿洞夺宝 · 账户版 http://${HOST}:${PORT}`);
      console.log(`data: ${DATA_DIR}（${storage.kind}）`);
      if (accounts.users.size === 0) {
        console.log('还没有账号：第一个注册的账号会成为管理员');
      }
      if (gitSync.enabled) console.log('[git-sync] 数据变更会写回仓库，重新部署不会丢');
    });
  })
  .catch((error) => {
    console.error('[boot] 启动失败：', error);
    process.exit(1);
  });

module.exports = { server, rounds, accounts, storage, gitSync };



