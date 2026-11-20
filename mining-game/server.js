'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { Game } = require('./game/engine');
const { DEFAULT_CONFIG, STYLES, DIFFICULTIES, CARD_KINDS } = require('./game/content');

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ROUNDS_FILE = path.join(DATA_DIR, 'rounds.json');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

let users = new Map();
let rounds = [];
let nextRoundNumber = 1;
let activeGame = null;

function loadData() {
  const savedUsers = readJson(USERS_FILE, []);
  if (Array.isArray(savedUsers)) {
    for (const user of savedUsers) users.set(user.id, user);
  }
  const savedRounds = readJson(ROUNDS_FILE, []);
  if (Array.isArray(savedRounds)) {
    rounds = savedRounds.map((round) => {
      if (round.status !== 'playing') return round;
      return { ...round, status: 'ended', endedAt: new Date().toISOString(), endReason: '服务重启，未完成的一局已结束' };
    });
    nextRoundNumber = savedRounds.reduce((max, round) => Math.max(max, Number(round.number) || 0), 0) + 1;
    saveRounds();
  }
  if (users.size === 0 && ADMIN_PASSWORD) {
    const admin = createUser(ADMIN_USERNAME, ADMIN_PASSWORD, 'admin');
    console.log(`[mining-game] 已创建管理员账号 ${admin.username}`);
    saveUsers();
  }
}

function saveUsers() {
  writeJson(USERS_FILE, [...users.values()]);
}

function saveRounds() {
  writeJson(ROUNDS_FILE, rounds);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return {
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString('hex'),
  };
}

function verifyPassword(password, user) {
  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = Buffer.from(crypto.scryptSync(password, user.salt, 64).toString('hex'), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function cleanUsername(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

function createUser(username, password, role = 'player') {
  const name = cleanUsername(username);
  if (name.length < 2 || name.length > 20) throw new Error('用户名要 2–20 个字符');
  if (String(password).length < 6) throw new Error('密码至少 6 位');
  if ([...users.values()].some((user) => user.username.toLowerCase() === name.toLowerCase())) {
    throw new Error('这个用户名已经被注册了');
  }
  const { salt, hash } = hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    username: name,
    role,
    salt,
    passwordHash: hash,
    points: 0,
    totalEarned: 0,
    createdAt: new Date().toISOString(),
    lastPlayedAt: null,
  };
  users.set(user.id, user);
  return user;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    points: user.points,
    totalEarned: user.totalEarned,
    createdAt: user.createdAt,
    lastPlayedAt: user.lastPlayedAt,
  };
}

const sessions = new Map();

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).mg_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return users.get(session.userId) ?? null;
}

function issueSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1';
  res.setHeader(
    'set-cookie',
    `mg_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`,
  );
}

