# 矿洞夺宝 · 账户版

原版「矿洞夺宝」的**完整 1:1 游戏界面**（原版 React + Canvas 页面），外面套一层账户与多局系统：

- 注册 / 登录，密码 scrypt 加盐哈希，HttpOnly Cookie 会话
- **多局并行**：管理员可以开任意多局，房主按设置限量开，普通玩家只能进别人开的局
- **对局大厅**：所有进行中的局都列出来，谁开的、还剩多少奖池、几人已领，任何人都能看到
- **用户管理**：管理员可以改角色、设开房上限、改积分、重置密码、停用、删除
- **系统设置**：是否允许房主开局、每人最多开几局、镐子上限（不再锁死 99）、奖池上限、是否开放注册
- 领取的积分**直接记到账户余额**，结束时未领取的自动结算
- 房主/管理员结束一局时，游戏内的玩家会立刻收到「这一局结束了」提示
- 别人的鼠标指针、谁在看哪张卡（原版在场功能）

![对局大厅](preview-lobby.png)

![用户管理](preview-users.png)

![游戏界面](preview-game.png)

## 快速开始

需要 Node.js 20+。

```bash
cd mining-game
npm start
```

打开 <http://127.0.0.1:4173>。**第一个注册的账号自动成为管理员。**

也可以预设管理员：

```powershell
$env:ADMIN_USERNAME='admin'; $env:ADMIN_PASSWORD='你的密码'; npm start
```

## 角色

| 角色 | 能做什么 |
| --- | --- |
| 管理员 admin | 开任意多局、管理所有用户、改系统设置、结束任何人的局 |
| 房主 host | 自己开局（数量受系统设置或单独设置限制），只能结束自己开的局 |
| 普通玩家 player | 进入别人开的局挖矿，不能开局 |

管理员在「用户管理」里把玩家改成房主，他就有了开房按钮。

## 开一局的配置

| 参数 | 说明 |
| --- | --- |
| 这一局的名字 | 留空自动叫「第 N 局」 |
| 奖池积分 | 本局总奖池，受系统设置的上限约束 |
| 预计人数 | 用来算每颗绿宝石的价 |
| 每人挖几次 | **默认上限 999**，可以在系统设置里改（原版写死 99，已放开） |
| 本局时长 | 1–10080 分钟（最长 7 天） |
| 难度 / 挖掘间隔 / 末影之眼 / 苦力怕 | 原版参数 |
| 奖励模式 | 按奖池分，或自己定价 |

## 系统设置（管理员）

- **允许房主开局**：关掉后房主不能再开新局（已有的局不受影响）
- **每个房主同时最多几局**：0 = 不限
- **管理员同时最多几局**：0 = 不限
- **每人最多挖几次的上限**：默认 999
- **奖池上限**：默认 1000000
- **允许注册**：关掉后只有已有账号能登录

## 目录

```
mining-game/
├─ server.js              # 账户、大厅、多局、用户管理、原版页面接口（/v3/api）、hb 桥（/api/hb）
├─ server/
│  ├─ accounts.js         # 注册、登录、会话、积分、角色、系统设置
│  ├─ rounds.js           # 每一局 = 一个 MineRoom + JSON 存储 + 领取凭证校验
│  └─ ws.js               # 极简 WebSocket 服务端（实时推送 + 在场）
├─ vendor/                # 原版规则与房间（game/shared、game/worker）
├─ web/                   # 原版 v3 前端源码（React + Canvas）
└─ public/
   ├─ index.html          # 登录 / 注册 / 大厅 / 用户管理 / 设置
   ├─ app.js
   ├─ styles.css
   └─ game/               # 构建好的原版游戏页面
```

## 数据

- `data/users.json`：账户、积分、角色、开房上限
- `data/settings.json`：系统设置
- `data/rounds.json`：每局的记录（进行中 + 历史）
- `data/rooms/<局编号>.json`：每一局的房间存档（临时状态，不提交）

`users.json` / `settings.json` / `rounds.json` **跟着仓库走**：免费版没有数据库，靠它们恢复数据。

服务重启时进行中的局会标记为结束，账户积分和局记录保留。

## 构建前端

`public/game/` 已包含构建产物；改了 `web/` 之后重新构建：

```bash
npm run build:web
```

Windows 上如果 `vite build` 报 `esbuild ... Access is denied`，是因为项目路径含空格；把项目复制到 `C:\mg` 之类的短路径再构建，或直接把产物放进 `public/game/`。

## 部署到 Abasthan

**免费版没有数据库也没有持久磁盘，容器每次部署都会重置。** 配好 `GITHUB_TOKEN` + `GITHUB_REPO` 后数据会自动写回仓库，重新部署就不丢——详见 [DEPLOY.md](DEPLOY.md)。

Web Service → Node.js 22：

| 配置 | 值 |
| --- | --- |
| Root Directory | `mining-game` |
| Build Command | `npm install`（前端产物已提交） |
| Start Command | `npm start` |
| Port | 使用平台注入的 `PORT`（服务监听 `0.0.0.0`） |

环境变量：

```dotenv
# 建议
ADMIN_PASSWORD=你的管理员密码
TICKET_KEY=一串随机长字符串

# 免费版保住数据（方案 A）
GITHUB_TOKEN=github_pat_xxx
GITHUB_REPO=as782/Mining-Red-Packet-games

# 或者有数据库时（方案 B）
# DATABASE_URL=postgres://user:pass@host:5432/db
```

配好后管理员「系统设置」页会显示同步状态，还有一个「立即写回仓库」按钮。

## 与线上原版的区别

- 身份来自本服务的账户，不需要 LINUX DO 登录或 hb.lafi.sh 红包页。
- 领取不走判定器：本服务自己校验 `MineRoom` 签的凭证，通过后直接入账。
- 放开了一局只能开一局、镐子最多 99 的限制。
- 单位是「积分」，1 积分 = 100 个规则最小单位，页面按 `0.01` 显示两位小数。

## 素材

`public/game/assets/minecraft/` 下的贴图和模型版权属于 Mojang，仅用于本地演示；公开发布前请自行确认授权，或替换成占位图。
