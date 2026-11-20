# Design

## Source of truth
- Status: Active（v2 紧凑布局与作者参数已实现，验证记录见 docs/VALIDATION.md）
- Last refreshed: 2026-11-01
- Primary product surfaces: 矿洞夺宝，lafish 红包站代码协议第五版的多人附带网页；单一游戏页面、规则弹窗、本地多人联调页。
- Evidence reviewed: 用户提供的真实判定记录（只保留匿名统计）、Xbox 游戏无障碍指南 103/109/115/117、Portal 作者的教学关卡复盘；依据和局限见 `docs/UX_RESEARCH.md`。同时遵循官方 `AGENTS.md`、`judge.d.ts`、`page/hb.d.ts`、`examples/scratch-card/`、`cli/lib/page.mjs`。
- Official kit source: https://github.com/LeUKi/hb/tree/ed192c1fd98de2cea12cb6e8ce3710b21ea647dd/kit 。开发包运行时、CLI、类型与该固定上游一致，包含官方模拟器时钟修复；同步记录见 `docs/KIT_REFRESH.md`。
- Existing design evidence: 当时的桌面、手机截图（本机验收留档，没有放进仓库）和已实现的游戏页。最新用户要求：原版双铁镐表示额外机会、逐把展示机会、道具数量与问号合并、可恢复的底部日志、中央放大道具演出、单页规则弹窗、对角线翻卡，以及收敛背景。
- Design guidance: Anthropic `frontend-design` 的单一视觉重点、克制文案和截图自评；https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md 。

## Brand
- Personality: 有探索感的共享矿洞，像素道具与清晰、克制的游戏界面。
- Trust signals: 主界面展示实际待结算余额、逐把机会和剩余道具数量；规则在原页弹窗查看；成功判定后才揭示道具。
- Avoid: 隐藏次数额度、复杂背包系统、付费入口、未经确认的自动提交、把模拟奖励展示为真实到账。

## Product goals
- Goals: 两名以上玩家共享 5×5／6×6／7×7 卡片，默认每卡随机规格，交替挖掘，按道具改变自己的奖励和机会，可主动领取奖励并结束挖掘。首次操作前能理解机会耗尽会结束参与。
- Non-goals: 首版不增加攻击其他玩家、信标、道具交易、工具升级、固定座次、机会道具累计额度。
- Success signals: 打开即可看到棋盘、自己的奖励和机会；没有宣传区或常驻规则长文；桌面紧凑侧栏只承载个人操作；多人牌面同步；抢同格或旧卡操作不扣机会；资金、机会、结算均与判定器一致；手机能顺畅操作。

### Confirmed rules
1. 每人初始 7 次机会，可由红包参数修改。第一次成功挖掘加入游戏。
2. 每次成功挖掘先扣 1 次，再处理效果；效果处理完后机会为 0，立即结算。没有次数上限或机会道具累计额度。
3. 最近成功挖掘的人需要别人接棒，或等待默认 10 秒后才能再挖。A→B→A 可以立即接棒；平台自身冷却另外生效。
4. 不合法、已打开、卡片过期、等待未结束的操作不扣机会、不改变最近成功挖掘的记录。不自动重试提交。
5. 主动点「见好就收」领取奖励不消耗机会、不改变最近挖掘记录、不受游戏接棒等待限制；平台自身的提交限制仍适用。领取前确认将放弃剩余机会，结算 0 也退出，不能重新加入这个红包。
6. 机会、奖励和盾牌跨卡保留。末影珍珠立即换卡；本卡全部格子打开也自动换卡，不另扣次数。v2 每卡恰好 1 颗珍珠；旧版卡片及后续换卡继续原来的 25 格与 2 颗珍珠。
7. 所有金额用整数分计算。正收益最多占用剩余可分配奖池，扣款最低到 0。平台奖池占满或截止时全员结算。
8. 未打开的位置内容只存在服务端 state；公开剩余种类数量，不公开位置。望远镜情报只发本人。

