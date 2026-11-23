# 部署与数据持久化

Abasthan 免费版**没有数据库、也没有持久磁盘**：每次一键部署都会拉取最新 `main`、构建一个全新的容器，容器里的本地文件全部重置。所以默认情况下“部署一次，账号和积分就没了”。

这个项目用三种方式保住数据，按你的套餐选一种即可。

## 方案 A：写回 Git 仓库（免费版推荐）

原理：数据文件就在仓库里（`mining-game/data/`），运行时数据一变就通过 GitHub API 提交回仓库；下次部署 checkout 下来就是上次的数据。

### 1. 建一个 GitHub Token

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token：

- Repository access：只选 `Mining-Red-Packet-games`
- Permissions → Contents：**Read and write**
- 其他权限都不需要

### 2. 在 Abasthan 里加环境变量

服务 → Environment：

```dotenv
GITHUB_TOKEN=github_pat_xxxxxxxx
GITHUB_REPO=as782/Mining-Red-Packet-games
GITHUB_BRANCH=main
GITHUB_DATA_PATH=mining-game/data
```

后两个可以省略（默认就是上面这两个值）。

### 3. 确认生效

用管理员登录 → 「系统设置」页，会显示：

> 数据会写回 **as782/Mining-Red-Packet-games**@main（mining-game/data）· 上次同步：…

那里还有一个「立即写回仓库」按钮，部署前点一下最保险。

### 注意

- 数据提交会出现在仓库的 commit 记录里（`chore(data): sync users.json`）。**这是公开仓库的话，用户名和积分哈希会公开。** 介意的话把仓库改成 private，或改用方案 B。
- 密码是 scrypt 哈希，不是明文，但用户名和积分可见。
- 同步是攒 5 秒推一次，服务收到 SIGTERM 时会再推一次。

## 方案 B：用 Postgres（付费版）

Abasthan 的付费套餐带 PostgreSQL。建好数据库后，把连接串加到环境变量：

```dotenv
DATABASE_URL=postgres://user:pass@host:5432/dbname
```

服务会自动建表（`mg_users` / `mg_settings` / `mg_rounds`，都是 `id + jsonb`），不需要手动迁移。有了 `DATABASE_URL` 就不会再用 Git 同步。

首次启动会把容器里 `data/` 的数据读进数据库（如果仓库里有的话），之后以数据库为准。

## 方案 C：什么都不配

数据只留在容器里，**每次部署都会重置**。只适合临时试用。

「系统设置」页会用红字提示“重新部署会丢数据”。

## 本地开发

不配任何变量就是文件模式，数据在 `mining-game/data/`：

```bash
cd mining-game
npm start
```

## 数据里有什么

| 文件 | 内容 |
| --- | --- |
| `data/users.json` | 账号、密码哈希、积分、角色、开房上限 |
| `data/settings.json` | 系统设置（开房开关、上限、是否允许注册） |
| `data/rounds.json` | 每局记录（进行中 + 历史） |
| `data/rooms/<局编号>.json` | 单局房间存档（临时状态，不提交） |

## 备份与恢复

- 每次写 `users.json` / `rounds.json` 前会在同目录留一份 `.bak`（不提交）。
- 方案 A：仓库历史就是备份，任何一次提交都能 checkout 回来。
- 方案 B：用 Abasthan 的数据库备份功能。
- 手动备份：管理员「系统设置」→「立即写回仓库」，或直接下载 `data/` 三个 json。

## 部署检查清单

1. Root Directory 填 `mining-game`
2. Build Command：`npm install`
3. Start Command：`npm start`
4. 环境变量至少设置 `ADMIN_PASSWORD`，建议再配 `TICKET_KEY`（不配的话每次重启随机生成，登录会话失效但不影响数据）
5. 配 `GITHUB_TOKEN` + `GITHUB_REPO`（方案 A）或 `DATABASE_URL`（方案 B）
6. 部署后登录 → 「系统设置」确认同步状态不是红字
