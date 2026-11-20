'use strict';

// 矿洞夺宝 · 账户版
//
// 三块：
//   1. 账户与大厅：注册、登录、管理员开局、用户列表（public/index.html）
//   2. 原版游戏页面：page/frontend/v3 的 React 应用，构建到 public/game/，接口在 /v3/api/
//   3. 游戏规则：vendor/worker/room.mjs（和线上游戏站同一份 MineRoom），存储用 JSON 文件
//
// 领取不走 hb.lafi.sh：游戏站签的凭证由本服务自己校验，校验通过就把积分记到账户上。

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { Accounts } = require('./server/accounts');
const { RoundStore, uidOf } = require('./server/rounds');

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_COOKIE = 'mg_session';
const TICKET_TTL_MS = 2 * 60 * 60 * 1000;
const ROUND_TTL_MS = 24 * 60 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });

const accounts = new Accounts(DATA_DIR, { adminUsername: ADMIN_USERNAME, adminPassword: ADMIN_PASSWORD });
const secret = process.env.TICKET_KEY || crypto.randomBytes(32).toString('hex');

/** 每局一条记录（编号、参数、谁开的、状态）。 */
const roundsFile = path.join(DATA_DIR, 'rounds.json');
let roundLog = [];
try {
  roundLog = JSON.parse(fs.readFileSync(roundsFile, 'utf8'));
  if (!Array.isArray(roundLog)) roundLog = [];
} catch {
  roundLog = [];
}
// 服务重启后，上一局没跑完的标成结束
for (const entry of roundLog) {
  if (entry.status === 'playing') {
    entry.status = 'ended';
    entry.endedAt = new Date().toISOString();
    entry.endReason = '服务重启，未完成的一局已结束';
  }
}
function saveRoundLog() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${roundsFile}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(roundLog, null, 2), 'utf8');
  fs.renameSync(temp, roundsFile);
}
saveRoundLog();

let nextNumber = roundLog.reduce((max, entry) => Math.max(max, Number(entry.number) || 0), 0) + 1;

const rounds = new RoundStore({
  dataDir: DATA_DIR,
  secret,
  onCredit: async (accountId, points) => {
    accounts.credit(accountId, points);
  },
});

/** 当前正在跑的一局。 */
let active = null;
let activeLog = null;