下表数量为困难 5×5 的固定基准；完整三规格、三难度及浮动规则见文末 v2 契约。

| kind | Minecraft 物品 | 基准数量 | 效果 |
| --- | --- | ---: | --- |
| emerald | 绿宝石 | 11 | 一份小奖 |
| diamond | 钻石 | 3 | 小奖 ×5 |
| apple | 附魔金苹果 | 1 | 待结算奖励翻倍；余额为 0 时给一份小奖；填了 `appleCap` 时一次最多加这么多 |
| totem | 两把错位叠放的原版铁镐 | 2 | 扣除本次机会后增加 3 次；最后一次可救回，无累计额度；保留内部 kind 与判定器兼容 |
| tnt | TNT | 4 | 扣除当前待结算的指定百分比，扣除金额向下取整到分 |
| pearl | 末影珍珠 | 1 | 全体进入下一张卡；按固定或每卡随机规格发牌 |
| shield | 盾牌 | 2 | 自动抵挡下一次 TNT，最多持有一面；重复获得给小奖 |
| spyglass | 望远镜 | 1 | 私下查看一个尚未公开、自己尚未获知的格子；没有新格子可看时给小奖 |

### Hongbao parameters
- `difficulty`: choice，简单／困难／地狱，默认困难；原生 set 回填初始机会、TNT 比例和配比。
- `boardSpec`: choice，5／6／7／random，默认 random；每张新卡等概率抽取规格并存档。
- `initialChances`: integer，默认 7，1–20。
- `waitSeconds`: integer，默认 10，1–60。
- `smallReward`: money，默认 10 分，至少 1 分；默认只是首版试玩基数。
- `tntPercent`: integer，默认 25，1–100。
- `compositionVariation`: choice，fixed／slight，默认 slight；仅钻石、双铁镐、TNT、盾牌各独立 ±1，绿宝石补齐。每张卡实际构成生成后固定。
- 钻石 ×5、双铁镐 +3、每卡 1 颗珍珠固定。总奖池、截止、标题、说明使用平台设置。七个原生字段按文末约定平铺，无自绘作者表单。
- `check` 要求总奖池至少足够完整的一份钻石奖励；实际后续发奖仍按剩余奖池裁剪。参数为公开规则。

## Personas and jobs
- Primary personas: 从红包页进入的 LINUX DO 玩家；发红包的人；只看牌面的游客。
- User jobs: 知道能否操作、选格挖掘、观察余下风险、了解本人的道具和金额、决定继续挖或领取奖励。
- Key contexts of use: 手机抽屉或桌面附带网页；可随时进入，无需等全部玩家就座。

## Information architecture
- Primary navigation: 只有一个游戏页面；规则在原页弹窗中打开和关闭。
- Core routes/screens: `#/` 展示奖励、机会资源区、剩余道具入口、棋盘、状态和最近挖掘；规则、演示、领取确认和结算都用原页弹窗。
- Content hierarchy: 个人奖励、领取与机会为一组；棋盘区依次为本卡剩余道具与“怎么玩”、卡片编号和规格、固定外框的网格。手机个人资源在上、状态在棋盘后；桌面个人资源与状态在右栏。最近 10 条挖掘默认折叠在主区域下方。
- 当前实现桌面紧凑双列、手机单列，详见文末契约。新增的数量和日志只展示真实游戏信息，不恢复宣传区、背包容器、参与人数装饰或重复奖池；动态记录默认折叠。

## Design principles
- 服务端结果优先：网页展示实际判定结果，不自行决定奖励和秘密牌面。
- 一眼知道下一步：明确区分能挖、等待、平台冷却、已结算、红包结束。
- 保持少量规则：一把原版铁镐对应一次剩余机会，逐把排列且不截断；额外机会道具由两把原版铁镐错位叠放；盾牌一个状态；望远镜情报直接标在本人格子上。
- 先删信息，再排字号：主界面每段文字必须帮助当前动作；规则和边界情况按需查看。
- 棋盘是静止时的视觉重点；触发后中央道具短暂接管注意力。背景仅保留低对比洞壁，删除木梁、火把、矿轨、晶簇与环境粒子。
- Tradeoffs: 点击与轻拖都能挖；刮开动作保留触感，但不以精细刮擦作为可用性门槛。

