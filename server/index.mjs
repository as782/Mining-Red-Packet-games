// 矿洞夺宝的 Node 版游戏站：给 Abasthan / VPS / Docker 用。
// 原版的 game/worker 是 Cloudflare Worker；这里复用完全相同的 rules.mjs 和 MineRoom，
// 只把 Durable Object、storage、WebSocket 换成 Node 的实现。接口和 FrontEnd v3 保持兼容。
//
// 环境变量：
//   PORT=3000
//   HB_ORIGIN=https://hb.lafi.sh
//   PAGE_ORIGIN=https://你的 Abasthan 域名
//   JUDGE_ID=...            判定器编号（自己发布的那一份）
//   MIN_JUDGE_VERSION=5
//   CLAIM_KID=k1
//   CLAIM_KEY={"kty":"EC",...}  # 签发领取凭证的 P-256 私钥 JWK，必须和 judge.js 公钥对应
//   TICKET_KEY=...           # 游戏站票据的 HMAC 密钥
//   DATA_DIR=./data          # 房间 JSON 持久化目录
//   STATIC_DIR=./page/frontend/dist-v3
//
// 不设置 CLAIM_KEY 时，领取会失败，但浏览/挖格子仍可用于本地调试。

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { MineRoom, RoomError } from '../game/worker/room.mjs';
import { signVoucher } from '../game/shared/voucher.mjs';
import { makeNonce, makeTicket, nonceValid, readTicket, TICKET_TTL_MS, verifyIdentity } from '../game/worker/auth.mjs';
import { inScope, outOfScope } from '../game/worker/scope.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const HB_ORIGIN = process.env.HB_ORIGIN || 'https://hb.lafi.sh';
const PAGE_ORIGIN = process.env.PAGE_ORIGIN || `http://localhost:${PORT}`;
const JUDGE_ID = process.env.JUDGE_ID || 'c9635560-890f-4cb7-97e0-9a1c9bf10013';
const MIN_JUDGE_VERSION = Number(process.env.MIN_JUDGE_VERSION ?? 5);
const CLAIM_KID = process.env.CLAIM_KID || 'k1';
const TICKET_KEY = process.env.TICKET_KEY || crypto.randomBytes(32).toString('hex');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(ROOT, 'page/frontend/dist-v3'));
const CLAIM_KEY = parseClaimKey(process.env.CLAIM_KEY);

function parseClaimKey(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    console.warn('[kddb] CLAIM_KEY 不是合法 JSON，领取会失败');
    return null;
  }
}

class JsonStorage {
  constructor(file) {
    this.file = file;
    this.data = new Map();
    this.loaded = null;
    this.saving = Promise.resolve();
  }

  async load() {
    this.loaded ??= (async () => {
      try {
        const text = await fsp.readFile(this.file, 'utf8');
        const object = JSON.parse(text);
        for (const [key, value] of Object.entries(object)) this.data.set(key, value);
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn(`[kddb] 读 ${this.file} 失败：`, error.message);
      }
    })();
    await this.loaded;
  }

  async save() {
    const object = Object.fromEntries(this.data);
    this.saving = this.saving.then(async () => {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      await fsp.writeFile(temp, JSON.stringify(object), 'utf8');
      await fsp.rename(temp, this.file);
    }).catch((error) => console.error('[kddb] 保存房间失败：', error));
    await this.saving;
  }

  async get(key) {
    await this.load();
    return this.data.get(key);
  }

  async put(entries) {
    await this.load();
    for (const [key, value] of Object.entries(entries)) this.data.set(key, value);
    await this.save();
  }

  async list({ prefix } = {}) {
    await this.load();
    return new Map([...this.data].filter(([key]) => !prefix || key.startsWith(prefix)));
  }

  async delete(keys) {
    await this.load();
    let deleted = 0;
    for (const key of keys) if (this.data.delete(key)) deleted += 1;
    if (deleted > 0) await this.save();
    return deleted;
  }
}

const rooms = new Map();
const infoCache = new Map();
const INFO_TTL = 30_000;

