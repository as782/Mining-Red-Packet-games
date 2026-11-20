// 道具（docs/V3_ITEMS.md §3）：工具条上每一格是什么、怎么用，和对格子用的道具点到哪几格。
// 纯数据和纯函数，网页和测试共用。
import type { IconKind } from '../../src/game'
import type { Me, PublicCard, Shape } from './types'

/** 工具条上的一格。镐子固定在最前面；被动的排在一道线后面。 */
export type Slot =
  | 'pickaxe' | 'pick-h' | 'pick-v' | 'pick-x' | 'spyglass' | 'torch' | 'key' | 'map' | 'potion' | 'ender' | 'table'
  | 'shield' | 'coal' | 'stick' | 'poison'

/**
 * 怎么用：cell 点一格、box 放一个形状、corner 插在四格相交处、vault 点宝库（这四种拿在手上，
 * 先预览再用）；confirm 在提示框里确认；dialog 打开弹窗；passive 自动生效，点开只看说明。
 */
export type Use = 'base' | 'cell' | 'box' | 'corner' | 'vault' | 'confirm' | 'dialog' | 'passive'

/** 拿在手上的道具（对格子用的那几种） */
export type Held = 'pick-h' | 'pick-v' | 'pick-x' | 'spyglass' | 'torch' | 'key'

export const SLOT_USE: Record<Slot, Use> = {
  pickaxe: 'base', 'pick-h': 'box', 'pick-v': 'box', 'pick-x': 'box', spyglass: 'cell', torch: 'corner', key: 'vault',
  map: 'confirm', potion: 'confirm', ender: 'dialog', table: 'dialog', shield: 'passive', coal: 'passive', stick: 'passive', poison: 'passive',
}

export const SLOT_NAMES: Record<Slot, string> = {
  pickaxe: '镐子', 'pick-h': '附魔镐 · 横三格', 'pick-v': '附魔镐 · 竖三格', 'pick-x': '附魔镐 · 十字', spyglass: '望远镜', torch: '火把',
  key: '试炼钥匙', map: '藏宝图', potion: '急迫药水', ender: '末影箱', table: '附魔台', shield: '盾牌', coal: '煤炭', stick: '木棍', poison: '中毒',
}

export const isHeld = (slot: Slot): slot is Held => ['box', 'cell', 'corner', 'vault'].includes(SLOT_USE[slot])

/** 每一格画什么图标（附魔镐是镐子加形状小图） */
export const SLOT_ICONS: Record<Slot, IconKind> = {
  pickaxe: 'pickaxe', 'pick-h': 'pickaxe', 'pick-v': 'pickaxe', 'pick-x': 'pickaxe', spyglass: 'spyglass', torch: 'torch', key: 'key',
  map: 'map', potion: 'potion', ender: 'ender', table: 'table', shield: 'shield', coal: 'coal', stick: 'stick', poison: 'spawner',
}

/**
 * 道具分五类（docs/ITEM_UX.md §2），类决定点了以后走哪个流程：瞄准（引导 → 选位置）、即用（确认弹窗）、
 * 抉择（专属弹窗）、被动（说明弹窗）、基础（镐子）。
 */
export type ItemClass = 'aim' | 'instant' | 'choice' | 'passive' | 'base'
export function classOf(slot: Slot): ItemClass {
  const use = SLOT_USE[slot]
  return use === 'base' ? 'base' : use === 'confirm' ? 'instant' : use === 'dialog' ? 'choice' : use === 'passive' ? 'passive' : 'aim'
}

/**
 * 道具登记表（docs/ITEM_UX.md §5、§6）：弹窗右上角的数量、一句它会怎样（words），玩家拿不准又影响决定的事
 * 放在下面一行小字（rule，最多一句）。看得见的数（镐子还能挖几次、还有几个、几面盾）和它们怎么变不用字说；
 * 弹窗里有图的、用了看得到的也不说。新道具在这里加一行，工具条、弹窗、步骤条都照着它画。
 */
