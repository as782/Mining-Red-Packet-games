import type { Viewport } from './camera'
import { BLOCK_PX, bounds, CARD_PX, overviewScale, SLOT_PX } from './camera'
import { isTreasure } from './eye'
import { drawCard } from './thumb'
import type { PublicCard } from './types'

// 整张地图的低清位图（docs/V3_MAP.md §6、V3_ITEMS.md §22）：所有卡按全图那一级够用的清晰度画在一块
// 不放进网页的画布上，光另画一块（光是糊的，只要一半清晰度），只在长出新卡、卡变了时补画那一块。地图画布
// （MapPaint）缩到全图时直接贴它们；放大以后近处的卡单独画清楚，盖在它上面。区块底色每帧直接画（几百个框，不贵）。

/**
 * 四周多留的格位：地图跨度的一成五，至少 2 格。卡长出这个范围，三块画布都要重开、整张重画
 * （上千张卡时手机上明显顿一下），所以留宽一点，地图大了也很少碰到
 */
const MARGIN_SLOTS = 2
const MARGIN_SHARE = 0.15
/** 画布最大边长（像素）：再大手机上占的显存太多 */
const MAX_SIDE = 4096
/**
 * 有人挖了一格：画布最多每 250 毫秒重画一次（几十个人一起挖时一秒十几格）。画布每改一次，
 * 显卡都要把整块画布再交一遍；远处那么小的格子晚一点点亮也看不出来
 */
export const PAINT_EVERY_MS = 250

/**
 * 画布的清晰度（画布像素 / 世界像素）：全图那一级刚好够清楚（乘上屏幕像素比，多一成），
 * 按 √2 一档取整，地图稍微长大一点不用整张重画。
 */
export function resolutionOf(view: Viewport, cards: Pick<PublicCard, 'x' | 'y'>[], ratio: number) {
  const wanted = Math.min(0.5, Math.max(0.03, overviewScale(view, cards) * ratio * 1.1))
  return 2 ** (Math.round(Math.log2(wanted) * 2) / 2)
}

/** 画布占的世界范围：所有卡的格位，四周多留一圈（见 MARGIN_SHARE）；只在卡长出范围时变。 */
export function areaOf(box: Area, before: Area | null): Area {
  if (before && box.minX >= before.minX && box.maxX <= before.maxX && box.minY >= before.minY && box.maxY <= before.maxY) return before
  const margin = Math.max(MARGIN_SLOTS, Math.ceil(Math.max(box.maxX - box.minX, box.maxY - box.minY) * MARGIN_SHARE))
  return { minX: box.minX - margin, maxX: box.maxX + margin, minY: box.minY - margin, maxY: box.maxY + margin }
}
export interface Area { minX: number; maxX: number; minY: number; maxY: number }

/** 按 2^¼ 一档取整：全图那一级的大小跟着地图一点点变，光的粗细不用每长一张卡就整张重画。 */
export const stepped = (value: number) => 2 ** (Math.round(Math.log2(value) * 4) / 4)

type Rect = { x: number; y: number; w: number; h: number }
const meets = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** 光变了的卡：以前画了、现在不画（或者换了颜色）的，和新要画的。 */
export function glowChanges(drawn: Map<number, string>, wanted: Map<number, string>) {
  const changed: number[] = []
  for (const [id, glow] of drawn) if (wanted.get(id) !== glow) changed.push(id)
  for (const id of wanted.keys()) if (!drawn.has(id)) changed.push(id)
  return changed
}

/** 画布换大小（会清空）；大小没变就只清空（给 width 赋值会重开画布的存储，手机上不便宜）。 */
function reopen(element: HTMLCanvasElement, context: CanvasRenderingContext2D, pixels: { width: number; height: number }) {
  if (element.width !== pixels.width || element.height !== pixels.height) {
    element.width = pixels.width
    element.height = pixels.height
  } else {
    context.clearRect(0, 0, element.width, element.height)
  }
}

/**
 * 一张光的贴图：区块（side 见方，四周留 pad）外面一圈光、里面淡淡的底色、一条细边。
 * px：屏幕 1px 在画布上合多少像素（全图那一级），光和边的粗细按它算，和网页里的一样。
 */