function roomOf(hongbao) {
  let entry = rooms.get(hongbao);
  if (!entry) {
    const storage = new JsonStorage(path.join(DATA_DIR, `${hongbao}.json`));
    const room = new MineRoom(storage, {
      seed: () => process.env.LOCAL_SEED || crypto.randomBytes(32).toString('hex'),
      sign: async (fields) => {
        if (!CLAIM_KEY) throw new Error('没有配置 CLAIM_KEY，不能签领取凭证');
        return signVoucher({ ...fields, kid: CLAIM_KID }, CLAIM_KEY);
      },
      alarm: null,
    });
    entry = { room, clients: new Set() };
    rooms.set(hongbao, entry);
  }
  return entry;
}

async function infoOf(hongbao) {
  const kept = infoCache.get(hongbao);
  if (kept && Date.now() - kept.at < INFO_TTL) return kept.info;
  const response = await fetch(`${HB_ORIGIN}/api/hongbao/${encodeURIComponent(hongbao)}`);
  if (!response.ok) {
    if (response.status === 404) throw new RoomError(404, '没有这个红包');
    if (kept) return kept.info;
    throw new RoomError(503, '红包站暂时读不到，稍后再试');
  }
  const info = await response.json();
  infoCache.set(hongbao, { info, at: Date.now() });
  return info;
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || origin !== PAGE_ORIGIN) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function sendJson(req, res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...corsHeaders(req),
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('请求内容太大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('JSON 格式不正确')); }
    });
    req.on('error', reject);
  });
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
};

