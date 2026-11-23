# Railway 部署（免费版，带持久卷）

Railway 免费版**有 0.5 GB 持久卷**，这是它和 Abasthan / Render 免费层的本质区别：容器重建，卷里的数据还在。这个游戏一年也就几百 KB 数据，够用很久。

---

## 一、准备

1. [railway.app](https://railway.app) 用 GitHub 登录
2. 仓库：`as782/Mining-Red-Packet-games`，分支 `main`
3. 不需要信用卡

---

## 二、建服务

1. **New Project** → **Deploy from GitHub repo** → 选 `Mining-Red-Packet-games`
2. 进入服务 → **Settings** → **Source**
   - **Root Directory** 填 `mining-game` ⚠️ 重要，不填会用仓库根目录（那是上游判定器项目）
   - **Branch** 选 `main`
3. Railway 会自动读 `mining-game/railway.json`，用里面的 Dockerfile 构建

> 仓库根目录也放了一份 `Dockerfile` 和 `railway.json` 兜底：万一 Root Directory 没改，也能构建出正确的镜像（只是构建慢一点，因为上下文是整个仓库）。

---

## 三、挂持久卷

服务 → **Variables** 旁边的 **Volumes**（或右键服务 → **Attach Volume**）：

| 项 | 值 |
| --- | --- |
| Mount path | `/app/data` |

这是数据不丢的关键。镜像里已经把 `DATA_DIR` 设成 `/app/data`，卷挂上就能用。

### 第一次部署会自动带上仓库里的数据

卷第一次挂上来是**空的**，会遮住镜像里的 `mining-game/data/`。所以镜像构建时把仓库里那三个文件另存到了 `/app/seed`，服务启动时如果 `/app/data` 是空的，就自动复制过去：

```
[seed] 数据目录是空的，从 /app/seed 恢复了 2 个文件
[boot] 账号 2 个，历史 4 局，下一局编号 5
```

之后每次部署都用卷里最新的那份，`seed/` 只在数据目录为空时起作用。

---

## 四、环境变量

服务 → **Variables** → **New Variable**：

```dotenv
ADMIN_PASSWORD=换成你的管理员密码
TICKET_KEY=换成一串随机长字符串
```

可选：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | 如果以后要接 Postgres（Railway 自带模板），填上就自动切换，不再用文件 |
| `PORT` | 不用设，Railway 会注入；Dockerfile 里的 3000 只是本地默认值 |
| `COOKIE_SECURE` | 走 https 时自动判断，一般不用设 |

⚠️ `TICKET_KEY` 不设的话每次重启随机生成，已登录的用户会被踢下线（数据不受影响）。建议设上。

---

## 五、生成域名

服务 → **Settings** → **Networking** → **Generate Domain**

拿到类似 `mining-game-production-xxxx.up.railway.app` 的地址，打开就能用。

健康检查用的是 `/healthz`，返回：

```json
{ "ok": true, "uptime": 42, "storage": "file", "users": 2, "rounds": 0 }
```

---

## 六、确认数据不会丢

部署完成后，登录管理员 → **系统设置** 页，应该看到：

> 当前用 **本地文件** 存数据。⚠️ 没有配置 GITHUB_TOKEN / GITHUB_REPO，重新部署会丢数据。

**这条提示在 Railway 上可以忽略**——因为数据在持久卷里，不在容器里。那段提示是为 Abasthan 那种没有卷的平台写的。

验证方法：

1. 注册一个测试账号，记下积分
2. 在 Railway 点 **Redeploy**
3. 部署完再登录，账号和积分还在 → 卷生效了

---

## 七、日常更新

推代码到 `main`，Railway 自动构建部署。数据在卷里不受影响。

也可以在 dashboard 手动 **Deploy** → 选最新 commit。

---

## 八、常见问题

### 构建失败：`Railpack could not determine how to build`

Root Directory 没设成 `mining-game`，Railway 读了仓库根目录的 `package.json`（上游判定器项目）。

**解决**：Settings → Source → Root Directory 改成 `mining-game`。或者确认根目录的 `Dockerfile` 已推送（我放了一份兜底）。

### 构建失败：`npm ERR! network` 或 `ETIMEDOUT`

`package-lock.json` 里写了国内镜像 `registry.npmmirror.com`，Railway 在海外访问不了。

**已修复**：锁文件已重新生成为官方源 `registry.npmjs.org`。

### 部署成功但数据没了

卷没挂，或者挂到了别的路径。

**检查**：Volumes 里 Mount path 必须是 `/app/data`；日志里应该有 `data: /app/data（file）`。

### 服务启动就退出

看 Deploy Logs。常见原因：

- 端口没监听：Dockerfile 里 `CMD ["node", "server.js"]`，服务读 `process.env.PORT`（Railway 注入）
- 卷权限：镜像用 root 跑（非 root 需要卷属主配合，已去掉 `USER app` 避免这个问题）

### 免费额度

Railway 免费版每月 **$1 额度**、1 个项目、3 个服务、每服务 1 vCPU / 0.5 GB。这个游戏常驻很省，但**额度用完服务会停**，下个月恢复。想长期跑建议升 Hobby（$5/月）。

---

## 附：本地验证镜像

```bash
cd mining-game
docker build -t mining-game .
docker run -p 3000:3000 -v mg-data:/app/data \
  -e ADMIN_PASSWORD=admin123 -e TICKET_KEY=devkey mining-game
```

打开 <http://127.0.0.1:3000>，第一个注册的账号是管理员。