export function glowSprite(glow: Glow, side: number, pad: number, px: number, outerOnly = false) {
  if (typeof document === 'undefined') return null
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = Math.ceil(side + pad * 2)
  const context = sprite.getContext('2d')
  if (!context) return null
  const end = glow === 'end'
  const rich = RICH[glow as RichGlow]
  const block = new Path2D()
  if ('roundRect' in block) block.roundRect(pad, pad, side, side, side * 16 / BLOCK_PX)
  else (block as Path2D).rect(pad, pad, side, side)
  // 外面那圈光只在区块外面（和 box-shadow 一样）：光用一块挪到画外的实心块投过来
  context.save()
  const outside = new Path2D()
  outside.rect(0, 0, sprite.width, sprite.height)
  outside.addPath(block)
  context.clip(outside, 'evenodd')
  const away = sprite.width + side * 2
  context.shadowColor = rich?.glow ?? (end ? '#ffbf3d8c' : '#9a6bff73')
  context.shadowBlur = (rich?.blur ?? (end ? 56 : 40)) * px
  context.shadowOffsetX = away
  context.fillStyle = '#000'
  context.translate(-away, 0)
  context.fill(block)
  context.restore()
  // 越富越亮的只有外面那圈光（和网页里的 .rich-N 一样），不加底色和边；outerOnly 时底色和边由调用的人画
  if (rich || outerOnly) return sprite
  context.fillStyle = end ? '#ffd36b17' : '#9a6bff12'
  context.fill(block)
  context.lineWidth = (end ? 2 : 1.5) * px
  context.strokeStyle = end ? '#f1c57fb3' : '#b48cff8c'
  context.save()
  context.clip(block)
  context.stroke(block)
  context.restore()
  return sprite
}

/** 世界坐标里的一点落在哪个格位的卡上（全图点击、悬停用）。 */
export function cardAt<T extends Pick<PublicCard, 'x' | 'y'>>(bySlot: Map<string, T>, world: { x: number; y: number }) {
  const x = Math.round(world.x / SLOT_PX)
  const y = Math.round(world.y / SLOT_PX)
  const card = bySlot.get(`${x},${y}`)
  if (!card) return null
  // 区块之间的空隙不算
  const half = BLOCK_PX / 2
  return Math.abs(world.x - x * SLOT_PX) <= half && Math.abs(world.y - y * SLOT_PX) <= half ? card : null
}

type RichGlow = 'rich1' | 'rich2' | 'rich3'
export type Glow = 'eye' | 'end' | RichGlow
/** 越富越亮的三档金光（regions.ts richnessOf；和 v3.css 的 .rich-N 一样）：静止的，只在档位变时重画 */
const RICH: Record<RichGlow, { glow: string; blur: number }> = {
  rich1: { glow: '#ffd24a33', blur: 28 },
  rich2: { glow: '#ffd24a5c', blur: 36 },
  rich3: { glow: '#ffd24a94', blur: 44 },
}

/** 发光的卡：没挖完的末地宝藏（金）、藏着眼的（紫），别的按还藏着多少钱分三档金光（rich：0 不亮）。 */
export const glowOf = (card: PublicCard, rich = 0): Glow | null =>
  isTreasure(card) ? (card.finished ? null : 'end') : (card.left.eye ?? 0) > 0 ? 'eye' : rich > 0 ? `rich${rich as 1 | 2 | 3}` : null

/** 新开一块不放进网页的画布 */
function offscreen() {
  return typeof document === 'undefined' ? null : document.createElement('canvas')
}

/**
 * 整张地图的低清位图：卡、光、区块底色三块，坐标是世界坐标 (left, top) 起、每个世界像素 scale 个画布像素。
 * 卡只会多、不会挪：范围、清晰度变了才整块重画，不然只补画变了的卡、光变了的那一圈。
 */
export class FarMap {
  readonly cards = offscreen()
  readonly glows = offscreen()
  left = 0
  top = 0
  scale = 0.1
  width = 0
  height = 0
  private area: Area | null = null
  private boxKey = ''
  private box: Area = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  private drawn = new Map<number, PublicCard | null>()
  private glowDrawn = { geometry: '', glows: new Map<number, string>() }
  private sprites: { key: string; made: Map<Glow, HTMLCanvasElement | null> } = { key: '', made: new Map() }
  private unit = 10
  /** 贴图缺了：图到了要整块重画 */
  missing = false

  /** 按卡的范围和画面大小定位置和清晰度；变了返回 true（三块都要重画）。 */
  layout(cards: PublicCard[], view: Viewport, ratio: number) {
    const key = `${cards.length}`
    if (key !== this.boxKey) {
      this.box = bounds(cards)
      this.boxKey = key
    }
    const corners = [{ x: this.box.minX, y: this.box.minY }, { x: this.box.maxX, y: this.box.maxY }]
    const resolution = view.width > 0 ? resolutionOf(view, corners, ratio) : 0.1
    const next = areaOf(this.box, this.area)
    const left = next.minX * SLOT_PX - BLOCK_PX / 2
    const top = next.minY * SLOT_PX - BLOCK_PX / 2
    const width = (next.maxX - next.minX) * SLOT_PX + BLOCK_PX
    const height = (next.maxY - next.minY) * SLOT_PX + BLOCK_PX
    const scale = Math.min(resolution, MAX_SIDE / width, MAX_SIDE / height)
    this.unit = view.width > 0 ? stepped(1 / overviewScale(view, corners)) : 10
    const changed = next !== this.area || scale !== this.scale || left !== this.left || top !== this.top
    Object.assign(this, { area: next, left, top, width, height, scale })
    return changed
  }

