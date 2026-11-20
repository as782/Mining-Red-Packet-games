// 地图的镜头（docs/V3_MAP.md §6）：一张卡占一个格位，镜头是平移加缩放。
// 屏幕坐标 = 世界坐标 × scale + (x, y)。都是纯函数，网页和测试共用。
import type { PublicCard } from './types'

/**
 * 卡的外框 5×5、6×6、7×7 都一样大（360，和 v2 一样“外框尺寸统一”），格子小的卡
 * 格子大：7×7 一格 44，6×6 52，5×5 63.2。格间 4，内边距 11、边框 3（页面是
 * border-box，边框算在宽度里，不算进去格子会往右下溢出）。每张卡放在区块正中，
 * 区块四周比卡宽 16（392 见方），区块之间固定隔 16：格位 408，卡和卡隔 48。
 */
export const CARD_PX = 360
export const GAP = 4
export const PAD = 11
export const CARD_BORDER = 3
export const BLOCK_PAD = 16
export const BLOCK_GAP = 16
export const BLOCK_PX = CARD_PX + BLOCK_PAD * 2
export const SLOT_PX = BLOCK_PX + BLOCK_GAP

/** 一格多宽：外框减去边框、内边距和格间距，平分。 */
export const cellPx = (size: number) => (CARD_PX - (PAD + CARD_BORDER) * 2 - (size - 1) * GAP) / size

export interface Camera { x: number; y: number; scale: number }
/**
 * 地图区的大小。left、bottom：浮在地图上的工具条占掉的那一条（竖着的画面在下面，横着的在左边）。
 * 取景（缩放、居中、哪张卡在正中）只用剩下的那块，卡不会落到工具条下面；算在不在画面里还是整块。
 */
export interface Viewport { width: number; height: number; left?: number; bottom?: number }

/** 取景用的那块：去掉工具条那一条以后的宽、高和正中。 */
export function areaOf(view: Viewport) {
  const left = Math.min(view.left ?? 0, view.width / 2)
  const bottom = Math.min(view.bottom ?? 0, view.height / 2)
  const width = view.width - left
  const height = view.height - bottom
  return { left, width, height, cx: left + width / 2, cy: height / 2 }
}

/** 三级缩放：0 总览，1 附近，2 挖卡。 */
export type Level = 0 | 1 | 2

/** 浮在地图上的工具条占掉的那一条有多宽（格子 48 + 内边距 10 + 边框 2 + 离地图边 10）。 */
export const TOOLBAR_SPACE = 70
/** 地图区这么大时工具条在哪边：竖着的画面在下面，横着的在左边（和样式里的 @container map 一致）。 */
export function withToolbar(width: number, height: number): Viewport {
  return width > height ? { width, height, left: TOOLBAR_SPACE } : { width, height, bottom: TOOLBAR_SPACE }
}

/** 挖卡这一级，卡和画面边之间至少留这么多。 */
export const MARGIN = 16
/** 挖卡这一级，卡的上下各留一行给卡周围的说明（区块名字、余量、噪音条，CardLabels.tsx）。 */
export const LABEL_SPACE = 30
/** 附近这一级的缩放（画面小时更小，至少放得下两块多）。 */
export const MID_SCALE = 0.6

/**
 * 挖卡这一级：画面放得下就是原大，区块之间的距离不随画面大小变；窄的那边
 * 放不下一张卡（加两边的留白）时才缩小。
 */
export function digScale(view: Viewport) {
  const area = areaOf(view)
  return Math.min(1, Math.max(0.5, (Math.min(area.width, area.height - LABEL_SPACE * 2) - MARGIN * 2) / CARD_PX))
}

/** 附近这一级：固定的缩放，画面大就多看到几块；画面小时缩到窄的那边放得下两块多。 */
export function midScale(view: Viewport) {
  const area = areaOf(view)
  return Math.min(MID_SCALE, digScale(view) * 0.8, Math.min(area.width, area.height) / (SLOT_PX * 2.2))
}

