# 矿洞夺宝

Minecraft 风格的多人挖宝红包，跑在 LINUX DO 社区的 [lafish 红包站](https://hb.lafi.sh) 上。发红包的人选好玩法和奖池，大家在一张越挖越大的地图上一起挖格子：挖到宝贝攒成待领取的奖励，踩到 TNT 会扣掉一部分，什么时候见好就收自己决定。

线上的网页是 <https://hbweb-kddb.lafi.sh/v3/>，要从红包页里打开：身份和红包信息都由红包站给。

本项目不是 Minecraft 官方产品，和 Mojang、Microsoft 没有关系。

## 怎么玩

- 地图从一张卡开始。挖到**末影珍珠**，旁边长出一张新卡（普通卡、废弃矿井或试炼密室）；挖到**末影之眼**，远处开出一个特殊区块（末地宝藏、深暗之域或下界），宝贝多，风险也大。
- 每人能挖几下由发红包的人定，挖到双铁镐另加 3 下。绿宝石、钻石、金苹果加奖励；TNT、末影水晶扣掉一部分待领取的奖励，盾牌能挡一次。
- 道具：望远镜看一格是什么；火把插在四格中间，颜色说这四格里有几个危险；还有藏宝图、试炼钥匙、附魔镐、末影箱。
- 点“见好就收”随时领取；次数用完自动领取；截止前 2 分钟停止挖掘，开着页面的人自动领取。截止时还没领的奖励作废，钱退回给发红包的人。
- 大家在同一张地图上：看得到别人挖开的格子、别人的指针、谁在看哪张卡，鼠标右键扔表情。
- 第一次进一个红包，先看到这一局的规矩：谁发的、难度、每人几下、奖池。“怎么玩”里也一直有。

格子、区块、道具的完整规则见 [docs/V3_ITEMS.md](docs/V3_ITEMS.md)。

## 发红包时填什么

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| 玩法 | 标准 | 轻松、标准、刺激。选一个，下面的难度、末影之眼、苦力怕自动填好，之后还能改 |
| 预计人数 | 20 | 1–2000。绿宝石值多少按奖池、人数和每人挖几下算，大约八成奖池能发出去 |
| 每人挖几次 | 20 | 1–99 |
| 难度 | 普通 | 简单、普通、困难：TNT 和末影水晶有多少，踩中扣掉待领取的多少 |
| 挖掘间隔 | 1 秒 | 1、3、10、30 秒 |
| 末影之眼 | 正常 | 少、正常、多：每 5、3、2 张卡藏一颗 |
| 苦力怕 | 1 分钟 | 不开、1 分钟、3 分钟：手上有待领取的奖励、这么久没挖，苦力怕来炸掉 20% |

奖池、截止时间、标题是红包站的通用字段。LDC 红包、🐟额红包和三方积分红包都能用（`meta.points`）。

## 怎么做的

分三块：

- **判定器**（`judge.js`，在红包站上运行）：只管领取。游戏站给领取的人签一张凭证（`kd3.开放时间.用户编号.分.钥匙编号.签名`，ES256），网页用 `hb.submit` 交给判定器；判定器用写在代码里的公钥验签，按凭证上的数结算。
- **游戏站**（`game/`，Cloudflare Worker）：每个红包一个 Durable Object，存地图、每人的分和道具，处理挖格子、用道具和领取，用 WebSocket 把变化推给所有人。指针、谁在看、表情另开一个房间，不写存储。规则是纯函数（`game/shared/rules.mjs`），Worker 和测试共用；每局的随机种子只在服务端，结果能重放。
- **网页**（`page/frontend/v3/`，React）：作为红包的附带网页打开，用 `hb.identity()` 拿到身份令牌，去游戏站认人。

钱只在领取时动一次：游戏站记的是分，红包站不知道也不管，领取时按凭证结算。设计和取舍见 [docs/V3_MAP.md](docs/V3_MAP.md)。

## 本地运行

需要 Node.js 22 或更新版本。音效要 ffmpeg；附魔金苹果的静态图要 ImageMagick 或 ffmpeg。

```sh
npm ci
npm run assets
npm --prefix page/frontend ci
npm --prefix page/frontend run build:v3
```

`npm run assets` 只要跑一次：照仓库里的清单，从 Mojang 的官方地址和 Minecraft Wiki 取回网页用的贴图和音效，逐个核对散列（仓库里不带这些文件，见“素材”）。

游戏站要两把钥匙，写在 `game/.dev.vars`（不进仓库）。生成签凭证的私钥：

```sh
node -e 'crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]).then(k=>crypto.subtle.exportKey("jwk",k.privateKey)).then(j=>console.log(JSON.stringify(j)))'
```

```
CLAIM_KEY='上面打印的整段 JSON'
TICKET_KEY='一串足够长的随机字符'
```

领取时判定器用 `judge.js` 里 `PUBLIC_KEYS.k1` 验签。本地要走通领取，把这把钥匙的 `x`、`y` 临时换进去，别提交。

然后开两个终端：

```sh
cd game && npm run dev
```

```sh
npm run page
```

前一个是游戏站（`http://127.0.0.1:8787`），后一个是红包站开发包的模拟器（`http://127.0.0.1:8730`），宽屏、手机和几个人并排都能试。本地开局用固定的种子（`game/wrangler.jsonc` 的 `env.local.vars.LOCAL_SEED`），按规则算得出哪格是什么；删掉 `game/.wrangler/state` 重新开局。

## 测试

```sh
npm test
npm run check
npm --prefix game test
npm --prefix page/frontend test
npm --prefix page/frontend run typecheck:v3
```

前两个是判定器的测试和部署检查。`tests.json` 里的凭证用线上的私钥签，签的是 v3 上线以前的开放时间，对不上任何真红包；换了钥匙要用 `scripts/voucher.mjs` 重新签。

`node game/scripts/sim-items.mjs` 用真的规则跑几十局，看奖池能发出去多少、人和人差多少；`game/scripts/presence-bots.mjs` 用机器人压指针和表情的房间。

## 部署

```sh
npm --prefix page/frontend run build
npm --prefix page/frontend run build:v3
cd game && npm run deploy
```

`build` 是 v2 的网页，放在游戏站根路径上，开着的旧红包还在用。`npm run deploy` 先拼出 `game/dist/`（v2 在根上，v3 在 `v3/` 下）再部署；部署到 Stage 用 `node ../scripts/site.mjs && npx wrangler deploy --env staging`。线上要设 `CLAIM_KEY`、`TICKET_KEY` 两个 secret（`npx wrangler secret put`）。

自己部署一份时要改：`game/wrangler.jsonc` 里的账号、Worker 名、域名和 `HB_ORIGIN`、`PAGE_ORIGIN`、`JUDGE_ID`（判定器在红包站上的编号）；`judge.js` 里的 `meta.page` 和公钥。判定器（`judge.js` 和 `tests.json`）在红包站的“新判定器”页面发布。

## 仓库里有什么

| 路径 | 内容 |
| --- | --- |
| `judge.js`、`tests.json`、`simulate.json` | v3 判定器和它的测试 |
| `game/worker/` | 游戏站：接口和认人、每个红包的房间（`room.mjs`）、指针和表情的房间（`presence.mjs`）、推送 |
| `game/shared/` | 规则（`rules.mjs`）、区块摆法、凭证签名；游戏站和网页的测试共用 |
| `game/test/`、`game/scripts/` | 游戏站的测试、平衡模拟、压测机器人 |
| `page/frontend/v3/` | v3 网页（React、Jotai、Motion） |
| `page/frontend/src/`、`page/dev/` | v2 网页和它的本地多人试玩 |
| `page/frontend/public/assets/minecraft/` | Minecraft 素材的清单 |
| `page/index.html`、`page/assets/` | 给开发包模拟器（`npm run page`）的 v3 构建 |
| `scripts/` | 拼发布目录、取素材、签测试凭证 |
| `runtime/`、`cli/`、`examples/`、`AGENTS.md`、`judge.d.ts`、`page/hb.d.ts` | 红包站的开发包 |
| `docs/` | 设计和进度 |

## 旧版本

v2（一次一张卡，整局在判定器里跑）的判定器在标签 `v2.1`，网页源码在 `page/frontend/src/`。说明见 [DESIGN.md](DESIGN.md)、[docs/AUTHORING_V2.md](docs/AUTHORING_V2.md)，当时的验收记录见 [docs/VALIDATION.md](docs/VALIDATION.md)。

## 素材

方块、道具和音效用 Minecraft 1.21.4 原版的文件，版权属于 Mojang，仓库里只放清单（`page/frontend/public/assets/minecraft/1.21.4/` 下的 `manifest.json`、`inventory/provenance.json`、`sounds/provenance.json`），文件用 `npm run assets` 取。来源和校验见 [docs/MINECRAFT_ASSETS.md](docs/MINECRAFT_ASSETS.md)。

## 许可

代码用 MIT 许可（[LICENSE](LICENSE)），不包括 Minecraft 的素材。开发包的文件来自 [LeUKi/hb](https://github.com/LeUKi/hb) 的 `kit/`，也是 MIT，同步记录见 [docs/KIT_REFRESH.md](docs/KIT_REFRESH.md)。
