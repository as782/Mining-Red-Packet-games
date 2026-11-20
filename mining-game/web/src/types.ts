// 游戏站给网页的数据（game/shared/rules.mjs 的 publicGame、privatePlayer）。
export type Kind = 'emerald' | 'diamond' | 'apple' | 'totem' | 'tnt' | 'pearl' | 'shield' | 'spyglass' | 'eye' | 'crystal'
  // 有道具栏的局（docs/V3_ITEMS.md §1）
  | 'coal' | 'stick' | 'map' | 'potion' | 'key' | 'vault' | 'deco' | 'lava' | 'debris' | 'cobweb' | 'spawner' | 'minecart' | 'ender'
/** 底栏“还剩”列的顺序（卡上没有的不列） */
export const KINDS: Kind[] = ['emerald', 'diamond', 'apple', 'debris', 'totem', 'tnt', 'crystal', 'spawner', 'cobweb', 'pearl', 'shield', 'spyglass', 'map', 'potion', 'key', 'minecart', 'ender', 'coal', 'stick', 'eye']
export const KIND_NAMES: Record<Kind, string> = {
  emerald: '绿宝石', diamond: '钻石', apple: '附魔金苹果', totem: '双铁镐',
  tnt: 'TNT', pearl: '末影珍珠', shield: '盾牌', spyglass: '望远镜', eye: '末影之眼', crystal: '末影水晶',
  coal: '煤炭', stick: '木棍', map: '藏宝图', potion: '急迫药水', key: '试炼钥匙', vault: '宝库', deco: '装饰',
  lava: '岩浆', debris: '远古残骸', cobweb: '蜘蛛网', spawner: '刷怪笼', minecart: '箱子矿车', ender: '末影箱',
}
/** 区块（docs/V3_ITEMS.md §2）：末地宝藏、试炼密室、废弃矿井、下界、深暗之域；普通卡没有 */
export type Biome = 'end' | 'trial' | 'mine' | 'nether' | 'deep'
export const BIOME_NAMES: Record<Biome, string> = { end: '末地宝藏', trial: '试炼密室', mine: '废弃矿井', nether: '下界', deep: '深暗之域' }
/**
 * 火把。第 1 版的局（rules.items 1）：插在 at 那一格的左上角（四格相交处），level 0 绿（4 格里没有危险）、
 * 1 黄（1–2 个）、2 红（3–4 个），按没挖开的算。第 2 版（2）：插在 at 那一格（挖开的）上，照 3×3，level
 * 0 绿、1 黄（1–2 个）、2 橙（3–4 个）、3 红（5 个以上），挖开的也算，插下就定了；游戏站给的带 v: 2。
 */
export interface Torch { at: number; level: 0 | 1 | 2 | 3; name: string; v?: 2 }
/** 附魔镐的形状 */
export type Shape = 'h' | 'v' | 'x'