### Main surface
- Type: 中文继续用系统苹方/思源回退，避免在线字体依赖；金额使用同字体的等宽数字。正文 16px，辅助标签和格子效果至少 14px，主界面金额 32–36px。
- Layout: 居中、最大约 480px 的单列游戏台，文字左右对齐，棋盘保持正方形；较矮桌面窗口按可用高度缩减游戏台宽度，保留按钮可见和格子点击尺寸。

```text
可领取奖励                  [ 见好就收 ]
0.00 LDC
挖掘机会                         7 次
⛏ ⛏ ⛏ ⛏ ⛏ ⛏ ⛏
一把挖一格 · 用完自动结算
本卡剩余                     [? 怎么玩]
道具图标与数量
第 1 张卡片       [已持盾时]
┌─────────────────────────────────┐
│             5 × 5               │
│              棋盘               │
└─────────────────────────────────┘
          选一格，挖开看看
挖掘动态

```

- Brief review: 避免仪表盘式堆叠与靠缩小文字容纳功能；桌面可用紧凑操作侧栏，但不增加装饰指标。移除通用宣传标题、卡片嵌套、状态点、重复坐标和按钮箭头。Minecraft 特征集中在矿石、物品和石槽，避免给安静的周边再加装饰。
- Verification: 检查 320／360／390／800／1060px 与三种规格共 15 个组合，网格作者名按 13／12／11px 适配，其他操作文字保持可读。帮助、领取取消、首次练习、接棒与跨规格换卡均做实际浏览器核验，详见 docs/VALIDATION.md。

## Visual language
- Color: 深灰蓝背景 `#13191f` 与低对比岩壁；石面使用原版纹理；暖白文字 `#f5e7cf` 和柔和琥珀强调。背景不与前景争夺颜色和轮廓。
- Typography: 中文使用系统苹方/思源黑体回退；金额和次数使用等宽数字。正文 16px，标签和格子效果至少 14px。
- Spacing/layout rhythm: 4px 基础节奏，主要间距 8/12/16/24/32；游戏内容最大约 480px。
- Shape/radius/elevation: 棋盘采用石槽和方块边缘；机会用一个低对比容器绑定图标与数字，其他个人信息直接排在背景上。
- Motion: 按确认事件使用「裂纹 → 中央道具放大及文字停留 → 飞行/淡出 → 同步数值及牌面 → 按需翻卡 → 结算」。中央说明必须有足够阅读时间；下方联动延后，常规拾取不震屏。
- Imagery/iconography: 平面道具使用从 Minecraft Java 1.21.4 官方客户端提取的原始纹理；TNT、盾牌、箱子等使用 Minecraft Wiki 的原版背包渲染图，来源与具体生成版本的边界单独记录。禁止用原创 SVG 冒充 Minecraft 道具。矿洞背景是独立原创 SVG 环境插画，来源记录见 docs/MINECRAFT_ASSETS.md。

## Components
- Existing components to reuse: 原有 ItemIcon、Jotai 状态、提交恢复流程、公开 feed 和官方 SDK；保留判定器及其数据契约。feed 来自持久 state，最多 10 条且跨卡保留，不新增浏览器历史缓存。
- New/changed components: AppShell、MineBoard、MineCell、ItemIcon、TurnStatus、PlayerSummary、LootDashboard、RulesDialog、ActivityLog、BoardFeedback、SettlementDialog。
- Variants and states: 格子隐藏/正在提交/公开/本人私有情报；本人状态初始/游戏中/已结算；接棒允许/等待。
- Token/component ownership: `page/frontend/src/styles.css` 管理视觉变量；React 组件复用同一个 ItemIcon 和金额格式化工具。

