'use strict';

// 账户：注册、登录、会话、积分、权限。
// 密码用 scrypt 加盐哈希，会话是内存里的随机令牌 + HttpOnly Cookie。
//
// 角色：
//   admin   管理员：管理用户、改设置、开任意局、管理所有人的局
//   host    房主：可以开自己的局（数量受设置限制），只能管自己的局
//   player  普通玩家：只能进别人开的局
//
// 存储：有 storage（Postgres）就走它，否则读写本地 JSON 文件。
// 所有写操作都是 async，等真正落盘/落库了才返回，避免“看着成功了其实没存上”。

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ROLES = ['admin', 'host', 'player'];

const DEFAULT_SETTINGS = {
  /** 允许 host 开局的全局开关 */
  hostCanStart: true,
  /** 每个 host 同时最多开几局；0 表示不限 */
  hostMaxRounds: 1,
  /** 管理员同时最多开几局；0 表示不限 */
  adminMaxRounds: 0,
  /** 一局最多几人（只是提示，实际按房间配置） */
  maxPlayersPerRound: 2000,
  /** 每人最多挖几次的上限（默认放开到 999） */
  maxChances: 999,
  /** 奖池上限（积分） */
  maxTotal: 1_000_000,
  /** 是否开放注册 */
  registrationOpen: true,
};

class Accounts {
  constructor(dataDir, { storage = null } = {}) {
    this.dataDir = dataDir;
    this.storage = storage;
    this.usersFile = path.join(dataDir, 'users.json');
    this.settingsFile = path.join(dataDir, 'settings.json');
    this.sessions = new Map();
    this.users = new Map();
    this.settings = { ...DEFAULT_SETTINGS };
  }

