export const kinds = ['emerald', 'diamond', 'apple', 'totem', 'tnt', 'pearl', 'shield', 'spyglass'] as const
export type Kind = typeof kinds[number]
export type IconKind = Kind | 'pickaxe' | 'ore' | 'chest' | 'eye' | 'crystal'
  // v3 有道具栏的局（docs/V3_ITEMS.md）
  | 'coal' | 'stick' | 'map' | 'potion' | 'key' | 'vault' | 'deco' | 'lava' | 'debris' | 'cobweb' | 'spawner' | 'minecart' | 'ender'
  | 'torch' | 'torch-green' | 'torch-red' | 'table' | 'sculk'
export type BoardSize = 5 | 6 | 7
export type Difficulty = 'easy' | 'hard' | 'hell'
export type Composition = Record<Kind, number>

export const loot: Record<Kind, { name: string; short: string; color: string; count: number; description: string }> = {
  emerald: { name: '绿宝石', short: '小奖励', color: '#8ad6a2', count: 10, description: '获得一份小奖励' },
  diamond: { name: '钻石', short: '大奖励', color: '#8cd9e5', count: 3, description: '获得小奖励的 5 倍' },
  apple: { name: '附魔金苹果', short: '奖励翻倍', color: '#edc96d', count: 1, description: '当前待结算翻倍；余额为零时给小奖励' },
  totem: { name: '双铁镐', short: '机会 +3', color: '#b7d477', count: 2, description: '额外增加 3 次挖掘机会，无累计限制' },
  tnt: { name: 'TNT', short: '比例扣除', color: '#ee9d88', count: 4, description: '扣除当前待结算奖励的一定比例' },
  pearl: { name: '末影珍珠', short: '全体换卡', color: '#b0a3dd', count: 2, description: '所有人一起进入下一张卡片' },
  shield: { name: '盾牌', short: '抵挡 TNT', color: '#d5b89a', count: 2, description: '自动抵挡一次 TNT；已有盾牌则给小奖励' },
  spyglass: { name: '望远镜', short: '私密情报', color: '#d5bc84', count: 1, description: '只有你能提前看见一个未开格子的内容' },
}

export interface Rules {
  initialChances: number
  waitSeconds: number
  smallReward: number
  bigMultiplier: number
  totemBonus: number
  tntPercent: number
  version?: 2
  difficulty?: Difficulty
  boardSpec?: '5' | '6' | '7' | 'random'
  compositionVariation?: 'fixed' | 'slight'
  /** The most one golden apple adds, in 分; absent for no cap. */
  appleCap?: number
}

export interface Cell { index: number; kind: Kind | null; by: string | null; at: number | null; actorKey?: string }
export interface FeedItem { id: number; actor: string; actorKey?: string; kind: Kind; text: string; at: number; cardId: number; index: number; size?: BoardSize }
export interface PublicGame {
  version: 1 | 2
  size?: BoardSize
  composition?: Composition
  cardId: number
  cells: Cell[]
  counts: Record<Kind, number>
  rules: Rules
  lastMove: { actorKey: string; name: string; at: number; cardId: number; index: number; size?: BoardSize } | null
  stats: { digs: number; players: number }
  feed: FeedItem[]
}
export interface LastResult { kind: Kind; cardId: number; index: number; size?: BoardSize; amount: number; blocked: boolean; text: string }
export interface PrivateGame {
  version: 1 | 2
  actorKey: string
  chances: number
  shield: boolean
  peeks: { cardId: number; index: number; kind: Kind }[]
  digs: number
  status: 'playing' | 'settled'
  lastResult: LastResult | null
}