## Accessibility
- Target standard: 以 WCAG 2.2 AA 可用性为目标，清楚的文字对比与焦点。
- Keyboard/focus behavior: 每个格子是有坐标的 button，Enter/Space 可操作；弹窗具备焦点管理、Escape 和遮罩点按关闭；按下与松开都在外侧才关闭，弹窗内部留白和向外拖动不误关。领取确认的外侧关闭仅取消。
- Contrast/readability: 状态同时用文字和图标表达，不只靠颜色。
- Screen-reader semantics: 格子包含坐标和公开状态；未开的秘密不进入 DOM；奖励与错误使用温和的 aria-live。
- Reduced motion and sensory considerations: MotionConfig reducedMotion=user，并用媒体查询订阅实时偏好变化；保留中央说明约1.2秒，关闭飞行、震动与三维翻转，不使用频闪。

## Responsive behavior
- Supported breakpoints/devices: 360px 及以上手机、平板和桌面浏览器。
- Layout adaptations: 支持固定/随机 5×5、6×6、7×7，桌面紧凑双列，窄屏单列。同一视口卡片外框保持一致；手机缩减留白，保留可读字号，避免整页横向滚动。
- Touch/hover differences: 手指短距离刮动或点按可提交，键盘等价；长距离滚动不会意外挖掘。

### Practice flow
- 与正式界面保持相同位置：奖励与右侧「见好就收」、其下机会与逐把镐子，再下是固定的练习格子盘。
- 第一次点任意练习格得到绿宝石；揭晓后可以点另一格继续，或在右上角领取示例奖励。不把下一次挖掘改成翻页按钮，不自动聚焦领取。
- 第二格固定展示 TNT 作为风险示例；练习使用本地样例，奖励和扣除按当前红包参数计算，既不读取秘密格子也不预测正式结果。
- 揭晓时文案讲本次效果，短暂展示后才更新示例数值；结束后只说明对应结束原因，不追加接棒、换卡和双铁镐知识点。
- 可以跳过、点外侧关闭或重试；关闭时取消练习中尚未完成的计时，不在看不见的地方继续。

## Interaction states
- Loading: 连接红包站，占位牌面不可挖。
- Empty: 尚未加入时显示初始次数与 0.00。首次浏览器访问提供可跳过、可重新打开的原地互动练习，固定标明「不消耗真实机会」「示例奖励」；演示不调用 SDK、不修改真实奖励、不展示秘密牌面。
- Error: 显示判定器或平台给出的原因；网络不确定时刷新本人记录和牌面，不自动重提。查询失败时保留牌面并锁住后续操作，通过“重新确认状态”恢复。
- Success: 以 SDK 实际 pending/settled 为准，中央道具说明后才更新格子和数值；公开挖掘记录在底部展示，最多10条。
- Disabled: 抢格失败不扣机会；游戏等待仍可领取；结算/结束后牌面可继续围观。机会只剩 1 次时，资源区持续提示，不被接棒倒计时替换。结算弹窗根据可靠状态区分机会用尽、主动领取、红包结束；未知时用中性说明。
- Offline/slow network: 锁住当前提交，保留可读牌面，失败给出人工重试/重新连接入口。

## Content voice
- Tone: 直接、轻松，使用简短的游戏提示。
- Terminology: 挖掘、挖掘机会、可领取奖励、见好就收（领取奖励并结束挖掘）、这个红包、接棒、换卡；结算后使用「继续围观」。不引入生命、耐久或能量。内部 `cashout` 与历史 `收手` 指令保留兼容。
- Microcopy rules: 10 秒等待只属于连续挖掘；清楚说明平台冷却；未结算金额不写成已到账。

