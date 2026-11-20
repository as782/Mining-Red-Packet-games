'use strict';

// 一局游戏 = 一个 MineRoom（vendor/worker/room.mjs，和线上游戏站同一份规则）。
// 这里只做三件事：给 MineRoom 一个 JSON 文件存储、把账户 id 映射成规则要的数字 uid、
// 校验领取凭证并把积分记到账户上。
//
// 金额单位：MineRoom 和原版规则里的钱都是「最小单位」的整数。账户版让 1 积分 = 100 个
// 最小单位，页面上按 step "0.01" 显示成两位小数。

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

/** vendor/worker/room.mjs 是 ES 模块，第一次用到时再 import。 */
let mineRoomPromise = null;
function loadMineRoom() {
  mineRoomPromise ??= import('../vendor/worker/room.mjs').then((module) => module.MineRoom);
  return mineRoomPromise;
}

const MINUTE = 60 * 1000;
const MINOR = 100;

/** MineRoom 要的 storage：和 Durable Object 的 storage 同形状。 */
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
        const object = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
        for (const [key, value] of Object.entries(object)) this.data.set(key, value);
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn(`[room] 读 ${this.file} 失败：`, error.message);
      }
    })();
    await this.loaded;
  }

  async save() {
    const object = Object.fromEntries(this.data);
    this.saving = this.saving
      .then(async () => {
        await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
        const temp = `${this.file}.tmp`;
        await fs.promises.writeFile(temp, JSON.stringify(object), 'utf8');
        await fs.promises.rename(temp, this.file);
      })
      .catch((error) => console.error('[room] 保存失败：', error));
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

/** 账户 id（uuid）→ 规则里的数字 uid：稳定、基本不撞。 */
function uidOf(accountId) {
  const digest = crypto.createHash('sha256').update(String(accountId)).digest();
  return digest.readUIntBE(0, 5) + 1;
}

function claimToken(secret, roundId, uid, points) {
  const body = `acct.${roundId}.${uid}.${points}`;
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function readClaimToken(secret, text) {
  const parts = String(text ?? '').split('.');
  if (parts.length !== 5 || parts[0] !== 'acct') return null;
  const [, roundId, uid, points, mac] = parts;
  const body = `acct.${roundId}.${uid}.${points}`;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return { roundId, uid: Number(uid), points: Number(points) };
}

/** 一局。 */
class Round {
  constructor({ room, roundId, number, info, secret, onCredit }) {
    this.room = room;
    this.roundId = roundId;
    this.number = number;
    this.info = info;
    this.secret = secret;
    this.onCredit = onCredit;
    this.clients = new Set();
    this.names = new Map();
    this.accounts = new Map();
    this.credited = new Set();
    this.ended = false;
  }

  remember(account) {
    const uid = uidOf(account.id);
    this.names.set(uid, account.username);
    this.accounts.set(uid, account.id);
    return uid;
  }

  broadcast(message) {
    if (!message) return;
    const text = JSON.stringify(message);
    for (const client of this.clients) {
      try {
        client.send(text);
      } catch {
        // 断了等重连
      }
    }
  }

  /** 把 MineRoom 攒下的推送发出去。 */
  drainOutbox() {
    for (const message of this.room.takeOutbox()) this.broadcast(message);
  }

  /** 校验领取凭证，通过就记到账户（同一张只记一次）。 */
  async credit(accountId, token) {
    const parsed = readClaimToken(this.secret, token);
    if (!parsed || parsed.roundId !== this.roundId) return null;
    if (this.accounts.get(parsed.uid) !== accountId) return null;
    if (this.credited.has(token)) return { points: parsed.points / MINOR, again: true };
    this.credited.add(token);
    await this.onCredit(accountId, parsed.points / MINOR, this);
    return { points: parsed.points / MINOR, again: false };
  }

  get stats() {
    const game = this.room.game;
    return {
      total: Number(this.info.units?.pool ?? 0) / MINOR,
      used: (game?.used ?? 0) / MINOR,
      left: ((game?.pool ?? 0) - (game?.used ?? 0)) / MINOR,
      players: game?.stats?.players ?? 0,
      claimed: game?.stats?.claimed ?? 0,
      over: Boolean(game?.over),
    };
  }
}

class RoundStore {
  constructor({ dataDir, secret, onCredit }) {
    this.dataDir = dataDir;
    this.secret = secret;
    this.onCredit = onCredit;
    this.rounds = new Map();
  }

  async open({ number, config, startedAt, durationMinutes }) {
    const MineRoom = await loadMineRoom();
    const roundId = crypto.randomUUID();
    const total = Math.max(1, Math.round(Number(config.total) || 1000));
    const minor = total * MINOR;
    const info = {
      id: roundId,
      status: 'active',
      pool: total.toFixed(2),
      units: { pool: minor, unclaimed: minor },
      step: '0.01',
      openedAt: new Date(startedAt).toISOString(),
      deadlineAt: new Date(startedAt + (durationMinutes || 30) * MINUTE).toISOString(),
      params: {
        level: config.level || 'normal',
        players: Number(config.players) || 10,
        initialChances: Number(config.chances) || 20,
        eyeEvery: Number(config.eyeEvery) || 3,
        creeper: Number(config.creeper) || 0,
        interval: Number(config.interval) || 1,
        reward: config.rewardMode === 'price' ? 'price' : 'pool',
        ...(config.rewardMode === 'price' ? { smallReward: Math.max(1, Math.round(Number(config.smallReward) || 10) * MINOR) } : {}),
      },
      scope: null,
    };
    const storage = new JsonStorage(path.join(this.dataDir, 'rooms', `${roundId}.json`));
    const room = new MineRoom(storage, {
      seed: () => crypto.randomBytes(32).toString('hex'),
      sign: async (fields) => claimToken(this.secret, roundId, fields.id, fields.points),
      alarm: null,
    });
    const round = new Round({ room, roundId, number, info, secret: this.secret, onCredit: this.onCredit });
    this.rounds.set(roundId, round);
    await room.gameFor(info);
    return round;
  }

  get(roundId) {
    return this.rounds.get(roundId) ?? null;
  }

  /** 每秒推进：不领的人被炸、到点结束。 */
  async tickAll() {
    for (const round of this.rounds.values()) {
      if (round.info.status !== 'active') continue;
      try {
        const result = await round.room.alarm(round.info, Date.now());
        if (result?.drained?.length) {
          round.broadcast({ type: 'drain', uids: result.drained, left: result.left, over: result.over });
        }
        if (result?.over) round.info.status = 'ended';
        round.drainOutbox();
      } catch (error) {
        console.error('[round tick]', error);
      }
    }
  }
}

module.exports = { Round, RoundStore, JsonStorage, uidOf, claimToken, readClaimToken, MINOR };
