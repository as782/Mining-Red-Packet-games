// 矿洞夺宝 v3 的规则（docs/V3_MAP.md §5，道具和区块见 docs/V3_ITEMS.md）：生成卡、挖一格、
// 长新卡、用道具、领取。纯函数，游戏站的 Durable Object 和测试共用；随机数来自每个红包自己的
// 种子，同一个种子、同样的先后，结果一样，能重放核对。分和金额一样，单位是分。

import { lavaOf, railsOf, trialLayout } from "./layouts.mjs";

/**
 * 以前就有的十种（以前开的局只有这些）。
 * @typedef {'emerald'|'diamond'|'apple'|'totem'|'tnt'|'pearl'|'shield'|'spyglass'|'eye'|'crystal'} BaseKind
 */
/**
 * 道具和区块的新格子（rules.items 的局，docs/V3_ITEMS.md §1）：能挖。
 * @typedef {'coal'|'stick'|'map'|'potion'|'key'|'debris'|'cobweb'|'spawner'|'minecart'|'ender'} ItemKind
 */
/**
 * 固定的格子：位置公开（publicCard 的 fixed），不能挖，不算进“已挖”。
 * @typedef {'vault'|'deco'|'lava'} FixedKind
 */
/** @typedef {BaseKind|ItemKind|FixedKind} Kind */
/** @typedef {3|5|6|7} Size */
/** 区块（长出来的卡按种子抽，§2）；末地宝藏是 end。普通卡没有 kind。 @typedef {'trial'|'mine'|'nether'|'deep'} Biome */
/** 附魔镐的形状：横三格、竖三格、十字。 @typedef {'h'|'v'|'x'} Shape */
/**
 * 难度：新判定器的参数是 level（easy 简单 / normal 普通 / tough 困难）；旧的 difficulty
 * （easy / hard / hell）照旧认，开着的旧局存的也是这几个，hard 就是普通。
 * @typedef {'easy'|'normal'|'tough'|'hard'|'hell'} Difficulty
 */
/**
 * 配比：以前的十种一定有；新局的卡另有道具格的数（没有的当 0）。固定的格子不在里面。
 * @typedef {Record<BaseKind, number> & Partial<Record<ItemKind, number>>} Composition
 */
/**
 * creeper：苦力怕，手上有分这么多秒不挖也不用道具就来（0 是不开；只在有道具栏的局）。
 * @typedef {{
 *   difficulty: Difficulty,
 *   boardSpec: '5'|'6'|'7'|'random',
 *   compositionVariation: 'fixed'|'slight',
 *   smallReward: number,
 *   bigMultiplier: 5,
 *   totemBonus: 3,
 *   tntPercent: number,
 *   initialChances: number,
 *   appleCap: number,
 *   eyeEvery: number,
 *   players?: number,
 *   digInterval?: number,
 *   endMix?: 2,
 *   items?: 1|2,
 *   creeper?: number,
 *   layout?: 2,
 *   special?: 2,
 *   craftTorches?: 4,
 *   loot?: 1,
 *   step?: string,
 * }} Rules
 */
/** 挖开的格子；burn: 1 是被岩浆吞掉的（uid 0、名字空）。 @typedef {{ uid: number, name: string, at: number, burn?: 1 }} OpenCell */
/**
 * 插在卡上的火把。第 1 版（items: 1）：at 是那个角右下的格子，颜色按没挖开的算、会变、四格挖开就灭。
 * 第 2 版（items: 2，§9）：at 是插着的那一格（挖开的），照亮以它为中心的 3×3，level 插下时定下（挖开的
 * 危险也算，之后不变），一直亮着。
 * @typedef {{ at: number, uid: number, name: string, level?: number }} Torch
 */
/**
 * 新局的卡另有：fixed（固定格子）、vaults（宝库还能开几次）、torches（插过的火把，灭了的也留着）、
 * wardenAt（深暗之域：噪音到这个数唤醒监守者，不公开）、closed（监守者醒了，卡关闭）。2026-11-12 起的局
 * （rules.special: 2，docs/V3_ITEMS.md §16、§17）：fromEye（末影之眼开的特殊区块）；深暗之域不再有 wardenAt，
 * 改成 noise / noiseAt（噪音会随时间退）和 wokeBy（谁吵醒了监守者、被抢走多少）。
 * @typedef {{
 *   id: number, x: number, y: number, size: Size, kind?: 'end'|Biome,
 *   composition: Composition, deck: Kind[], opened: (OpenCell|null)[],
 *   finished: boolean,
 *   fixed?: Record<string, FixedKind>, vaults?: Record<string, number>, torches?: Torch[],
 *   wardenAt?: number, closed?: boolean, rails?: Record<string, import('./layouts.mjs').RailShape>,
 *   fromEye?: true, noise?: number, noiseAt?: number, wokeBy?: { uid: number, name: string, amount: number, at: number },
 * }} Card
 */
/** @typedef {{ cardId: number, index: number, kind: Kind }} Peek */
/** 挖到末影珍珠、末影之眼、箱子矿车另得的一样道具（rules.loot，docs/V3_ITEMS.md §19） @typedef {'spyglass'|'map'|'key'|'table'|'ender'|'potion'|'torch'} Loot */
/**
 * 挖一格的结果。burned：这一挖让岩浆吞掉的格子；warden：唤醒监守者被扣掉的分；
 * poison：这次动作中毒扣掉的分（附魔镐一次只算一次，记在第一格）。
 * @typedef {{
 *   kind: Kind, cardId: number, index: number, amount: number,
 *   blocked: boolean, text: string, newCardId: number|null,
 *   burned?: { index: number, kind: Kind }[], warden?: number, poison?: number, loot?: Loot,
 * }} Result
 */
/** 手里的道具（新局）。 @typedef {{ torch: number, map: number, potion: number, ender: number, table: number, key: number, pick: Record<Shape, number> }} Bag */
/**
 * shield：手里有没有盾牌（以前开的局只记这个）。新局（rules.items）另记 shields 几面盾牌、
 * spyglasses 几个望远镜，shield 跟着 shields 变，老网页照样看得懂；还有道具（items）、
 * 煤炭和木棍的进度、中毒还剩几次、末影箱里的分（chest）、急迫药水到什么时候（hasteUntil）、
 * 蜘蛛网让下一挖多等几毫秒（slow）、用过几个附魔台和藏宝图（tables、maps，抽种子用）、
 * 开过的宝库（"卡号:格号"）、最后一次动的时刻（activeAt，苦力怕从这里算）。
 * @typedef {{
 *   uid: number, name: string, chances: number, shield: boolean,
 *   shields?: number, spyglasses?: number,
 *   items?: Bag, coal?: number, stick?: number, poison?: number, chest?: number,
 *   hasteUntil?: number, slow?: number, tables?: number, maps?: number,
 *   vaultsOpened?: string[], activeAt?: number, drained?: { from: number, times: number },
 *   peeks: Peek[], points: number, digs: number,
 *   status: 'playing'|'claimed', lastDigAt: number, lastResult: Result|null,
 *   trail?: Step[],
 * }} Player
 */
/**
 * 逐格记录（收益曲线用）：挖到什么（k）、这一格加减多少分（a）、之后手上加末影箱一共多少分（p）、
 * 盾牌挡住了（b: 1）。新局另有不是格子的几步：poison 中毒、creeper 苦力怕、warden 监守者、
 * ender 存进末影箱（a 是毁掉的那一半）、vault 宝库开出的分。开始记录以前就来过的人没有 trail。
 * @typedef {{ k: Kind|'poison'|'creeper'|'warden'|'ender'|'vault', a: number, p: number, b?: 1 }} Step
 */
/** @typedef {{ uid: number, name: string, points: number }} TopEntry */
/**
 * @typedef {{
 *   seq: number, uid: number, name: string, kind: Kind, cardId: number,
 *   index: number, text: string, at: number, newCardId: number|null,
 * }} FeedItem
 */
/**
 * @typedef {{
 *   version: 3, seed: string, rules: Rules,
 *   pool: number, used: number,
 *   openedAt: number, deadlineAt: number|null,
 *   cards: Record<string, Card>, slots: Record<string, number>, nextCardId: number,
 *   feed: FeedItem[], seq: number,
 *   stats: { digs: number, players: number, claimed: number, claimedPoints: number },
 *   over: boolean,
 *   top?: TopEntry[],
 * }} Game
 */
/** 挖开一格的输出（镐子一格，附魔镐每格一份）。 @typedef {{ result: Result, feed: FeedItem, newCard: Card|null, burned: { index: number, kind: Kind }[] }} CellOut */

/** 每张卡占一个 7×7 的格位，5×5、6×6 的卡在格位里居中。 */
export const SLOT = 7;
/** 截止前 2 分钟停止挖掘，开着网页的人自动领取（§2）。 */
export const WRAP_UP_MS = 2 * 60 * 1000;
/** 每人两次挖掘至少隔 1 秒，只防脚本（§4）；参数“挖掘间隔”可以拉长（秒）。 */
export const MIN_INTERVAL_MS = 1000;
export const DIG_INTERVALS = /** @type {const} */ ([1, 3, 10, 30]);
/** 动态留最近这么多条。 */
export const FEED_LIMIT = 30;

/** 公开的基准配比；顺序不代表洗过的牌。 */
const COMPOSITIONS = /** @type {const} */ ({
  5: { emerald: 11, diamond: 3, apple: 1, totem: 2, tnt: 4, pearl: 1, shield: 2, spyglass: 1, eye: 0, crystal: 0 },
  6: { emerald: 14, diamond: 4, apple: 2, totem: 3, tnt: 6, pearl: 1, shield: 3, spyglass: 3, eye: 0, crystal: 0 },
  7: { emerald: 20, diamond: 6, apple: 2, totem: 4, tnt: 8, pearl: 2, shield: 4, spyglass: 4, eye: 0, crystal: 0 },
});
/**
 * 末地宝藏卡：3×3，奖励多，但藏着一颗末影水晶（踩中扣双倍，见 dig），不再长卡。
 * 2026-11-06 以前开出的宝藏卡是 5 绿宝石、3 钻石、1 金苹果，存着的牌不变。
 */
const END_COMPOSITION = /** @type {const} */ ({ emerald: 4, diamond: 3, apple: 1, totem: 0, tnt: 0, pearl: 0, shield: 0, spyglass: 0, eye: 0, crystal: 1 });
/**
 * 2026-11-07 起开的局（rules.endMix 是 2）：每张宝藏卡随机，依次抽末影水晶 1–2 颗、双铁镐 1–2 把、
 * 金苹果 0–1 个、钻石 3–5 颗（剩下的格子不够就少抽），剩下的是绿宝石（0–4 颗）。水晶可能有两颗，
 * 风险大了，钱也多：钻石比绿宝石多，平均约 21 份小奖（以前 19 份）。有道具栏的局先抽末影箱（60% 一个）。
 */
export const END_RANGES = /** @type {const} */ ({ crystal: [1, 2], totem: [1, 2], apple: [0, 1], diamond: [3, 5] });
/**
 * 道具栏（rules.items，2026-11-10 起开的局，docs/V3_ITEMS.md）：盾牌最多带这么多面，再挖到转成
 * 一份小奖；望远镜等主动道具先收着，自己用（useItem）。以前开的局盾牌只有一面、望远镜挖到就随机看一格。
 */
export const SHIELD_CAP = 3;
/** 煤炭、木棍各攒到这么多就满了，两样都满自动做成一个火把。 */
export const SCRAP_CAP = 2;
/**
 * 一块煤炭、一根木棍做成几个火把：2026-11-13 起开的局（rules.craftTorches）照原版做成 4 个，
 * 以前开的局一个（docs/V3_ITEMS.md §18）。
 */
export const CRAFT_TORCHES = 4;
export const craftedTorches = (/** @type {Rules} */ rules) => rules.craftTorches ?? 1;
/** “一个火把”“ 4 个火把”（数字前带空格，接在“做成了”后面） */
export const torchesWords = (/** @type {number} */ count) => (count === 1 ? "一个火把" : ` ${count} 个火把`);
/**
 * 开图有奖（2026-11-13 起开的局，rules.loot，docs/V3_ITEMS.md §19，用户定的）：挖到末影珍珠的人另得一样道具
 * （望远镜 35、藏宝图 30、试炼钥匙 25、附魔台 10；挖掘间隔 ≥3 秒的局急迫药水占 20，别的按比例让），挖到末影之眼的
 * 另得附魔台或末影箱（各一半）；箱子矿车改成小奖 50、藏宝图 25、火把 10、附魔台 15。都是百分比的累计上限，按种子抽。
 */