export const defaultRules: Rules = { initialChances: 7, waitSeconds: 10, smallReward: 10, bigMultiplier: 5, totemBonus: 3, tntPercent: 25 }
export const difficultyPresets = {
  easy: { label: '简单', initialChances: 9, tntPercent: 15, compositionVariation: 'fixed' },
  hard: { label: '困难', initialChances: 7, tntPercent: 25, compositionVariation: 'slight' },
  hell: { label: '地狱', initialChances: 4, tntPercent: 75, compositionVariation: 'slight' },
} as const
export const formatMoney = (cents: number) => (cents / 100).toFixed(2)
export const boardSize = (game: Pick<PublicGame, 'size'>): BoardSize => game.size ?? 5
export const coordinate = (index: number, size: BoardSize = 5) => `${String.fromCharCode(65 + Math.floor(index / size))}${index % size + 1}`
export function customizedRules(rules: Rules) {
  const preset = rules.difficulty ? difficultyPresets[rules.difficulty] : null
  return Boolean(preset && (rules.initialChances !== preset.initialChances || rules.tntPercent !== preset.tntPercent || rules.compositionVariation !== preset.compositionVariation))
}
export function rulesLabel(rules: Rules) {
  return rules.difficulty ? `${difficultyPresets[rules.difficulty].label}${customizedRules(rules) ? ' · 已自定义' : ''}` : '经典规则'
}
export const cardComposition = (game: PublicGame): Composition => game.composition ?? Object.fromEntries(kinds.map(kind => [kind, loot[kind].count])) as Composition
export function isOwnCell(cell: Cell, cardId: number, own: PrivateGame | null): boolean {
  if (!own || cell.kind === null) return false
  if (cell.actorKey !== undefined) return cell.actorKey === own.actorKey
  // Older judges only persist a display name per cell. The private lastResult
  // still proves this one dig; matching names alone cannot prove ownership.
  const result = own.lastResult
  return Boolean(result && result.cardId === cardId && result.index === cell.index && result.kind === cell.kind)
}
export const isKind = (value: unknown): value is Kind => typeof value === 'string' && kinds.includes(value as Kind)
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const integer = (value: unknown, min = 0) => Number.isSafeInteger(value) && (value as number) >= min
const sizeValue = (value: unknown): value is BoardSize => value === 5 || value === 6 || value === 7
const compositionValue = (value: unknown): value is Composition => object(value) && kinds.every(kind => integer(value[kind]))
const positioned = (value: Record<string, unknown>, version: 1 | 2) => integer(value.cardId, 1) && (version === 1 ? value.size === undefined || value.size === 5 : sizeValue(value.size)) && integer(value.index) && (value.index as number) < (value.size === undefined ? 25 : (value.size as number) ** 2)
function rulesValue(value: unknown, version: 1 | 2): value is Rules {
  if (!object(value) || !Object.keys(defaultRules).every(key => integer(value[key], 1))) return false
  if ((value.initialChances as number) > 20 || (value.waitSeconds as number) > 60 || (value.tntPercent as number) > 100) return false
  if (value.appleCap !== undefined && !integer(value.appleCap, 1)) return false
  return version === 1 || value.version === 2 && (value.difficulty === 'easy' || value.difficulty === 'hard' || value.difficulty === 'hell') && ['5', '6', '7', 'random'].includes(value.boardSpec as string) && (value.compositionVariation === 'fixed' || value.compositionVariation === 'slight')
}

// The SDK payload is external data. Reject incompatible pages instead of inventing a board.
export function readPublic(value: unknown): PublicGame | null {
  if (!object(value) || value.version !== 1 && value.version !== 2 || !integer(value.cardId, 1)) return null
  const version = value.version
  if (version === 1 && value.size !== undefined && value.size !== 5) return null
  const size = version === 1 ? 5 : value.size
  if (!sizeValue(size) || !Array.isArray(value.cells) || value.cells.length !== size ** 2) return null
  if (!value.cells.every((cell, index) => object(cell) && cell.index === index && (cell.kind === null || isKind(cell.kind)) && (cell.by === null || typeof cell.by === 'string') && (cell.at === null || integer(cell.at)) && (cell.actorKey === undefined || typeof cell.actorKey === 'string') && (cell.kind !== null || cell.actorKey === undefined && cell.by === null && cell.at === null))) return null
  if (!compositionValue(value.counts) || !rulesValue(value.rules, version)) return null
  if (version === 2) {
    const composition = value.composition
    if (!compositionValue(composition) || kinds.reduce((sum, kind) => sum + composition[kind], 0) !== size ** 2) return null
    const cells = value.cells as Cell[]
    if (!kinds.every(kind => (value.counts as Composition)[kind] === composition[kind] - cells.filter(cell => cell.kind === kind).length)) return null
  }
  if (!object(value.stats) || !integer(value.stats.digs) || !integer(value.stats.players) || !Array.isArray(value.feed)) return null
  if (!value.feed.every(entry => object(entry) && integer(entry.id) && positioned(entry, version) && typeof entry.actor === 'string' && (entry.actorKey === undefined || typeof entry.actorKey === 'string') && isKind(entry.kind) && typeof entry.text === 'string' && integer(entry.at))) return null
  if (value.lastMove !== undefined && value.lastMove !== null && (!object(value.lastMove) || !positioned(value.lastMove, version) || typeof value.lastMove.actorKey !== 'string' || typeof value.lastMove.name !== 'string' || !integer(value.lastMove.at))) return null
  return value as unknown as PublicGame
}

export function readPrivate(value: unknown): PrivateGame | null {
  if (!object(value) || value.version !== 1 && value.version !== 2 || typeof value.actorKey !== 'string' || !integer(value.chances) || typeof value.shield !== 'boolean' || !Array.isArray(value.peeks) || !integer(value.digs)) return null
  if (value.status !== 'playing' && value.status !== 'settled') return null
  if (!value.peeks.every(peek => object(peek) && integer(peek.cardId, 1) && integer(peek.index) && (peek.index as number) < (value.version === 1 ? 25 : 49) && isKind(peek.kind))) return null
  const result = value.lastResult
  if (result !== null && (!object(result) || !positioned(result, value.version) || !isKind(result.kind) || !Number.isSafeInteger(result.amount) || typeof result.blocked !== 'boolean' || typeof result.text !== 'string')) return null
  return value as unknown as PrivateGame
}