async function serveStatic(req, res, pathname) {
  let relative;
  if (pathname === '/v3' || pathname === '/v3/') relative = 'index.html';
  else if (pathname.startsWith('/v3/')) relative = pathname.slice('/v3/'.length);
  else if (pathname === '/') {
    res.writeHead(302, { location: '/v3/' });
    res.end();
    return;
  } else {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const file = path.resolve(STATIC_DIR, relative);
  if (file !== STATIC_DIR && !file.startsWith(`${STATIC_DIR}${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    let content = await fsp.readFile(file);
    if (path.extname(file) === '.html') {
      content = Buffer.from(content.toString('utf8').replaceAll('https://hb.lafi.sh/sdk/v1.js', `${HB_ORIGIN}/sdk/v1.js`));
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      ...corsHeaders(req),
    });
    res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404);
      res.end('页面还没有构建：先运行 npm run build:page');
    } else {
      res.writeHead(500);
      res.end('页面读取失败');
    }
  }
}

function ticketOf(req, hongbao) {
  const auth = req.headers.authorization || '';
  return readTicket(TICKET_KEY, auth.replace(/^Ticket /, ''), hongbao, Date.now());
}

function broadcast(entry, message) {
  if (!message) return;
  const text = JSON.stringify(message);
  for (const client of entry.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(text);
  }
}

function broadcastPushes(entry, pushes = []) {
  for (const [broadcastMessage, cell] of pushes) {
    if (cell) broadcast(entry, cell);
    else if (broadcastMessage) broadcast(entry, broadcastMessage);
  }
}

async function handleApi(req, res, url) {
  const hongbao = url.searchParams.get('hb') || '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(hongbao)) return sendJson(req, res, 400, { message: '没有红包编号' });
  const route = `${req.method} ${url.pathname.slice('/v3/api'.length)}`;
  const entry = roomOf(hongbao);
  const room = entry.room;

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }

    if (route === 'GET /nonce') {
      return sendJson(req, res, 200, { nonce: await makeNonce(TICKET_KEY, hongbao, Date.now()) });
    }

    if (route === 'POST /hello') {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const now = Date.now();
      const identity = await verifyIdentity(token, {
        site: HB_ORIGIN,
        page: PAGE_ORIGIN,
        judgeId: JUDGE_ID,
        minJudgeVersion: MIN_JUDGE_VERSION,
        hongbao,
        now,
      });
      if (!identity) return sendJson(req, res, 401, { message: '认不出你，请重新打开矿洞夺宝' });
      if (!identity.nonce || !(await nonceValid(TICKET_KEY, hongbao, identity.nonce, now)) || !(await room.takeNonce(identity.nonce, now))) {
        return sendJson(req, res, 401, { message: '这次认人过期了，请重新打开矿洞夺宝' });
      }
      const info = await infoOf(hongbao);
      if (!inScope(info.scope, { username: identity.username, level: identity.level })) {
        return sendJson(req, res, 403, { message: outOfScope(info.scope), out: true });
      }
      const uid = Number(identity.sub);
      const name = identity.username;
      const ticket = await makeTicket(TICKET_KEY, { uid, name, hongbao, exp: now + TICKET_TTL_MS });
      return sendJson(req, res, 200, { ticket, uid, ...(await room.state(info, uid, name, now)) });
    }

    const who = ticketOf(req, hongbao);
    if (!who) return sendJson(req, res, 401, { message: '票据过期了，请重新打开矿洞夺宝' });
    const info = await infoOf(hongbao);

    if (route === 'GET /state') return sendJson(req, res, 200, await room.state(info, who.uid, who.name, Date.now()));
    if (route === 'GET /summary') return sendJson(req, res, 200, await room.summary(info, who.uid, who.name));
    if (route === 'GET /since') {
      const seq = Number(url.searchParams.get('seq'));
      if (!Number.isSafeInteger(seq) || seq < 0) return sendJson(req, res, 400, { message: '序号不对' });
      return sendJson(req, res, 200, await room.since(info, who.uid, who.name, seq, Date.now()));
    }
    if (route === 'POST /dig') {
      const body = await readBody(req);
      const cardId = Number(body.cardId);
      const index = Number(body.index);
      if (!Number.isSafeInteger(cardId) || !Number.isSafeInteger(index)) return sendJson(req, res, 400, { message: '格子不对' });
      const result = await room.dig(info, who.uid, who.name, { cardId, index }, Date.now(), { compact: body.v === 2 });
      if (result.cell) broadcast(entry, result.cell);
      else if (result.broadcast) broadcast(entry, result.broadcast);
      return sendJson(req, res, 200, result.answer);
    }
    if (route === 'POST /use') {
      const body = await readBody(req);
      const number = (value) => (value == null ? undefined : Number(value));
      const cardId = number(body.cardId);
      const index = number(body.index);
      if (typeof body.item !== 'string' || [cardId, index].some((value) => value !== undefined && !Number.isSafeInteger(value))) {
        return sendJson(req, res, 400, { message: '道具或格子不对' });
      }
      const result = await room.use(info, who.uid, who.name, {
        item: body.item,
        cardId,
        index,
        ...(typeof body.choice === 'string' ? { choice: body.choice } : {}),
      }, Date.now());
      broadcastPushes(entry, result.pushes);
      return sendJson(req, res, 200, result.answer);
    }
    if (route === 'POST /creeper') return sendJson(req, res, 200, await room.creeper(info, who.uid, who.name, Date.now()));
    if (route === 'POST /claim') {
      const result = await room.claim(info, who.uid, who.name, Date.now());
      if (result.broadcast) broadcast(entry, result.broadcast);
      return sendJson(req, res, 200, result.answer);
    }

    return sendJson(req, res, 404, { message: '接口不存在' });
  } catch (error) {
    const status = error instanceof RoomError ? error.status : 500;
    console.error('[kddb api]', route, error);
    return sendJson(req, res, status, { message: error instanceof RoomError ? error.message : '游戏站出了点问题，稍后再试' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/v3/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error('[kddb]', error);
    res.writeHead(500);
    res.end('服务器错误');
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname !== '/v3/api/live' && url.pathname !== '/v3/api/presence') {
    socket.destroy();
    return;
  }
  const hongbao = url.searchParams.get('hb') || '';
  const who = readTicket(TICKET_KEY, url.searchParams.get('ticket') || '', hongbao, Date.now());
  if (!who) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    const entry = roomOf(hongbao);
    entry.clients.add(ws);
    ws.on('close', () => entry.clients.delete(ws));
    ws.on('error', () => entry.clients.delete(ws));
    // presence 目前只保持连接；页面上的鼠标指针/表情是可选的。
    if (url.pathname === '/v3/api/presence') ws.send(JSON.stringify({ type: 'hello' }));
  });
});

await fsp.mkdir(DATA_DIR, { recursive: true });
server.listen(PORT, HOST, () => {
  console.log(`[kddb] Node game server on http://${HOST}:${PORT}`);
  console.log(`[kddb] HB_ORIGIN=${HB_ORIGIN} PAGE_ORIGIN=${PAGE_ORIGIN} static=${STATIC_DIR}`);
  if (!CLAIM_KEY) console.warn('[kddb] CLAIM_KEY 未设置：可以浏览和挖，但领取会失败');
});
