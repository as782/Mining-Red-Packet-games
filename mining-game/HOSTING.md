# 部署方案对比：哪家能真正保住数据

结论先说：**你要的是"免费 + 数据不丢 + 能跑 Node 长连接"**，那么只有一类方案满足——**带持久磁盘的免费容器**，或者**免费云服务器（VPS）**。

PaaS 免费层基本都清空本地文件（Abasthan、Render、Railway、Koyeb 都是），差别只在"能不能挂磁盘""磁盘要不要钱"。

---

## 一句话推荐

| 你的情况 | 选这个 |
| --- | --- |
| 不想折腾、不想绑卡 | **Railway 免费版**（0.5 GB 卷，免费） |
| 想长期稳定、能接受注册时要卡 | **Oracle Cloud 永久免费 ARM 服务器**（4 核 24 GB，送 200 GB 磁盘） |
| 只想要个便宜的固定小服务器 | **Hetzner / 阿里云 / 腾讯云 学生机**（约 ¥5–20/月） |
| 就想留在 Abasthan | 接一个**免费外部数据库**（Neon / Turso），代码已支持 |
| 想用 Vercel | **不推荐**跑这个游戏，除非改成无状态 + 外部数据库 + 外部房间（见下） |

---

## Vercel 能不能跑？——技术上能，但这个游戏不适合

Vercel 这两年补了很多东西，先纠正几个常见误解：

- ✅ **WebSocket 支持**：Vercel Functions 原生支持，所有计划都能用（`ws`、Socket.IO 都行）
- ✅ **容器支持**：根目录放 `Dockerfile` 就能部署，按 Fluid compute 计费
- ✅ **持久化**：Vercel Blob（对象存储）、Global Config、Marketplace 数据库（Neon/Upstash/Supabase）

但有三条硬约束，正好都踩在这个游戏的痛点上：

### 1. 没有"进程"，就没有 1 秒心跳

这个游戏靠 `setInterval(..., 1000)` 每秒钟推进房间状态：不领的人被苦力怕炸、到点结束、奖池分完收尾。

Vercel Functions 是**按请求唤醒、空闲 5 分钟缩容到 0** 的。没有请求就没有进程，`setInterval` 不会跑。Hobby 的 Cron 又限制**每天只能跑一次**，救不了。

后果：没人挖的时候，苦力怕不会炸人、到点不会结束，直到下一个请求把它唤醒才"补算"一次——计时会漂。

### 2. WebSocket 连接会断，而且不保证落在同一实例

Vercel 文档明确写了两点：

> A single WebSocket connection is pinned to one Vercel Function instance.
> **New WebSocket connections are not guaranteed to reach the same Vercel Function instance.**

而且连接**受 Function 最大时长限制**——Hobby 是 300 秒（5 分钟）。到点连接就被切断，客户端得重连，然后可能落到另一个实例。

这个游戏的"在场"（别人的鼠标、谁在看哪张卡）和"实时挖掘推送"都是内存状态（`clients`、`presenceSeats` 两个 Map）。多实例之间不共享，A 在实例 1 挖，B 连在实例 2 就收不到。

Vercel 官方给的解法是"把状态放外部存储"（Redis / 数据库），也就是要重写这一层。

### 3. 本地文件必然丢

Functions 的文件系统是临时的，缩容就清空。`Drives` 是给 Sandbox 用的（挂到沙箱里当工作目录），不是给 Functions 用的。Daemons（常驻容器）文档里也写了 **不支持持久本地存储**。

所以数据必须进数据库或 Blob。

### 如果非要用 Vercel，得这样改

| 现在 | 改成 |
| --- | --- |
| `setInterval` 每秒 tick | 每次请求进来时按时间戳补算（惰性结算），或用 Pro 的每分钟 Cron |
| 房间状态在内存 Map | 存 Redis（Upstash 免费 250 MB） |
| 推送靠进程内广播 | 用 Upstash Redis Pub/Sub 或 SSE 轮询 |
| 数据存本地 JSON | Neon Postgres（`DATABASE_URL`，代码已支持） |
| 在场功能 | Redis 存 hash + 定时过期 |

工作量不小，而且 Hobby 的 4 CPU-hrs / 360 GB-hrs 额度，跑一个常驻长连接服务容易烧完（连接活跃期间**一直算** provisioned memory）。