export function aboutSlot(slot: Slot, me: Me, items: boolean, interval: number, blocked: string | null, version = items ? 1 : 0, made = 1): { count: string; words: string; rule?: string } {
  const count = countOf(me, slot)
  const v2 = version >= 2
  const torches = madeWords(made)
  switch (slot) {
    case 'pickaxe': return { count: `还剩 ${me.chances} 次`, words: blocked ?? '点没挖开的格子就能挖。', rule: !blocked && interval > 1 ? `两次之间至少隔 ${interval} 秒。` : undefined }
    case 'pick-h': case 'pick-v': case 'pick-x': return { count: `还能用 ${count} 次`, words: `一下挖开${SHAPE_WORDS[shapeOf(slot)!]}。` }
    case 'spyglass': return { count: `还有 ${count} 个`, words: '看一格下面是什么，只有你看得见。' }
    case 'torch': return v2
      ? { count: count > 0 ? `还有 ${count} 个` : '还没有', words: `${count > 0 ? '' : `还没有火把。煤炭和木棍各挖到一个，会自动做成${made === 1 ? '一个' : ` ${made} 个`}。`}插在挖开的格子上，照亮周围 9 格，大家都看得见。`,
        rule: '颜色表示这 9 格里有几个 TNT、末影水晶和刷怪笼，挖开的也算。' }
      : { count: count > 0 ? `还有 ${count} 个` : '还没有', words: `${count > 0 ? '' : `还没有火把。煤炭和木棍各攒满 ${CRAFT_NEED} 个，会自动做成一个。`}插在四个格子相交的角上，照亮旁边 4 格，大家都看得见。`,
        rule: '绿色是这 4 格里没有 TNT、末影水晶和刷怪笼，黄色有 1～2 个，红色有 3～4 个。' }
    case 'key': return { count: `还有 ${count} 把`, words: '打开试炼密室里的一个宝库，开出一样东西。', rule: '每个宝库你只能开一次。' }
    case 'map': return { count: `还有 ${count} 张`, words: '标出地图上一格奖励，只有你看得见。', rule: '多半是绿宝石，偶尔是钻石。' }
    case 'potion': return { count: `还有 ${count} 瓶`, words: '用了以后 10 秒里，每次挖只要隔 1 秒。' }
    case 'ender': return { count: `还有 ${count} 个`, words: '把待领取的一半存进去，不会被炸掉；另一半退回奖池。' }
    case 'table': return { count: `还有 ${count} 个`, words: '两把附魔镐挑一把。' }
    case 'shield': return { count: `${count}/${items ? SHIELD_CAP : 1} 面`, words: '挖到 TNT 或末影水晶时，自动挡下一次。', rule: '带满以后再挖到，换成一份小奖。' }
    case 'coal': case 'stick': return v2
      ? { count: `${count} 个`, words: `再挖到${slot === 'coal' ? '一根木棍' : '一块煤炭'}，就自动做成${torches}。` }
      : { count: `${count}/${CRAFT_NEED}`, words: `煤炭和木棍各攒满 ${CRAFT_NEED} 个，就自动做成一个火把。`, rule: '攒满以后再挖到不算。' }
    case 'poison': return { count: `还有 ${count} 次`, words: '接下来每挖一次，扣掉待领取的 5%。' }
  }
}
/** 一合成做成几个火把的说法：“一个火把”“ 4 个火把”（数字前带空格，接在“做成”后面） */
export const madeWords = (made: number) => (made === 1 ? '一个火把' : ` ${made} 个火把`)
/** 附魔镐一下挖开哪些格（说明里的说法） */
const SHAPE_WORDS: Record<Shape, string> = { h: '横着的 3 格', v: '竖着的 3 格', x: '十字形的 5 格' }

/** 瞄准类：在地图上点什么（步骤条上没预览时的那一句）；version 是 rules.items（第 2 版火把插在挖开的格子上）。 */
export function aimWhat(held: Held, version = 1) {
  if (held === 'torch') return version >= 2 ? '点一个挖开的格子，照亮周围 9 格' : '点四个格子相交的角，照亮旁边 4 格'
  return held === 'spyglass' ? '点一格，看看里面是什么' : held === 'key' ? '点试炼密室里的宝库' : '点一格，框住的格子一起挖开'
}
/** 瞄准类的引导弹窗里“怎么点”那一句；mouse 是有鼠标（指着就预览） */
export function howToAim(held: Held, version = 1, mouse = false) {
  if (mouse) return '鼠标指着预览，点一下确认。'
  const where = held === 'torch' ? (version >= 2 ? '挖开的格子' : '四个格子相交的角') : held === 'key' ? '宝库' : '一格'
  return `在地图上点${where}预览，再点一下确认。`
}
/** 预览以后步骤条上接的那一句 */
export const confirmWords = (mouse: boolean) => (mouse ? '点一下确认' : '再点一下确认')

/** 有鼠标（指着就能预览）还是触屏（点一下预览） */
export const hasMouse = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches

/**
 * 瞄准类的引导弹窗（docs/ITEM_UX.md §4）：只在第一次弹，点“知道了”就记住、进入选位置，说明收进步骤条的问号；
 * 问号随时能再打开。三种附魔镐算一种。记在这台设备上（存不了就照旧弹，不影响玩）。以前选过“不再提示”的
 * 记在同一个地方，算学过。
 */