/** 谁吵醒了深暗之域的监守者、被抢走多少（at：什么时候，新的游戏站才有） */
export interface WokeBy { uid: number; name: string; amount: number; at?: number }
/** burn：被岩浆吞掉的格子（uid 0），翻开给大家看一下，之后就是岩浆 */
export interface OpenCell { kind: Kind; uid: number; name: string; at: number; burn?: 1 }
export interface PublicCard {
  id: number; x: number; y: number; size: 3 | 5 | 6 | 7
  /** 区块；普通卡没有 */
  kind?: Biome
  /** 不能挖的格子（装饰、宝库、开局的岩浆），大家都看得见 */
  fixed?: Record<string, 'deco' | 'vault' | 'lava'>
  /** 宝库还能开几次 */
  vaults?: Record<string, number>
  /** 废弃矿井的铁轨每一格的形状（新局，game/shared/layouts.mjs）；以前开的局没有，是横着的一排 */
  rails?: Record<string, RailShape>
  /** 亮着的火把 */
  torches?: Torch[]
  /**
   * 深暗之域的噪音；closed：监守者醒了，这张卡关了。2026-11-12 起开的局（rules.special: 2）噪音会退：
   * noise 是 noiseAt 那一刻的，之后按 noiseDecayMs 往下退（regions.ts noiseOf）；wokeBy 是谁吵醒了监守者、被抢走多少
   */
  noise?: number
  noiseAt?: number
  closed?: boolean
  wokeBy?: WokeBy
  /** 末影之眼开出来的特殊区块（rules.special: 2 的局；末地宝藏、深暗之域、下界） */
  fromEye?: true
  cells: (OpenCell | null)[]
  /** 旧局的卡没有 eye 这一项 */
  left: Partial<Record<Kind, number>>
  finished: boolean
}
export interface FeedItem {
  seq: number; uid: number; name: string; kind: Kind; cardId: number; index: number
  text: string; at: number; newCardId: number | null
}
export interface Stats { digs: number; players: number; claimed: number; claimedPoints: number }
export interface Rules {
  difficulty: 'easy' | 'normal' | 'tough' | 'hard' | 'hell'; smallReward: number; tntPercent: number
  initialChances: number; appleCap: number; totemBonus: number; bigMultiplier: number
  /** 每几张普通卡一颗末影之眼；0 不开；旧局没有 */
  eyeEvery?: number
  /** 按大约多少人算的绿宝石（新判定器）；旧局没有 */
  players?: number
  /** 每人两次挖掘至少隔几秒；旧局没有，是 1 */
  digInterval?: number
  /** 2：末地宝藏每张随机配（2026-11-07 起开的局）；旧局没有 */
  endMix?: 2
  /** 1：道具栏、新格子和区块（docs/V3_ITEMS.md）；2：第 2 版道具规则（§9）；旧局没有 */
  items?: 1 | 2
  /** 多少秒不挖苦力怕会来；0 不来 */
  creeper?: number
  /** 2：区块里固定格子的新摆法（docs/V3_ITEMS.md §10）；旧局没有 */
  layout?: 2
  /** 2：特殊区块都从末影之眼开、深暗之域的噪音会退（docs/V3_ITEMS.md §16、§17）；旧局没有 */
  special?: 2
  /** 一块煤炭、一根木棍做成几个火把：2026-11-13 起开的局是 4（照原版，docs/V3_ITEMS.md §18）；旧局没有，是 1 */
  craftTorches?: 4
  /** 1：挖到末影珍珠、末影之眼另得道具，箱子矿车能开出附魔台（2026-11-13 起开的局，docs/V3_ITEMS.md §19）；旧局没有 */
  loot?: 1
  /** 三方积分红包的最小单位（"1"、"0.5"、"100"…），所有的数都是多少个最小单位；LDC 和🐟红包没有（就是 0.01） */
  step?: string
}
export interface PublicGame {
  seq: number; rules: Rules; pool: number; left: number
  deadlineAt: number | null; wrapUpAt: number | null; over: boolean
  stats: Stats; cards: PublicCard[]; feed: FeedItem[]
}
export interface Peek { cardId: number; index: number; kind: Kind }
export interface DigResult {
  kind: Kind; cardId: number; index: number; amount: number
  blocked: boolean; text: string; newCardId: number | null
  /** 挖到末影珍珠、末影之眼、箱子矿车另得的一样道具（rules.loot 的局，docs/V3_ITEMS.md §19） */
  loot?: Loot
}
export type Loot = 'spyglass' | 'map' | 'key' | 'table' | 'ender' | 'potion' | 'torch'
export interface Me {
  chances: number; shield: boolean; peeks: Peek[]; points: number; digs: number
  /** 有道具栏的局：几面盾牌、几个望远镜；旧局没有（盾牌只看 shield） */
  shields?: number; spyglasses?: number
  status: 'playing' | 'claimed'; lastResult: DigResult | null
  /** 还要等多少毫秒才能再挖（游戏站算好的，不受时钟差影响） */
  coolingMs?: number
  /** 有道具栏的局（docs/V3_ITEMS.md §4）：主动道具 */
  items?: { torch: number; map: number; potion: number; ender: number; table: number; key: number; pick: Record<Shape, number> }
  coal?: number; stick?: number; poison?: number
  /** 末影箱里存着的分（领取时一起算） */
  chest?: number
  /** 急迫药水还剩多少毫秒；蜘蛛网让下一次多等多少毫秒 */
  hasteMs?: number; slowMs?: number
  /** 手里有附魔台时，下一个附魔台给的两种 */
  tableChoices?: Shape[] | null
  /** 还有多少毫秒苦力怕来（不适用时 null） */
  creeperMs?: number | null
  /** 开过的宝库："卡号:格" */
  vaultsOpened?: string[]
}
/** drained：不在的时候苦力怕炸掉的（回来时游戏站先算掉） */
export interface State { game: PublicGame; me: Me; blocked: string | null; drained?: number }