export const PEARL_LOOT = /** @type {const} */ ([["spyglass", 35], ["map", 65], ["key", 90], ["table", 100]]);
export const PEARL_LOOT_SLOW = /** @type {const} */ ([["potion", 20], ["spyglass", 48], ["map", 72], ["key", 92], ["table", 100]]);
export const EYE_LOOT = /** @type {const} */ ([["table", 50], ["ender", 100]]);
export const MINECART_LOOT = /** @type {const} */ ([["small", 50], ["map", 75], ["torch", 85], ["table", 100]]);
/** 以前开的局的箱子矿车：小奖 50、火把 25、藏宝图 25 */
const MINECART_OLD = /** @type {const} */ ([["small", 50], ["torch", 75], ["map", 100]]);
export const LOOT_WORDS = /** @type {Record<Loot, string>} */ ({
  spyglass: "一个望远镜", map: "一张藏宝图", key: "一把试炼钥匙", table: "一个附魔台", ender: "一个末影箱", potion: "一瓶急迫药水", torch: "一个火把",
});
/** 中毒：挖到刷怪笼以后这么多次挖掘，每次扣手上的百分之几（盾牌挡不住）。 */
export const POISON_TIMES = 3;
export const POISON_PERCENT = 5;
/** 蜘蛛网让下一次挖多等这么久（第 2 版的局 10 秒，2026-11-11 用户：5 秒不明显）。 */
export const COBWEB_MS = 5000;
export const COBWEB_MS_2 = 10_000;
const cobwebMs = (/** @type {Rules} */ rules) => ((rules.items ?? 0) >= 2 ? COBWEB_MS_2 : COBWEB_MS);
/** 急迫药水：这么久里挖掘间隔变成 1 秒。 */
export const HASTE_MS = 10_000;
/** 下界每挖这么多格，岩浆流一格。 */
export const LAVA_EVERY = 3;
/** 监守者扣手上的百分之几；深暗之域的噪音阈值在格子数的这个范围里（种子定）。 */
export const WARDEN_PERCENT = 50;
export const WARDEN_RANGE = /** @type {const} */ ([0.45, 0.75]);
/** 每个宝库一共能开几次（每人一次）。 */
export const VAULT_OPENS = 4;
/** 苦力怕：参数默认几秒；探头以后倒数几毫秒；核对时留几毫秒余量；炸掉手上的百分之几。 */
export const CREEPER_DEFAULT = 60;
export const CREEPER_FUSE_MS = 10_000;
export const CREEPER_SLACK_MS = 2000;
export const CREEPER_PERCENT = 20;
/**
 * 不领的人（第 2 版的局，§9）：待领取大于 0、这么久没挖也没用道具（网页关了、在后台），游戏站替苦力怕
 * 每 IDLE_EVERY_MS 炸一次，直到 0。开着网页的人每次苦力怕炸完重新计时，到不了这么久。
 */
export const IDLE_MS = 5 * 60_000;
export const IDLE_EVERY_MS = 60_000;
/** 附魔台开出的一种附魔镐给几次。 */
export const TABLE_USES = 2;
export const SHAPES = /** @type {Shape[]} */ (["h", "v", "x"]);
export const PICK_NAMES = /** @type {Record<Shape, string>} */ ({ h: "横三格附魔镐", v: "竖三格附魔镐", x: "十字附魔镐" });
/** 火把数的“危险”：会扣分的格子。 */
export const DANGER = /** @type {ReadonlySet<Kind>} */ (new Set(["tnt", "crystal", "spawner"]));
/** 藏宝图抽种类的权重：按价值的倒数（绿宝石 1、金苹果 3、钻石 5、远古残骸 10），乘 30 取整。 */
export const MAP_WEIGHTS = /** @type {const} */ ({ emerald: 30, apple: 10, diamond: 6, debris: 3 });
/** 长出来的卡抽区块（百分比的累计上限）：普通 55，试炼密室 12，废弃矿井 12，下界 11，深暗之域 10。 */
const BIOME_ODDS = /** @type {const} */ ([["normal", 55], ["trial", 67], ["mine", 79], ["nether", 90], ["deep", 100]]);
/**
 * 2026-11-12 起的局（rules.special: 2，docs/V3_ITEMS.md §17，权重用户定的）：末影珍珠长的卡只抽普通、废弃矿井、试炼密室；
 * 末影之眼在远处开特殊区块：末地宝藏、深暗之域、下界（容易得大奖、风险也大）。
 */
/** 区块的名字（说给人听的） */
export const BIOME_NAMES = /** @type {Record<Biome, string>} */ ({ trial: "试炼密室", mine: "废弃矿井", nether: "下界", deep: "深暗之域" });
const PEARL_ODDS = /** @type {const} */ ([["normal", 50], ["mine", 90], ["trial", 100]]);
const EYE_ODDS = /** @type {const} */ ([["end", 50], ["deep", 75], ["nether", 100]]);
/**
 * 深暗之域第 2 版（docs/V3_ITEMS.md §16）：噪音谁挖都加一，没人挖时慢慢退（每 NOISE_DECAY_MS 退一，挖掘间隔长的局按
 * 间隔的 5 倍）；过了格子数的 WARDEN_FROM 以后，每挖一格都有机会惊醒监守者，越吵越大，最吵时 WARDEN_MAX。
 */
export const NOISE_DECAY_MS = 15_000;
export const WARDEN_FROM = 0.25;
export const WARDEN_MAX = 0.1;
export const WARDEN_CURVE = 0.8;
export const noiseDecayMs = (/** @type {Pick<Rules, 'digInterval'>} */ rules) => Math.max(NOISE_DECAY_MS, (rules.digInterval ?? 1) * 5000);
/** 深暗之域现在的噪音（第 2 版会退；第 1 版就是挖开的格子数） */
export function noiseNow(/** @type {Card} */ card, /** @type {Rules} */ rules, /** @type {number} */ now) {
  if (card.noiseAt === undefined) return dugOf(card);
  return Math.max(0, (card.noise ?? 0) - Math.max(0, now - card.noiseAt) / noiseDecayMs(rules));
}
/** 噪音到 noise 时，再挖一格惊醒监守者的机会（0–WARDEN_MAX）；cells 是这张卡能挖的格子数 */
export function wardenChance(/** @type {number} */ noise, /** @type {number} */ cells) {
  const from = cells * WARDEN_FROM;
  if (noise <= from) return 0;
  return WARDEN_MAX * Math.min(1, (noise - from) / (cells - from)) ** WARDEN_CURVE;
}
/** 新局普通卡的煤炭、木棍各几块。 */
const SCRAP_COUNTS = /** @type {const} */ ({ 5: 2, 6: 3, 7: 4 });
/** 末影之眼默认每 3 张普通卡一颗；参数可改，0 是不开末地宝藏。 */
export const EYE_EVERY = 3
const TNT_COUNTS = /** @type {const} */ ({
  easy: { 5: 3, 6: 4, 7: 6 },
  normal: { 5: 4, 6: 6, 7: 8 },
  tough: { 5: 6, 6: 9, 7: 12 },
  // 旧判定器的难度
  hard: { 5: 4, 6: 6, 7: 8 },
  hell: { 5: 8, 6: 12, 7: 17 },
});
/** 踩中 TNT 扣还没领的奖励的百分之几（旧判定器可以自己填 tntPercent）。 */
const TNT_PERCENT = /** @type {const} */ ({ easy: 15, normal: 25, tough: 50, hard: 25, hell: 75 });
/** 按预计人数算绿宝石时，打算发出去的那部分奖池（留些给 TNT 扣回、末地宝藏和挖得多的人）。 */
export const POOL_TARGET = 0.8
/** 没填预计人数时按这么多人算。 */
export const PLAYERS = 20
/** 能挖的格子（洗牌按这个先后）；以前的十种在前，旧局的牌不变。 */
export const KINDS = /** @type {(BaseKind|ItemKind)[]} */ ([
  "emerald", "diamond", "apple", "totem", "tnt", "pearl", "shield", "spyglass", "eye", "crystal",
  "coal", "stick", "map", "potion", "key", "debris", "cobweb", "spawner", "minecart", "ender",
]);
const BASE_KINDS = /** @type {BaseKind[]} */ (KINDS.slice(0, 10));
/** 收益卡上的前几名。 */
export const TOP_LIMIT = 5;
export const KIND_NAMES = /** @type {Record<Kind, string>} */ ({
  emerald: "绿宝石",
  diamond: "钻石",
  apple: "附魔金苹果",
  totem: "双铁镐",
  tnt: "TNT",
  pearl: "末影珍珠",
  shield: "盾牌",
  spyglass: "望远镜",
  eye: "末影之眼",
  crystal: "末影水晶",
  coal: "煤炭",
  stick: "木棍",
  map: "藏宝图",
  potion: "急迫药水",
  key: "试炼钥匙",
  debris: "远古残骸",
  cobweb: "蜘蛛网",
  spawner: "刷怪笼",
  minecart: "箱子矿车",
  ender: "末影箱",
  vault: "宝库",
  deco: "装饰",
  lava: "岩浆",
});

/**
 * 判定器参数（红包信息里的 params，金额是分）和奖池（分）→ 规则。
 * 新判定器只有这几个参数：预计人数 players、每人机会 initialChances、难度 level、挖掘间隔
 * interval、末地宝藏 eyeEvery、苦力怕 creeper；绿宝石值多少按奖池、人数和机会算（rewardFor），
 * TNT 扣多少跟着难度，金苹果一次最多加 10 颗绿宝石，卡的规格每张随机，配比小幅浮动。旧判定器的
 * 参数（difficulty、smallReward、tntPercent、appleCap、boardSpec、compositionVariation）写了就照旧用。
 */
export function rulesOf(/** @type {Record<string, unknown>} */ params, /** @type {number} */ pool = 0) {
  const integer = (/** @type {unknown} */ value, /** @type {number} */ fallback) =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  const level = ["easy", "normal", "tough"].includes(String(params.level)) ? String(params.level) : null;
  const legacy = ["easy", "hard", "hell"].includes(String(params.difficulty)) ? String(params.difficulty) : null;
  const difficulty = /** @type {Difficulty} */ (level ?? legacy ?? "normal");
  const boardSpec = /** @type {Rules['boardSpec']} */ (
    ["5", "6", "7", "random"].includes(String(params.boardSpec)) ? String(params.boardSpec) : "random"
  );
  const players = Math.min(2000, integer(params.players, PLAYERS));
  const initialChances = Math.min(99, integer(params.initialChances, 20));
  const eyeEvery = params.eyeEvery == null || params.eyeEvery === "" || !Number.isSafeInteger(Number(params.eyeEvery))
    ? EYE_EVERY : Math.min(20, Math.max(0, Number(params.eyeEvery)));
  // 判定器第 12 版（docs/V3_ITEMS.md §24）：“自己定价”时 smallReward 是发红包的人定的价；“按奖池分”时不管它
  // （红包站会给 null，这里再保险一次）。旧判定器写了 smallReward 就照旧用。
  const smallReward = params.smallReward == null || params.reward === "pool"
    ? rewardFor(pool, players, initialChances, difficulty, true, eyeEvery)
    : integer(params.smallReward, 10);
  const digInterval = DIG_INTERVALS.includes(/** @type {1} */ (Number(params.interval))) ? Number(params.interval) : 1;
  return /** @type {Rules} */ ({
    difficulty,
    boardSpec,
    compositionVariation: params.compositionVariation === "fixed" ? "fixed" : "slight",
    smallReward,
    bigMultiplier: 5,
    totemBonus: 3,
    tntPercent: params.tntPercent == null ? TNT_PERCENT[difficulty] : Math.min(100, integer(params.tntPercent, 25)),
    initialChances,
    // 旧判定器的金苹果上限：没填（null）是不限；新判定器一次最多加 10 颗绿宝石
    appleCap: "appleCap" in params ? (params.appleCap == null ? 0 : integer(params.appleCap, 0)) : smallReward * 10,
    eyeEvery,
    ...(params.smallReward == null ? { players } : {}),
    digInterval,
    // 末地宝藏的牌按新的随机范围配（开局时定下，存在局里；以前开的局没有这一项，照旧）
    endMix: 2,
    // 道具栏、区块（同上，以前开的局没有这一项）；2026-11-11 下午起是第 2 版（docs/V3_ITEMS.md §9）：
    // 煤炭木棍各一个就合成、火把照 3×3、蜘蛛网 10 秒、苦力怕至少 0.01、不领的人每分钟被炸
    items: 2,
    creeper: creeperOf(params.creeper, digInterval),
    // 区块里固定格子的新摆法（2026-11-11 晚起，docs/V3_ITEMS.md §10）：铁轨随机铺、试炼密室 5 种摆法、
    // 下界岩浆一半挨在一起（layouts.mjs）；以前开的局没有这一项，照旧
    layout: 2,
    // 末影之眼开特殊区块、末影珍珠只长普通的几种、深暗之域的噪音会退（2026-11-12 起，docs/V3_ITEMS.md §16、§17）；以前开的局没有这一项，照旧
    special: 2,
    // 一块煤炭、一根木棍照原版做成 4 个火把（2026-11-13 起，docs/V3_ITEMS.md §18）；以前开的局没有这一项，一个
    craftTorches: CRAFT_TORCHES,
    // 开图有奖、附魔台多几个地方（2026-11-13 起，docs/V3_ITEMS.md §19）；以前开的局没有这一项，照旧
    loot: 1,
  });
}

/** 苦力怕参数：没填（旧判定器）是 60 秒，0 是不开，最多 600 秒，开着时至少是挖掘间隔的两倍。 */
function creeperOf(/** @type {unknown} */ value, /** @type {number} */ digInterval) {
  const seconds = value == null || value === "" || !Number.isSafeInteger(Number(value))
    ? CREEPER_DEFAULT : Math.min(600, Math.max(0, Number(value)));
  return seconds === 0 ? 0 : Math.max(seconds, digInterval * 2);
}