  /**
   * 从存储读账号和设置。老数据（passwordHash、没有 role）在这里就地迁移，
   * 不会因为字段改名把用户“弄丢”。
   */
  async load() {
    let list = [];
    let saved = {};
    if (this.storage) {
      list = await this.storage.loadUsers();
      saved = await this.storage.loadSettings();
    } else {
      try {
        list = JSON.parse(fs.readFileSync(this.usersFile, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn('[accounts] 读用户失败：', error.message);
      }
      try {
        saved = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn('[accounts] 读设置失败：', error.message);
      }
    }
    let migrated = false;
    for (const user of Array.isArray(list) ? list : []) {
      if (!ROLES.includes(user.role)) user.role = 'player';
      if (typeof user.disabled !== 'boolean') user.disabled = false;
      if (typeof user.maxRounds !== 'number') user.maxRounds = null;
      if (typeof user.roundsStarted !== 'number') user.roundsStarted = 0;
      // 兼容更早的版本：密码字段以前叫 passwordHash，现在叫 hash
      if (!user.hash && user.passwordHash) {
        user.hash = user.passwordHash;
        delete user.passwordHash;
        migrated = true;
      }
      if (typeof user.salt !== 'string' || typeof user.hash !== 'string') {
        console.warn(`[accounts] 跳过损坏的账号 ${user.username ?? user.id}：没有密码哈希`);
        continue;
      }
      this.users.set(user.id, user);
    }
    this.settings = { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
    if (migrated) {
      console.log('[accounts] 已把旧版账号数据迁移到新格式');
      await this.save();
    }
  }

  /** 首次启动：没有账号又给了管理员密码，就建一个。 */
  async ensureAdmin(adminUsername, adminPassword) {
    if (this.users.size > 0 || !adminPassword) return null;
    const admin = this.create(adminUsername, adminPassword, 'admin');
    console.log(`[accounts] 已创建管理员 ${admin.username}`);
    await this.save();
    return admin;
  }

  async save() {
    const list = [...this.users.values()];
    if (this.storage) {
      await this.storage.saveUsers(list);
      return;
    }
    fs.mkdirSync(this.dataDir, { recursive: true });
    const temp = `${this.usersFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(list, null, 2), 'utf8');
    try {
      if (fs.existsSync(this.usersFile)) fs.copyFileSync(this.usersFile, `${this.usersFile}.bak`);
    } catch {
      // 备份失败不影响保存
    }
    fs.renameSync(temp, this.usersFile);
  }

  async saveSettings() {
    if (this.storage) {
      await this.storage.saveSettings(this.settings);
      return;
    }
    fs.mkdirSync(this.dataDir, { recursive: true });
    const temp = `${this.settingsFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.settings, null, 2), 'utf8');
    fs.renameSync(temp, this.settingsFile);
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
      role: ROLES.includes(role) ? role : 'player',
      disabled: false,
      maxRounds: null,
      salt,
      hash: crypto.scryptSync(String(password), salt, 64).toString('hex'),
      points: 0,
      totalEarned: 0,
      roundsStarted: 0,
      createdAt: new Date().toISOString(),
      lastPlayedAt: null,
      lastLoginAt: null,
    };
    this.users.set(user.id, user);
    return user;
  }

  async register(username, password) {
    if (!this.settings.registrationOpen) throw new Error('管理员关闭了注册');
    const role = this.users.size === 0 ? 'admin' : 'player';
    const user = this.create(username, password, role);
    await this.save();
    return user;
  }

  async login(username, password) {
    const name = Accounts.clean(username);
    const user = [...this.users.values()].find((entry) => entry.username.toLowerCase() === name.toLowerCase());
    if (!user) return null;
    const expected = Buffer.from(user.hash, 'hex');
    const actual = crypto.scryptSync(String(password), user.salt, 64);
    if (expected.length !== actual.length) return null;
    if (!crypto.timingSafeEqual(expected, actual)) return null;
    if (user.disabled) throw new Error('这个账号已被管理员停用');
    user.lastLoginAt = new Date().toISOString();
    await this.save();
    return user;
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
    const user = this.users.get(session.userId) ?? null;
    if (!user || user.disabled) return null;
    return user;
  }

  revoke(token) {
    if (token) this.sessions.delete(token);
  }

  /** 停用/启用：停用会踢掉他所有会话。 */
  async setDisabled(userId, disabled) {
    const user = this.users.get(userId);
    if (!user) return null;
    if (user.role === 'admin' && disabled && this.adminCount() <= 1) throw new Error('不能停用最后一个管理员');
    user.disabled = Boolean(disabled);
    if (user.disabled) this.revokeUser(userId);
    await this.save();
    return user;
  }

  revokeUser(userId) {
    for (const [token, session] of this.sessions) if (session.userId === userId) this.sessions.delete(token);
  }

  adminCount() {
    return [...this.users.values()].filter((user) => user.role === 'admin' && !user.disabled).length;
  }

  async setRole(userId, role) {
    if (!ROLES.includes(role)) throw new Error('没有这个角色');
    const user = this.users.get(userId);
    if (!user) return null;
    if (user.role === 'admin' && role !== 'admin' && this.adminCount() <= 1) throw new Error('至少要留一个管理员');
    user.role = role;
    await this.save();
    return user;
  }

  async setMaxRounds(userId, value) {
    const user = this.users.get(userId);
    if (!user) return null;
    const number = value === null || value === '' ? null : Math.max(0, Math.floor(Number(value)));
    user.maxRounds = Number.isFinite(number) ? number : null;
    await this.save();
    return user;
  }

  async resetPassword(userId, password) {
    const user = this.users.get(userId);
    if (!user) return null;
    if (String(password).length < 6) throw new Error('密码至少 6 位');
    const salt = crypto.randomBytes(16).toString('hex');
    user.salt = salt;
    user.hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    this.revokeUser(userId);
    await this.save();
    return user;
  }

  async credit(userId, points) {
    const user = this.users.get(userId);
    if (!user) return null;
    // 保留两位小数：规则里的钱是最小单位的整数，除以 100 就是积分
    const amount = Math.max(0, Math.round((Number(points) || 0) * 100) / 100);
    user.points = Math.round((user.points + amount) * 100) / 100;
    user.totalEarned = Math.round((user.totalEarned + amount) * 100) / 100;
    user.lastPlayedAt = new Date().toISOString();
    await this.save();
    return user;
  }

  /** 管理员直接改积分（发奖励、扣分、清零）。 */
  async setPoints(userId, points) {
    const user = this.users.get(userId);
    if (!user) return null;
    user.points = Math.max(0, Math.round((Number(points) || 0) * 100) / 100);
    await this.save();
    return user;
  }

  async adjustPoints(userId, delta) {
    const user = this.users.get(userId);
    if (!user) return null;
    const amount = Math.round((Number(delta) || 0) * 100) / 100;
    user.points = Math.max(0, Math.round((user.points + amount) * 100) / 100);
    if (amount > 0) user.totalEarned = Math.round((user.totalEarned + amount) * 100) / 100;
    await this.save();
    return user;
  }

  async countRound(userId) {
    const user = this.users.get(userId);
    if (!user) return;
    user.roundsStarted = (user.roundsStarted ?? 0) + 1;
    await this.save();
  }

  async remove(userId) {
    const user = this.users.get(userId);
    if (!user) return null;
    if (user.role === 'admin' && this.adminCount() <= 1) throw new Error('至少要留一个管理员');
    this.revokeUser(userId);
    this.users.delete(userId);
    await this.save();
    return user;
  }

  /** 这个用户还能不能再开一局。 */
  canStartRound(user) {
    if (!user) return { ok: false, message: '请先登录' };
    if (user.disabled) return { ok: false, message: '这个账号已被停用' };
    if (user.role === 'player') return { ok: false, message: '普通玩家不能开局，请联系管理员给你开房权限' };
    if (user.role === 'host' && !this.settings.hostCanStart) return { ok: false, message: '管理员暂时关闭了开房功能' };
    const limit = user.maxRounds ?? (user.role === 'admin' ? this.settings.adminMaxRounds : this.settings.hostMaxRounds);
    if (limit === 0) return { ok: true, limit: 0 };
    return { ok: true, limit };
  }

  async updateSettings(patch) {
    const next = { ...this.settings };
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      if (typeof DEFAULT_SETTINGS[key] === 'boolean') next[key] = Boolean(value);
      else if (typeof DEFAULT_SETTINGS[key] === 'number') {
        const number = Number(value);
        if (Number.isFinite(number) && number >= 0) next[key] = Math.floor(number);
      }
    }
    this.settings = next;
    await this.saveSettings();
    return this.settings;
  }

  public(user) {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      disabled: Boolean(user.disabled),
      maxRounds: user.maxRounds ?? null,
      points: user.points,
      totalEarned: user.totalEarned,
      roundsStarted: user.roundsStarted ?? 0,
      createdAt: user.createdAt,
      lastPlayedAt: user.lastPlayedAt,
      lastLoginAt: user.lastLoginAt,
    };
  }

  list() {
    return [...this.users.values()]
      .map((user) => this.public(user))
      .sort((a, b) => {
        if (a.role !== b.role) return ROLES.indexOf(a.role) - ROLES.indexOf(b.role);
        return b.points - a.points;
      });
  }
}

module.exports = { Accounts, SESSION_TTL_MS, ROLES, DEFAULT_SETTINGS };