/** 总览：所有卡都放下、四周留安全距离；卡少时不比附近那一级更大。 */
export function overviewScale(view: Viewport, cards: Pick<PublicCard, 'x' | 'y'>[]) {
  const box = bounds(cards)
  const margin = 48
  const area = areaOf(view)
  const fit = Math.min(
    (area.width - margin * 2) / ((box.maxX - box.minX + 1) * SLOT_PX),
    (area.height - margin * 2) / ((box.maxY - box.minY + 1) * SLOT_PX),
  )
  return Math.max(0.04, Math.min(midScale(view), fit))
}

/**
 * 附近这一级真正用的缩放（docs/V3_ITEMS.md §23）：地图小时就是 midScale；卡多了、全图那一级缩得很小时，取全图
 * 和挖卡两级的“中间”（按倍数算，开平方），三级之间每级差不多一样多倍，不用再加一级。343 张卡的宽屏上全图约
 * 0.06、挖卡 1，附近就是 0.25 左右，一屏看得到五十多张卡（以前固定 0.6，从全图一下跳到只看见六七张）。
 */
export function nearScale(view: Viewport, cards: Pick<PublicCard, 'x' | 'y'>[]) {
  const over = overviewScale(view, cards)
  return Math.min(midScale(view), Math.max(over, Math.sqrt(over * digScale(view))))
}

export function scaleOf(level: Level, view: Viewport, cards: Pick<PublicCard, 'x' | 'y'>[]) {
  return level === 2 ? digScale(view) : level === 1 ? nearScale(view, cards) : overviewScale(view, cards)
}

/** 离这个缩放最近的那一级（捏合松手后吸过去）。 */
export function nearestLevel(scale: number, view: Viewport, cards: Pick<PublicCard, 'x' | 'y'>[]): Level {
  const levels: Level[] = [0, 1, 2]
  return levels.reduce((best, level) =>
    Math.abs(Math.log(scaleOf(level, view, cards) / scale)) < Math.abs(Math.log(scaleOf(best, view, cards) / scale)) ? level : best,
  )
}