function clearSession(req, res) {
  const token = parseCookies(req).mg_session;
  if (token) sessions.delete(token);
  res.setHeader('set-cookie', 'mg_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

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

function attachGameHooks(game) {
  game.onClaim = (player, paid) => {
    if (!player.userId || paid <= 0) return;
    const user = users.get(player.userId);
    if (!user) return;
    user.points += paid;
    user.totalEarned += paid;
    user.lastPlayedAt = new Date().toISOString();
    const round = rounds.find((entry) => entry.id === game.roundId);
    if (round) {
      round.paid = (round.paid || 0) + paid;
      round.claims = (round.claims || 0) + 1;
      if (!round.claimants.includes(user.id)) round.claimants.push(user.id);
    }
    saveUsers();
    saveRounds();
  };
}

function createRound(config, admin) {
  if (activeGame && activeGame.status === 'playing') throw new Error('已经有一局在进行中');
  const normalized = {
    ...DEFAULT_CONFIG,
    ...(config || {}),
    bots: Math.max(0, Math.min(20, Number(config?.bots) || 0)),
  };
  const game = new Game(normalized);
  game.roundId = crypto.randomUUID();
  game.gameId = game.roundId;
  game.roundNumber = nextRoundNumber++;
  game.startedBy = admin.id;
  game.onClaim = null;
  attachGameHooks(game);
  activeGame = game;
  rounds.push({
    id: game.roundId,
    number: game.roundNumber,
    title: `第 ${game.roundNumber} 局`,
    status: 'playing',
    startedBy: admin.username,
    startedAt: new Date(game.startedAt).toISOString(),
    endedAt: null,
    config: game.publicConfig(),
    paid: 0,
    claims: 0,
    claimants: [],
    players: 0,
    endReason: '',
  });
  saveRounds();
  return game;
}

function roundSummary(game) {
  if (!game) return { status: 'idle', message: '管理员还没有开启这一局' };
  return {
    id: game.roundId,
    number: game.roundNumber,
    status: game.status,
    config: game.publicConfig(),
    total: game.config.total,
    remaining: game.remaining,
    price: game.pricePerEmerald,
    players: game.activePlayers,
    claimed: game.claimedPlayers,
    startedAt: game.startedAt,
    deadlineAt: game.deadlineAt,
    endReason: game.endReason,
  };
}

function findGamePlayer(user) {
  if (!activeGame) return null;
  return [...activeGame.players.values()].find((player) => player.userId === user.id) ?? null;
}

function myRoundInfo(user) {
  if (!activeGame) return { status: 'idle', joined: false };
  const player = findGamePlayer(user);
  return {
    ...roundSummary(activeGame),
    joined: !!player,
    me: player ? {
      status: player.status,
      points: player.points,
      claimedAmount: player.claimedAmount,
      chances: player.chances,
    } : null,
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('请求体太大'));
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

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = decodeURIComponent(filePath);
  const resolved = path.resolve(PUBLIC_DIR, `.${filePath}`);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(resolved, (error, content) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(resolved)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(content);
  });
}

function playerFromRequest(url, body) {
  if (!activeGame) return null;
  const playerId = body.playerId ?? url.searchParams.get('playerId');
  const token = body.token ?? url.searchParams.get('token');
  if (!playerId || !token) return null;
  return activeGame.getPlayer(playerId, token);
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      status: activeGame?.status ?? 'idle',
      players: activeGame?.players.size ?? 0,
      users: users.size,
    });
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = currentUser(req);
    return sendJson(res, 200, {
      ok: true,
      user: user ? publicUser(user) : null,
      round: user ? myRoundInfo(user) : (activeGame ? roundSummary(activeGame) : { status: 'idle' }),
    });
  }

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const first = users.size === 0;
      const user = createUser(body.username, body.password, first ? 'admin' : 'player');
      saveUsers();
      issueSession(req, res, user);
      return sendJson(res, 200, { ok: true, user: publicUser(user), round: myRoundInfo(user) });
    } catch (error) {
      return sendJson(res, 400, { ok: false, message: error.message });
    }
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = cleanUsername(body.username);
    const user = [...users.values()].find((entry) => entry.username.toLowerCase() === username.toLowerCase());
    if (!user || !verifyPassword(String(body.password ?? ''), user)) {
      return sendJson(res, 401, { ok: false, message: '用户名或密码不对' });
    }
    issueSession(req, res, user);
    return sendJson(res, 200, { ok: true, user: publicUser(user), round: myRoundInfo(user) });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    clearSession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/meta' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      defaultConfig: DEFAULT_CONFIG,
      presets: STYLES,
      difficulties: DIFFICULTIES,
      cardKinds: CARD_KINDS,
      round: activeGame ? roundSummary(activeGame) : { status: 'idle' },
    });
  }

  if (pathname === '/api/round' && req.method === 'GET') {
    const user = currentUser(req);
    return sendJson(res, 200, {
      ok: true,
      round: user ? myRoundInfo(user) : (activeGame ? roundSummary(activeGame) : { status: 'idle' }),
    });
  }

  if (pathname === '/api/round/join' && req.method === 'POST') {
    const user = requireUser(req, res);
    if (!user) return;
    if (!activeGame) return sendJson(res, 409, { ok: false, message: '管理员还没有开启一局游戏' });
    let player = findGamePlayer(user);
    if (!player) {
      if (activeGame.status !== 'playing') return sendJson(res, 409, { ok: false, message: '这一局已经结束了' });
      player = activeGame.join(user.username, user.id);
      const round = rounds.find((entry) => entry.id === activeGame.roundId);
      if (round) {
        round.players = activeGame.players.size;
        saveRounds();
      }
    }
    return sendJson(res, 200, {
      ok: true,
      playerId: player.id,
      token: player.token,
      state: activeGame.getState(player.id),
      round: myRoundInfo(user),
    });
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    const player = playerFromRequest(url);
    if (!player) return sendJson(res, 401, { ok: false, message: '请先加入本局游戏' });
    return sendJson(res, 200, { ok: true, state: activeGame.getState(player.id) });
  }

  if (pathname === '/api/action' && req.method === 'POST') {
    const body = await readBody(req);
    const player = playerFromRequest(url, body);
    if (!player) return sendJson(res, 401, { ok: false, message: '请先加入本局游戏' });
    const result = activeGame.action(player.id, player.token, body.action ?? {});
    return sendJson(res, result.ok ? 200 : 400, { ...result, state: activeGame.getState(player.id) });
  }

  if (pathname === '/api/admin/overview' && req.method === 'GET') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    return sendJson(res, 200, {
      ok: true,
      users: [...users.values()].map(publicUser).sort((a, b) => b.points - a.points),
      round: activeGame ? myRoundInfo(admin) : { status: 'idle' },
      rounds: rounds.slice().reverse().slice(0, 20),
    });
  }

  if (pathname === '/api/admin/start' && req.method === 'POST') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    try {
      const game = createRound(body.config ?? {}, admin);
      return sendJson(res, 200, { ok: true, round: roundSummary(game) });
    } catch (error) {
      return sendJson(res, 409, { ok: false, message: error.message });
    }
  }

  if (pathname === '/api/admin/end' && req.method === 'POST') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    if (!activeGame || activeGame.status !== 'playing') {
      return sendJson(res, 409, { ok: false, message: '现在没有进行中的一局' });
    }
    activeGame.endGame('管理员结束了本局');
    const round = rounds.find((entry) => entry.id === activeGame.roundId);
    if (round) {
      round.status = 'ended';
      round.endedAt = new Date().toISOString();
      round.paid = activeGame.paidOut;
      round.endReason = activeGame.endReason;
      round.players = activeGame.players.size;
      saveRounds();
    }
    return sendJson(res, 200, { ok: true, round: roundSummary(activeGame) });
  }

  return sendJson(res, 404, { ok: false, message: '接口不存在' });
}

loadData();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error('[mining-game]', error);
    sendJson(res, 500, { ok: false, message: error instanceof Error ? error.message : '服务器错误' });
  }
});

setInterval(() => {
  if (!activeGame) return;
  try {
    activeGame.tick();
    if (activeGame.status === 'ended') {
      const round = rounds.find((entry) => entry.id === activeGame.roundId);
      if (round && round.status === 'playing') {
        round.status = 'ended';
        round.endedAt = new Date().toISOString();
        round.paid = activeGame.paidOut;
        round.endReason = activeGame.endReason;
        round.players = activeGame.players.size;
        saveRounds();
      }
    }
  } catch (error) {
    console.error('[tick]', error);
  }
}, 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`矿洞夺宝 · 账户版 running at http://${HOST}:${PORT}`);
  console.log(`data: ${DATA_DIR}`);
});
