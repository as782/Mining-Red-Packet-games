# Vercel 部署说明

先说结论：**这个仓库不是“直接点 Vercel 就能完整跑起来”的项目**。原版由三部分组成：

- `judge.js`：上传到 lafish 红包站，由红包站的沙箱运行，不在你的服务器上。
- `game/`：Cloudflare Worker + Durable Object + WebSocket + 本地 SQLite，负责地图、掉落、在线状态和签凭证。
- `page/`：React 附带网页，需要被红包页通过 `hb` SDK 嵌入，单独打开只能显示“请从红包页打开”。

## 方案 A：Vercel 只放附带网页（推荐先这样做）

Vercel 可以托管 `page/` 的静态构建，但游戏站仍然要放在 Cloudflare Worker（或你自己的 Node 服务）上：

1. 用 `page/frontend` 构建 production 版 v3 页面。
2. 把页面里的 `__API_BASE__` 指向你的游戏站地址。
3. 部署到 Vercel，把 Vercel 域名填到判定器的 `meta.page`。
4. 在游戏站 Worker 的 `PAGE_ORIGIN` 里放行这个 Vercel 域名，否则 `hb.identity()` 和游戏 API 的跨域会被拒绝。
5. 只打开 Vercel 链接时，页面会因为不在红包 iframe 里而提示“请从红包页打开”，这是正常的；要从红包页的“附带网页”进入。

## 方案 B：整套游戏部署到 Vercel

Vercel 的函数运行时没有 Cloudflare Durable Objects、WebSocket 房间和 SQLite 持久化，**不能直接部署 `game/worker/`**。要整套迁移，至少需要：

- 把 `game/worker/room.mjs` 的状态机迁到 Vercel Functions；
- 用 Redis / Postgres / Upstash 等外部存储保存每个红包的房间状态；
- 把 WebSocket 推送改成 Vercel 支持的实时方案（或轮询）；
- 重新实现 `game/worker/auth.mjs` 的身份校验和 `voucher.mjs` 的凭证签名；
- 修改 `page` 的 `__API_BASE__` 和 CORS 配置。

这不是改一个 `vercel.json` 能完成的，属于一次后端重写。如果你确定要，我可以下一步专门做一个 Vercel 版本。

## 方案 C：Vercel 前端 + Cloudflare Worker 后端

这是最省事、最接近原版的组合：Vercel 只放页面，`game/` 仍按原 README 部署到 Cloudflare。原仓库已经提供 Worker 和 `page/frontend` 的构建脚本，只需要调整 `__API_BASE__` 和 `PAGE_ORIGIN`。

## 当前仓库没有内置 `vercel.json` 的原因

原项目是 Cloudflare 项目，强行加一个只部署静态页的 `vercel.json` 会让人误以为整套游戏都能在 Vercel 运行。建议确认采用 A/C 哪种方式后，我再补对应的 Vercel 构建配置和部署脚本。