export function bounds(cards: Pick<PublicCard, 'x' | 'y'>[]) {
  if (cards.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  return {
    minX: Math.min(...cards.map(card => card.x)),
    maxX: Math.max(...cards.map(card => card.x)),
    minY: Math.min(...cards.map(card => card.y)),
    maxY: Math.max(...cards.map(card => card.y)),
  }
}

/** 卡的中心在世界里的位置。 */
export const centerOf = (card: Pick<PublicCard, 'x' | 'y'>) => ({ x: card.x * SLOT_PX, y: card.y * SLOT_PX })

/** 让世界里的一点落在屏幕正中。 */
export function cameraAt(point: { x: number; y: number }, scale: number, view: Viewport): Camera {
  const area = areaOf(view)
  return { x: area.cx - point.x * scale, y: area.cy - point.y * scale, scale }
}

/** 总览：把所有卡的中心放在屏幕正中。 */
export function overviewCamera(view: Viewport, cards: Pick<PublicCard, 'x' | 'y'>[]): Camera {
  const box = bounds(cards)
  return cameraAt({ x: ((box.minX + box.maxX) / 2) * SLOT_PX, y: ((box.minY + box.maxY) / 2) * SLOT_PX }, overviewScale(view, cards), view)
}

/** 屏幕正中对着世界里的哪一点。 */
export function worldCenter(camera: Camera, view: Viewport) {
  const area = areaOf(view)
  return { x: (area.cx - camera.x) / camera.scale, y: (area.cy - camera.y) / camera.scale }
}

/** 屏幕上这一点下面（或离它最近）的卡：滚轮放大时朝指针那张。 */
export function cardNear<T extends Pick<PublicCard, 'x' | 'y'>>(cards: T[], camera: Camera, point: { x: number; y: number }): T | null {
  const at = { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale }
  let best: T | null = null
  let distance = Infinity
  for (const card of cards) {
    const center = centerOf(card)
    const d = (center.x - at.x) ** 2 + (center.y - at.y) ** 2
    if (d < distance) {
      distance = d
      best = card
    }
  }
  return best
}

/** 离屏幕正中最近的卡（聚焦、松手吸附都用它）。 */
export function nearestCard<T extends Pick<PublicCard, 'x' | 'y'>>(cards: T[], camera: Camera, view: Viewport): T | null {
  const area = areaOf(view)
  return cardNear(cards, camera, { x: area.cx, y: area.cy })
}

export type Direction = 'up' | 'down' | 'left' | 'right'
export const VECTORS: Record<Direction, [number, number]> = { right: [1, 0], down: [0, 1], left: [-1, 0], up: [0, -1] }

/**
 * 从这张卡往一个方向走，到哪张卡：在那个方向上（偏离不超过 45°），先看格位
 * 距离，再看偏了多少。没有就是 null（按钮变灰）。
 */
export function cardToward<T extends Pick<PublicCard, 'x' | 'y'>>(cards: T[], from: Pick<PublicCard, 'x' | 'y'>, direction: Direction): T | null {
  const [vx, vy] = VECTORS[direction]
  let best: T | null = null
  let score = Infinity
  for (const card of cards) {
    const dx = card.x - from.x
    const dy = card.y - from.y
    const along = dx * vx + dy * vy
    const across = Math.abs(dx * vy - dy * vx)
    if (along <= 0 || across > along) continue
    const s = along * 10 + across
    if (s < score) {
      score = s
      best = card
    }
  }
  return best
}

/** 这张卡在不在屏幕里（留一点边）。 */
export function onScreen(card: Pick<PublicCard, 'x' | 'y'>, camera: Camera, view: Viewport, margin = 0) {
  const center = centerOf(card)
  const half = (CARD_PX / 2) * camera.scale
  const sx = center.x * camera.scale + camera.x
  const sy = center.y * camera.scale + camera.y
  return sx + half > -margin && sx - half < view.width + margin && sy + half > -margin && sy - half < view.height + margin
}

/**
 * 屏幕上看得到哪些格位（含两头，露出一点的也算）：报给在场的房间（docs/V3_ITEMS.md §20），房间按它发别人的指针和
 * 表情。区块在格位正中、BLOCK_PX 见方。
 */
export function slotsOnScreen(camera: Camera, view: Viewport) {
  const left = -camera.x / camera.scale
  const top = -camera.y / camera.scale
  const right = (view.width - camera.x) / camera.scale
  const bottom = (view.height - camera.y) / camera.scale
  const half = BLOCK_PX / 2
  // || 0：不要 -0
  return {
    x0: Math.ceil((left - half) / SLOT_PX) || 0, y0: Math.ceil((top - half) / SLOT_PX) || 0,
    x1: Math.floor((right + half) / SLOT_PX) || 0, y1: Math.floor((bottom + half) / SLOT_PX) || 0,
  }
}

/** 整张卡都在画面里（NEW 提醒用：只露出一部分也要提醒）。 */
export function fullyOnScreen(card: Pick<PublicCard, 'x' | 'y'>, camera: Camera, view: Viewport) {
  // 被工具条盖住一点也不算整张在画面里
  const area = areaOf(view)
  const center = centerOf(card)
  const half = (CARD_PX / 2) * camera.scale
  const sx = center.x * camera.scale + camera.x
  const sy = center.y * camera.scale + camera.y
  return sx - half >= area.left && sx + half <= view.width && sy - half >= 0 && sy + half <= area.height
}

/** 屏幕外的卡在屏幕边上的哪个位置、箭头朝哪（NEW 标记用）。 */
export function edgePointer(card: Pick<PublicCard, 'x' | 'y'>, camera: Camera, view: Viewport, inset = 44) {
  // 贴在取景那块的边上，不落到工具条下面
  const area = areaOf(view)
  const center = centerOf(card)
  const sx = center.x * camera.scale + camera.x - area.cx
  const sy = center.y * camera.scale + camera.y - area.cy
  const halfW = area.width / 2 - inset
  const halfH = area.height / 2 - inset
  const k = Math.min(halfW / Math.max(Math.abs(sx), 1e-6), halfH / Math.max(Math.abs(sy), 1e-6), 1)
  return { x: area.cx + sx * k, y: area.cy + sy * k, angle: (Math.atan2(sy, sx) * 180) / Math.PI }
}

/** 滚轮缩放：一下（中间停不到 200ms 的一串事件）的状态。 */
export interface WheelZoom { last: number; stepAt: number; sum: number; stepped: boolean }
export const WHEEL_IDLE_MS = 200
export const WHEEL_STEP_MS = 260
export const WHEEL_MORE_PX = 80

/**
 * 滚轮换缩放级别。浏览器分不清鼠标滚轮和触控板双指滑动，所以不按设备分：
 * 不按 ctrl 的滚轮都是缩放（触控板捏合是按着 ctrl 的滚轮，另算），平移靠拖动和箭头。
 * 一下的第一个事件就换一级；同一下里同方向再攒够 80px、离上次换级过了 260ms，再换一级。
 * 返回 1 放大、-1 缩小、0 不动。
 */
export function wheelZoom(state: WheelZoom | null, event: { deltaMode: number; deltaY: number }, now: number): { state: WheelZoom; step: 1 | -1 | 0 } {
  const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1
  const px = event.deltaY * unit
  const fresh = !state || now - state.last > WHEEL_IDLE_MS
  const next: WheelZoom = fresh ? { last: now, stepAt: state?.stepAt ?? -Infinity, sum: 0, stepped: false } : { ...state, last: now }
  if (px === 0) return { state: next, step: 0 }
  if (Math.sign(px) !== Math.sign(next.sum)) next.sum = 0
  next.sum += px
  if (now - next.stepAt < WHEEL_STEP_MS || (next.stepped && Math.abs(next.sum) < WHEEL_MORE_PX)) return { state: next, step: 0 }
  return { state: { ...next, stepAt: now, sum: 0, stepped: true }, step: next.sum < 0 ? 1 : -1 }
}

/** 一张卡上第 index 格的中心在世界里的位置（珍珠从这里飞出去）。 */
export function cellCenter(card: Pick<PublicCard, 'x' | 'y' | 'size'>, index: number) {
  const center = centerOf(card)
  const side = cellPx(card.size)
  const left = center.x - CARD_PX / 2 + CARD_BORDER + PAD
  const top = center.y - CARD_PX / 2 + CARD_BORDER + PAD
  const col = index % card.size
  const row = Math.floor(index / card.size)
  return { x: left + col * (side + GAP) + side / 2, y: top + row * (side + GAP) + side / 2 }
}

/** 新卡朝着旧卡的那条边（格子从这边开始翻出来）。 */
export function edgeFacing(card: Pick<PublicCard, 'x' | 'y'>, from: Pick<PublicCard, 'x' | 'y'>): Direction {
  const dx = from.x - card.x
  const dy = from.y - card.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'up' : 'down'
}

/** 入场时第 index 格晚多少毫秒翻出来：离那条边越远越晚，边的中间先出来（箭头形的一波）。 */
export function entranceWave(size: number, index: number, edge: Direction, step = 45) {
  const col = index % size
  const row = Math.floor(index / size)
  const middle = (size - 1) / 2
  const horizontal = edge === 'left' || edge === 'right'
  const along = edge === 'left' ? col : edge === 'right' ? size - 1 - col : edge === 'up' ? row : size - 1 - row
  const across = Math.abs((horizontal ? row : col) - middle)
  return Math.round((along + across * 0.35) * step)
}

/**
 * 珍珠的落点：新卡朝着旧卡那条边往里一点（格子从这里开始翻出来）。挖卡那一级
 * 邻卡的中心常在画面外，落在边上才看得见落地。
 */
export function entryPoint(card: Pick<PublicCard, 'x' | 'y'>, edge: Direction, inset = 60) {
  const center = centerOf(card)
  const [vx, vy] = VECTORS[edge]
  const reach = CARD_PX / 2 - inset
  return { x: center.x + vx * reach, y: center.y + vy * reach }
}