/** 逐格记录：挖到什么（k）、这一格加减多少分（a）、挖完手里多少分（p）、盾牌挡住了（b）。 */
export interface Step { k: Kind | 'poison' | 'creeper' | 'warden' | 'ender' | 'vault'; a: number; p: number; b?: 1 }
export interface TopEntry { uid: number; name: string; points: number }
/** 收益卡（game/shared/rules.mjs 的 summaryOf）。 */
export interface Summary {
  me: {
    name: string; status: 'playing' | 'claimed'; points: number; digs: number
    /** 开始记录以前就来过的人没有 */
    trail: Step[] | null
    best: number; tnt: number; blocked: number; lost: number
  }
  top: TopEntry[]
  stats: Stats; pool: number; left: number; over: boolean
}

/**
 * 实时推送（game/worker/room.mjs）：网页连推送时带 v=2，收第 2 版的 cell（只有变了的那一格）；
 * 第 1 版的 dig（整张卡）只有老的游戏站发，留着认。
 */
export interface LiveCell {
  type: 'cell'; seq: number; cardId: number; index: number; cell: OpenCell
  newCard: PublicCard | null; text: string; left: number; over: boolean; stats: Stats
  /** 有道具栏的局：这张卡的火把（变了颜色、灭了）、被岩浆吞掉的格子、噪音、监守者醒了 */
  torches?: Torch[]; burned?: { index: number; kind: Kind }[]; noise?: number; noiseAt?: number; closed?: boolean; wokeBy?: WokeBy
  vaults?: Record<string, number>
}
/** 火把插上、宝库开了：整张卡换一下（不带序号） */
export interface LiveCard { type: 'card'; card: PublicCard; left?: number; over?: boolean }
export interface LiveDig { type: 'dig'; seq: number; card: PublicCard; newCard: PublicCard | null; feed: FeedItem; left: number; over: boolean; stats: Stats }
export type LiveStep = LiveCell | LiveDig
/** 不领的人被苦力怕炸了（docs/V3_ITEMS.md §9）：奖池变了；uids 是被炸的人 */
export interface LiveDrain { type: 'drain'; uids: number[]; left: number; over: boolean }
export type Live = LiveStep | LiveCard | LiveDrain | { type: 'claim'; name: string; points: number; stats: Stats }

/**
 * 写给人看的数（docs/V3_ITEMS.md §11）：数是多少个最小单位，小数位跟着最小单位，同红包站的 tools.money.format：
 * LDC 和🐟 10000 → "100.00"；最小单位 "1" 时 2000 → "2000"，"0.5" 时 3 → "1.5"，"100" 时 3 → "300"。
 */
export function formatUnits(points: number, step = '0.01') {
  const minor = Math.abs(points) * stepMinor(step)
  const digits = decimalsOf(step)
  const text = `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`
  return (points < 0 ? '-' : '') + (digits === 2 ? text : text.slice(0, text.length - (2 - digits) - (digits === 0 ? 1 : 0)))
}
/** 一个最小单位是多少分（"0.01" → 1，"1" → 100，"0.5" → 50） */
export function stepMinor(step = '0.01') {
  const [whole, fraction = ''] = step.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0')) || 1
}
/** 写几位小数：整数的积分不写，0.5 写一位，LDC 两位 */
export function decimalsOf(step = '0.01') {
  const minor = stepMinor(step)
  return minor % 100 === 0 ? 0 : minor % 10 === 0 ? 1 : 2
}

/** 这个红包的最小单位：开局时按游戏站的规则（rules.step）或红包站给的 hongbao.step 定，money() 都按它写 */
let moneyStep = '0.01'
export function setMoneyStep(step: string | null | undefined) {
  moneyStep = step || '0.01'
}
export const currentStep = () => moneyStep

/** 红包站给的金额字符串（"12.34"、积分 "66"）换回多少个最小单位（同 money() 的单位）。 */
export function unitsOf(text: string) {
  return Math.round((Number(text) * 100) / stepMinor(moneyStep))
}

/** 待领取这些数写给人看：按这个红包的最小单位（LDC 10000 → "100.00"）。 */
export function money(points: number) {
  return formatUnits(points, moneyStep)
}

/** 铁轨一格连着哪两边（原版 rail 的叫法）：ns、ew 直道，ne、se、sw、nw 弯道。 */
export type RailShape = 'ns' | 'ew' | 'ne' | 'se' | 'sw' | 'nw'
