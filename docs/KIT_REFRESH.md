# 官方开发包同步记录

当前版本：2026-11-01 已原样同步至 `ed192c1fd98de2cea12cb6e8ce3710b21ea647dd`，包含官方模拟器时钟修复。下面 b86e8fb、823a8d9 与“只读核对”保留为历史；最新实际同步见文末。

2026-11-02：本批同步随 v2 源码与验证证据纳入 Git 提交。下文未推送、未部署的表述均为各次验证当时的状态；后续静态网页部署日志见 [VALIDATION.md](VALIDATION.md)。

2026-10-31 从 [LeUKi/hb](https://github.com/LeUKi/hb) 的 `kit/` 核对并同步，来源固定为提交 [`b86e8fb341a135b8760210666df0ff55a79f8528`](https://github.com/LeUKi/hb/tree/b86e8fb341a135b8760210666df0ff55a79f8528/kit)。这是本次检查时的官方 HEAD。

## 同步范围

本项目与该版本官方开发包相比，需要更新的官方文件只有 `AGENTS.md`、`judge.d.ts`、`runtime/params.mjs`，现均与固定来源逐字一致。其余 `runtime/`、`cli/`、类型、schema、示例、脚本配置和 `page/hb.d.ts` 已一致，无需替换。官方模板 `README.md` 保存在 `docs/UPSTREAM_KIT_README.md`。

保留自定义 `judge.js`、`tests.json`、`simulate.json`、附带网页与部署配置。本轮判定器只在 `export const hongbao` 中增加 `pageAutoOpen: true`，5×5 棋盘、道具数量、换卡时机和奖励规则均未修改。

## 自动打开附带网页

`pageAutoOpen` 是 `hongbao` 的建议默认值，不属于 `meta`。用本判定器新建红包时，主站会建议打开“进入红包页自动打开附带网页”；发红包的人仍可关闭，没有附带网页时不生效。它不会追改已经开放的红包。

主站仍保留首次访问某个附带网页网站的确认，以及用户主动关闭后的偏好。详情见固定来源的 [HongbaoRules 类型](https://github.com/LeUKi/hb/blob/b86e8fb341a135b8760210666df0ff55a79f8528/kit/judge.d.ts#L321) 与 [自动打开说明](https://github.com/LeUKi/hb/blob/b86e8fb341a135b8760210666df0ff55a79f8528/docs/attached-page-design.md#L106)。

## 并发优化与排队显示的边界

新版平台为第 5 版、不联网的判定器提供按顺序判定、批量读写数据库的优化；原有判定协议、随机流和共享状态传递方式保持一致。本游戏未导出 `network`，符合此范围。优化发生在红包站服务端，无需把队列或批处理逻辑写进 `judge.js`。本地 `npm run page` 也不模拟该生产并发吞吐量，不能用它证明线上容量。

具体“前面还有 N 人”目前是主站红包页的功能。服务端只向提交者推送一次内部 `{ type: "queued", ahead }` 消息，主站按后续已判定数递减。来源见 [并发设计说明](https://github.com/LeUKi/hb/blob/b86e8fb341a135b8760210666df0ff55a79f8528/docs/programmable-hongbao-design.md#L62)、[队列通知](https://github.com/LeUKi/hb/blob/b86e8fb341a135b8760210666df0ff55a79f8528/apps/api/src/durable-objects.ts#L642) 与 [主站排队文案](https://github.com/LeUKi/hb/blob/b86e8fb341a135b8760210666df0ff55a79f8528/apps/web/src/components/hongbao/my-judgments.tsx#L195)。

该版本附带网页 SDK 尚未提供人数读取接口或 `queue` 事件：官方 `page/hb.d.ts` 仅声明 `view`、`hongbao`、`announce`、`me`、`myView` 五种公开事件，主站 [page bridge](https://github.com/LeUKi/hb/blob/b86e8fb341a135b8760210666df0ff55a79f8528/apps/web/src/components/shell/page-bridge.ts#L379) 也未转发排队人数。因此游戏内可以呈现真实的提交中状态、他人判定进度及等待提示，但不能凭 `hongbao.judged` 推算“前面还有 N 人”。要在游戏内显示准确人数，需官方额外扩展 SDK 与宿主桥接；本项目没有伪造该接口。

## 本轮验证

在上述 kit 同步及 `pageAutoOpen` 一行修改后执行：

- `npm test`：56 / 56 通过。
- `npm run check`：56 / 56 通过，结论“可以去网站部署了”；代码指纹 `7e1d293679af16713516be0d440d56f66009a37d23690b7e0dfe64d917cbb400`。
- `node scripts/verify-setup.mjs`：13 项通过，验证同种子重放、不同种子差异、原有牌组与私有信息隔离。
- 使用官方 `readHongbaoRules` 直接验证：本游戏默认 `true`；`true`、`false` 均被接受；字符串被拒绝，合计 4 项通过。
- 官方管理文件逐字比对无差异，`git diff --check` 通过。

- 前端测试：53 / 53 通过；TypeScript 检查与生产构建通过，正式附带页产物已重新生成。
- 构建产物经实际 Chrome 验证：挖格、领取均显示对应等待文案，延迟回应期间格子与领取按钮禁用，奖励和机会不提前变化；真实鼠标重复点击不增加 SDK 请求，明确拒绝后恢复操作。使用本地 SDK 替身，没有真实红包提交。

这些结果证明本轮 kit、默认值及提交等待反馈通过本地验证；线上并发吞吐量仍由平台服务端决定。本轮没有推送或部署。

## 2026-11-01 最新文档与仓库核对

本次已将任务里的官方仓库快照更新到 [`823a8d9d08e96c23bde2b0dc8db947ddf3f1a843`](https://github.com/LeUKi/hb/commit/823a8d9d08e96c23bde2b0dc8db947ddf3f1a843)。这是文档与方案核对，项目正式开发包仍是上面的 `b86e8fb` 同步版本，没有在这次只读核对中替换 runtime、CLI 或模板。

- [线上参数文档](https://hb.lafi.sh/help/code#params) 已增加 `choice.options[].set` 与选项 `hint`。当前生产脚本 `index-osi78ZMl.js` 也含相同实现：选择时写入目标参数、更新选项说明；作者之后可手改，再选档重新套用，恢复草稿不覆盖保存值。官方实现与限制见 [参数规格](https://github.com/LeUKi/hb/blob/823a8d9d08e96c23bde2b0dc8db947ddf3f1a843/docs/judge-square-design.md#L64)。
- `set` 目标必须存在、不能是自己，值必须符合目标声明；默认选项的 set 与目标 default 一致。联动由表单事件执行，`paramValues` 不会替后端自动套预设。最新作者参数草案已使用此接口，并通过 41 项官方运行时及主站源函数检查；没有冒称线上表单的点击验收通过。
- 新增 [`hb.identity()`](https://hb.lafi.sh/help/page#sdk)，供附带网页自己的后端验证身份令牌。它和替用户提交共用许可；已有 private actorKey 的本游戏不需要为了区分本人而额外建立后端。
- `npm run page` 升级为宽屏、手机、同页 2–4 人模拟器；新增 `npm run page -- --shot` 截取 wide、phone、phone-open 三种布局及错误报告，`--play` 可先执行 simulate 场景。详见 [模拟器设计](https://github.com/LeUKi/hb/blob/823a8d9d08e96c23bde2b0dc8db947ddf3f1a843/docs/kit-simulator-design.md)。本次未运行新模拟器或截图命令。
- 提交反馈链路也有更新：收到判定结果即可显示，不再先等待额外一次“我的记录”读取。属于主站与桥接更新，本项目无需伪造提前结果。
- 排队人数仍未开放给附带网页：线上 SDK 和新版类型的公开事件依旧只有 view／hongbao／announce／me／myView，主站内部 queued.ahead 不等于游戏网页的可用接口。上次关于这部分边界的结论仍适用。

本次更新设计文档与参数草案，不实施尚待讨论的正式 v2 玩法；生产判定器与构建测试未因资料核对而重复运行。


## 2026-11-01 正式同步并接入 v2

用户授权实施后，从上述固定快照原样复制官方管理文件。最终逐字核对 80 个管理文件及官方 README 均一致，包含 runtime、CLI、AGENTS、类型、schema、示例与 package；保留项目自有判定器、测试、模拟、页面源代码与部署配置，没有将官方网页模板覆盖游戏页。根依赖按官方 package 增加 playwright-core 1.63.0 并更新锁文件，未引入应用依赖。

新原生难度选项使用官方 options[].set/hint；`pageAutoOpen: true` 与说明首行入口保留。`hb.identity()` 类型和新版宽屏／手机／多人模拟器已同步，本游戏继续使用 actorKey 识别自己，不新增自有鉴权后端。主站排队 ahead 仍未通过公开 SDK 转发，游戏不捏造人数。

正式 v2 的验证记录见 [VALIDATION.md](VALIDATION.md)。官方截图命令已运行，SDK 连接与页面资源检查通过；本轮没有改造官方 CLI 或运行时，也没有推送或部署。

## 2026-11-01 官方模拟器时钟修复同步

用户告知上游已修复后，重新 fetch，最新提交为 [`ed192c1fd98de2cea12cb6e8ce3710b21ea647dd`](https://github.com/LeUKi/hb/commit/ed192c1fd98de2cea12cb6e8ce3710b21ea647dd)。原样同步本项目的 `AGENTS.md`、`cli/lib/page.mjs`、`cli/page/host.html`；其余管理文件无需替换。再次逐字核对，80 个管理文件和官方 README 全部一致。SDK 本体不变，因为此前已支持 clock 事件。

修复覆盖 hello 时钟偏移、快进时先发 clock、重开后的新时间锚、模拟时间域的 cooldownUntil 与 identity.expiresAt。上游同时新增了源码测试与设计说明；本项目没有运行整个上游主站测试集，也没有自行改写官方 CLI。使用本项目实际浏览器核对后，游戏状态显示剩余 7 至 1 秒并在到期后解锁，其他玩家接棒提前解锁。另修正游戏前端状态文字动画滞留旧秒数的问题。

同步后官方测试／部署检查均 69／69，前端 63／63、类型和生产构建通过，官方三张截图命令通过。一次 check 出现 889ms 墙钟提醒，独立复跑最慢 20ms；原始日志是本机验收留档，没有放进仓库。详细证据和验证范围见 [VALIDATION.md](VALIDATION.md)。

## 2026-11-06 同步

从红包站仓库的 `kit/` 同步到提交 `ac382cc`：`AGENTS.md`、`judge.d.ts`、`page/hb.d.ts`、`runtime/`、`cli/`（新增 `cli/lib/signer.mjs`，本地模拟器签身份令牌和 `X-Hb-Token`，并回答 `/api/hongbao/test`）。`ac382cc` 修了官方开发包的一处导入成环（11-02 起 `npm test` 一启动就报 `SLOW_MS` 未初始化），这里同步的是修好的版本。

验证：`npm test` 73 / 73 通过，`npm run check` “可以去网站部署了”。判定器、测试、网页都没改。

## 2026-11-12 同步（三方积分）

从红包站仓库的 `kit/` 同步到提交 `a73c69f`（kit 最后一次改动）：`AGENTS.md`、`judge.d.ts`、`page/hb.d.ts`、`runtime/`、`cli/`、`examples/`、两个 schema，官方 README 放在 `docs/UPSTREAM_KIT_README.md`。新东西是三方积分红包（`meta.points`）：金额都是多少个最小单位，`hongbao.step`、`unit`、`points`，`tools.money.format()` 按最小单位写，红包信息多了 `units`。kit 里新加的 `.claude/skills`、`.cursor/rules`、`.gitignore` 没有搬（项目自己的配置）。判定器怎么接见 [V3_ITEMS.md](V3_ITEMS.md) §11。

验证：`npm test` 10 / 10（加了一条三方积分的），`npm run check` “可以去网站部署了”。
