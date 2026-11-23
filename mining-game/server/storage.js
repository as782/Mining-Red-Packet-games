'use strict';

// 数据持久化：两套后端，接口一样。
//
//   PostgresStore  有 DATABASE_URL 时用（付费版 / 任何托管 Postgres）。
//   FileStore      没有 DATABASE_URL 时用（免费版、本地开发）。
//                  免费版容器每次部署都会重置，所以 FileStore 会配合 git-sync：
//                  数据一变就写回仓库，下次部署 checkout 下来就是上次的数据。
//
// 表只有三张，都是 id + jsonb：字段以后怎么加都不用改表结构。

const fs = require('node:fs');
const path = require('node:path');

const TABLES = ['mg_users', 'mg_settings', 'mg_rounds'];

// ---------------------------------------------------------------------------
// 文件后端
// ---------------------------------------------------------------------------

class FileStore {
  constructor(dataDir, { onWrite = null } = {}) {
    this.dataDir = dataDir;
    this.usersFile = path.join(dataDir, 'users.json');
    this.settingsFile = path.join(dataDir, 'settings.json');
    this.roundsFile = path.join(dataDir, 'rounds.json');
    this.onWrite = onWrite;
    fs.mkdirSync(dataDir, { recursive: true });
  }

  static read(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }

  static write(file, value) {
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    // 覆盖前留一份备份，写坏了还能捞回来
    try {
      if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    } catch {
      // 备份失败不影响保存
    }
    fs.renameSync(temp, file);
  }

  get kind() {
    return 'file';
  }

  async init() {
    return this;
  }

  async loadUsers() {
    const list = FileStore.read(this.usersFile, []);
    return Array.isArray(list) ? list : [];
  }

  async saveUsers(users) {
    FileStore.write(this.usersFile, users);
    this.onWrite?.('users.json');
  }

  async loadSettings() {
    return FileStore.read(this.settingsFile, {});
  }

  async saveSettings(settings) {
    FileStore.write(this.settingsFile, settings);
    this.onWrite?.('settings.json');
  }

  async loadRounds() {
    const list = FileStore.read(this.roundsFile, []);
    return Array.isArray(list) ? list : [];
  }

  async saveRounds(rounds) {
    FileStore.write(this.roundsFile, rounds);
    this.onWrite?.('rounds.json');
  }

  async close() {}
}

// ---------------------------------------------------------------------------
// Postgres 后端
// ---------------------------------------------------------------------------

class PostgresStore {
  constructor(connectionString) {
    this.connectionString = connectionString;
    this.pool = null;
  }

  get kind() {
    return 'postgres';
  }

  async init() {
    let pg;
    try {
      pg = require('pg');
    } catch {
      throw new Error('要用 Postgres 需要先 npm install pg');
    }
    const needsSsl = /sslmode=require/.test(this.connectionString) || process.env.PGSSL === '1';
    this.pool = new pg.Pool({
      connectionString: this.connectionString,
      ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    for (const table of TABLES) {
      await this.pool.query(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data JSONB NOT NULL)`);
    }
    return this;
  }

  async rows(table) {
    const result = await this.pool.query(`SELECT data FROM ${table}`);
    return result.rows.map((row) => row.data);
  }

  async put(table, id, data) {
    await this.pool.query(
      `INSERT INTO ${table} (id, data) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [id, data],
    );
  }

  async loadUsers() {
    return this.rows('mg_users');
  }

  async saveUsers(users) {
    const keep = users.map((user) => user.id);
    if (keep.length === 0) await this.pool.query('DELETE FROM mg_users');
    else await this.pool.query('DELETE FROM mg_users WHERE NOT (id = ANY($1::text[]))', [keep]);
    for (const user of users) await this.put('mg_users', user.id, user);
  }

  async loadSettings() {
    const result = await this.pool.query('SELECT data FROM mg_settings WHERE id = $1', ['app']);
    return result.rows[0]?.data ?? {};
  }

  async saveSettings(settings) {
    await this.put('mg_settings', 'app', settings);
  }

  async loadRounds() {
    return this.rows('mg_rounds');
  }

  async saveRounds(rounds) {
    const keep = rounds.map((round) => round.id);
    if (keep.length === 0) await this.pool.query('DELETE FROM mg_rounds');
    else await this.pool.query('DELETE FROM mg_rounds WHERE NOT (id = ANY($1::text[]))', [keep]);
    for (const round of rounds) await this.put('mg_rounds', round.id, round);
  }

  async close() {
    await this.pool?.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------

/**
 * 选后端：有 DATABASE_URL（或 POSTGRES_URL）就用 Postgres，否则用文件。
 * @param {{ dataDir: string, onWrite?: (file: string) => void }} options
 */
function createStorage({ dataDir, onWrite = null }) {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (url) {
    console.log('[storage] 使用 Postgres 持久化');
    return new PostgresStore(url);
  }
  console.log('[storage] 使用本地文件（配合 git-sync 写回仓库）');
  return new FileStore(dataDir, onWrite);
}

module.exports = { createStorage, FileStore, PostgresStore };
