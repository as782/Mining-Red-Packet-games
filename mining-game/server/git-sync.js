'use strict';

// 免费版没有数据库时，把数据写回 GitHub 仓库，这样每次一键部署都能带着上一次的数据。
//
// 原理：容器每次部署都是全新的（本地文件会丢），但仓库里的文件不会丢。
//   - 启动时：本地 data/ 已经是从仓库 checkout 出来的，直接读，等于“恢复上次的数据”。
//   - 运行时：数据一变，攒几秒，用 GitHub API 把 data/*.json 提交回仓库。
//   - 下次部署：仓库里是最新的数据，自动就恢复了。
//
// 需要两个环境变量（都免费）：
//   GITHUB_TOKEN  有 repo 写权限的 token（fine-grained 只给 Contents: Read and write 就够）
//   GITHUB_REPO   owner/name，例如 as782/Mining-Red-Packet-games
// 可选：
//   GITHUB_BRANCH 默认 main
//   GITHUB_DATA_PATH 仓库里存数据的目录，默认 mining-game/data

const fs = require('node:fs');
const path = require('node:path');

const API = 'https://api.github.com';

class GitSync {
  constructor({ token, repo, branch = 'main', dataPath = 'mining-game/data', dataDir, files }) {
    this.token = token;
    this.repo = repo;
    this.branch = branch;
    this.dataPath = dataPath.replace(/\/+$/, '');
    this.dataDir = dataDir;
    this.files = files;
    this.enabled = Boolean(token && repo);
    this.pending = null;
    this.timer = null;
    this.sha = new Map();
    this.busy = false;
    this.lastError = null;
    this.lastSyncAt = null;
  }

  get status() {
    return {
      enabled: this.enabled,
      repo: this.repo || null,
      branch: this.branch,
      path: this.dataPath,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      pending: Boolean(this.timer),
    };
  }

  async headers() {
    return {
      authorization: `Bearer ${this.token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'mining-game-sync',
      'content-type': 'application/json',
    };
  }

  /** 读一个文件当前的 sha（更新时必须带）。 */
  async shaOf(file) {
    const url = `${API}/repos/${this.repo}/contents/${this.dataPath}/${file}?ref=${this.branch}`;
    const response = await fetch(url, { headers: await this.headers() });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`读 ${file} 失败：${response.status}`);
    const data = await response.json();
    return data.sha ?? null;
  }

  async put(file, content, message) {
    const sha = await this.shaOf(file);
    const url = `${API}/repos/${this.repo}/contents/${this.dataPath}/${file}`;
    const body = {
      message,
      branch: this.branch,
      content: Buffer.from(content, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
    };
    const response = await fetch(url, { method: 'PUT', headers: await this.headers(), body: JSON.stringify(body) });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`写 ${file} 失败：${response.status} ${text.slice(0, 160)}`);
    }
  }

  /** 数据变了：攒 5 秒再推，避免一次操作提交好几次。 */
  schedule() {
    if (!this.enabled) return;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 5000);
    this.timer.unref?.();
  }

  /** 立刻推一次（部署前、管理员手动备份时用）。 */
  async flush() {
    if (!this.enabled) return { ok: false, message: '没有配置 GITHUB_TOKEN / GITHUB_REPO' };
    if (this.busy) return { ok: false, message: '正在同步，稍等一下' };
    this.busy = true;
    try {
      for (const file of this.files) {
        const local = path.join(this.dataDir, file);
        if (!fs.existsSync(local)) continue;
        const content = fs.readFileSync(local, 'utf8');
        await this.put(file, content, `chore(data): sync ${file}`);
      }
      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;
      return { ok: true, at: this.lastSyncAt };
    } catch (error) {
      this.lastError = error.message;
      console.warn('[git-sync]', error.message);
      return { ok: false, message: error.message };
    } finally {
      this.busy = false;
    }
  }

  /** 启动时把仓库里的数据拉下来覆盖本地（一般不需要：checkout 已经是最新的）。 */
  async pull() {
    if (!this.enabled) return { ok: false };
    for (const file of this.files) {
      try {
        const url = `${API}/repos/${this.repo}/contents/${this.dataPath}/${file}?ref=${this.branch}`;
        const response = await fetch(url, { headers: await this.headers() });
        if (!response.ok) continue;
        const data = await response.json();
        const content = Buffer.from(data.content ?? '', 'base64').toString('utf8');
        fs.mkdirSync(this.dataDir, { recursive: true });
        fs.writeFileSync(path.join(this.dataDir, file), content, 'utf8');
      } catch {
        // 拉不到就用本地那份
      }
    }
    return { ok: true };
  }
}

function createGitSync(options) {
  const token = process.env.GITHUB_TOKEN || '';
  const repo = process.env.GITHUB_REPO || '';
  const sync = new GitSync({
    token,
    repo,
    branch: process.env.GITHUB_BRANCH || 'main',
    dataPath: process.env.GITHUB_DATA_PATH || 'mining-game/data',
    dataDir: options.dataDir,
    files: options.files ?? ['users.json', 'settings.json', 'rounds.json'],
  });
  if (sync.enabled) console.log(`[git-sync] 数据会写回 ${repo}@${sync.branch}:${sync.dataPath}`);
  else console.log('[git-sync] 没有配置 GITHUB_TOKEN / GITHUB_REPO，数据只留在容器里（部署会丢）');
  return sync;
}

module.exports = { createGitSync, GitSync };