/**
 * 每挖一格平均值几颗绿宝石：5×5、6×6、7×7 一样多，按基准配比（6×6 的珍珠算 1.5 颗）
 * 只数绿宝石和钻石；金苹果翻倍和 TNT 扣回大致抵掉。
 */
export function averageUnits(/** @type {Difficulty} */ difficulty, items = false) {
  if (items) return averageUnits(difficulty) * ITEMS_UNITS[difficulty];
  let total = 0;
  for (const size of /** @type {const} */ ([5, 6, 7])) {
    /** @type {Composition} */
    const composition = { ...COMPOSITIONS[size], tnt: TNT_COUNTS[difficulty][size], pearl: size === 6 ? 1.5 : COMPOSITIONS[size].pearl };
    const others = BASE_KINDS.filter((kind) => kind !== "emerald").reduce((sum, kind) => sum + composition[kind], 0);
    total += (size * size - others + composition.diamond * 5) / (size * size);
  }
  return total / 3;
}

/**
 * 有道具栏的局每次机会平均发出去的，是旧局的几成（docs/V3_ITEMS.md §7，game/scripts/sim-items.mjs
 * 2026-11-11 每种难度 60 局，地图不会长不动以后：简单 1.459/1.936、普通 1.179/1.752、困难 0.624/1.435
 * 份小奖）。垃圾格、道具占了绿宝石的位置，困难的 TNT 又扣得多；绿宝石按这个比例变贵，同样的奖池、
 * 同样的人数，发出去的和旧局差不多。2026-11-12 特殊区块都从末影之眼开（rules.special: 2，§17）：珍珠长的多是
 * 普通和废弃矿井，下界、深暗之域少了，sim-items.mjs 60 局（3 秒一下）每次机会发出去的是以前的 0.824 / 0.828 / 0.825
 * （简单 1.193/1.447、普通 0.959/1.158、困难 0.517/0.627），上面的几成都乘 0.825。2026-11-13 开图有奖（rules.loot，§19）：
 * 附魔台、钥匙多了，sim-items.mjs 1000 局每次机会发出去的是以前的 1.055 / 1.048 / 1.042（简单 1.275/1.209、普通
 * 1.028/0.981、困难 0.548/0.526），各乘上去（绿宝石便宜半成）。
 */
export const ITEMS_UNITS = /** @type {const} */ ({ easy: 0.654, normal: 0.576, tough: 0.37, hard: 0.576, hell: 0.37 });

/**
 * 末影之眼的三档（判定器第 11 版的少 / 正常 / 多 = 每 5 / 3 / 2 张卡一颗，docs/V3_ITEMS.md §14）：眼多，
 * 特殊区块多，每次挖平均发出去的也多一点。sim-items.mjs 每档 120 局、三种难度，和每 3 张一颗比：
 * 每 2 张 1.048 / 1.027 / 1.052，每 5 张 0.970 / 0.958 / 0.950。别的数（旧判定器能填 0–20）按 1 算。
 */
export const EYE_UNITS = /** @type {Readonly<Record<number, number>>} */ ({ 2: 1.04, 3: 1, 5: 0.96 });

/**
 * 绿宝石值多少分：大约 POOL_TARGET 的奖池够预计人数每人把镐子挖完；至少 1 分。items：有道具栏的局；
 * eyeEvery：每几张卡一颗末影之眼（有道具栏的局按 EYE_UNITS 调）。
 */
export function rewardFor(/** @type {number} */ pool, /** @type {number} */ players, /** @type {number} */ chances, /** @type {Difficulty} */ difficulty, items = false, eyeEvery = EYE_EVERY) {
  const units = averageUnits(difficulty, items) * (items ? EYE_UNITS[eyeEvery] ?? 1 : 1);
  return Math.max(1, Math.floor((pool * POOL_TARGET) / (players * chances * units)));
}

/** "100.00" → 10000；红包信息的金额是两位小数的字符串。 */
export function amountOf(/** @type {string} */ text) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) throw new TypeError(`不是金额：${text}`);
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -cents : cents;
}

/**
 * 写给人看的数：LDC 和🐟 10000 → "100.00"；三方积分红包（rules.step，docs/V3_ITEMS.md §11）按最小单位定小数位，
 * 数是多少个最小单位：最小单位 "1" 时 2000 → "2000"，"0.5" 时 3 → "1.5"，"100" 时 3 → "300"（同红包站的 tools.money.format）。
 */