  private pixels() {
    return { width: Math.ceil(this.width * this.scale), height: Math.ceil(this.height * this.scale) }
  }

  /** 卡：只画变了的（skip：刚长出来、入场动画还没放完的那张先不画） */
  paintCards(cards: PublicCard[], skip: number | null) {
    const element = this.cards
    const context = element?.getContext('2d')
    if (!element || !context) return
    const pixels = this.pixels()
    if (element.width !== pixels.width || element.height !== pixels.height || this.missing) {
      element.width = pixels.width
      element.height = pixels.height
      this.drawn.clear()
      this.missing = false
    }
    const { left, top, scale } = this
    let missing = false
    for (const card of cards) {
      const hide = card.id === skip
      const before = this.drawn.get(card.id)
      if (hide ? before === null : before === card) continue
      const x = (card.x * SLOT_PX - CARD_PX / 2 - left) * scale
      const y = (card.y * SLOT_PX - CARD_PX / 2 - top) * scale
      context.clearRect(x - 1, y - 1, CARD_PX * scale + 2, CARD_PX * scale + 2)
      if (hide) {
        this.drawn.set(card.id, null)
        continue
      }
      if (!drawCard(context, card, x, y, scale)) missing = true
      this.drawn.set(card.id, card)
    }
    this.missing = missing
  }

  /** 发光的卡（藏着眼的、没挖完的宝藏、越富越亮）：光变了的那一圈清掉重画 */
  paintGlows(cards: PublicCard[], rich: Map<number, number>) {
    const element = this.glows
    const context = element?.getContext('2d')
    if (!element || !context) return
    const wanted = new Map<number, Glow>()
    for (const card of cards) {
      const glow = glowOf(card, rich.get(card.id))
      if (glow) wanted.set(card.id, glow)
    }
    // 光只要一半清晰度（本来就是糊的），省四分之三的显存
    const scale = this.scale / 2
    const pixels = { width: Math.ceil(this.width * scale), height: Math.ceil(this.height * scale) }
    const { left, top, unit } = this
    const byId = new Map(cards.map(card => [card.id, card]))
    const rectOf = (card: Pick<PublicCard, 'x' | 'y'>) => ({ x: (card.x * SLOT_PX - BLOCK_PX / 2 - left) * scale, y: (card.y * SLOT_PX - BLOCK_PX / 2 - top) * scale, side: BLOCK_PX * scale })
    const reach = 84 * unit * scale
    const around = (card: Pick<PublicCard, 'x' | 'y'>): Rect => {
      const { x, y, side } = rectOf(card)
      return { x: x - reach, y: y - reach, w: side + reach * 2, h: side + reach * 2 }
    }
    const side = BLOCK_PX * scale
    const pad = Math.ceil(reach)
    const spriteKey = `${scale},${unit}`
    if (this.sprites.key !== spriteKey) this.sprites = { key: spriteKey, made: new Map() }
    const spriteOf = (glow: Glow) => {
      const made = this.sprites.made
      if (!made.has(glow)) made.set(glow, glowSprite(glow, side, pad, unit * scale))
      return made.get(glow) ?? null
    }
    const drawGlow = (card: PublicCard, glow: Glow) => {
      const { x, y } = rectOf(card)
      const sprite = spriteOf(glow)
      if (sprite) context.drawImage(sprite, x - pad, y - pad)
    }
    const geometry = `${pixels.width}x${pixels.height}@${left},${top},${scale},${unit}`
    const before = this.glowDrawn
    if (before.geometry !== geometry) {
      reopen(element, context, pixels)
      for (const [id, glow] of wanted) drawGlow(byId.get(id)!, glow)
    } else {
      const glowing = [...wanted].map(([id, glow]) => ({ card: byId.get(id)!, glow, rect: around(byId.get(id)!) }))
      for (const id of glowChanges(before.glows, wanted)) {
        const card = byId.get(id)
        if (!card) continue
        const dirty = around(card)
        context.save()
        context.beginPath()
        context.rect(dirty.x, dirty.y, dirty.w, dirty.h)
        context.clip()
        context.clearRect(dirty.x, dirty.y, dirty.w, dirty.h)
        for (const item of glowing) if (meets(item.rect, dirty)) drawGlow(item.card, item.glow)
        context.restore()
      }
    }
    this.glowDrawn = { geometry, glows: wanted }
  }
}