**结论**：Vercel 适合"请求-响应"型应用。这个游戏是"常驻房间 + 定时器 + 长连接"，属于它的弱项。除非你愿意重写状态层，否则不划算。

> 顺带说明：Vercel 的 Hobby 免费额度本身不算小（100 GB 流量、100 万次调用、4 CPU 小时），跑个人小站完全够。只是这个游戏的形态不匹配。

---

## 详细对比

### 1. Railway（推荐给"想一键部署"）

- 免费版：**$1/月额度**、1 个项目、3 个服务、每服务 1 vCPU / 0.5 GB
- **有 0.5 GB 持久卷**，免费版就能挂
- 服务空闲会睡眠，有请求自动唤醒
- 支持 GitHub 直连，推 main 自动部署
- 数据库模板：Postgres / Redis / MySQL / MongoDB

⚠️ 0.5 GB 卷 + $1 额度够跑这个游戏（数据只有几十 KB），但如果流量大，额度会烧得快。

**配置：**
1. railway.app 用 GitHub 登录 → New Project → Deploy from GitHub repo
2. Root Directory 填 `mining-game`
3. 加 Volume，挂载路径 `/app/data`
4. 环境变量：`DATA_DIR=/app/data`、`ADMIN_PASSWORD=xxx`、`TICKET_KEY=xxx`

---

### 2. Oracle Cloud 永久免费（推荐给"想一劳永逸"）

**Always Free 是永久免费的，不是试用。**

| 资源 | 额度 |
| --- | --- |
| ARM Ampere A1 | **4 OCPU + 24 GB 内存**（1500 OCPU 小时 + 9000 GB 小时/月） |
| AMD Micro | 2 台（1/8 OCPU、1 GB 内存） |
| 块存储 | **200 GB** |
| 出站流量 | 10 TB/月 |
| 对象存储 | 20 GB |

这是目前免费额度最夸张的。跑这个游戏连零头都用不到。

⚠️ 注意：
- 注册要**信用卡/借记卡验证**（不扣费，只验证）
- 空闲实例可能被回收：7 天内 CPU 95 分位 <20%、网络 <20%、内存 <20% 会被判定闲置
- 国内访问速度一般（可选日本/新加坡/首尔区域）