export function formatPoints(/** @type {number} */ points, /** @type {string|undefined} */ step = undefined) {
  const sign = points < 0 ? "-" : "";
  const [whole, fraction = ""] = String(step ?? "0.01").split(".");
  const stepMinor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  const minor = Math.abs(points) * (stepMinor || 1);
  const decimals = stepMinor % 100 === 0 ? 0 : stepMinor % 10 === 0 ? 1 : 2;
  const text = `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
  return sign + (decimals === 2 ? text : text.slice(0, text.length - (2 - decimals) - (decimals === 0 ? 1 : 0)));
}

/** floor(points * percent / 100)，不让中间的乘法超出安全整数。 */
const percentOf = (/** @type {number} */ points, /** @type {number} */ percent) =>
  Math.floor(points / 100) * percent + Math.floor((points % 100) * percent / 100);

/** 字符串的 128 位散列（cyrb128），给随机数做种子。 */
function hash128(/** @type {string} */ text) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/**
 * 一条随机流：种子加用途（"card:3"、"spy:10001:4"），同样的种子和用途总是同一串。
 * @returns {(min: number, max: number) => number} 闭区间里的整数
 */
export function randomOf(/** @type {string} */ seed, /** @type {string} */ use) {
  let [a, b, c, d] = hash128(`${seed}:${use}`);
  const next = () => {
    // sfc32
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ (b >>> 9);
    b = c + (c << 3) | 0;
    c = (c << 21) | (c >>> 11);
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
  return (min, max) => min + Math.floor(next() * (max - min + 1));
}

/** @param {(min: number, max: number) => number} int @param {Composition} composition */
function shuffledDeck(int, composition) {
  /** @type {Kind[]} */
  const deck = [];
  for (const kind of KINDS) for (let i = 0; i < (composition[kind] ?? 0); i++) deck.push(kind);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = int(0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** 第 id 张卡，放在 (x, y)；规格、配比和牌序都由种子和卡号定。 */
export function newCard(/** @type {Game} */ game, /** @type {number} */ id, /** @type {number} */ x, /** @type {number} */ y, /** @type {Biome|null} */ biome = null) {
  if (game.rules.items) return newItemsCard(game, id, x, y, biome);
  const int = randomOf(game.seed, `card:${id}`);
  const { rules } = game;
  const size = /** @type {5|6|7} */ (rules.boardSpec === "random" ? int(5, 7) : Number(rules.boardSpec));
  /** @type {Composition} */
  const composition = { ...COMPOSITIONS[size], tnt: TNT_COUNTS[rules.difficulty][size] };
  if (rules.compositionVariation === "slight")
    for (const kind of /** @type {const} */ (["diamond", "totem", "tnt", "shield"])) composition[kind] += int(-1, 1);
  // 珍珠：5×5 一颗，6×6 随机一到两颗，7×7 两颗（地图会分叉，人少也能长出几张卡）
  if (size === 6) composition.pearl = int(1, 2);
  // 末影之眼：每第 eyeEvery 张普通卡藏一颗（末地宝藏卡不算张数）
  const nth = Object.values(game.cards).filter((other) => other.kind !== "end").length + 1;
  if (rules.eyeEvery > 0 && nth % rules.eyeEvery === 0) composition.eye = 1;
  composition.emerald = size * size - BASE_KINDS.filter((kind) => kind !== "emerald")
    .reduce((sum, kind) => sum + composition[kind], 0);
  return /** @type {Card} */ ({
    id, x, y, size, composition,
    deck: shuffledDeck(int, composition),
    opened: Array(size * size).fill(null),
    finished: false,
  });
}

/**
 * 有道具栏的局的卡（docs/V3_ITEMS.md §1、§2）。第一张是普通卡，之后长出来的普通卡按种子抽
 * 区块：试炼密室、废弃矿井、下界、深暗之域各有自己的规格和配比，固定格子放在 fixed 里（牌里
 * 那几格也是这几种，挖不了）。普通卡在原来的配比上加煤炭、木棍、藏宝图、急迫药水（挖掘间隔
 * 3 秒以上的局才有）、试炼钥匙，望远镜少一些；末影之眼照旧每第 eyeEvery 张卡一颗（区块卡也算，
 * 占一颗绿宝石的位置）。
 */
function newItemsCard(/** @type {Game} */ game, /** @type {number} */ id, /** @type {number} */ x, /** @type {number} */ y, /** @type {Biome|null} */ forced = null) {
  const int = randomOf(game.seed, `card:${id}`);
  const { rules } = game;
  // 第几张：末地宝藏和末影之眼开的特殊区块不算（“每几张卡一颗眼”只数珍珠长的）
  const nth = Object.values(game.cards).filter((other) => other.kind !== "end" && !other.fromEye).length + 1;
  /** @type {'normal'|Biome} */
  let biome = forced ?? "normal";
  if (!forced && nth > 1) {
    const roll = int(0, 99);
    const odds = (rules.special ?? 0) >= 2 ? PEARL_ODDS : BIOME_ODDS;
    biome = /** @type {'normal'|Biome} */ (odds.find(([, upTo]) => roll < upTo)?.[0] ?? "normal");
  }
  const tnt = (/** @type {5|6|7} */ size) => TNT_COUNTS[rules.difficulty][size];
  /** 新摆法（rules.layout: 2，layouts.mjs） */
  const layout2 = (rules.layout ?? 0) >= 2;
  /** @type {Record<string, FixedKind>} */
  const fixed = {};
  /** @type {Record<string, import('./layouts.mjs').RailShape>|null} */
  let rails = null;
  let vaultCells = [22, 26];
  /** @type {5|6|7} */
  let size;
  /** @type {Partial<Record<BaseKind|ItemKind, number>>} */
  let counts;
  switch (biome) {
    case "trial":
      // 7×7：以前四角和正中是装饰，第 4 行第 2、6 格是宝库；新摆法 5 种里挑一种再随机翻
      size = 7;
      if (layout2) {
        const picked = trialLayout(int);
        vaultCells = picked.vaults;
        for (const index of picked.deco) fixed[index] = "deco";
      } else for (const index of [0, 6, 24, 42, 48]) fixed[index] = "deco";
      for (const index of vaultCells) fixed[index] = "vault";
      counts = { diamond: 5, apple: 1, totem: 2, tnt: tnt(6), pearl: 1, shield: 2, key: 2, coal: 2, stick: 2, spyglass: 1 };
      break;
    case "mine":
      // 6×6：以前第 3 行中间 4 格是铁轨；新摆法随机铺一条（会拐弯、可能断开一格、一半的卡再有一小段）
      size = 6;
      if (layout2) {
        rails = railsOf(int, 6);
        for (const index of Object.keys(rails)) fixed[index] = "deco";
      } else for (const index of [13, 14, 15, 16]) fixed[index] = "deco";
      counts = { cobweb: 3, spawner: 1, minecart: 2, coal: 4, stick: 4, tnt: tnt(5), diamond: 2, pearl: 1, totem: 1, shield: 1 };
      break;
    case "nether": {
      // 6×6：岩浆 2 格，位置由种子定，开局就看得见；新摆法一半挨在一起
      size = 6;
      let first, second;
      if (layout2) [first, second] = lavaOf(int);
      else {
        first = int(0, 35);
        second = int(0, 34);
        if (second >= first) second += 1;
      }
      fixed[first] = "lava";
      fixed[second] = "lava";
      counts = { debris: 1, diamond: 4, tnt: tnt(6), apple: 1, pearl: 1, totem: 2, shield: 2 };
      break;
    }
    case "deep":
      size = 7;
      counts = { diamond: 8, apple: 2, totem: 2, tnt: tnt(7), pearl: 2, shield: 2, spyglass: 1 };
      break;
    default: {
      size = /** @type {5|6|7} */ (rules.boardSpec === "random" ? int(5, 7) : Number(rules.boardSpec));
      const { emerald: _emerald, ...base } = COMPOSITIONS[size];
      counts = { ...base, tnt: tnt(size), spyglass: size === 5 ? 1 : 2 };
      if (rules.compositionVariation === "slight")
        for (const kind of /** @type {const} */ (["diamond", "totem", "tnt", "shield"])) counts[kind] = (counts[kind] ?? 0) + int(-1, 1);
      if (size === 6) counts.pearl = int(1, 2);
      counts.coal = SCRAP_COUNTS[size];
      counts.stick = SCRAP_COUNTS[size];
      counts.map = size === 7 ? 1 : int(0, 1);
      counts.potion = (rules.digInterval ?? 1) >= 3 ? int(0, 1) : 0;
      counts.key = int(0, 99) < 30 ? 1 : 0;
    }
  }
  // 末影之眼开的特殊区块里不藏眼（不会一个接一个开）
  if (!forced && rules.eyeEvery > 0 && nth % rules.eyeEvery === 0) counts.eye = 1;
  const cells = size * size - Object.keys(fixed).length;
  const sum = () => Object.values(counts).reduce((total, count) => total + (count ?? 0), 0);
  // 放不下时（难度高的 5×5）依次少放这几样
  for (const kind of /** @type {const} */ (["potion", "map", "key", "stick", "coal"]))
    while (sum() > cells && (counts[kind] ?? 0) > 0) counts[kind] = (counts[kind] ?? 0) - 1;
  const composition = /** @type {Composition} */ (Object.fromEntries(KINDS.map((kind) => [kind, counts[kind] ?? 0])));
  composition.emerald = Math.max(0, cells - sum());
  const shuffled = shuffledDeck(int, composition);
  /** @type {Kind[]} */
  const deck = [];
  for (let index = 0, next = 0; index < size * size; index++) deck.push(fixed[index] ?? shuffled[next++]);
  /** @type {Card} */
  const card = {
    id, x, y, size, ...(biome === "normal" ? {} : { kind: biome }),
    composition, deck,
    opened: Array(size * size).fill(null),
    finished: false,
    torches: [],
  };
  if (Object.keys(fixed).length > 0) card.fixed = fixed;
  if (biome === "trial") card.vaults = Object.fromEntries(vaultCells.map((index) => [index, VAULT_OPENS]));
  if (rails) card.rails = rails;
  if (biome === "deep") {
    // 第 2 版：噪音会退、每挖一格都可能醒（§16），不再先定一个数
    if ((rules.special ?? 0) >= 2) {
      card.noise = 0;
      card.noiseAt = 0;
    } else card.wardenAt = int(Math.ceil(cells * WARDEN_RANGE[0]), Math.floor(cells * WARDEN_RANGE[1]));
    card.closed = false;
  }
  if (forced) card.fromEye = true;
  return card;
}

const slotKey = (/** @type {number} */ x, /** @type {number} */ y) => `${x},${y}`;

/**
 * 开局：第一张卡在 (0, 0)。
 * @param {{ seed: string, rules: Rules, pool: number, openedAt: number, deadlineAt: number|null }} start
 * @returns {Game}
 */
export function createGame({ seed, rules, pool, openedAt, deadlineAt }) {
  /** @type {Game} */
  const game = {
    version: 3, seed, rules, pool, used: 0, openedAt, deadlineAt,
    cards: {}, slots: {}, nextCardId: 1, feed: [], seq: 0,
    stats: { digs: 0, players: 0, claimed: 0, claimedPoints: 0 },
    over: false, top: [],
  };
  addCard(game, 0, 0);
  return game;
}

/** 末地宝藏卡，放在 (x, y)；配比（新局随机）和牌序都由种子和卡号定。 */
export function newEndCard(/** @type {Game} */ game, /** @type {number} */ id, /** @type {number} */ x, /** @type {number} */ y) {
  const int = randomOf(game.seed, `card:${id}`);
  /** @type {Composition} */
  const composition = { ...END_COMPOSITION };
  if (game.rules.endMix === 2) {
    let room = 9;
    // 有道具栏的局：60% 有一个末影箱
    if (game.rules.items) {
      composition.ender = int(0, 99) < 60 ? 1 : 0;
      room -= composition.ender;
    }
    for (const [kind, [low, high]] of Object.entries(END_RANGES)) {
      const count = int(low, Math.min(high, room));
      composition[/** @type {BaseKind} */ (kind)] = count;
      room -= count;
    }
    composition.emerald = room;
  }
  return /** @type {Card} */ ({
    id, x, y, size: 3, kind: "end", composition,
    deck: shuffledDeck(int, composition),
    opened: Array(9).fill(null),
    finished: false,
    ...(game.rules.items ? { torches: [] } : {}),
  });
}

function addCard(/** @type {Game} */ game, /** @type {number} */ x, /** @type {number} */ y, end = false, /** @type {Biome|null} */ biome = null) {
  const card = end ? newEndCard(game, game.nextCardId, x, y) : newCard(game, game.nextCardId, x, y, biome);
  if (end && biome === null && game.rules.items && (game.rules.special ?? 0) >= 2) card.fromEye = true;
  game.cards[card.id] = card;
  game.slots[slotKey(x, y)] = card.id;
  game.nextCardId += 1;
  return card;
}

/** 右、下、左、上：一样近时的先后（§5）。 */
const DIRECTIONS = /** @type {const} */ ([[1, 0], [0, 1], [-1, 0], [0, -1]]);

/**
 * 珍珠在第 index 格时，新卡放哪：离珍珠最近的那条边外；那边有卡就换下一近的边；
 * 四边都满，找离这张卡最近的空位（先按切比雪夫距离一圈一圈找，同一圈里按曼哈顿
 * 距离，再按右、下、左、上）。
 * @returns {{ x: number, y: number }}
 */
export function placeFor(/** @type {Game} */ game, /** @type {Card} */ card, /** @type {number} */ index) {
  const row = Math.floor(index / card.size);
  const col = index % card.size;
  const last = card.size - 1;
  // 到右、下、左、上四条边的距离
  const distances = [last - col, last - row, col, row];
  const order = [0, 1, 2, 3].sort((a, b) => distances[a] - distances[b] || a - b);
  for (const side of order) {
    const [dx, dy] = DIRECTIONS[side];
    if (!(slotKey(card.x + dx, card.y + dy) in game.slots)) return { x: card.x + dx, y: card.y + dy };
  }
  return nearestFree(game, card, 1);
}

/**
 * 末影之眼开的末地宝藏放哪：离这张卡至少隔一圈的最近空位（从第二圈找起），
 * 看上去是飞到远处开出来的。
 */
export function placeFar(/** @type {Game} */ game, /** @type {Card} */ card) {
  return nearestFree(game, card, 2);
}

/** 从第 fromRing 圈起，离这张卡最近的空位：切比雪夫距离一圈一圈找，同一圈里按曼哈顿距离，再按右、下、左、上。 */
function nearestFree(/** @type {Game} */ game, /** @type {Card} */ card, /** @type {number} */ fromRing) {
  for (let ring = fromRing; ; ring++) {
    /** @type {{ x: number, y: number, manhattan: number, rank: number }[]} */
    const free = [];
    for (let dy = -ring; dy <= ring; dy++)
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = card.x + dx;
        const y = card.y + dy;
        if (slotKey(x, y) in game.slots) continue;
        // 先看主要偏向哪边，再看另一个方向，都按右、下、左、上
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const major = horizontal ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
        const minor = horizontal ? (dy > 0 ? 1 : dy < 0 ? 3 : 0) : (dx > 0 ? 0 : dx < 0 ? 2 : 0);
        const rank = major * 4 + minor;
        free.push({ x, y, manhattan: Math.abs(dx) + Math.abs(dy), rank });
      }
    free.sort((a, b) => a.manhattan - b.manhattan || a.rank - b.rank || a.y - b.y || a.x - b.x);
    if (free.length > 0) return { x: free[0].x, y: free[0].y };
  }
}

/** 预算还剩多少分：总奖池减去大家手里的分（领了的、没领的、末影箱里的都算）。 */
export function budgetLeft(/** @type {Game} */ game) {
  return Math.max(0, game.pool - game.used);
}

/** 第一次来的人。 */
export function newPlayer(/** @type {Game} */ game, /** @type {number} */ uid, /** @type {string} */ name) {
  return /** @type {Player} */ ({
    uid, name: [...name].slice(0, 32).join(""),
    chances: game.rules.initialChances, shield: false,
    ...(game.rules.items ? {
      shields: 0, spyglasses: 0, items: emptyBag(), coal: 0, stick: 0, poison: 0, chest: 0,
      hasteUntil: 0, slow: 0, tables: 0, maps: 0, vaultsOpened: [], activeAt: 0,
    } : {}),
    peeks: [],
    points: 0, digs: 0, status: "playing", lastDigAt: 0, lastResult: null, trail: [],
  });
}

/** @returns {Bag} */
const emptyBag = () => ({ torch: 0, map: 0, potion: 0, ender: 0, table: 0, key: 0, pick: { h: 0, v: 0, x: 0 } });

/** 手里的道具（新局；这一版以前在本机开的局的人第一次用时补上）。 */
function bagOf(/** @type {Player} */ player) {
  return (player.items ??= emptyBag());
}

/** 手里几面盾牌：新局记着数，以前开的局只有有没有。 */
export const shieldsOf = (/** @type {Player} */ player) => player.shields ?? (player.shield ? 1 : 0);
/** 最多带几面盾牌。 */
export const shieldCap = (/** @type {Rules} */ rules) => (rules.items ? SHIELD_CAP : 1);
/** 领取时能拿到的分：手上加末影箱。 */
export const totalOf = (/** @type {Player} */ player) => player.points + (player.chest ?? 0);
/** 附魔镐还能用几次（三种加起来）。 */
export const picksOf = (/** @type {Player} */ player) =>
  player.items ? player.items.pick.h + player.items.pick.v + player.items.pick.x : 0;
/**
 * 还有没有能挖的：镐子的机会、附魔镐，或者手里的附魔台（换得到附魔镐）。都没有了才说机会用完、
 * 才自动领取。
 */
export const canDig = (/** @type {Player} */ player) =>
  player.chances > 0 || picksOf(player) > 0 || (player.items?.table ?? 0) > 0;

function addShield(/** @type {Player} */ player) {
  if (player.shields !== undefined) player.shields += 1;
  player.shield = true;
}

function useShield(/** @type {Player} */ player) {
  if (player.shields !== undefined) {
    player.shields = Math.max(0, player.shields - 1);
    player.shield = player.shields > 0;
  } else player.shield = false; // 以前开的局只有一面
}

/** 两次挖掘之间至少隔多少毫秒（旧局没有这个参数，是 1 秒）。 */
export const intervalOf = (/** @type {Game} */ game) => (game.rules.digInterval ?? 1) * 1000;

/**
 * 还要等多少毫秒才能再挖（0 是现在就能挖）。新局另算：蜘蛛网让下一挖多等 slow 毫秒；急迫药水
 * 生效时间隔是 1 秒（到点时药水还有效才算）。
 */
export function coolingOf(/** @type {Game} */ game, /** @type {Player} */ player, /** @type {number} */ now) {
  const slow = player.slow ?? 0;
  const quick = Math.max(now, player.lastDigAt + MIN_INTERVAL_MS + slow);
  if (quick < (player.hasteUntil ?? 0)) return quick - now;
  return Math.max(0, player.lastDigAt + intervalOf(game) + slow - now);
}

/**
 * 现在还能不能挖；能挖时 null，不能时一句话。cooling: false 时不算间隔：“现在能不能挖”
 * 的状态里不说它，它几秒就过去，网页自己倒计时。机会用完是说镐子的机会和附魔镐都用完了；
 * 只剩附魔镐时镐子挖不了，由 dig 自己说。
 */
export function digBlocked(/** @type {Game} */ game, /** @type {Player} */ player, /** @type {number} */ now, { cooling = true } = {}) {
  if (player.status === "claimed") return "你已经领取了，这一局不能再挖了";
  // 手里没有分就不叫他领：领 0 分只会在红包里记一笔“领取 0.00”
  const ask = totalOf(player) > 0 ? "，请领取" : "";
  if (game.over) return `奖池已经分完，游戏结束了${ask}`;
  if (game.deadlineAt !== null && now >= game.deadlineAt - WRAP_UP_MS)
    return `快截止了，已经停止挖掘${ask}`;
  if (!canDig(player)) return `能挖的都用完了${ask}`;
  const left = cooling ? coolingOf(game, player, now) : 0;
  if (left > 0) {
    if ((player.slow ?? 0) > 0) return `被蜘蛛网缠住了，还要等 ${Math.ceil(left / 1000)} 秒才能再挖`;
    return intervalOf(game) <= MIN_INTERVAL_MS || now < (player.hasteUntil ?? 0)
      ? "挖得太快了，稍等一下" : `还要等 ${Math.ceil(left / 1000)} 秒才能再挖`;
  }
  return null;
}

/** 卡挖完了没有：固定的格子不算，被岩浆吞掉的算挖开；监守者关掉的卡也算挖完。 */
function finishedOf(/** @type {Card} */ card) {
  return Boolean(card.closed) || card.opened.every((cell, index) => cell !== null || card.fixed?.[index] !== undefined);
}

/** 这张卡上有人挖开的格子数（被岩浆吞掉的不算）：下界的岩浆、深暗之域的噪音都数这个。 */
export function dugOf(/** @type {Card} */ card) {
  return card.opened.reduce((count, cell) => count + (cell !== null && !cell.burn ? 1 : 0), 0);
}

/** 没有这一格、固定的格子、挖开的格子、挖完的卡：挖不了时一句话。 */
function cellRefused(/** @type {Card|undefined} */ card, /** @type {number} */ index) {
  if (!card) return "没有这张卡";
  if (!Number.isSafeInteger(index) || index < 0 || index >= card.deck.length) return "没有这一格";
  if (card.closed) return "监守者醒了，这张卡已经关闭，不能再挖";
  if (card.finished) return "这张卡已经挖完了";
  return null;
}

const FIXED_REFUSED = /** @type {Record<FixedKind, string>} */ ({
  deco: "这一格是装饰，不能挖",
  vault: "这是宝库，不能挖：拿试炼钥匙点它，开一次",
  lava: "这一格是岩浆，不能挖",
});

/**
 * 一次动作（镐子挖一格、附魔镐用一次）开头：间隔从这里算，蜘蛛网的等待用掉了，苦力怕重新
 * 计时；中毒时先扣一次（手上的 5%，盾牌挡不住，扣掉的回到预算）。返回扣掉的分，没中毒是 null。
 */
function startAction(/** @type {Game} */ game, /** @type {Player} */ player, /** @type {number} */ now) {
  player.lastDigAt = now;
  if (!game.rules.items) return null;
  player.slow = 0;
  player.activeAt = now;
  if ((player.poison ?? 0) <= 0) return null;
  player.poison = (player.poison ?? 0) - 1;
  const lost = percentOf(player.points, POISON_PERCENT);
  player.points -= lost;
  game.used -= lost;
  if (lost > 0) player.trail?.push({ k: "poison", a: -lost, p: totalOf(player) });
  return lost;
}

/** 中毒那一下写在结果的话里。 */
function noteText(/** @type {Player} */ player, /** @type {number} */ lost, /** @type {string|undefined} */ step) {
  return `；中毒扣掉 ${formatPoints(lost, step)}（5%），${player.poison ? `还要扣 ${player.poison} 次` : "毒解了"}`;
}

/**
 * 挖一格（镐子）。先做完所有检查，再改牌面、机会和分；game、player 原地改。
 * @returns {{ ok: false, message: string } | { ok: true, result: Result, feed: FeedItem, newCard: Card|null, burned: CellOut['burned'], claimNow: boolean }}
 */
export function dig(
  /** @type {Game} */ game,
  /** @type {Player} */ player,
  /** @type {{ cardId: number, index: number, now: number }} */ { cardId, index, now },
) {
  const blocked = digBlocked(game, player, now);
  if (blocked) return { ok: false, message: blocked };
  // 只剩附魔镐（新局）
  if (player.chances <= 0)
    return { ok: false, message: picksOf(player) > 0 ? "镐子用完了，可以用附魔镐接着挖" : "镐子用完了，打开附魔台换一把附魔镐接着挖" };
  const card = game.cards[cardId];
  const refused = cellRefused(card, index);
  if (refused) return { ok: false, message: refused };
  const fixed = card.fixed?.[index];
  if (fixed) return { ok: false, message: FIXED_REFUSED[fixed] };
  const open = card.opened[index];
  if (open !== null) return { ok: false, message: open.burn ? "这一格被岩浆吞掉了，换一格" : "这一格已经被挖开了，换一格" };

  player.chances -= 1;
  const poisoned = startAction(game, player, now);
  const out = digCell(game, player, card, index, now);
  if (poisoned !== null) {
    out.result.poison = poisoned;
    out.result.text += noteText(player, poisoned, game.rules.step);
  }
  // 机会和附魔镐都用完、奖池分完时自动领取；手里没有分就不领（领了也是 0）
  return { ok: true, ...out, claimNow: (!canDig(player) || game.over) && totalOf(player) > 0 };
}

/**
 * 挖开一格：牌面、统计、奖励和扣分、长卡、道具、岩浆、监守者、动态。镐子和附魔镐的每一格
 * 都走这里；机会、间隔、中毒在外面算（一次动作只算一次）。
 * @returns {CellOut}
 */
function digCell(/** @type {Game} */ game, /** @type {Player} */ player, /** @type {Card} */ card, /** @type {number} */ index, /** @type {number} */ now) {
  const { rules } = game;
  const cardId = card.id;
  const kind = card.deck[index];
  card.opened[index] = { uid: player.uid, name: player.name, at: now };
  card.finished = finishedOf(card);
  game.stats.digs += 1;
  if (player.digs === 0) game.stats.players += 1;
  player.digs += 1;
  player.peeks = player.peeks.filter((peek) => !(peek.cardId === cardId && peek.index === index));

  let wanted = 0;
  let blockedTnt = false;
  let appleCapped = 0;
  let text = "";
  let publicText = "";
  /** 有奖励时话怎么开头 */
  let label = "";
  /** @type {Card|null} */
  let grown = null;
  /** @type {Loot|undefined} */
  let loot;
  const bag = rules.items ? bagOf(player) : null;
  switch (kind) {
    case "emerald":
      wanted = rules.smallReward;
      label = "绿宝石";
      publicText = "挖到了绿宝石";
      break;
    case "diamond":
      wanted = rules.smallReward * rules.bigMultiplier;
      label = "钻石大奖";
      publicText = "挖到了钻石大奖";
      break;
    case "apple": {
      const doubled = player.points === 0 ? rules.smallReward : player.points;
      wanted = rules.appleCap > 0 ? Math.min(doubled, rules.appleCap) : doubled;
      if (wanted < doubled) appleCapped = rules.appleCap;
      label = "附魔金苹果";
      publicText = player.points === 0 ? "附魔金苹果送来一份小奖"
        : appleCapped ? "附魔金苹果让奖励翻倍，加到了上限" : "附魔金苹果让奖励翻倍";
      break;
    }
    case "totem":
      player.chances += rules.totemBonus;
      text = `双铁镐！镐子 +${rules.totemBonus} 次`;
      publicText = `双铁镐让镐子多了 ${rules.totemBonus} 次`;
      break;
    case "tnt":
      if (shieldsOf(player) > 0) {
        useShield(player);
        blockedTnt = true;
        text = rules.items ? `盾牌挡住了 TNT，用掉一面，还有 ${shieldsOf(player)} 面` : "盾牌挡住了 TNT，盾牌已消耗";
        publicText = "用盾牌挡住了 TNT";
      } else {
        wanted = -percentOf(player.points, rules.tntPercent);
        publicText = "踩中了 TNT";
      }
      break;
    case "crystal":
      // 末影水晶（末地宝藏卡里）：像 TNT，扣双倍比例，最多扣光；盾牌一样能挡
      if (shieldsOf(player) > 0) {
        useShield(player);
        blockedTnt = true;
        text = rules.items ? `盾牌挡住了末影水晶的爆炸，用掉一面，还有 ${shieldsOf(player)} 面` : "盾牌挡住了末影水晶的爆炸，盾牌已消耗";
        publicText = "用盾牌挡住了末影水晶";
      } else {
        wanted = -percentOf(player.points, crystalPercent(rules));
        publicText = "引爆了末影水晶";
      }
      break;
    case "pearl": {
      const place = placeFor(game, card, index);
      grown = addCard(game, place.x, place.y);
      text = "末影珍珠！旁边长出了一张新卡";
      publicText = "末影珍珠长出了一张新卡";
      if (rules.loot && bag) {
        loot = rollLoot(game, `loot:${cardId}:${index}`, (rules.digInterval ?? 1) >= 3 ? PEARL_LOOT_SLOW : PEARL_LOOT);
        giveLoot(player, bag, loot);
        text += `，还捡到了${LOOT_WORDS[loot]}`;
        publicText += `，还捡到了${LOOT_WORDS[loot]}`;
      }
      break;
    }
    case "eye": {
      const place = placeFar(game, card);
      // 新局（§17，有道具栏的）：远处开一张特殊区块，按权重抽末地宝藏、深暗之域、下界；以前的局只开末地宝藏
      let opens = /** @type {'end'|Biome} */ ("end");
      if (rules.items && (rules.special ?? 0) >= 2) {
        const roll = randomOf(game.seed, `eye:${card.id}:${index}`)(0, 99);
        opens = /** @type {'end'|Biome} */ (EYE_ODDS.find(([, upTo]) => roll < upTo)?.[0] ?? "end");
      }
      grown = opens === "end" ? addCard(game, place.x, place.y, true) : addCard(game, place.x, place.y, false, opens);
      const where = opens === "end" ? "末地宝藏" : BIOME_NAMES[opens];
      text = `末影之眼！远处开出了${where}`;
      publicText = `挖到末影之眼，${where}开了！`;
      if (rules.loot && bag) {
        loot = rollLoot(game, `loot:${cardId}:${index}`, EYE_LOOT);
        giveLoot(player, bag, loot);
        text += `，还捡到了${LOOT_WORDS[loot]}`;
        publicText += `还捡到了${LOOT_WORDS[loot]}`;
      }
      break;
    }
    case "shield":
      if (shieldsOf(player) >= shieldCap(rules)) {
        wanted = rules.smallReward;
        label = rules.items ? "盾牌带满了，转成小奖" : "重复盾牌转小奖";
        publicText = rules.items ? "盾牌带满了，转成了一份小奖" : "重复盾牌转成了一份小奖";
      } else {
        addShield(player);
        text = rules.items ? `获得盾牌（${shieldsOf(player)}/${SHIELD_CAP}），自动挡下一次 TNT 或末影水晶` : "获得盾牌，自动挡下一次 TNT";
        publicText = "获得了一面盾牌";
      }
      break;
    case "spyglass": {
      // 新局：先收进道具栏，自己挑一格看（useItem）
      if (rules.items) {
        player.spyglasses = (player.spyglasses ?? 0) + 1;
        text = "获得望远镜：点工具条里的望远镜，再点一格没挖开的格子，看看里面是什么";
        publicText = "捡到了一个望远镜";
        break;
      }
      const known = new Set(player.peeks.filter((peek) => peek.cardId === cardId).map((peek) => peek.index));
      const candidates = card.opened.flatMap((open, target) => open === null && !known.has(target) ? [target] : []);
      if (candidates.length === 0) {
        wanted = rules.smallReward;
        label = "望远镜转小奖";
        publicText = "望远镜没有新格子可看，转成一份小奖";
      } else {
        const target = candidates[randomOf(game.seed, `spy:${player.uid}:${player.digs}`)(0, candidates.length - 1)];
        player.peeks.push({ cardId, index: target, kind: card.deck[target] });
        text = `望远镜看见了 ${cellName(card, target)}，只有你看得见`;
        publicText = "用望远镜看到了一格";
      }
      break;
    }
    case "coal":
    case "stick": {
      const name = KIND_NAMES[kind];
      const other = kind === "coal" ? "stick" : "coal";
      const have = player[kind] ?? 0;
      publicText = `挖到了${name}`;
      if ((rules.items ?? 0) >= 2) {
        // 第 2 版：各一个就合成，多的攒着（不封顶），所以两样不会同时有
        player[kind] = have + 1;
        if ((player.coal ?? 0) >= 1 && (player.stick ?? 0) >= 1 && bag) {
          const made = craftedTorches(rules);
          player.coal = (player.coal ?? 0) - 1;
          player.stick = (player.stick ?? 0) - 1;
          bag.torch += made;
          text = `获得${name}，和${KIND_NAMES[other]}做成了${torchesWords(made)}`;
          publicText += `，做成了${torchesWords(made)}`;
        } else text = `获得${name}（${have + 1} 个），再有${KIND_NAMES[other]}就能做成火把`;
        break;
      }
      if (have >= SCRAP_CAP) {
        text = `${name}已经够了（${SCRAP_CAP}/${SCRAP_CAP}），这一块不算；再凑齐${KIND_NAMES[other]}就能做成火把`;
      } else {
        player[kind] = have + 1;
        text = `获得${name}（${have + 1}/${SCRAP_CAP}）`;
      }
      if ((player.coal ?? 0) >= SCRAP_CAP && (player.stick ?? 0) >= SCRAP_CAP && bag) {
        player.coal = 0;
        player.stick = 0;
        bag.torch += 1;
        text += "，煤炭和木棍凑齐了，做成一个火把";
        publicText += "，做成了一个火把";
      }
      break;
    }
    case "map":
      if (bag) bag.map += 1;
      text = "获得藏宝图：用它在地图上找一格宝物，只有你看得见";
      publicText = "捡到了一张藏宝图";
      break;
    case "potion":
      if (bag) bag.potion += 1;
      text = "获得急迫药水：喝下以后 10 秒里挖掘间隔变成 1 秒";
      publicText = "捡到了一瓶急迫药水";
      break;
    case "key":
      if (bag) bag.key += 1;
      text = "获得试炼钥匙：拿它点试炼密室里的宝库，开一次";
      publicText = "捡到了一把试炼钥匙";
      break;
    case "ender":
      if (bag) bag.ender += 1;
      text = "获得末影箱：用它把待领取的一半存进末影箱、另一半退回奖池，存进去的谁也扣不到";
      publicText = "捡到了一个末影箱";
      break;
    case "debris":
      wanted = rules.smallReward * 10;
      label = "远古残骸";
      publicText = "挖到了远古残骸";
      break;
    case "cobweb":
      player.slow = cobwebMs(rules);
      text = `蜘蛛网！下一次挖要多等 ${cobwebMs(rules) / 1000} 秒`;
      publicText = "被蜘蛛网缠住了";
      break;
    case "spawner":
      player.poison = POISON_TIMES;
      text = `刷怪笼！你中毒了：之后 ${POISON_TIMES} 次挖掘，每次扣手上的 ${POISON_PERCENT}%，盾牌挡不住`;
      publicText = "挖开了刷怪笼，中毒了";
      break;
    case "minecart": {
      const int = randomOf(game.seed, `minecart:${cardId}:${index}`);
      const roll = int(0, 99);
      publicText = "打开了箱子矿车";
      const got = (rules.loot ? MINECART_LOOT : MINECART_OLD).find(([, upTo]) => roll < upTo)?.[0] ?? "small";
      if (got === "small") {
        const count = int(2, 4);
        wanted = rules.smallReward * count;
        label = `箱子矿车里有 ${count} 份小奖`;
      } else {
        if (bag) giveLoot(player, bag, got);
        text = `箱子矿车里有${LOOT_WORDS[got]}`;
        if (rules.loot) loot = got;
      }
      break;
    }
  }

  // 正的按预算封顶，负的不扣到 0 以下；扣掉的回到预算
  const amount = wanted > 0 ? Math.min(wanted, budgetLeft(game)) : Math.max(wanted, -player.points);
  player.points += amount;
  game.used += amount;
  if (wanted > 0) {
    text = `${label}，奖励 +${formatPoints(amount, game.rules.step)}${amount < wanted ? "（奖池只剩这么多）"
      : appleCapped ? `（附魔金苹果一次最多加 ${formatPoints(appleCapped, game.rules.step)}）` : ""}`;
  } else if (kind === "tnt" && !blockedTnt) {
    text = `TNT！奖励 -${formatPoints(-amount, game.rules.step)}（${rules.tntPercent}%）`;
  } else if (kind === "crystal" && !blockedTnt) {
    text = `末影水晶爆炸！奖励 -${formatPoints(-amount, game.rules.step)}（双倍，${crystalPercent(rules)}%）`;
  }
  player.trail?.push({ k: kind, a: amount, p: totalOf(player), ...(blockedTnt ? { b: /** @type {1} */ (1) } : {}) });

  /** @type {CellOut['burned']} */
  const burned = [];
  let warden = 0;
  if (rules.items && card.kind === "nether") {
    const flowed = lavaFlow(game, card, now);
    if (flowed) {
      burned.push(flowed);
      publicText += `；岩浆流过来，吞掉了一格${KIND_NAMES[flowed.kind]}`;
    }
  }
  if (rules.items && card.kind === "deep" && !card.closed) {
    let wakes = false;
    if (card.noiseAt !== undefined) {
      // 第 2 版（§16）：先按没人挖的时间退，再加这一格；过了两成五以后按噪音抽一次（种子 + 这张卡挖开的格数，谁都能核对）
      const noise = noiseNow(card, rules, now) + 1;
      card.noise = noise;
      card.noiseAt = now;
      const cells = card.size * card.size - Object.keys(card.fixed ?? {}).length;
      wakes = randomOf(game.seed, `warden:${card.id}:${dugOf(card)}`)(0, 9999) < wardenChance(noise, cells) * 10000;
    } else wakes = dugOf(card) >= (card.wardenAt ?? Infinity);
    if (wakes) {
      // 监守者：吵醒它的人待领取的扣一半（盾牌挡不住，末影箱里的不算），卡关闭；大家看得见是谁、被抢走多少
      warden = percentOf(player.points, WARDEN_PERCENT);
      player.points -= warden;
      game.used -= warden;
      card.closed = true;
      card.finished = true;
      card.wokeBy = { uid: player.uid, name: player.name, amount: warden, at: now };
      if (warden > 0) player.trail?.push({ k: "warden", a: -warden, p: totalOf(player) });
      const lost = formatPoints(warden, game.rules.step);
      // 卡关了不用再说：卡上暗下来、写着监守者醒了（2026-11-12 用户）
      text += `${text ? "。" : ""}监守者被你吵醒了！${warden > 0 ? `它抢走了你待领取的一半（-${lost}）` : "好在你手上没有待领取的"}`;
      publicText += `，吵醒了监守者${warden > 0 ? `，待领取的被抢走一半（-${lost}）` : ""}`;
    }
  }
  // 地图不能长不动：监守者关掉的卡、岩浆里都可能把最后几颗珍珠带走；还能挖的卡上一颗都不剩时，
  // 在这张卡旁边长一张新卡（有珍珠），大家还有地方挖（2026-11-11 模拟里人多的局有一成停住）
  if (rules.items && !grown && !game.over && !pearlsLeft(game)) {
    const place = placeFor(game, card, index);
    grown = addCard(game, place.x, place.y);
    text += `${text ? "。" : ""}矿洞里没有末影珍珠了，旁边长出一张新卡`;
    publicText += "；矿洞里没有末影珍珠了，旁边长出一张新卡";
  }
  if (budgetLeft(game) === 0) game.over = true;

  /** @type {Result} */
  const result = {
    kind, cardId, index, amount, blocked: blockedTnt, text, newCardId: grown?.id ?? null,
    ...(burned.length > 0 ? { burned } : {}), ...(warden > 0 ? { warden } : {}), ...(loot ? { loot } : {}),
  };
  player.lastResult = result;
  game.seq += 1;
  /** @type {FeedItem} */
  const feed = { seq: game.seq, uid: player.uid, name: player.name, kind, cardId, index, text: publicText, at: now, newCardId: grown?.id ?? null };
  game.feed = [feed, ...game.feed].slice(0, FEED_LIMIT);
  return { result, feed, newCard: grown, burned };
}

/** 按种子从累计上限表里抽一样（0–99）。 */
function rollLoot(/** @type {Game} */ game, /** @type {string} */ key, /** @type {ReadonlyArray<readonly [Loot, number]>} */ odds) {
  const roll = randomOf(game.seed, key)(0, 99);
  return odds.find(([, upTo]) => roll < upTo)?.[0] ?? odds[odds.length - 1][0];
}

/** 道具收进手里（望远镜在新局里单独记）。 */
function giveLoot(/** @type {Player} */ player, /** @type {Bag} */ bag, /** @type {Loot} */ loot) {
  if (loot === "spyglass") player.spyglasses = (player.spyglasses ?? 0) + 1;
  else bag[loot] += 1;
}

/**
 * 下界：这张卡上每挖 LAVA_EVERY 格，岩浆往旁边（上下左右）一格没挖开的格子流一格（岩浆和
 * 被它吞掉的格子都算岩浆），挑哪格由种子定，远古残骸吞不掉。被吞的格子翻开（uid 0），之后就没了。
 * @returns {{ index: number, kind: Kind }|null}
 */
const UNBURNABLE = /** @type {ReadonlySet<Kind>} */ (new Set(["debris", "pearl", "eye"]));

/** 还能挖的卡（没关）上还有没挖开的末影珍珠吗：没有了地图就长不动。 */
function pearlsLeft(/** @type {Game} */ game) {
  return Object.values(game.cards).some((card) => !card.closed
    && card.deck.some((kind, at) => kind === "pearl" && card.opened[at] === null && card.fixed?.[at] === undefined));
}

function lavaFlow(/** @type {Game} */ game, /** @type {Card} */ card, /** @type {number} */ now) {
  const dug = dugOf(card);
  if (dug === 0 || dug % LAVA_EVERY !== 0) return null;
  const { size } = card;
  const lava = (/** @type {number} */ at) => card.fixed?.[at] === "lava" || card.opened[at]?.burn === 1;
  /** @type {number[]} */
  const targets = [];
  for (let at = 0; at < card.deck.length; at++) {
    // 远古残骸烧不掉；末影珍珠、末影之眼也不吞（吞了地图就可能长不动）
    if (card.opened[at] !== null || card.fixed?.[at] !== undefined || UNBURNABLE.has(card.deck[at])) continue;
    const row = Math.floor(at / size);
    const col = at % size;
    if ((row > 0 && lava(at - size)) || (row < size - 1 && lava(at + size)) || (col > 0 && lava(at - 1)) || (col < size - 1 && lava(at + 1)))
      targets.push(at);
  }
  // 旁边能吞的都吞不了时（只挨着远古残骸、末影珍珠、末影之眼），岩浆从这张卡别处冒出来：要是这一次
  // 不流，大家就知道岩浆旁边那几格是大奖（审查发现的漏洞）
  if (targets.length === 0)
    for (let at = 0; at < card.deck.length; at++)
      if (card.opened[at] === null && card.fixed?.[at] === undefined && !UNBURNABLE.has(card.deck[at])) targets.push(at);
  if (targets.length === 0) return null;
  const target = targets[randomOf(game.seed, `lava:${card.id}:${dug}`)(0, targets.length - 1)];
  card.opened[target] = { uid: 0, name: "", at: now, burn: 1 };
  card.finished = finishedOf(card);
  return { index: target, kind: card.deck[target] };
}

/** 附魔镐在第 index 格（形状的中心）挖到的格子，按从上到下、从左到右；出界的不算。 */
export function shapeCells(/** @type {Card} */ card, /** @type {Shape} */ shape, /** @type {number} */ index) {
  const { size } = card;
  const row = Math.floor(index / size);
  const col = index % size;
  const offsets = shape === "h" ? [[0, -1], [0, 0], [0, 1]]
    : shape === "v" ? [[-1, 0], [0, 0], [1, 0]]
    : [[-1, 0], [0, -1], [0, 0], [0, 1], [1, 0]];
  return offsets
    .map(([dr, dc]) => [row + dr, col + dc])
    .filter(([r, c]) => r >= 0 && r < size && c >= 0 && c < size)
    .map(([r, c]) => r * size + c);
}

/**
 * 用附魔镐：一次挖开形状里没挖开的格子，每格照常算；不花镐子的机会，花这种附魔镐的一次，
 * 但要等挖掘间隔（蜘蛛网也算）；中毒只扣一次。挖到中间监守者醒了、奖池分完就停下。
 * @returns {{ ok: false, message: string } | { ok: true, cells: (CellOut & { left: number, over: boolean, stats: Game['stats'] })[], skipped: number, text: string, claimNow: boolean }}
 */
export function usePick(
  /** @type {Game} */ game,
  /** @type {Player} */ player,
  /** @type {{ shape: Shape, cardId: number, index: number, now: number }} */ { shape, cardId, index, now },
) {
  if (!game.rules.items) return { ok: false, message: "这一局没有道具栏" };
  const blocked = digBlocked(game, player, now);
  if (blocked) return { ok: false, message: blocked };
  const bag = bagOf(player);
  if (bag.pick[shape] <= 0) return { ok: false, message: `你手里没有${PICK_NAMES[shape]}` };
  const card = game.cards[cardId];
  const refused = cellRefused(card, index);
  if (refused) return { ok: false, message: refused };
  const area = shapeCells(card, shape, index);
  const targets = area.filter((at) => card.opened[at] === null && card.fixed?.[at] === undefined);
  if (targets.length === 0) return { ok: false, message: "框里没有能挖的格子，换个地方" };

  bag.pick[shape] -= 1;
  const poisoned = startAction(game, player, now);
  /** @type {(CellOut & { left: number, over: boolean, stats: Game['stats'] })[]} */
  const cells = [];
  for (const at of targets) {
    if (card.closed || game.over) break;
    // 刚被这一下引来的岩浆吞掉
    if (card.opened[at] !== null) continue;
    const out = digCell(game, player, card, at, now);
    cells.push({ ...out, left: game.pool - game.used, over: game.over, stats: { ...game.stats } });
  }
  if (poisoned !== null) {
    cells[0].result.poison = poisoned;
    cells[0].result.text += noteText(player, poisoned, game.rules.step);
  }
  const skipped = area.length - cells.length;
  const sum = cells.reduce((total, cell) => total + cell.result.amount, 0);
  const text = `${PICK_NAMES[shape]}挖开了 ${cells.length} 格${skipped > 0 ? `，跳过 ${skipped} 格` : ""}${
    sum > 0 ? `，奖励一共 +${formatPoints(sum, game.rules.step)}` : sum < 0 ? `，奖励一共 -${formatPoints(-sum, game.rules.step)}` : ""}；还能用 ${bag.pick[shape]} 次`;
  return { ok: true, cells, skipped, text, claimNow: (!canDig(player) || game.over) && totalOf(player) > 0 };
}

/** 领取：分（手上加末影箱）定下来，之后不能再挖。再领一次还是同样的分。 */
export function claim(/** @type {Game} */ game, /** @type {Player} */ player, now = 0) {
  if (player.status !== "claimed") {
    player.status = "claimed";
    if (game.rules.items && now) player.activeAt = now;
    game.stats.claimed += 1;
    game.stats.claimedPoints += totalOf(player);
    if (game.top) game.top = topWith(game.top, player);
  }
  return totalOf(player);
}

/** 附魔台给的两种形状：每人第 n 个附魔台由种子定，换不了。 */
export function tableChoicesOf(/** @type {Game} */ game, /** @type {Player} */ player) {
  const left = randomOf(game.seed, `table:${player.uid}:${player.tables ?? 0}`)(0, 2);
  return SHAPES.filter((_, at) => at !== left);
}

/** 火把那个角的四格（index 是右下那格；行、列都要 ≥1）。 */
function cornerCells(/** @type {Card} */ card, /** @type {number} */ index) {
  return [index - card.size - 1, index - card.size, index - 1, index];
}

/** 第 2 版的火把照亮的格子：以 index 为中心的 3×3（出界的不算）。 */
export function torchCells(/** @type {Card} */ card, /** @type {number} */ index) {
  const { size } = card;
  const row = Math.floor(index / size);
  const col = index % size;
  /** @type {number[]} */
  const cells = [];
  for (let r = row - 1; r <= row + 1; r++)
    for (let c = col - 1; c <= col + 1; c++) if (r >= 0 && r < size && c >= 0 && c < size) cells.push(r * size + c);
  return cells;
}

/** 第 2 版火把的颜色：3×3 里一共几个危险（挖开的也算）：0 绿、1–2 黄（1）、3–4 橙（2）、5 个以上红（3）。 */
export function torchLevel2(/** @type {Card} */ card, /** @type {number} */ at) {
  const danger = torchCells(card, at).filter((index) => DANGER.has(card.deck[index])).length;
  return danger === 0 ? 0 : danger <= 2 ? 1 : danger <= 4 ? 2 : 3;
}

/** 火把亮着没有。第 2 版一直亮着（卡关了就不显示）；第 1 版四格里还有没挖开的（固定的格子不算），卡也没关。 */
function torchLit(/** @type {Card} */ card, /** @type {number} */ at) {
  if (card.torches?.find((torch) => torch.at === at)?.level !== undefined) return !card.closed;
  return !card.closed && cornerCells(card, at).some((index) => card.opened[index] === null && card.fixed?.[index] === undefined);
}

/** 火把的颜色：这 4 格里没挖开的危险（TNT、末影水晶、刷怪笼）有几个：0 是绿，1–2 黄（1），3–4 红（2）。 */
export function torchLevel(/** @type {Card} */ card, /** @type {number} */ at) {
  const danger = cornerCells(card, at).filter((index) => card.opened[index] === null && DANGER.has(card.deck[index])).length;
  return danger === 0 ? 0 : danger <= 2 ? 1 : 2;
}

const TORCH_WORDS = ["绿色：这四格里没有危险", "黄色：这四格里有 1–2 个危险", "红色：这四格里有 3–4 个危险"];
const TORCH_WORDS_2 = ["绿色：周围 9 格里没有危险", "黄色：周围 9 格里有 1～2 个危险", "橙色：周围 9 格里有 3～4 个危险", "红色：周围 9 格里有 5 个以上危险"];

/**
 * 亮着的火把，给大家看的样子（第 1 版颜色每次都按现在的牌算，第 2 版是插下时定的）。第 2 版的带 v: 2：
 * 网页按它画在格子上、照 3×3、四种颜色（第 1 版画在角上、三种颜色）。
 */
export function publicTorches(/** @type {Card} */ card) {
  return (card.torches ?? []).filter((torch) => torchLit(card, torch.at))
    .map((torch) => (torch.level === undefined
      ? { at: torch.at, level: torchLevel(card, torch.at), name: torch.name }
      : { at: torch.at, level: torch.level, name: torch.name, v: 2 }));
}

/**
 * 用道具（新局的道具栏，docs/V3_ITEMS.md §3、§4）。附魔镐交给 usePick；别的不花机会、不用等
 * 挖掘间隔；领了、机会和附魔镐都用完、快截止、奖池分完时不能用。game、player 原地改。
 * 成功时：text 是给自己看的一句话；card 是改过、要推给大家的卡（火把、宝库）；budget 是改了预算
 * （要存整局）；其余是这种道具自己的回答（peek、cardId/index/kind、stored/destroyed、hasteMs、
 * pick、reward）。
 * @returns {ReturnType<typeof usePick> | { ok: false, message: string } | ({ ok: true, text: string, card?: Card, budget?: true } & Record<string, unknown>)}
 */
export function useItem(
  /** @type {Game} */ game,
  /** @type {Player} */ player,
  /** @type {{ item: string, cardId?: number, index?: number, choice?: string, now: number }} */ { item, cardId = NaN, index = NaN, choice, now },
) {
  if (!game.rules.items) return { ok: false, message: "这一局没有道具栏" };
  if (item.startsWith("pick-") && SHAPES.includes(/** @type {Shape} */ (item.slice(5))))
    return usePick(game, player, { shape: /** @type {Shape} */ (item.slice(5)), cardId, index, now });
  if (!["spyglass", "torch", "table", "ender", "potion", "map", "key"].includes(item)) return { ok: false, message: "没有这种道具" };
  const blocked = digBlocked(game, player, now, { cooling: false });
  if (blocked) return { ok: false, message: blocked };
  const bag = bagOf(player);
  const card = game.cards[cardId];
  const out = itemEffect(game, player, bag, { item, card, index, choice, now });
  if (out.ok) player.activeAt = now;
  return out;
}

/**
 * 各种道具（不含附魔镐）做什么。
 * @returns {{ ok: false, message: string } | ({ ok: true, text: string, card?: Card, budget?: true } & Record<string, unknown>)}
 */
function itemEffect(
  /** @type {Game} */ game,
  /** @type {Player} */ player,
  /** @type {Bag} */ bag,
  /** @type {{ item: string, card: Card|undefined, index: number, choice?: string, now: number }} */ { item, card, index, choice, now },
) {
  const { rules } = game;
  const onCard = () => {
    if (!card) return "没有这张卡";
    if (!Number.isSafeInteger(index) || index < 0 || index >= card.deck.length) return "没有这一格";
    return null;
  };
  switch (item) {
    case "spyglass": {
      if ((player.spyglasses ?? 0) <= 0) return { ok: false, message: "你手里没有望远镜" };
      const wrong = onCard();
      if (wrong || !card) return { ok: false, message: wrong ?? "没有这张卡" };
      if (card.fixed?.[index] !== undefined) return { ok: false, message: "这一格大家都看得见，换一格" };
      if (card.closed) return { ok: false, message: "监守者醒了，这张卡已经关闭，看了也挖不了" };
      if (card.opened[index] !== null) return { ok: false, message: "这一格已经被挖开了，换一格" };
      if (player.peeks.some((peek) => peek.cardId === card.id && peek.index === index)) return { ok: false, message: "这一格你已经看过了，换一格" };
      player.spyglasses = (player.spyglasses ?? 0) - 1;
      const peek = { cardId: card.id, index, kind: card.deck[index] };
      player.peeks.push(peek);
      return { ok: true, peek, text: `望远镜看见了 ${cellName(card, index)}：${KIND_NAMES[peek.kind]}，只有你看得见` };
    }
    case "torch": {
      if (bag.torch <= 0) return { ok: false, message: "你手里没有火把" };
      const wrong = onCard();
      if (wrong || !card) return { ok: false, message: wrong ?? "没有这张卡" };
      if ((rules.items ?? 0) >= 2) {
        // 第 2 版：插在挖开的格子上，照 3×3，颜色插下时定下（挖开的危险也算）
        if (card.closed) return { ok: false, message: "监守者醒了，这张卡已经关闭" };
        const open = card.opened[index];
        if (card.fixed?.[index] !== undefined || !open || open.burn) return { ok: false, message: "火把只能插在挖开的格子上" };
        if ((card.torches ?? []).some((torch) => torch.at === index)) return { ok: false, message: "这一格已经插了火把" };
        if (torchCells(card, index).every((at) => card.opened[at] !== null || card.fixed?.[at] !== undefined))
          return { ok: false, message: "周围的格子都挖开了，插火把没有用" };
        const level = torchLevel2(card, index);
        bag.torch -= 1;
        (card.torches ??= []).push({ at: index, uid: player.uid, name: player.name, level });
        return { ok: true, card, text: `火把插好了，大家都看得见。它是${TORCH_WORDS_2[level]}（挖开的也算）` };
      }
      if (Math.floor(index / card.size) < 1 || index % card.size < 1) return { ok: false, message: "火把要插在卡内部四格相交的地方" };
      if (card.closed) return { ok: false, message: "监守者醒了，这张卡已经关闭" };
      if ((card.torches ?? []).some((torch) => torch.at === index)) return { ok: false, message: "这个角已经插了火把" };
      if (!torchLit(card, index)) return { ok: false, message: "这个角的四格都挖开了，插火把没有用" };
      bag.torch -= 1;
      (card.torches ??= []).push({ at: index, uid: player.uid, name: player.name });
      return { ok: true, card, text: `火把插好了，大家都看得见。它是${TORCH_WORDS[torchLevel(card, index)]}` };
    }
    case "table": {
      if (bag.table <= 0) return { ok: false, message: "你手里没有附魔台" };
      const choices = tableChoicesOf(game, player);
      if (!choices.includes(/** @type {Shape} */ (choice))) return { ok: false, message: "只能挑附魔台给出的两种" };
      const shape = /** @type {Shape} */ (choice);
      bag.table -= 1;
      player.tables = (player.tables ?? 0) + 1;
      bag.pick[shape] += TABLE_USES;
      return { ok: true, pick: shape, text: `附魔好了：得到${PICK_NAMES[shape]}，能用 ${TABLE_USES} 次` };
    }
    case "ender": {
      if (bag.ender <= 0) return { ok: false, message: "你手里没有末影箱" };
      if (player.points <= 0) return { ok: false, message: "手上还没有分，不用存进末影箱" };
      const stored = Math.floor(player.points / 2);
      const destroyed = player.points - stored;
      bag.ender -= 1;
      player.chest = (player.chest ?? 0) + stored;
      player.points = 0;
      game.used -= destroyed;
      player.trail?.push({ k: "ender", a: -destroyed, p: totalOf(player) });
      return {
        ok: true, budget: true, stored, destroyed,
        text: `存进末影箱 ${formatPoints(stored, game.rules.step)}，${formatPoints(destroyed, game.rules.step)} 退回奖池。存进去的谁也扣不到，领取时一起算`,
      };
    }
    case "potion": {
      if (bag.potion <= 0) return { ok: false, message: "你手里没有急迫药水" };
      bag.potion -= 1;
      player.hasteUntil = Math.max(now, player.hasteUntil ?? 0) + HASTE_MS;
      const hasteMs = player.hasteUntil - now;
      return { ok: true, hasteMs, text: `喝下急迫药水：${Math.round(hasteMs / 1000)} 秒里挖掘间隔变成 1 秒` };
    }
    case "map": {
      if (bag.map <= 0) return { ok: false, message: "你手里没有藏宝图" };
      const known = new Set(player.peeks.map((peek) => `${peek.cardId}:${peek.index}`));
      /** @type {Record<string, { card: Card, index: number }[]>} */
      const found = {};
      for (const other of Object.values(game.cards).sort((a, b) => a.id - b.id)) {
        if (other.finished) continue;
        other.deck.forEach((kind, at) => {
          if (kind in MAP_WEIGHTS && other.opened[at] === null && !known.has(`${other.id}:${at}`))
            (found[kind] ??= []).push({ card: other, index: at });
        });
      }
      const kinds = /** @type {(keyof typeof MAP_WEIGHTS)[]} */ (Object.keys(MAP_WEIGHTS)).filter((kind) => found[kind]);
      if (kinds.length === 0) return { ok: false, message: "地图上已经没有能找的宝物了" };
      const int = randomOf(game.seed, `map:${player.uid}:${player.maps ?? 0}`);
      let roll = int(0, kinds.reduce((sum, kind) => sum + MAP_WEIGHTS[kind], 0) - 1);
      const kind = /** @type {keyof typeof MAP_WEIGHTS} */ (kinds.find((each) => (roll -= MAP_WEIGHTS[each]) < 0));
      const spot = found[kind][int(0, found[kind].length - 1)];
      bag.map -= 1;
      player.maps = (player.maps ?? 0) + 1;
      const peek = { cardId: spot.card.id, index: spot.index, kind };
      player.peeks.push(peek);
      return {
        ok: true, peek, cardId: peek.cardId, index: peek.index, kind,
        text: `藏宝图找到了第 ${spot.card.id} 张卡的 ${cellName(spot.card, spot.index)}：${KIND_NAMES[kind]}，只有你看得见`,
      };
    }
    case "key": {
      if (bag.key <= 0) return { ok: false, message: "你手里没有试炼钥匙" };
      const wrong = onCard();
      if (wrong || !card) return { ok: false, message: wrong ?? "没有这张卡" };
      if (card.fixed?.[index] !== "vault" || !card.vaults) return { ok: false, message: "这一格不是宝库" };
      if ((card.vaults[index] ?? 0) <= 0) return { ok: false, message: "这个宝库已经开完了" };
      const vaultsOpened = (player.vaultsOpened ??= []);
      const key = `${card.id}:${index}`;
      if (vaultsOpened.includes(key)) return { ok: false, message: "这个宝库你已经开过了，每人每个宝库只能开一次" };
      const roll = randomOf(game.seed, `vault:${card.id}:${index}:${player.uid}`)(0, 99);
      bag.key -= 1;
      card.vaults[index] -= 1;
      vaultsOpened.push(key);
      let wanted = 0;
      /** @type {'small'|'diamond'|'table'|'shield'} */
      let kind;
      let text;
      if (roll < 45) {
        kind = "small";
        wanted = rules.smallReward * 3;
        text = "宝库开出三份小奖";
      } else if (roll < 70) {
        kind = "diamond";
        wanted = rules.smallReward * rules.bigMultiplier;
        text = "宝库开出一颗钻石";
      } else if (roll < 90) {
        kind = "table";
        bag.table += 1;
        text = "宝库开出一个附魔台：打开它，从两种附魔镐里挑一种";
      } else {
        kind = "shield";
        if (shieldsOf(player) >= shieldCap(rules)) {
          wanted = rules.smallReward;
          text = "宝库开出一面盾牌，盾牌带满了，转成一份小奖";
        } else {
          addShield(player);
          text = `宝库开出一面盾牌（${shieldsOf(player)}/${SHIELD_CAP}）`;
        }
      }
      const amount = Math.min(wanted, budgetLeft(game));
      player.points += amount;
      game.used += amount;
      if (amount > 0) {
        player.trail?.push({ k: "vault", a: amount, p: totalOf(player) });
        text += `，奖励 +${formatPoints(amount, game.rules.step)}${amount < wanted ? "（奖池只剩这么多）" : ""}`;
      }
      if (budgetLeft(game) === 0) game.over = true;
      return { ok: true, card, budget: true, reward: { kind, amount }, text: `${text}。这个宝库还能开 ${card.vaults[index]} 次` };
    }
  }
  return { ok: false, message: "没有这种道具" };
}

/** 苦力怕几秒来（0 是这一局不开）；本机在这一版以前开的有道具栏的局按默认。 */
export const creeperSeconds = (/** @type {Rules} */ rules) => (rules.items ? rules.creeper ?? CREEPER_DEFAULT : 0);

/**
 * 还有多少毫秒苦力怕探头（之后再过 CREEPER_FUSE_MS 爆炸）；不开、手上没分、不能挖了（领了、
 * 机会用完、快截止、奖池分完）时 null。
 */
export function creeperMsOf(/** @type {Game} */ game, /** @type {Player} */ player, /** @type {number} */ now) {
  const seconds = creeperSeconds(game.rules);
  if (seconds <= 0 || player.points <= 0 || digBlocked(game, player, now, { cooling: false })) return null;
  return Math.max(0, (player.activeAt ?? now) + seconds * 1000 - now);
}

/**
 * 苦力怕爆炸（网页倒数到点时发 POST /creeper）：核对这么久没挖、没用道具（留 2 秒余量），
 * 炸掉手上的 20%（向下取整，末影箱里的不算），扣掉的回到预算，重新计时。
 * @returns {{ ok: false, message: string } | { ok: true, lost: number, text: string }}
 */
export function creeperBlast(/** @type {Game} */ game, /** @type {Player} */ player, /** @type {number} */ now) {
  const seconds = creeperSeconds(game.rules);
  if (seconds <= 0) return { ok: false, message: "这一局没有苦力怕" };
  const blocked = digBlocked(game, player, now, { cooling: false });
  if (blocked) return { ok: false, message: blocked };
  if (player.points <= 0) return { ok: false, message: "手上没有分，苦力怕不会来" };
  if (now - (player.activeAt ?? now) < seconds * 1000 + CREEPER_FUSE_MS - CREEPER_SLACK_MS)
    return { ok: false, message: "苦力怕还没到时候" };
  const lost = creeperLoss(game.rules, player.points);
  player.points -= lost;
  game.used -= lost;
  player.activeAt = now;
  if (lost > 0) player.trail?.push({ k: "creeper", a: -lost, p: totalOf(player) });
  return { ok: true, lost, text: `苦力怕爆炸了！待领取的奖励 -${formatPoints(lost, game.rules.step)}（${CREEPER_PERCENT}%）` };
}

/** 苦力怕炸一次扣多少：20% 向下取整；第 2 版的局至少 0.01（以前 0.04 以下扣 0，永远扣不完）。 */
function creeperLoss(/** @type {Rules} */ rules, /** @type {number} */ points) {
  const lost = percentOf(points, CREEPER_PERCENT);
  return (rules.items ?? 0) >= 2 && points > 0 ? Math.max(1, lost) : lost;
}

/** 不领的人没动多久起被炸：5 分钟，苦力怕参数更长时等网页上的苦力怕先来过（参数加 10 秒）。 */
export const idleDelayOf = (/** @type {Rules} */ rules) => Math.max(IDLE_MS, creeperSeconds(rules) * 1000 + CREEPER_FUSE_MS);

/** 不领的人从什么时候起被炸。 */
const idleFrom = (/** @type {Game} */ game, /** @type {Player} */ player) => (player.activeAt ?? 0) + idleDelayOf(game.rules);

/** 这个人会不会被当成不领的人炸（第 2 版的局、开着苦力怕、手上有分、还能挖）。 */
function drainable(/** @type {Game} */ game, /** @type {Player} */ player, /** @type {number} */ now) {
  return (game.rules.items ?? 0) >= 2 && creeperSeconds(game.rules) > 0 && player.status === "playing"
    && player.points > 0 && !digBlocked(game, player, now, { cooling: false });
}

/**
 * 不领的人（§9）：5 分钟没挖、没用道具起，每 60 秒苦力怕炸一次（20%，至少 0.01），把到 now 为止该炸的
 * 几次一起算掉（谁来算都一样：本人回来时、游戏站的闹钟）；扣掉的回到预算，逐格记录里记一步。返回这次
 * 扣掉的分（0 是没到时候或不适用）。drained 记着从哪次动作（activeAt）起已经炸过几次，动一下就重来。
 */
export function drainIdle(/** @type {Game} */ game, /** @type {Player} */ player, /** @type {number} */ now) {
  if (!drainable(game, player, now)) return 0;
  const from = idleFrom(game, player);
  if (now < from) return 0;
  const done = player.drained?.from === player.activeAt ? player.drained.times : 0;
  const due = Math.floor((now - from) / IDLE_EVERY_MS) + 1;
  let lost = 0;
  for (let time = done; time < due && player.points > 0; time++) {
    const each = creeperLoss(game.rules, player.points);
    player.points -= each;
    lost += each;
  }
  player.drained = { from: player.activeAt ?? 0, times: due };
  if (lost > 0) {
    game.used -= lost;
    player.trail?.push({ k: "creeper", a: -lost, p: totalOf(player) });
  }
  return lost;
}

/** 下一次该炸这个人的时刻（游戏站定闹钟用）；不适用时 null。 */
export function idleNextAt(/** @type {Game} */ game, /** @type {Player} */ player, /** @type {number} */ now) {
  if (!drainable(game, player, now)) return null;
  const from = idleFrom(game, player);
  const done = player.drained?.from === player.activeAt ? player.drained.times : 0;
  return from + done * IDLE_EVERY_MS;
}

/** 末影水晶扣还没领的奖励的百分之几：TNT 的两倍，最多 100。 */
export const crystalPercent = (/** @type {Rules} */ rules) => Math.min(100, rules.tntPercent * 2);

/** 领得最多的前几名：加上刚领的这个人（手上加末影箱），分一样时先领的在前。 */
export function topWith(/** @type {TopEntry[]} */ top, /** @type {Player|TopEntry} */ player) {
  const points = "status" in player ? totalOf(player) : player.points;
  if (points <= 0) return top;
  const next = [...top.filter((entry) => entry.uid !== player.uid), { uid: player.uid, name: player.name, points }];
  // sort 是稳定的：分一样时保持原来的先后（先领的在前）
  return next.sort((a, b) => b.points - a.points).slice(0, TOP_LIMIT);
}

/** 收益卡（网页的“收益”和结束时的弹窗）：自己的逐格记录和数，加上全场前几名。points 是手上加末影箱。 */
export function summaryOf(/** @type {Game} */ game, /** @type {Player} */ player) {
  const trail = player.trail ?? null;
  const steps = trail ?? [];
  return {
    me: {
      name: player.name, status: player.status, points: totalOf(player), digs: player.digs,
      ...(player.chest !== undefined ? { chest: player.chest } : {}),
      trail,
      best: steps.reduce((most, step) => Math.max(most, step.a), 0),
      tnt: steps.filter((step) => (step.k === "tnt" || step.k === "crystal") && !step.b).length,
      blocked: steps.filter((step) => step.b).length,
      lost: steps.reduce((sum, step) => sum + (step.a < 0 ? -step.a : 0), 0),
    },
    top: game.top ?? [],
    stats: game.stats,
    pool: game.pool,
    left: budgetLeft(game),
    over: game.over,
  };
}

/** A1、C5：行是字母，列是数字。 */
export function cellName(/** @type {Card} */ card, /** @type {number} */ index) {
  return `${"ABCDEFG"[Math.floor(index / card.size)]}${index % card.size + 1}`;
}

/**
 * 一张卡给大家看的样子：挖开的格子、剩下各种道具的数量；没挖开的牌不出去。新局的卡另有固定的格子
 * （fixed）、宝库还能开几次（vaults）、亮着的火把（torches）、深暗之域的噪音和关没关（noise、closed）；
 * 被岩浆吞掉的格子带 burn: 1。
 */
export function publicCard(/** @type {Card} */ card) {
  /** @type {Partial<Record<Kind, number>>} */
  const left = { ...card.composition };
  const cells = card.opened.map((open, index) => {
    if (open === null) return null;
    const kind = card.deck[index];
    left[kind] = (left[kind] ?? 0) - 1;
    return { kind, uid: open.uid, name: open.name, at: open.at, ...(open.burn ? { burn: open.burn } : {}) };
  });
  return {
    id: card.id, x: card.x, y: card.y, size: card.size, ...(card.kind ? { kind: card.kind } : {}), cells, left, finished: card.finished,
    // 复制一份：攒着没发的推送不能跟着之后的改动变
    ...(card.fixed ? { fixed: { ...card.fixed } } : {}),
    ...(card.vaults ? { vaults: { ...card.vaults } } : {}),
    ...(card.rails ? { rails: { ...card.rails } } : {}),
    ...(card.torches ? { torches: publicTorches(card) } : {}),
    ...publicNoise(card),
    ...(card.fromEye ? { fromEye: true } : {}),
  };
}

/**
 * 深暗之域的卡给大家看的噪音：noise 和 closed；第 2 版的噪音会退，noise 是 noiseAt 那一刻的，
 * 网页按 noiseDecayMs 接着往下退；wokeBy 是谁吵醒了监守者、被抢走多少。别的卡什么也没有。
 * @returns {{ noise?: number, noiseAt?: number, closed?: boolean, wokeBy?: { uid: number, name: string, amount: number, at: number } }}
 */
export function publicNoise(/** @type {Card} */ card) {
  if (card.kind !== "deep") return {};
  return {
    noise: card.noiseAt === undefined ? dugOf(card) : Math.round((card.noise ?? 0) * 1000) / 1000,
    closed: Boolean(card.closed),
    ...(card.noiseAt !== undefined ? { noiseAt: card.noiseAt } : {}),
    ...(card.wokeBy ? { wokeBy: { ...card.wokeBy } } : {}),
  };
}

/** 整局给大家看的样子。 */
export function publicGame(/** @type {Game} */ game) {
  return {
    seq: game.seq,
    rules: game.rules,
    pool: game.pool,
    left: budgetLeft(game),
    deadlineAt: game.deadlineAt,
    wrapUpAt: game.deadlineAt === null ? null : game.deadlineAt - WRAP_UP_MS,
    over: game.over,
    stats: game.stats,
    cards: Object.values(game.cards).map(publicCard),
    feed: game.feed,
  };
}

/**
 * 只给本人看的；带上 game 和 now 时多一项 coolingMs：还要等多少毫秒（网页拿它倒计时，不受两边时钟差影响）。
 * 有道具栏的局另有道具和各种状态（docs/V3_ITEMS.md §4）。
 */
export function privatePlayer(/** @type {Player} */ player, /** @type {Game|null} */ game = null, now = 0) {
  const coolingMs = game ? coolingOf(game, player, now) : 0;
  return {
    chances: player.chances, shield: player.shield, peeks: player.peeks,
    ...(player.shields !== undefined ? { shields: player.shields, spyglasses: player.spyglasses ?? 0 } : {}),
    points: player.points, digs: player.digs, status: player.status, lastResult: player.lastResult,
    ...(game ? { coolingMs } : {}),
    ...(player.shields !== undefined ? itemsView(player, game, now, coolingMs) : {}),
  };
}

/** 道具栏那一部分（只有新局的人有）。 */
function itemsView(/** @type {Player} */ player, /** @type {Game|null} */ game, /** @type {number} */ now, /** @type {number} */ coolingMs) {
  const bag = player.items ?? emptyBag();
  return {
    items: { torch: bag.torch, map: bag.map, potion: bag.potion, ender: bag.ender, table: bag.table, key: bag.key, pick: { ...bag.pick } },
    coal: player.coal ?? 0,
    stick: player.stick ?? 0,
    poison: player.poison ?? 0,
    chest: player.chest ?? 0,
    hasteMs: game ? Math.max(0, (player.hasteUntil ?? 0) - now) : 0,
    // 现在的等待里蜘蛛网占的那一段（和 coolingMs 一起走到 0）
    slowMs: Math.min(player.slow ?? 0, coolingMs),
    tableChoices: game && bag.table > 0 ? tableChoicesOf(game, player) : null,
    creeperMs: game ? creeperMsOf(game, player, now) : null,
    vaultsOpened: [...(player.vaultsOpened ?? [])],
  };
}