## Implementation constraints
- Framework/styling system: React + TypeScript + TanStack Router 的 hash history + Jotai + Motion；CSS 原生变量，无新增组件库。
- Design-token constraints: 单一 CSS 变量来源；图标离线可用。
- Performance constraints: 判定器无依赖且单文件，50ms CPU；共用 state 64KB、公开 data 16KB、个人 state/data 各 4KB。历史有界，不记录全体玩家名单。
- Compatibility constraints: 原样保留官方 runtime、cli、类型、schema 与根 package.json；用户指定的前端依赖仅放在 `page/frontend/`。构建输出到 `page/index.html`、`page/assets/`。
- Test/screenshot expectations: `npm test`、`npm run check`；前端 typecheck/build；真实 workerd 多步判定测试；桌面/手机实际渲染、双人同步、私有情报隔离与抢同格验证。
- SDK: 使用 `hb.ready/view/me/myView/submit/on/now`；自己的 actorKey 与公共 lastMove.actorKey 比较，仅用于 UI，授权以 user.id 为准。以 `settled` 判断退出，包含 0 元结算。
- Local harness: 官方 npm run page 原样可用；另在 `page/dev/` 增加项目自有本地包装，轮询官方 API、推送 SDK 事件并校准模拟时钟，验证跨标签同步。该包装不参与静态发布。

### Data contract
- Commands: `dig <cardId> <1-based cell>`；`cashout` 或 `收手`。
- Public `view.data`: `{ version:2, cardId, size:5|6|7, composition:{kind:initialCount}, cells:[{ index, kind:null|kind, by:null|string, at:null|number, actorKey?:string }], counts:{kind:remaining}, rules:{version:2,difficulty,boardSpec,compositionVariation,initialChances,waitSeconds,smallReward,bigMultiplier:5,totemBonus:3,tntPercent}, lastMove:null|{actorKey,name,at,cardId,index,size}, stats:{digs,players}, feed:[{id,actor,actorKey,kind,text,at,cardId,index,size}] }`。v1 旧视图继续接受，规格固定解释为 5。
- Private `player.view.data`: `{ version:1|2, actorKey, chances, shield, peeks:[{cardId,index,kind}], digs, status:'playing'|'settled', lastResult:null|{kind,cardId,index,size?,amount,blocked,text} }`。事件的 size 是操作发生时的卡片规格，不能改用新卡规格解释旧事件。
- `index` 在数据中从 0 开始，指令中的格子从 1 开始。actorKey 使用稳定的玩家标识，仅用于匹配，不承担认证。
- Public feed 最多 10 条；私人情报仅保留当前卡；隐藏格子的 kind 必须为 null，不能带内部牌面或随机种子。

## Open questions
- [x] v2 作者参数与紧凑布局已实现，完整规格见 `docs/AUTHORING_V2.md`。七项原生平铺字段与官方选项联动已接入；难度预设仍待真实玩家体验校准，不承诺人均收益。
- [x] 用户已授权将网页发布至 Cloudflare Workers；正式地址 https://hbweb-kddb.lafi.sh/，Worker 为 `hbweb-kddb`，判定器 `meta.page` 已配置。只发布 `page/frontend/dist/`；身份、判定与结算继续由红包站提供。
- [ ] 默认小奖 0.10 和卡组比例属于首版试玩值，按实际参与人数与奖池消耗再调。
- [x] 已完成桌面、390px/360px 窄屏实际渲染检查及双人浏览器联调；截图是本机验收留档，触屏真机仍待复核。

## Quiet cave and confirmed event choreography (2026-10-31)

- Visual thesis: 低对比的大块洞壁只暗示空间，安静地衬托实际牌面；删除原背景的木梁、火把、轨道和晶簇。道具与石面继续使用原版 Minecraft 纹理。
- Composition: 中央深色区域干净，岩壁只在边缘轻微出现，手机减少更多环境细节；棋盘容器与每个格子的占位在换卡时保持不变。
- Materials: 岩层使用大轮廓和有限阴影，不使用全屏纹理噪点；石块不软弹。道具使用像素最近邻缩放，不重新绘制图标。
- HUD: 使用上文信息层级。机会数字和逐把铁镐位于同一个资源区；顶部奖励右侧的「见好就收」为次要按钮，不另设品牌标题行。中央道具反馈临时出现，规则和互动演示使用同一个带进出动画的原页弹窗。
- References applied: 社区 game-feel skill https://github.com/gamedev-skills/awesome-gamedev-agent-skills/blob/main/skills/disciplines/game-feel/SKILL.md 的离散事件、分级反馈和呈现独立；GDC Folmer Kelly《Don't Juice It or Lose It》https://www.gdcvault.com/play/1020861/don-t-juice-it-or 的材质语义与避免过量反馈；Motion https://motion.dev/docs/react-accessibility 的 reducedMotion。
- Art guidance applied: atmospheric-game-art-director/SKILL.md 的世界/HUD分离、少量持久信息、环境层次和低强度待机。用户已经指定矿洞与自主实施，无需重新采访已确定方向。