**部署步骤：**
```bash
# 1. 创建 Ubuntu 22.04 ARM 实例（2 OCPU / 12 GB 就够）
# 2. 开放 80/443 端口（安全列表 + ufw）
sudo apt update && sudo apt install -y nginx git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 3. 拉代码
git clone https://github.com/as782/Mining-Red-Packet-games.git
cd Mining-Red-Packet-games/mining-game
npm install

# 4. 用 systemd 常驻
sudo tee /etc/systemd/system/mining.service > /dev/null <<'EOF'
[Unit]
Description=Mining Game
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/ubuntu/Mining-Red-Packet-games/mining-game
Environment=PORT=3000
Environment=DATA_DIR=/home/ubuntu/mining-data
Environment=ADMIN_PASSWORD=换成你的密码
Environment=TICKET_KEY=换成一串随机字符
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now mining

# 5. Nginx 反代（含 WebSocket）
sudo tee /etc/nginx/sites-available/mining > /dev/null <<'EOF'
server {
    listen 80;
    server_name 你的域名或IP;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }
}
EOF
sudo ln -s /etc/nginx/sites-available/mining /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

数据就在 `/home/ubuntu/mining-data`，**重启、更新代码都不会丢**。

---

### 3. 其他免费 PaaS（都有坑）

| 平台 | 免费额度 | 持久化 | 坑 |
| --- | --- | --- | --- |
| **Render** | 750 小时/月、0.1 CPU/512 MB | ❌ 免费版**不能挂磁盘**；免费 Postgres **30 天过期** | 15 分钟无流量睡眠，唤醒要 1 分钟 |
| **Koyeb** | 已取消免费层 | — | 现在最低 $29/月 |
| **Fly.io** | $5/月额度（需绑卡）；不绑卡只有 $1、7 天 | ✅ 有卷（5 GB 上限），但**算钱** | 绑定卡才给 $5，容易超 |
| **Zeabur** | 免费版只能管自己的服务器 | ❌ | 相当于没给资源 |
| **Vercel** | 100 GB 流量、100 万次调用、4 CPU 小时 | ⚠️ 有 Blob / Marketplace 数据库，但 Functions 无本地持久 | 无常驻进程（`setInterval` 不跑）；WebSocket 5 分钟断、不保证同实例 |
| **Abasthan** | 512 MB / 0.1 vCPU | ❌ 无磁盘、无免费数据库 | 就是你现在的困境 |

**Render 特别说明**：它免费版明确写了 "Free web services *cannot* attach a persistent disk"，所以只能用外部数据库。

---

### 4. 免费数据库（搭配任意 PaaS）

如果不想换平台，给 Abasthan 接一个免费数据库即可。**代码已经支持，只要设 `DATABASE_URL`。**

| 服务 | 免费额度 | 适合度 |
| --- | --- | --- |
| **Neon**（Postgres） | 100 个项目、每个 1 GB 存储、100 CU 小时/月、**5 分钟不活动自动挂起** | ⭐⭐⭐ 最推荐，纯 Postgres |
| **Turso**（SQLite） | 100 个库、5 GB、5 亿行读/月 | ⭐⭐ 需要改代码适配 |
| **Supabase**（Postgres） | 500 MB 数据库、**1 周不活动项目暂停** | ⭐⭐ 功能多但会暂停 |
| **Upstash**（Redis） | 250 MB、50 万命令/月 | ⭐ 只适合缓存，不适合主数据 |
| **Aiven** | 有免费 Postgres（1 GB） | ⭐⭐ |

**Neon 配置步骤：**
1. neon.tech 用 GitHub 登录 → Create Project
2. 复制连接串（形如 `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`）
3. Abasthan → Environment 加 `DATABASE_URL=<连接串>`
4. 重新部署，服务会自动建表

⚠️ Neon 免费版 5 分钟不活动会挂起，第一次请求会慢 1–2 秒，之后正常。对这个游戏完全够用。

---

## 这个项目的数据有多大？

```
users.json     约 1 KB / 100 个用户
settings.json  约 0.3 KB
rounds.json    约 0.8 KB / 局
rooms/*.json   每局约 2 KB（不持久化）
```

**一年几百个用户也就几百 KB。** 任何免费方案都绰绰有余，瓶颈从来不是容量，而是"平台会不会清空容器"。

---

## 我的建议

**如果你能接受注册时验证一张卡** → 直接上 **Oracle Cloud 永久免费 ARM**。一次配置，以后 `git pull && systemctl restart` 就能更新，数据永远在磁盘上，不用任何 trick。

**如果完全不想绑卡** → **Railway 免费版 + 0.5 GB 卷**。数据量这么小，卷够用，且是官方支持的持久化方式，比我之前那个"写回 Git 仓库"干净得多。

**如果暂时不想动 Abasthan** → 花 5 分钟开个 **Neon**，把 `DATABASE_URL` 填进去。代码已经写好了，这是改动最小的方案。

那个写回 Git 仓库的方案（`server/git-sync.js`）我保留了，但**只在没配 `DATABASE_URL` 时才会启用**，你可以当兜底。它的缺点是会把用户数据提交进仓库历史，公开仓库不太合适。

---

## 附：各平台免费层速查

| 平台 | 免费计算 | 免费持久磁盘 | 免费数据库 | 需要绑卡 |
| --- | --- | --- | --- | --- |
| Oracle Cloud | 4 OCPU / 24 GB ARM | ✅ 200 GB | ✅ 2 个自治库 | ✅ 验证 |
| Railway | 1 vCPU / 0.5 GB | ✅ 0.5 GB | ✅ 模板 | ❌ |
| Render | 0.1 CPU / 512 MB | ❌ | ✅ 但 30 天过期 | ❌ |
| Fly.io | $5 额度 | ✅ 但算钱 | ✅ Managed PG $4 | ✅ |
| Abasthan | 0.1 vCPU / 512 MB | ❌ | ❌ 免费版 | ❌ |
| Koyeb | ❌ 已取消 | — | — | — |
| Zeabur | 仅自有服务器 | ❌ | ❌ | ❌ |
| Vercel | 100 万次调用 / 4 CPU-hrs | ❌ Functions 无 | ✅ Blob / Neon / Upstash | ❌ |