/** 身份票据：账户版自己的，和会话分开，2 小时有效。 */
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
    if (active && claims.hb !== active.roundId) return null;
    const user = accounts.users.get(claims.sub);
    return user ? { user, claims } : null;
  } catch {
    return null;
  }
}

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
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor((7 * 24 * 60 * 60))}${secure ? '; Secure' : ''}`,
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

/** 大厅里显示的一局。 */
function roundSummary() {
  if (!active) return { status: 'idle' };
  const game = active.room.game;
  const rules = game?.rules ?? {};
  return {
    id: active.roundId,
    number: active.number,
    status: active.info.status === 'active' && !game?.over ? 'playing' : 'ended',
    total: Number(active.info.pool) || 0,
    remaining: Math.max(0, (Number(active.info.pool) || 0) - (game?.used ?? 0)),
    price: rules.smallReward ?? 0,
    players: game?.stats?.players ?? 0,
    claimed: game?.stats?.claimed ?? 0,
    startedAt: Date.parse(active.info.openedAt),
    deadlineAt: active.info.deadlineAt ? Date.parse(active.info.deadlineAt) : null,
    endReason: activeLog?.endReason ?? '',
  };
}

/** 这个人有没有进过这一局。 */
function joined(user) {
  if (!active) return false;
  const uid = uidOf(user.id);
  return active.room.players.has(uid) || active.room.game?.cards !== undefined && active.room.players.has(uid);
}

async function startRound(config, admin) {
  if (active && active.info.status === 'active' && !active.room.game?.over) {
    throw new Error('已经有一局在进行中');
  }
  const durationMinutes = Math.max(5, Math.min(1440, Number(config.durationMinutes) || 30));
  const round = await rounds.open({
    number: nextNumber++,
    config,
    startedAt: Date.now(),
    durationMinutes,
  });
  active = round;
  activeLog = {
    id: round.roundId,
    number: round.number,
    status: 'playing',
    startedBy: admin.username,
    startedAt: new Date().toISOString(),
    endedAt: null,
    endReason: '',
    total: Number(round.info.pool) || 0,
    paid: 0,
    claims: 0,
    config,
  };
  roundLog.push(activeLog);
  saveRoundLog();
  return round;
}

async function endRound(reason) {
  if (!active) return;
  active.info.status = 'ended';
  if (active.room.game) active.room.game.over = true;
  if (activeLog) {
    activeLog.status = 'ended';
    activeLog.endedAt = new Date().toISOString();
    activeLog.endReason = reason;
    activeLog.paid = active.room.game?.stats?.claimedPoints ?? 0;
    activeLog.claims = active.room.game?.stats?.claimed ?? 0;
    saveRoundLog();
  }
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
    if (!active) return sendJson(res, 409, { message: '管理员还没有开启一局' });
    if (active.info.status !== 'active') return sendJson(res, 409, { message: '这一局已经结束了' });
    const uid = active.remember(user);
    const now = Date.now();
    const state = await active.room.state(active.info, uid, user.username, now);
    return sendJson(res, 200, { ticket: signTicket(user.id, active.roundId), uid, ...state });
  }

  const ticket = readTicket((req.headers.authorization ?? '').replace(/^Ticket /, ''));
  if (!ticket) return sendJson(res, 401, { message: '票据过期了，请重新进入矿洞' });
  if (!active) return sendJson(res, 409, { message: '管理员还没有开启一局' });
  const user = ticket.user;
  const uid = active.remember(user);
  const info = active.info;
  const now = Date.now();

  try {
    if (route === 'GET /state') {
      return sendJson(res, 200, await active.room.state(info, uid, user.username, now));
    }
    if (route === 'GET /summary') {
      return sendJson(res, 200, await active.room.summary(info, uid, user.username));
    }
    if (route === 'GET /since') {
      const seq = Number(url.searchParams.get('seq'));
      if (!Number.isSafeInteger(seq) || seq < 0) return sendJson(res, 400, { message: '序号不对' });
      return sendJson(res, 200, await active.room.since(info, uid, user.username, seq, now));
    }
    if (route === 'POST /dig') {
      const body = await readBody(req);
      const cardId = Number(body.cardId);
      const index = Number(body.index);
      if (!Number.isSafeInteger(cardId) || !Number.isSafeInteger(index)) return sendJson(res, 400, { message: '格子不对' });
      const result = await active.room.dig(info, uid, user.username, { cardId, index }, now, { compact: body.v === 2 });
      active.broadcast(result.cell ?? result.broadcast);
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
      const result = await active.room.use(info, uid, user.username, {
        item: body.item,
        cardId,
        index,
        ...(typeof body.choice === 'string' ? { choice: body.choice } : {}),
      }, now);
      for (const [v1, v2] of result.pushes ?? []) active.broadcast(v2 ?? v1);
      return sendJson(res, 200, result.answer);
    }
    if (route === 'POST /creeper') {
      return sendJson(res, 200, await active.room.creeper(info, uid, user.username, now));
    }
    if (route === 'POST /claim') {
      const result = await active.room.claim(info, uid, user.username, now);
      active.broadcast(result.broadcast);
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

async function handleHbApi(req, res, url) {
  const user = currentUser(req);
  if (!user) return sendJson(res, 401, { message: '请先登录' });

  if (url.pathname === '/api/hb/ready') {
    if (!active) return sendJson(res, 409, { message: '管理员还没有开启一局' });
    const uid = active.remember(user);
    const game = await active.room.state(active.info, uid, user.username, Date.now());
    const rules = game.game.rules;
    const hongbao = {
      id: active.roundId,
      title: `矿洞夺宝 · 第 ${active.number} 局`,
      url: '/game/',
      code: true,
      status: active.info.status === 'active' && !game.game.over ? 'active' : 'ended',
      endedByCode: false,
      unit: '积分',
      step: '0.01',
      points: null,
      shares: null,
      pool: active.info.pool,
      unclaimed: String(game.game.left / 100),
      deadlineAt: active.info.deadlineAt,
      judged: game.game.stats.claimed,
      sender: { name: '管理员', avatar: null },
      params: {},
    };
    return sendJson(res, 200, {
      hongbao,
      viewer: { signedIn: true, name: user.username, avatar: null },
      me: toHbMe(game.me, user),
      clock: 0,
      rules,
    });
  }

  if (url.pathname === '/api/hb/me') {
    if (!active) return sendJson(res, 409, { message: '管理员还没有开启一局' });
    const uid = active.remember(user);
    const game = await active.room.state(active.info, uid, user.username, Date.now());
    return sendJson(res, 200, {
      me: toHbMe(game.me, user),
      hongbao: {
        id: active.roundId,
        title: `矿洞夺宝 · 第 ${active.number} 局`,
        url: '/game/',
        code: true,
        status: active.info.status === 'active' && !game.game.over ? 'active' : 'ended',
        endedByCode: false,
        unit: '积分',
        step: '0.01',
        points: null,
        shares: null,
        pool: active.info.pool,
        unclaimed: String(game.game.left / 100),
        deadlineAt: active.info.deadlineAt,
        judged: game.game.stats.claimed,
        sender: { name: '管理员', avatar: null },
        params: {},
      },
    });
  }

  if (url.pathname === '/api/hb/identity') {
    return sendJson(res, 200, {
      token: signTicket(user.id, active?.roundId ?? 'none'),
      user: { id: user.id, username: user.username, level: null },
    });
  }

  if (url.pathname === '/api/hb/submit' && req.method === 'POST') {
    const body = await readBody(req);
    if (!active) return sendJson(res, 409, { message: '管理员还没有开启一局' });
    const result = await active.credit(user.id, String(body.input ?? ''));
    if (!result) return sendJson(res, 400, { message: '凭证对不上' });
    const uid = active.remember(user);
    const game = await active.room.state(active.info, uid, user.username, Date.now());
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
    claim: me.status === 'claimed' ? { amount: (me.points / 100).toFixed(2), unit: '积分', payment: 'paid' } : null,
    registered: false,
    pending: (me.points / 100).toFixed(2),
    settled: me.status === 'claimed',
    ...me,
  };
}

// ---------------------------------------------------------------------------
// 大厅接口（/api/*）
// ---------------------------------------------------------------------------

async function handleLobbyApi(req, res, url) {
  const pathname = url.pathname;

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const user = accounts.register(body.username, body.password);
      setSession(req, res, user);
      return sendJson(res, 200, { ok: true, user: accounts.public(user), round: roundSummary() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, message: error.message });
    }
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const user = accounts.login(body.username, body.password);
    if (!user) return sendJson(res, 401, { ok: false, message: '用户名或密码不对' });
    setSession(req, res, user);
    return sendJson(res, 200, { ok: true, user: accounts.public(user), round: roundSummary() });
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
      round: roundSummary(),
      ...(user ? { joined: joined(user) } : {}),
    });
  }

  if (pathname === '/api/round' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, round: roundSummary(), joined: user ? joined(user) : false });
  }

  if (pathname === '/api/round/join' && req.method === 'POST') {
    if (!user) return sendJson(res, 401, { ok: false, message: '请先登录' });
    if (!active) return sendJson(res, 409, { ok: false, message: '管理员还没有开启一局' });
    if (active.info.status !== 'active') return sendJson(res, 409, { ok: false, message: '这一局已经结束了' });
    const uid = active.remember(user);
    await active.room.state(active.info, uid, user.username, Date.now());
    return sendJson(res, 200, { ok: true, round: roundSummary(), joined: true });
  }

  if (pathname === '/api/admin/overview' && req.method === 'GET') {
    if (!user) return sendJson(res, 401, { ok: false, message: '请先登录' });
    if (user.role !== 'admin') return sendJson(res, 403, { ok: false, message: '只有管理员可以操作' });
    return sendJson(res, 200, {
      ok: true,
      users: accounts.list(),
      round: roundSummary(),
      rounds: roundLog.slice().reverse().slice(0, 20),
    });
  }

  if (pathname === '/api/admin/start' && req.method === 'POST') {
    if (!user) return sendJson(res, 401, { ok: false, message: '请先登录' });
    if (user.role !== 'admin') return sendJson(res, 403, { ok: false, message: '只有管理员可以操作' });
    const body = await readBody(req);
    try {
      await startRound(body.config ?? {}, user);
      return sendJson(res, 200, { ok: true, round: roundSummary() });
    } catch (error) {
      return sendJson(res, 409, { ok: false, message: error.message });
    }
  }

  if (pathname === '/api/admin/end' && req.method === 'POST') {
    if (!user) return sendJson(res, 401, { ok: false, message: '请先登录' });
    if (user.role !== 'admin') return sendJson(res, 403, { ok: false, message: '只有管理员可以操作' });
    if (!active) return sendJson(res, 409, { ok: false, message: '现在没有进行中的一局' });
    await endRound('管理员结束了本局');
    return sendJson(res, 200, { ok: true, round: roundSummary() });
  }

  if (pathname === '/api/meta') {
    return sendJson(res, 200, {
      ok: true,
      defaultConfig: {
        style: 'standard', level: 'normal', total: 1000, players: 10, chances: 20,
        interval: 1, eyeEvery: 3, creeper: 120, durationMinutes: 30,
      },
      round: roundSummary(),
    });
  }

  return sendJson(res, 404, { ok: false, message: '接口不存在' });
}

// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
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
  if (!ticket || !active) {
    try {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    } catch {
      // 已经断了
    }
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    if (url.pathname.startsWith('/v3/api/presence')) {
      // 指针和表情：账户版先不做，保持连接即可
      ws.on('message', (data) => {
        if (String(data) === 'ping') ws.send('pong');
      });
      return;
    }
    active.clients.add(ws);
    ws.on('close', () => active?.clients.delete(ws));
  });
});

// 兜底：任何漏网的 socket 错误都不许带崩进程
process.on('uncaughtException', (error) => {
  console.error('[uncaught]', error);
});
process.on('unhandledRejection', (error) => {
  console.error('[unhandled]', error);
});

// 每秒推进一次：不领的人、到点的截止
setInterval(() => {
  rounds.tickAll().catch((error) => console.error('[tick]', error));
  if (active && active.info.status === 'active' && active.room.game?.over) {
    void endRound('奖池分完');
  }
}, 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`矿洞夺宝 · 账户版 http://${HOST}:${PORT}`);
  console.log(`data: ${DATA_DIR}`);
  if (accounts.users.size === 0) {
    console.log('还没有账号：第一个注册的账号会成为管理员');
  }
});

module.exports = { server };
