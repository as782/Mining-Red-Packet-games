'use strict';

// 账户：注册、登录、会话、积分。密码用 scrypt 加盐哈希，会话是内存里的随机令牌 + HttpOnly Cookie。

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

class Accounts {
  constructor(dataDir, { adminUsername = 'admin', adminPassword = '' } = {}) {
    this.dataDir = dataDir;
    this.usersFile = path.join(dataDir, 'users.json');
    this.sessions = new Map();
    this.users = new Map();
    this.load();
    if (this.users.size === 0 && adminPassword) {
      const admin = this.create(adminUsername, adminPassword, 'admin');
      console.log(`[accounts] 已创建管理员 ${admin.username}`);
      this.save();
    }
  }

  load() {
    try {
      const list = JSON.parse(fs.readFileSync(this.usersFile, 'utf8'));
      for (const user of list) this.users.set(user.id, user);
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[accounts] 读用户失败：', error.message);
    }
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const temp = `${this.usersFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify([...this.users.values()], null, 2), 'utf8');
    fs.renameSync(temp, this.usersFile);
  }

  static clean(value) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  }

  create(username, password, role = 'player') {
    const name = Accounts.clean(username);
    if (name.length < 2 || name.length > 20) throw new Error('用户名要 2–20 个字符');
    if (String(password).length < 6) throw new Error('密码至少 6 位');
    if ([...this.users.values()].some((user) => user.username.toLowerCase() === name.toLowerCase())) {
      throw new Error('这个用户名已经被注册了');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: crypto.randomUUID(),
      username: name,
      role,
      salt,
      hash: crypto.scryptSync(String(password), salt, 64).toString('hex'),
      points: 0,
      totalEarned: 0,
      createdAt: new Date().toISOString(),
      lastPlayedAt: null,
    };
    this.users.set(user.id, user);
    return user;
  }

  register(username, password) {
    const role = this.users.size === 0 ? 'admin' : 'player';
    const user = this.create(username, password, role);
    this.save();
    return user;
  }

  login(username, password) {
    const name = Accounts.clean(username);
    const user = [...this.users.values()].find((entry) => entry.username.toLowerCase() === name.toLowerCase());
    if (!user) return null;
    const expected = Buffer.from(user.hash, 'hex');
    const actual = crypto.scryptSync(String(password), user.salt, 64);
    if (expected.length !== actual.length) return null;
    return crypto.timingSafeEqual(expected, actual) ? user : null;
  }

  issue(user) {
    const token = crypto.randomBytes(32).toString('hex');
    this.sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
    return token;
  }

  fromToken(token) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return this.users.get(session.userId) ?? null;
  }

  revoke(token) {
    if (token) this.sessions.delete(token);
  }

  credit(userId, points) {
    const user = this.users.get(userId);
    if (!user) return null;
    // 保留两位小数：规则里的钱是最小单位的整数，除以 100 就是积分
    const amount = Math.max(0, Math.round((Number(points) || 0) * 100) / 100);
    user.points = Math.round((user.points + amount) * 100) / 100;
    user.totalEarned = Math.round((user.totalEarned + amount) * 100) / 100;
    user.lastPlayedAt = new Date().toISOString();
    this.save();
    return user;
  }

  public(user) {
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

  list() {
    return [...this.users.values()].map((user) => this.public(user)).sort((a, b) => b.points - a.points);
  }
}

module.exports = { Accounts, SESSION_TTL_MS };