| 阶段 | 从确认时刻起 | 呈现契约 |
| --- | --- | --- |
| 按下/等待确认 | 网络耗时独立 | 格子下压、原版铁镐敲击、局部裂纹；不提前揭示或改钱 |
| reveal | 0–260ms | 确认后的局部裂纹，牌面和数值保留原值 |
| effect | 260–1760ms | 中央大图标、道具名称与效果说明；其他玩家不显示其私有奖励 |
| transfer | 1760–2460ms | 图标飞向奖励、机会、盾牌或侦察目标；无需联动则自然淡出，底部尚不更新 |
| resolve | 2460–2840ms | 飞行落定后更新真实数值、机会铁镐、格子、情报、盾牌与日志 |
| transition | 按需追加1160ms | 同规格逐格绕 Y 轴翻转，跨规格保留旧新完整网格分层翻入；各自按行列推进，最后一格在时间窗口内结束 |
| settle | 全序列后 | 完成最后一击后展开宝箱与结算金额；后端在确认时已经禁止后续操作 |

- Multiplayer: 中央放大与飞行仅用于本人已确认结果。普通远端操作直接在对应格子短暂亮起，约300ms，不经过中央 effect/transfer；珍珠先显示发起者与旧卡最后一格，再翻卡。本人演出期间远端只合并最新快照，不排队补播。所有已开格显示作者短名，点开可看完整名字；本人依据 actorKey 标“你”，旧数据仅用私有 lastResult 提供有限兼容，禁止用同名猜身份。初次进入不重播历史。旧卡拒绝恢复最新牌面，不补造本地成功。
- Reduced motion: 保留约 1.2 秒的中央说明阅读时间，其余阶段短淡入；禁用碎屑、震动、飞行和三维翻转。
- Hard non-goals: 不恢复绿色仪表盘；不把石面做成软糖；不把原创图标称为原版；不添加永久漂浮、闪烁或全屏强光。
- Checks: 原始PNG和SHA-1来源、确认前无泄露、珍珠旧卡演出、末击结算、同格失败、多人快速更新、移动端完整棋盘/按钮、减少动态偏好、所有动作结束归位。

### Historical v1 implementation brief

使用现有 React/TanStack Router/Jotai/Motion 实现单页多人 5×5 矿洞红包。保留所有金钱与机会规则，判定器只澄清入口和结果文案。先实现移除品牌行后的顶部金额与右侧「见好就收」、绑定的机会资源区和持续末次提醒，再实现不调用 SDK、布局与主界面一致的原地练习与明确结束原因。道具使用原版 Minecraft 本地素材，剩几次就排几把铁镐，不使用会暗示固定上限的百分比条。保留安静矿洞、底部持久日志和「裂纹 → 中央效果说明 → 飞行 → HUD/牌面 → 按需翻卡 → 结算」顺序。验证演示不产生真实提交，领取确认能取消，末次和额外机会表达准确，弹窗原因不从过期快照推断。完成桌面及320/360/390宽度、减少动态、真实判定及恢复路径检查，再发布静态 Worker。改进理解度需要新玩家回访验证，不能用构建通过或截图代替。

## v2 compact play and author controls (2026-11-01, Active)

本节是最新实施契约，对上文历史 5×5 描述的尺寸与四项参数有优先级。v2 已实现并在本地验证；现有线上网页与红包站保存的判定器需要分别更新才能启用。完整规范与平台边界见 `docs/AUTHORING_V2.md`。

