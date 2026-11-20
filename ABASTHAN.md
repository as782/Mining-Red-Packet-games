# Abasthan Web Service 配置

仓库已经把原来的 Cloudflare Worker 后端补了一个 Node 版本：`server/index.mjs`。它复用原版
`game/shared/rules.mjs` 和 `game/worker/room.mjs` 的规则/状态机，只把 Durable Object、存储和
WebSocket 换成 Node 实现；前端仍是原版 v3 页面。

## Abasthan 面板填写

在 Abasthan **Create App → Web Service** 里这样填：

| 项目 | 值 |
| --- | --- |
| Repository | `as782/Mining-Red-Packet-games` |
| Branch | `main` |
| Runtime | Node.js 22 |
| Root Directory | 仓库根目录（留空或 `/`） |
| Build Command | `npm install --omit=dev && npm run build:page` |
| Start Command | `npm start` |
| Port | 使用平台注入的 `PORT`（`server/index.mjs` 已按 `process.env.PORT` 监听 `0.0.0.0`） |

`build:page` 会先 `npm run assets` 下载 Minecraft 素材，再安装并构建 `page/frontend` 的 v3 页面；
如果 Abasthan 的构建环境没有 `ffmpeg` / ImageMagick，素材脚本可能会提示音频或 GIF 转换失败。先看构建日志；
实在不行可以先把 `npm run assets` 放到本地执行并把 `page/frontend/public/assets/minecraft/1.21.4` 里的文件
提交上去（注意这些素材的版权属于 Mojang，仓库默认不带）。

## 环境变量

在 Abasthan 的 Environment 里至少设置：

```dotenv
HB_ORIGIN=https://hb.lafi.sh
PAGE_ORIGIN=https://你的应用名.abasthan.app
JUDGE_ID=你的判定器编号
MIN_JUDGE_VERSION=5
CLAIM_KID=k1
CLAIM_KEY={"kty":"EC","crv":"P-256","x":"...","y":"...","d":"..."}
TICKET_KEY=随机长字符串
DATA_DIR=/home/abasthan/app/data
```

说明：

- `PAGE_ORIGIN` 必须和红包页里打开的网页来源完全一致，也要和 `hb.identity()` 令牌的 `aud` 一致；自定义域名后要改。
- `JUDGE_ID` 是你发布到 hb.lafi.sh 的判定器编号；如果先用原站的判定器，领取凭证的私钥不在仓库里，签不出能通过验签的凭证。
- `CLAIM_KEY` 是 `judge.js` 里 `PUBLIC_KEYS` 对应私钥的 JWK。最稳的做法是生成自己的 P-256 密钥，把公钥写进自己的 `judge.js` 再发布成一个新判定器。
- `DATA_DIR` 用持久目录；如果 Abasthan 实例重部署会清空本地磁盘，就把 `server/index.mjs` 的 `JsonStorage` 换成 Redis/Postgres。

生成本地密钥对：

```bash
node -e 'crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]).then(async k=>{console.log("private",JSON.stringify(await crypto.subtle.exportKey("jwk",k.privateKey)));console.log("public",JSON.stringify(await crypto.subtle.exportKey("jwk",k.publicKey)))})'
```

把 private JWK 放进 `CLAIM_KEY`；把 public JWK 的 `x`、`y` 填进 `judge.js` 的 `PUBLIC_KEYS.k1`。

## 发布顺序

1. 在 hb.lafi.sh 发布自己的判定器（`judge.js` + `tests.json`）。
2. 在 Abasthan 创建 Web Service，填上面的仓库、构建、启动和环境变量。
3. 等 `/v3/` 页面能打开后，把 Abasthan 域名填到判定器的 `meta.page`，或者发红包时填“附带网页”地址。
4. 红包页会通过 `hb` SDK 嵌入 Abasthan 页面；不要在浏览器里直接打开 Abasthan 地址当游戏入口，单独打开会提示“请从红包页打开”。

## 本地检查

```bash
npm install
npm run build:page
npm start
```

打开 `http://127.0.0.1:3000/v3/`（本地单独打开仍需要红包 iframe；接口可用 `curl` 测）。