const LEARNED_KEY = 'kddb:v3:skip-guide'
const guideGroup = (slot: Held) => (shapeOf(slot) ? 'pick' : slot)
function learnedList(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(LEARNED_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
export const knowsGuide = (slot: Held) => learnedList().includes(guideGroup(slot))
export function learnGuide(slot: Held) {
  try {
    const list = learnedList()
    if (!list.includes(guideGroup(slot))) localStorage.setItem(LEARNED_KEY, JSON.stringify([...list, guideGroup(slot)]))
  } catch {
    // 存不了：下次照旧弹引导
  }
}

/** 附魔镐的形状：相对中心的 [行, 列] */
export const SHAPES: Record<Shape, [number, number][]> = {
  h: [[0, -1], [0, 0], [0, 1]],
  v: [[-1, 0], [0, 0], [1, 0]],
  x: [[-1, 0], [0, -1], [0, 0], [0, 1], [1, 0]],
}
export const SHAPE_NAMES: Record<Shape, string> = { h: '横三格', v: '竖三格', x: '十字' }
export const shapeOf = (slot: Held): Shape | null => (slot === 'pick-h' ? 'h' : slot === 'pick-v' ? 'v' : slot === 'pick-x' ? 'x' : null)

/** 煤炭、木棍各攒几格做一个火把（游戏站的 NEED）。 */
export const CRAFT_NEED = 2
/** 有道具栏的局盾牌最多带几面。 */
export const SHIELD_CAP = 3

/** 形状放在 (row, col) 时，整个形状挪进卡里以后的中心。 */
export function clampCenter(size: number, row: number, col: number, shape: Shape) {
  const cells = SHAPES[shape]
  const low = (axis: 0 | 1) => -Math.min(...cells.map(cell => cell[axis]))
  const high = (axis: 0 | 1) => size - 1 - Math.max(...cells.map(cell => cell[axis]))
  return {
    row: Math.min(high(0), Math.max(low(0), row)),
    col: Math.min(high(1), Math.max(low(1), col)),
  }
}

/** 形状的中心在第 index 格时，盖住哪几格（从上到下、从左到右，出界的不算）。 */
export function shapeCells(size: number, index: number, shape: Shape) {
  const row = Math.floor(index / size)
  const col = index % size
  return SHAPES[shape]
    .map(([dr, dc]) => [row + dr, col + dc])
    .filter(([r, c]) => r >= 0 && c >= 0 && r < size && c < size)
    .map(([r, c]) => r * size + c)
    .sort((a, b) => a - b)
}

/**
 * 火把插在哪个角：点在第 index 格的哪个四分之一（qx、qy 是 0 左/上，1 右/下），就是离得最近的
 * 那个角；卡边上的角挪到里面。返回那个角右下的格子（行、列都 ≥ 1）。
 */
export function cornerOf(size: number, index: number, qx: 0 | 1, qy: 0 | 1) {
  const row = Math.min(size - 1, Math.max(1, Math.floor(index / size) + qy))
  const col = Math.min(size - 1, Math.max(1, (index % size) + qx))
  return row * size + col
}

/** 火把（插在 at 格的左上角）照亮的 4 格。 */
export function cornerCells(size: number, at: number) {
  return [at - size - 1, at - size, at - 1, at]
}

/** 第 2 版火把（插在 at 格上）照亮的格子：以它为中心的 3×3，出界的不算。 */
export function torchArea(size: number, at: number) {
  const row = Math.floor(at / size)
  const col = at % size
  const cells: number[] = []
  for (let r = row - 1; r <= row + 1; r++)
    for (let c = col - 1; c <= col + 1; c++) if (r >= 0 && c >= 0 && r < size && c < size) cells.push(r * size + c)
  return cells
}

/** 这一格挖开了（插第 2 版火把的地方）：有人挖开的，不是固定的、不是被岩浆吞掉的。 */
export function dugCell(card: PublicCard, index: number) {
  const cell = card.cells[index]
  return !!cell && !cell.burn && !card.fixed?.[index]
}

/** 这张卡上还有能开的宝库（卡挖完了宝库照样能开）。 */
export function vaultsLeft(card: PublicCard) {
  return !card.closed && Object.values(card.vaults ?? {}).some(left => left > 0)
}

/** 这一格能不能挖（没开、不是装饰、宝库、岩浆；卡没关）。 */
export function diggable(card: PublicCard, index: number) {
  return !card.closed && card.cells[index] === null && !card.fixed?.[index]
}

/**
 * 工具条上有哪些格：镐子以外主动的、被动的（被动排在一道线后面）。没有道具栏的旧局只有盾牌。
 * 第 2 版（version 2）：煤炭、木棍排在火把后面，合成时是相邻两格之间的动画（docs/V3_ITEMS.md §9）。
 */
export function slotsOf(me: Me, items: boolean, version = items ? 1 : 0): { active: Slot[]; passive: Slot[] } {
  const active: Slot[] = []
  const passive: Slot[] = []
  const shields = me.shields ?? (me.shield ? 1 : 0)
  if (items) {
    const owned = me.items
    if (owned) {
      if (owned.pick.h > 0) active.push('pick-h')
      if (owned.pick.v > 0) active.push('pick-v')
      if (owned.pick.x > 0) active.push('pick-x')
    }
    if ((me.spyglasses ?? 0) > 0) active.push('spyglass')
    if (owned) {
      // 火把一直在（没有时是灰的 0）：看得出这局能做火把（2026-11-11 用户转述的反馈）
      active.push('torch')
      if (version >= 2) {
        if ((me.coal ?? 0) > 0) active.push('coal')
        if ((me.stick ?? 0) > 0) active.push('stick')
      }
      if (owned.key > 0) active.push('key')
      if (owned.map > 0) active.push('map')
      if (owned.potion > 0) active.push('potion')
      if (owned.ender > 0) active.push('ender')
      if (owned.table > 0) active.push('table')
    }
  }
  if (shields > 0) passive.push('shield')
  if (version < 2 && (me.coal ?? 0) > 0) passive.push('coal')
  if (version < 2 && (me.stick ?? 0) > 0) passive.push('stick')
  // 中毒不在工具条上了：画成身上的效果（右上角、地图四周一圈绿、镐子上的标记，Effects.tsx）
  return { active, passive }
}

/** 一格的数量（右下角的数）；煤炭、木棍是进度条，不写数。 */
export function countOf(me: Me, slot: Slot): number {
  const owned = me.items
  switch (slot) {
    case 'pickaxe': return me.chances
    case 'pick-h': return owned?.pick.h ?? 0
    case 'pick-v': return owned?.pick.v ?? 0
    case 'pick-x': return owned?.pick.x ?? 0
    case 'spyglass': return me.spyglasses ?? 0
    case 'shield': return me.shields ?? (me.shield ? 1 : 0)
    case 'coal': return me.coal ?? 0
    case 'stick': return me.stick ?? 0
    case 'poison': return me.poison ?? 0
    default: return owned?.[slot] ?? 0
  }
}

/**
 * 这一下挖完，这一局就挖不动了吗（docs/V3_ITEMS.md §13 最后一下）：镐子、附魔镐只剩这一下，手里也没有附魔台。
 * by 是用什么挖：镐子，或者某一种附魔镐。
 */
export function isLastDig(me: Me, by: 'pickaxe' | Shape) {
  const pick = me.items?.pick
  const picks = pick ? pick.h + pick.v + pick.x : 0
  if ((me.items?.table ?? 0) > 0) return false
  return by === 'pickaxe' ? me.chances === 1 && picks === 0 : me.chances <= 0 && picks === 1
}
/** 最后一下之前还没用、还用得上的：钥匙开宝库，望远镜、火把、藏宝图帮着挑这最后一格。 */
export const LEFTOVER_SLOTS: Slot[] = ['key', 'spyglass', 'torch', 'map']
export const leftoversOf = (me: Me) => LEFTOVER_SLOTS.filter(slot => countOf(me, slot) > 0)

/** 镐子和附魔镐都用完了、手里也没有附魔台（换得到附魔镐）：这一局挖不动了（游戏站的 canDig）。 */
export function outOfPicks(me: Me) {
  const pick = me.items?.pick
  return me.chances <= 0 && (!pick || pick.h + pick.v + pick.x <= 0) && (me.items?.table ?? 0) <= 0
}

/**
 * 工具条两头还有没有（渐隐、箭头）：position 是滚了多少，content 是格子排出来的长度，client 是看得见的长度。
 * content 要按排版算（offsetWidth，不算 transform），不能用 scrollWidth：收起的那一格会先浮起来
 * （popLayout 的 position: absolute）、动画里的格子带着位移，都会把 scrollWidth 撑大，工具条明明放得下却
 * 冒出箭头，点了也滚不动；它们走了以后工具条大小不变，没人再量，箭头就一直留着（2026-11-11 用户）。
 */
export function edgesOf(position: number, content: number, client: number) {
  const room = Math.max(0, content - client)
  return { start: room > 4 && position > 4, end: room > 4 && position < room - 4 }
}