- **紧凑布局**：桌面约 440px 正方形卡片 + 220px 个人操作栏，主体约 684px；不填满桌面、不增加品牌标题或指标卡。活动记录默认折叠。手机恢复奖励/机会在上、棋盘在下、活动最后的单列。同一视口下所有规格外框一致；默认外框由前端适配，不暴露给红包作者。
- **首次引导为保留项**：复用 `GamePage` 的浏览器首次条件与 `GuideDemo` 的无 SDK 本地练习，可跳过、可从“怎么玩”重新进入。练习明确标记示例，不消耗真实机会；奖励与 TNT 示范从有效规则读取。不能因为页面变紧凑而省略领取退出与机会耗尽的教学。
- **七项原生参数**：按难度、卡片规格、绿宝石奖励、初始机会、TNT 扣除比例、连续挖掘等待、道具配比的顺序平铺。难度为简单／困难／地狱，用户已确认默认困难。使用官方新版 `options[].set`：选档回填初始机会、TNT 比例、配比，数字框显示实际值；简单固定、困难和地狱小幅浮动，套用后可继续手改，再选档会重置这三个字段。加载已有草稿保留保存值。移除旧稿的留空继承与“跟随难度”选项，现有四项保留 key。
- **地狱配置**：初始 4 次、TNT 扣当前待结算的 75%，5/6/7 规格 TNT 基准为 8/12/17，小幅浮动后各 ±1；其他奖励倍率和道具效果保持一致。简单为 9 次／15%、困难为 7 次／25%，其余基准见完整规范；按这些值实现，实际体验仍需玩家校准。
- **默认情报配置**：5/6/7 规格的望远镜为 1/3/4，较上轮提案增加大棋盘情报，从绿宝石让出位置；困难难度的绿宝石基准为 11/14/20。其数量不再额外开放一项作者参数。
- **生成契约**：卡片规格默认“每卡随机”，每张新卡从 5×5／6×6／7×7 中等概率抽一种，同卡所有玩家共享相同规格；作者仍可选固定规格，切换难度不重置规格。换卡物固定 1；规格、实际道具构成和牌序每卡一次生成后存档。浮动仅四类各 ±1，绿宝石补齐总数。当前卡剩余数量取真实牌面；旧卡命令不转投新卡，不扣机会；跨规格换卡分别持有旧、新坐标与尺寸。
- **身份与适配**：本人 actorKey 金色强调，其他玩家名字调暗但保持对比；不调暗道具。窄屏大棋盘名字可降至 11px、单行截断，完整信息可访问；主界面操作文字仍保持原先可读性目标。7×7 最窄屏需要真机误触验证。
- **预算表达**：选项 hint 随档位切换，check 保留钻石预算护栏；作者手改后的最终有效规则与确定的收益/扣除示例放在游戏自己的“怎么玩”和首次练习。预计人均、覆盖人数和时长需单独带假设的模拟，不以奖池除基数冒充结果。
- **表单边界**：2026-11-01 最新仓库 `823a8d9` 和线上文档已支持 choice 选项的 `set` 与 `hint`，可以回填和切换说明；尚无分组、条件隐藏和通用计算摘要。默认困难的 set 与目标 default 必须一致。`paramValues` 不执行 set，直接写测试参数时应提供最终数值；具体响应式排版沿用主站组件。
- **兼容边界**：v2 仅用于新红包；旧卡 25 格与两个换卡物按旧事实完成，不中途改规则。规则、卡片与视图需版本化，保存旧作者显式参数。
- **视觉与核验**：沿用现有原版 ItemIcon、低对比洞壁、本人演出优先与减少动态偏好。正式判定器 69 个用例、101 步通过；setup 863 项与正式生成函数 729 种构成通过；前端 63 项、15 种布局、三种引导宽度、真实判定器双人跨规格换卡与结算均通过。生产作者表单的登录后操作、真实付款与触摸真机仍不在本地证据范围内。
