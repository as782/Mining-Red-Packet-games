import type { AimInfo } from './aim'
import type { Direction } from './camera'
import { CARD_BORDER, CARD_PX, cellPx, entranceWave, GAP, PAD } from './camera'
import type { Held } from './items'
import { torchArea } from './items'
import { isBulb, RAIL_TEXTURE, railOf, sculkOf } from './layout'
import { CELL_COLORS, FRAMES, GROUNDS, ICONS, image } from './thumb'
import type { DigResult, Kind, PublicCard } from './types'
import { KIND_NAMES, money } from './types'

// 一张卡画在画布上（docs/V3_ITEMS.md §22）：外框、格子、图标、名字、火把、宝库、预览、刚挖开的动画，
// 和以前网页里的卡（v3.css 的 .map-card、.map-cell）画得一样。坐标是卡的局部坐标：(0, 0) 是卡外框的左上角，
// 1 是世界里的 1 像素；调用的人先把画布的变换设好。纯画图，不碰网页。

const TEX = {
  stone: 'block/stone.png', planks: 'block/oak_planks.png', rail: 'block/rail.png', railCorner: 'block/rail_corner.png',
  chiseledTuff: 'block/chiseled_tuff.png', bulb: 'block/copper_bulb_lit.png', tuffBricks: 'block/tuff_bricks.png',
  lava: 'block/lava_still.png', sculk: 'block/sculk.png', warden: 'entity/warden/warden.png',
  potionOverlay: 'item/potion_overlay.png', potion: 'item/potion.png', pickaxe: 'item/iron_pickaxe.png',
  torch: 'block/torch.png', redstoneTorch: 'block/redstone_torch.png',
}
const INV = { copperTorch: 'inventory/copper_torch.png' }
/** 贴图（thumb.ts 加载、缓存）：TEX 里的路径相对 textures/，ICONS、GROUNDS 里的带着 textures/ 或 inventory/ */
const tex = (path: string) => image(path.startsWith('inventory/') || path.startsWith('textures/') ? path : `textures/${path}`)

export const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif'
const GOLD = '#e9b56b'
/** 网格从卡外框左上角往里多少（边框加内边距） */
const ORIGIN = CARD_BORDER + PAD
/** 画布有没有 filter（Safari 18 以前没有）：没有就跳过灰度、调亮这些，只差一点颜色 */
const HAS_FILTER = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype

/** 挖开的格子的边框颜色（v3.css 的 .map-cell.kind-*） */
const CELL_BORDERS: Partial<Record<Kind, string>> = {
  diamond: '#496772', apple: '#827049', tnt: '#75504a', totem: '#68704b', pearl: '#686080',
  shield: '#6c6053', spyglass: '#66717a', crystal: '#7f5d96',
}
/** 没挖开的格子上那层淡淡的渐变（各区块不一样） */
const COVER_TINT: Record<string, [string, string]> = {
  normal: ['#edc38f0f', '#0e172526'], end: ['#fff5c114', '#2a1f402e'], trial: ['#e0a06414', '#0e172526'],
  mine: ['#edc38f0f', '#0e172540'], nether: ['#ff906014', '#1a050526'], deep: ['#2fe0e012', '#04080a40'],
}
const TORCH_LIGHT = ['#7cf08a', '#ffd75a', '#ff5a3c']
const TORCH_LIGHT_2 = ['#7cf08a', '#ffd75a', '#ff9a3c', '#ff4b4b']
const HALO = ['#5fdc7c', '#ffd84a', '#ff9a3c', '#ff4b4b']

/** 刚挖开的一格（谁挖的、什么时候、自己挖的结果） */
export interface Fresh { mine: boolean; at: number; result?: DigResult }

/** 变得慢的：换了才重画缓存（卡、当前卡、名字、望远镜、开过的宝库） */
export interface Look {
  focused: boolean
  /** 挖卡这一级的当前卡：格子上写谁挖的 */
  names: boolean
  myUid: number | null
  peeks: ReadonlyMap<number, Kind>
  opened: ReadonlySet<number>
  /** 第几版道具规则（第 2 版火把在格子正中） */
  version: number
}

/** 一直在变的：动画、指着哪格、按着哪格、预览。只画当前卡和正在动的卡。 */
export interface Live {
  /** Date.now() */
  now: number
  /** 红包站的时钟（监守者醒的时刻按它记） */
  hbNow: number
  reduced: boolean
  pending: ReadonlySet<number>
  fresh: ReadonlyMap<number, Fresh>
  hover: number | null
  pressed: number | null
  cooling: boolean
  diggable: boolean
  held: Held | null
  preview: (AimInfo & { at: number }) | null
  /** 刚用望远镜、藏宝图看到的那一格，飘一下是什么 */
  peeked: { index: number; at: number } | null
  /** 新长出来：start（Date.now()）以后 land 毫秒落地，格子从 edge 那边翻出来 */
  entrance: { start: number; land: number; edge: Direction } | null
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
/** --ease-out：cubic-bezier(.22, 1, .36, 1) 差不多 */
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 4
const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * clamp01(t)) / 2
/** 带一点回弹：cubic-bezier(.34, 1.56, .64, 1) 差不多 */
const backOut = (t: number) => {
  const c1 = 1.70158
  const x = clamp01(t) - 1
  return 1 + (c1 + 1) * x ** 3 + c1 * x ** 2
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

/** 每一格在卡上的位置（局部坐标）。 */
export function cellBox(card: Pick<PublicCard, 'size'>, index: number) {
  const side = cellPx(card.size)
  return { x: ORIGIN + (index % card.size) * (side + GAP), y: ORIGIN + Math.floor(index / card.size) * (side + GAP), side }
}

/** 卡上一点（局部坐标）落在哪一格；格子之间的缝不算。 */
export function cellUnder(card: Pick<PublicCard, 'size'>, x: number, y: number) {
  const side = cellPx(card.size)
  const col = Math.floor((x - ORIGIN) / (side + GAP))
  const row = Math.floor((y - ORIGIN) / (side + GAP))
  if (col < 0 || row < 0 || col >= card.size || row >= card.size) return null
  const inX = x - ORIGIN - col * (side + GAP)
  const inY = y - ORIGIN - row * (side + GAP)
  return inX <= side && inY <= side ? row * card.size + col : null
}

/** 火把的位置（局部坐标）：第 1 版在四格相交的角上，第 2 版在格子正中。 */
export function torchPoint(card: Pick<PublicCard, 'size'>, at: number, center: boolean) {
  const side = cellPx(card.size)
  return {
    x: ORIGIN + (at % card.size) * (side + GAP) + (center ? side / 2 : -GAP / 2),
    y: ORIGIN + Math.floor(at / card.size) * (side + GAP) + (center ? side / 2 : -GAP / 2),
  }
}

/** 几格围成的框（第 2 版火把照亮的 3×3、预览） */
function areaBox(card: Pick<PublicCard, 'size'>, cells: number[]) {
  const side = cellPx(card.size)
  const rows = cells.map(index => Math.floor(index / card.size))
  const cols = cells.map(index => index % card.size)
  const [r0, r1, c0, c1] = [Math.min(...rows), Math.max(...rows), Math.min(...cols), Math.max(...cols)]
  return { x: ORIGIN + c0 * (side + GAP) - 3, y: ORIGIN + r0 * (side + GAP) - 3, w: (c1 - c0 + 1) * (side + GAP) - GAP + 6, h: (r1 - r0 + 1) * (side + GAP) - GAP + 6 }
}

let potionSprite: HTMLCanvasElement | null = null
/** 急迫药水：液体层乘上急迫的颜色，再盖上瓶子（和 ItemIcon 一样，画一次存着）。 */
function potionIcon() {
  if (potionSprite) return potionSprite
  const overlay = tex(TEX.potionOverlay)
  const bottle = tex(TEX.potion)
  if (!overlay || !bottle || typeof document === 'undefined') return null
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 16
  const ctx = sprite.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(overlay, 0, 0)
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = '#d9c043'
  ctx.fillRect(0, 0, 16, 16)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(overlay, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(bottle, 0, 0)
  potionSprite = sprite
  return sprite
}

/** 画一个道具图标（x, y 是左上角，size 见方）；缺图返回 false。 */
function icon(ctx: CanvasRenderingContext2D, kind: Kind | 'pickaxe', x: number, y: number, size: number) {
  if (kind === 'totem') {
    // 双铁镐：后面那把在右上、暗一点，前面那把在左下、带一点投影
    const pick = tex(TEX.pickaxe)
    if (!pick) return false
    const small = size * 0.77
    ctx.save()
    if (HAS_FILTER) ctx.filter = 'brightness(.8)'
    ctx.drawImage(pick, x + size - small, y, small, small)
    ctx.restore()
    ctx.save()
    ctx.shadowColor = '#13191fcc'
    ctx.shadowOffsetX = 1
    ctx.shadowOffsetY = -1
    ctx.drawImage(pick, x, y + size - small, small, small)
    ctx.restore()
    return true
  }
  if (kind === 'potion') {
    const sprite = potionIcon()
    if (!sprite) return false
    ctx.drawImage(sprite, x, y, size, size)
    return true
  }
  const path = kind === 'pickaxe' ? 'textures/item/iron_pickaxe.png' : ICONS[kind]
  const img = path ? image(path) : null
  if (!img) return !path
  ctx.drawImage(img, x, y, size, size)
  return true
}

/** 一段文字，宽不过 max 时截断加省略号。 */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1)
  return `${cut}…`
}

/** 格子上飘的字里道具的短名 */
const LOOT_NAMES: Record<NonNullable<DigResult['loot']>, string> = { spyglass: '望远镜', map: '藏宝图', key: '钥匙', table: '附魔台', ender: '末影箱', potion: '急迫药水', torch: '火把' }

/** 自己挖开一格时格子上飘的字（和以前网页里的一样）。 */
export function floatText(result: DigResult) {
  if (result.amount > 0) return `+${money(result.amount)}`
  if (result.amount < 0) return money(result.amount)
  if (result.kind === 'totem') return '+3 次'
  if (result.kind === 'pearl') return result.loot ? `新卡 +1 ${LOOT_NAMES[result.loot]}` : '新卡！'
  if (result.loot) return `+1 ${LOOT_NAMES[result.loot]}`
  if (result.kind === 'shield') return result.blocked ? '挡住了' : '盾牌'
  if (result.kind === 'tnt' || result.kind === 'crystal') return result.blocked ? '挡住了' : '没扣到'
  if (result.kind === 'spyglass') return result.text.startsWith('获得望远镜') ? '+1 望远镜' : '看到一格'
  const got: Partial<Record<DigResult['kind'], string>> = {
    coal: '+1 煤炭', stick: '+1 木棍', map: '+1 藏宝图', potion: '+1 急迫药水', key: '+1 钥匙', ender: '+1 末影箱',
    cobweb: '被蜘蛛网缠住了', spawner: '中毒了', minecart: '箱子矿车',
  }
  if (result.kind === 'coal' || result.kind === 'stick') return result.text.includes('已经够了') ? '够了，不算' : got[result.kind] ?? ''
  return got[result.kind] ?? ''
}

/** 一格的边框：四周 1 像素，下面 3 像素（和 .map-cell 一样）。 */
function cellEdges(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, color: string, bottom: string, width = 1) {
  ctx.fillStyle = color
  ctx.fillRect(x, y, side, width)
  ctx.fillRect(x, y, width, side)
  ctx.fillRect(x + side - width, y, width, side)
  ctx.fillStyle = bottom
  ctx.fillRect(x, y + side - 3, side, 3)
}

/** 一条虚线框 */
function dashed(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string, width = 2) {
  ctx.save()
  ctx.setLineDash([width * 2.5, width * 2])
  ctx.lineWidth = width
  ctx.strokeStyle = color
  rounded(ctx, x + width / 2, y + width / 2, w - width, h - width, r)
  ctx.stroke()
  ctx.restore()
}

/** 发光的边（box-shadow: 0 0 blur color） */
function glowRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string, blur: number, ring: string | null = null, ringWidth = 0) {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = blur
  ctx.strokeStyle = ring ?? color
  ctx.lineWidth = Math.max(1, ringWidth)
  rounded(ctx, x, y, w, h, r)
  ctx.stroke()
  ctx.restore()
}

/**
 * 画一张卡。live 是 null 时只画不动的样子（存进缓存用）；有 live 时把动画、指着、预览也画上。
 * 返回 complete：贴图都到了；busy：还有动画没放完（调用的人下一帧再画）。
 */
export function paintCard(ctx: CanvasRenderingContext2D, card: PublicCard, look: Look, live: Live | null): { complete: boolean; busy: boolean } {
  let complete = true
  let busy = false
  const need = (path: string) => {
    const img = tex(path)
    if (!img) complete = false
    return img
  }
  ctx.imageSmoothingEnabled = false
  const now = live?.now ?? 0
  const reduced = live?.reduced ?? true
  const biome = card.kind ?? null
  const end = biome === 'end'
  const side = cellPx(card.size)
  const iconSize = Math.round(side * 0.6)

  // 新卡入场：落地以前什么都不画；落地后外框回弹，格子一波一波翻出来
  const entrance = live?.entrance && !reduced ? live.entrance : null
  let since = Infinity
  if (entrance) {
    since = now - entrance.start - entrance.land
    if (since < 0) return { complete, busy: true }
    const last = entranceWave(card.size, card.size * card.size - 1, entrance.edge) + 380
    if (since < Math.max(450, last)) busy = true
  }
  ctx.save()
  if (since < 450) {
    const grow = 0.86 + 0.14 * backOut(since / 450)
    ctx.translate(CARD_PX / 2, CARD_PX / 2)
    ctx.scale(grow, grow)
    ctx.translate(-CARD_PX / 2, -CARD_PX / 2)
    ctx.globalAlpha = easeOut(since / 300)
  }

  // —— 外框：错位投影、底色、边框、里面一圈深色 ——
  const [frameColor, back] = (biome && FRAMES[biome]) ?? ['#67533e', '#211f20']
  // 当前卡的边框变金；区块卡（试炼密室、废弃矿井、下界、深暗之域）保留自己的颜色，末地宝藏变亮金（和以前的样式一样）
  const border = look.focused ? (end ? '#ffe08a' : biome ? frameColor : GOLD) : frameColor
  ctx.fillStyle = '#11151b'
  rounded(ctx, 0, 6, CARD_PX, CARD_PX, 6)
  ctx.fill()
  ctx.fillStyle = '#31281f'
  rounded(ctx, 0, 3, CARD_PX, CARD_PX, 6)
  ctx.fill()
  ctx.fillStyle = back
  rounded(ctx, 0, 0, CARD_PX, CARD_PX, 6)
  ctx.fill()
  ctx.lineWidth = CARD_BORDER
  ctx.strokeStyle = border
  rounded(ctx, CARD_BORDER / 2, CARD_BORDER / 2, CARD_PX - CARD_BORDER, CARD_PX - CARD_BORDER, 6 - CARD_BORDER / 2)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#10151b'
  rounded(ctx, CARD_BORDER + 1, CARD_BORDER + 1, CARD_PX - CARD_BORDER * 2 - 2, CARD_PX - CARD_BORDER * 2 - 2, 3)
  ctx.stroke()

  const ground = (biome && GROUNDS[biome]) ?? GROUNDS.mine ?? 'textures/block/stone.png'
  const tint = COVER_TINT[biome ?? 'normal'] ?? COVER_TINT.normal
  const sculks = sculkOf(card)
  const torchOn = new Map((card.torches ?? []).filter(torch => torch.v === 2).map(torch => [torch.at, torch]))
  const preview = live?.preview ?? null
  const held = live?.held ?? null
  const inPreview = new Set(preview?.cells ?? [])
  const skipped = new Set(preview?.skip ?? [])
  const floats: { x: number; y: number; side: number; text: string; color: string; t: number }[] = []

  card.cells.forEach((cell, index) => {
    const { x, y } = cellBox(card, index)
    let flip = 1
    let alpha = 1
    if (entrance && since < Infinity) {
      const t = (since - entranceWave(card.size, index, entrance.edge)) / 380
      if (t < 1) {
        if (t <= 0) return
        const p = easeOut(t)
        flip = Math.max(0.05, Math.cos((1 - p) * 80 * Math.PI / 180)) * (0.7 + 0.3 * p)
        alpha = p
      }
    }
    const fresh = live?.fresh.get(index)
    const recent = fresh && now - fresh.at < 2400 && !reduced ? fresh : null
    if (recent) busy = true
    ctx.save()
    if (flip !== 1 || alpha !== 1) {
      ctx.globalAlpha *= alpha
      ctx.translate(x + side / 2, y + side / 2)
      ctx.scale(0.7 + 0.3 * alpha, flip)
      ctx.translate(-(x + side / 2), -(y + side / 2))
    }
    // 自己刚挖开的：弹一下
    if (recent?.mine && now - recent.at < 500) {
      const t = (now - recent.at) / 500
      const pop = t < 0.6 ? 0.6 + 0.52 * easeOut(t / 0.6) : 1.12 - 0.12 * easeOut((t - 0.6) / 0.4)
      ctx.translate(x + side / 2, y + side / 2)
      ctx.scale(pop, pop)
      ctx.translate(-(x + side / 2), -(y + side / 2))
    }
    const fixed = card.fixed?.[index]
    if (fixed || cell?.burn) {
      paintFixed(ctx, card, index, x, y, side, iconSize, look, need, recent, now)
    } else if (cell) {
      // —— 挖开的格子 ——
      const mine = look.myUid !== null && cell.uid === look.myUid
      const lit = torchOn.get(index)
      ctx.fillStyle = '#0006'
      rounded(ctx, x, y + 2, side, side, 2)
      ctx.fill()
      ctx.fillStyle = CELL_COLORS[cell.kind] ?? '#19232d'
      rounded(ctx, x, y, side, side, 2)
      ctx.fill()
      ctx.fillStyle = '#060b1266'
      ctx.fillRect(x + 1, y + 1, side - 2, 2)
      cellEdges(ctx, x, y, side, mine ? '#b99760' : CELL_BORDERS[cell.kind] ?? '#4c5155', '#171c22')
      if (mine) {
        ctx.strokeStyle = '#b9976055'
        ctx.lineWidth = 1
        ctx.strokeRect(x + 1.5, y + 1.5, side - 3, side - 3 - 2)
      }
      if (lit) {
        // 插着火把：图标缩到左下角、淡一点
        ctx.save()
        ctx.globalAlpha *= 0.6
        if (!icon(ctx, cell.kind, x + side * 0.06, y + side * (1 - 0.06 - 0.38), side * 0.38)) complete = false
        ctx.restore()
      } else {
        const named = look.names
        const size = named ? iconSize * 0.84 : iconSize
        const ix = x + (side - size) / 2
        const iy = y + (side - iconSize) / 2 - (named ? iconSize * 0.14 : 0) + (iconSize - size) / 2
        if (!icon(ctx, cell.kind, ix, iy, size)) complete = false
      }
      if (look.names) {
        ctx.font = `${mine ? 650 : 400} 9px ${FONT}`
        ctx.fillStyle = mine ? '#f3cc8f' : '#aeb6bb'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(fit(ctx, mine ? '我' : cell.name, side * 0.9), x + side / 2, y + side - 2 - 2.5)
      }
      // 别人刚挖开的：一圈光淡出
      if (recent && !recent.mine && now - recent.at < 1200) {
        const fade = 1 - easeOut((now - recent.at) / 1200)
        ctx.save()
        ctx.globalAlpha *= fade
        glowRect(ctx, x - 1, y - 1, side + 2, side + 2, 2, '#f5e7cf88', 18, '#f5e7cf', 2)
        ctx.restore()
      }
      if (recent?.mine && recent.result && now - recent.at < 1600) {
        const text = floatText(recent.result)
        if (text) floats.push({ x, y, side, text, color: recent.result.amount < 0 ? '#ff9c8a' : '#b4f0a8', t: (now - recent.at) / 1600 })
      }
    } else {
      // —— 没挖开的格子 ——
      const peek = look.peeks.get(index)
      const digging = live?.pending.has(index) ?? false
      const sculk = sculks.get(index)
      ctx.fillStyle = '#0006'
      rounded(ctx, x, y + 2, side, side, 2)
      ctx.fill()
      ctx.save()
      rounded(ctx, x, y, side, side, 2)
      ctx.clip()
      const groundImg = sculk !== undefined ? need(TEX.sculk) : need(ground)
      if (groundImg) {
        if (sculk !== undefined) ctx.drawImage(groundImg, 0, sculk * 16, 16, 16, x, y, side, side)
        else ctx.drawImage(groundImg, x, y, side, side)
      } else {
        ctx.fillStyle = end ? '#cfc79a' : '#6d6d6d'
        ctx.fillRect(x, y, side, side)
      }
      const gradient = ctx.createLinearGradient(x, y, x + side, y + side)
      gradient.addColorStop(0, tint[0])
      gradient.addColorStop(1, tint[1])
      ctx.fillStyle = gradient
      ctx.fillRect(x, y, side, side)
      ctx.fillStyle = '#c5bbb22b'
      ctx.fillRect(x + 1, y + 1, side - 2, 2)
      // 挖卡这一级的当前卡：冷却时暗一点，指着时亮一点、边框变金，按下去暗一点
      const enabled = !!live?.diggable && !digging && !card.closed
      const aiming = !!held
      if (enabled && !aiming) {
        if (live?.pressed === index) {
          ctx.fillStyle = '#00000026'
          ctx.fillRect(x, y, side, side)
        } else if (live?.cooling) {
          ctx.fillStyle = live.hover === index ? '#00000033' : '#00000047'
          ctx.fillRect(x, y, side, side)
        } else if (live?.hover === index) {
          ctx.fillStyle = '#ffffff24'
          ctx.fillRect(x, y, side, side)
        }
      }
      ctx.restore()
      const hovered = enabled && !aiming && !live?.cooling && live?.hover === index
      if (peek && !digging) dashed(ctx, x, y, side, side, 2, '#c5be9c', 2)
      else cellEdges(ctx, x, y, side, digging ? GOLD : hovered ? '#e3c08a' : '#8c89826b', digging ? GOLD : '#303136')
      if (peek) {
        const size = Math.round(iconSize * 0.85)
        ctx.save()
        ctx.globalAlpha *= 0.55
        if (!icon(ctx, peek, x + (side - size) / 2, y + (side - size) / 2, size)) complete = false
        ctx.restore()
        if (live?.peeked?.index === index && now - live.peeked.at < 1600 && !reduced) {
          busy = true
          floats.push({ x, y, side, text: KIND_NAMES[peek], color: '#bdf2fb', t: (now - live.peeked.at) / 1600 })
        }
      }
      if (digging) {
        // 正在挖：镐子来回挥（.32 秒一下，绕右下角转）
        const size = Math.round(iconSize * 0.92)
        const swing = reduced ? 0 : easeInOut(((now / 320) % 2) < 1 ? (now / 320) % 1 : 1 - (now / 320) % 1)
        const angle = (-25 + 43 * swing) * Math.PI / 180
        const left = x + (side - size) / 2
        const top = y + (side - size) / 2
        ctx.save()
        ctx.translate(left + size * 0.8, top + size * 0.8)
        ctx.rotate(angle)
        if (!icon(ctx, 'pickaxe', -size * 0.8, -size * 0.8, size)) complete = false
        ctx.restore()
        if (!reduced) busy = true
      }
    }
    // —— 预览（拿着道具时）——
    if (preview && inPreview.has(index)) {
      const dug = !!cell || !!card.fixed?.[index]
      if (held === 'spyglass' || held === 'key') {
        glowRect(ctx, x, y, side, side, 2, '#8fe3f080', 12, '#8fe3f0', held === 'key' ? 2 : 1)
        ctx.strokeStyle = '#8fe3f0'
        ctx.lineWidth = 2
        ctx.strokeRect(x + 1, y + 1, side - 2, side - 2)
      } else if (held === 'torch') {
        if (look.version < 2) {
          ctx.fillStyle = '#ffd76a1f'
          ctx.fillRect(x, y, side, side)
          ctx.strokeStyle = '#ffd76a99'
          ctx.lineWidth = 1
          ctx.strokeRect(x + 0.5, y + 0.5, side - 1, side - 1)
        }
      } else if (dug || skipped.has(index) || !preview.ok) {
        dashed(ctx, x + 3, y + 3, side - 6, side - 6, 2, '#f3cc8fa6', 2)
      } else {
        ctx.fillStyle = '#ffffff1a'
        ctx.fillRect(x, y, side, side)
        glowRect(ctx, x, y, side, side, 2, '#f3cc8f80', 12, '#f3cc8f', 1)
        ctx.strokeStyle = '#f3cc8f'
        ctx.lineWidth = 2
        ctx.strokeRect(x + 1, y + 1, side - 2, side - 2)
      }
    }
    ctx.restore()
  })

  // —— 第 2 版的火把：照亮的 3×3 一层同色的光 ——
  for (const torch of torchOn.values()) {
    const area = areaBox(card, torchArea(card.size, torch.at))
    const color = HALO[torch.level]
    const cx = area.x + area.w / 2
    const cy = area.y + area.h / 2
    const radius = Math.min(area.w, area.h) / 2
    const light = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    light.addColorStop(0, `${color}57`)
    light.addColorStop(0.75, `${color}29`)
    light.addColorStop(1, `${color}14`)
    ctx.save()
    rounded(ctx, area.x, area.y, area.w, area.h, 6)
    ctx.fillStyle = light
    ctx.fill()
    ctx.strokeStyle = `${color}4d`
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }
  // —— 火把 ——
  const torchSize = Math.round(side * 0.85)
  for (const torch of card.torches ?? []) {
    const v2 = torch.v === 2
    const at = torchPoint(card, torch.at, v2)
    const color = (v2 ? TORCH_LIGHT_2 : TORCH_LIGHT)[torch.level]
    paintTorch(ctx, at.x, at.y, torchSize, v2, color, v2 ? (torch.level === 0 ? 'green' : torch.level === 3 ? 'red' : torch.level === 2 ? 'orange' : 'plain') : (torch.level === 0 ? 'green' : torch.level === 1 ? 'plain' : 'red'), 1, need)
  }
  // —— 预览：第 2 版火把照到的框、放下去的火把 ——
  if (preview && held === 'torch') {
    const v2 = look.version >= 2
    if (v2) {
      const area = areaBox(card, preview.cells)
      ctx.save()
      rounded(ctx, area.x, area.y, area.w, area.h, 6)
      ctx.fillStyle = preview.ok ? '#f3cc8f1c' : '#ff7a6b1a'
      ctx.fill()
      ctx.restore()
      if (preview.ok) glowRect(ctx, area.x, area.y, area.w, area.h, 6, '#f3cc8f40', 12, '#f3cc8f00', 1)
      dashed(ctx, area.x, area.y, area.w, area.h, 6, preview.ok ? '#f3cc8f' : '#ff7a6b', 2)
    }
    if (preview.ok) {
      const at = torchPoint(card, preview.at, v2)
      paintTorch(ctx, at.x, at.y, torchSize, v2, '#ffd75a', 'plain', 0.6, need)
    }
  }

  // —— 监守者醒了：卡暗下来，脸浮在中间 ——
  if (card.closed) {
    const fresh = !!card.wokeBy?.at && live && live.hbNow - card.wokeBy.at < 4000 && !reduced
    const t = fresh ? live!.hbNow - card.wokeBy!.at! : Infinity
    if (fresh) busy = true
    paintClosed(ctx, t, need)
  }

  // —— 挖完的卡：灰一点、暗一点（和以前的 grayscale(.75) brightness(.55) 差不多）——
  if (card.finished) {
    ctx.save()
    rounded(ctx, 0, 0, CARD_PX, CARD_PX + 6, 6)
    ctx.clip()
    ctx.globalCompositeOperation = 'saturation'
    ctx.fillStyle = '#808080'
    ctx.globalAlpha = 0.75
    ctx.fillRect(0, 0, CARD_PX, CARD_PX + 6)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 0.45
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, CARD_PX, CARD_PX + 6)
    ctx.restore()
  }

  // —— 飘的字（在格子上面，可以出格）——
  for (const item of floats) {
    const t = clamp01(item.t)
    const alpha = t < 0.15 ? t / 0.15 : t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25
    const lift = 8 - 16 * easeOut(t)
    ctx.save()
    ctx.globalAlpha *= alpha
    ctx.font = `700 12px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const width = ctx.measureText(item.text).width + 10
    const cx = item.x + item.side / 2
    const top = item.y + 4 + lift
    ctx.fillStyle = '#11171dcc'
    rounded(ctx, cx - width / 2, top, width, 17, 4)
    ctx.fill()
    ctx.fillStyle = item.color
    ctx.fillText(item.text, cx, top + 2)
    ctx.restore()
  }
  ctx.restore()
  return { complete, busy }
}

/** 不能挖的格子：岩浆（含被吞掉的）、装饰（铁轨、铜灯）、宝库。 */
function paintFixed(ctx: CanvasRenderingContext2D, card: PublicCard, index: number, x: number, y: number, side: number, iconSize: number, look: Look, need: (path: string) => CanvasImageSource | null, recent: Fresh | null, now: number) {
  const cell = card.cells[index]
  const fixed = card.fixed?.[index] ?? 'lava'
  ctx.fillStyle = '#0006'
  rounded(ctx, x, y + 2, side, side, 2)
  ctx.fill()
  ctx.save()
  rounded(ctx, x, y, side, side, 2)
  ctx.clip()
  if (fixed === 'lava') {
    const lava = need(TEX.lava)
    // 刚被吞掉的：岩浆流两遍（1.9 秒 19 帧，来回）；平时停在第一帧
    let frame = 0
    if (recent && cell?.burn) {
      const t = (now - recent.at) / 1900
      if (t < 2) frame = Math.min(19, Math.floor((t < 1 ? t : 2 - t) * 19))
    }
    if (lava) ctx.drawImage(lava, 0, frame * 16, 16, 16, x, y, side, side)
    else {
      ctx.fillStyle = '#d4561c'
      ctx.fillRect(x, y, side, side)
    }
  } else if (fixed === 'vault') {
    ctx.fillStyle = '#2b2d2a'
    ctx.fillRect(x, y, side, side)
    const bricks = need(TEX.tuffBricks)
    if (bricks) ctx.drawImage(bricks, x, y, side, side)
  } else {
    const rail = railOf(card, index)
    const bulb = isBulb(card, index)
    const texture = card.kind === 'mine' ? TEX.planks : card.kind === 'trial' ? (bulb ? TEX.bulb : TEX.chiseledTuff) : null
    const img = texture ? need(texture) : null
    if (img) ctx.drawImage(img, x, y, side, side)
    else {
      ctx.fillStyle = card.kind === 'mine' ? '#6b5233' : bulb ? '#c9824a' : '#5d5f58'
      ctx.fillRect(x, y, side, side)
    }
    if (rail) {
      const track = need(RAIL_TEXTURE[rail].corner ? TEX.railCorner : TEX.rail)
      if (track) {
        ctx.save()
        ctx.translate(x + side / 2, y + side / 2)
        ctx.rotate((RAIL_TEXTURE[rail].turn * Math.PI) / 180)
        ctx.drawImage(track, -side / 2, -side / 2, side, side)
        ctx.restore()
      }
    }
  }
  ctx.restore()
  if (fixed === 'deco' && isBulb(card, index)) glowRect(ctx, x, y, side, side, 2, '#ffbe6a66', 14, '#ffbe6a00', 1)
  ctx.strokeStyle = '#0006'
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, side - 1, side - 1)
  ctx.strokeStyle = '#0004'
  ctx.strokeRect(x + 1.5, y + 1.5, side - 3, side - 3)
  if (fixed === 'vault') {
    const left = card.vaults?.[index] ?? 0
    const spent = left <= 0 || look.opened.has(index)
    const vault = need('inventory/vault.png')
    if (vault) {
      ctx.save()
      if (spent) {
        if (HAS_FILTER) ctx.filter = 'grayscale(.8) brightness(.7)'
        else ctx.globalAlpha *= 0.6
      } else {
        ctx.shadowColor = '#6fd8ff88'
        ctx.shadowBlur = 6
      }
      ctx.drawImage(vault, x + (side - iconSize) / 2, y + (side - iconSize) / 2, iconSize, iconSize)
      ctx.restore()
    }
    ctx.save()
    ctx.font = `700 13px ${FONT}`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = '#3f3f3f'
    ctx.fillText(String(left), x + side - 3 + 1, y + side - 1 + 1)
    ctx.fillStyle = '#fff'
    ctx.fillText(String(left), x + side - 3, y + side - 1)
    ctx.restore()
  }
  // 被岩浆吞掉的那一下：原来的东西亮一下、往下沉着消失
  if (cell?.burn && recent && now - recent.at < 1800) {
    const t = (now - recent.at) / 1800
    const size = iconSize * (1 - 0.3 * clamp01((t - 0.4) / 0.6))
    ctx.save()
    ctx.globalAlpha *= t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6
    if (HAS_FILTER && t < 0.6) ctx.filter = 'brightness(1.5) sepia(1) saturate(4) hue-rotate(-20deg)'
    icon(ctx, cell.kind, x + (side - size) / 2, y + (side - size) / 2 + 6 * clamp01((t - 0.4) / 0.6), size)
    ctx.restore()
  }
}

/** 一个火把：一圈光，图标的中心在点上（火焰在上，略往上）。kind 是图标的颜色。 */
function paintTorch(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, v2: boolean, color: string, kind: 'green' | 'red' | 'orange' | 'plain', alpha: number, need: (path: string) => CanvasImageSource | null) {
  const radius = v2 ? 35 : 48
  ctx.save()
  ctx.globalAlpha *= alpha * (v2 ? 0.5 : 0.55)
  const light = ctx.createRadialGradient(x, y, 0, x, y, radius)
  light.addColorStop(0, color)
  light.addColorStop(0.68, `${color}00`)
  ctx.fillStyle = light
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  ctx.restore()
  const img = kind === 'green' ? image(INV.copperTorch) : kind === 'red' ? need(TEX.redstoneTorch) : need(TEX.torch)
  if (!img) return
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.shadowColor = color
  ctx.shadowBlur = 3
  if (kind === 'orange' && HAS_FILTER) ctx.filter = 'hue-rotate(-24deg) saturate(1.8)'
  ctx.drawImage(img, x - size / 2, y - size * 0.56, size, size)
  ctx.restore()
}

/** 监守者醒了：t 是醒来以后过了多久（毫秒；早就醒了是 Infinity）。 */
function paintClosed(ctx: CanvasRenderingContext2D, t: number, need: (path: string) => CanvasImageSource | null) {
  const x = CARD_BORDER
  const y = CARD_BORDER
  const size = CARD_PX - CARD_BORDER * 2
  // 刚醒：像原版的“黑暗”效果一明一暗几下
  let dark = 0xd9 / 255
  if (t < 2400) {
    const steps: [number, number][] = [[0, 0.95], [0.18, 0.5], [0.36, 0.95], [0.56, 0.55], [0.76, 0.93], [1, 0xd9 / 255]]
    const p = t / 2400
    for (let i = 1; i < steps.length; i++) {
      if (p <= steps[i][0]) {
        const [a, va] = steps[i - 1]
        const [b, vb] = steps[i]
        dark = va + (vb - va) * easeInOut((p - a) / (b - a))
        break
      }
    }
  }
  ctx.save()
  ctx.fillStyle = `rgba(4, 8, 10, ${dark})`
  rounded(ctx, x, y, size, size, 4)
  ctx.fill()
  const rise = (delay: number, length: number) => {
    const p = t === Infinity ? 1 : easeOut((t - delay) / length)
    return { alpha: p, shift: 40 * (1 - p), scale: 0.85 + 0.15 * p }
  }
  const face = rise(500, 900)
  const words = rise(1100, 500)
  const cx = x + size / 2
  const faceSize = 96
  const top = y + size / 2 - (faceSize + 12 + 34) / 2
  const warden = need(TEX.warden)
  if (face.alpha > 0) {
    ctx.save()
    ctx.globalAlpha *= face.alpha
    ctx.translate(cx, top + faceSize / 2 + face.shift)
    ctx.scale(face.scale, face.scale)
    glowRect(ctx, -faceSize / 2, -faceSize / 2, faceSize, faceSize, 6, '#29dfeb66', 26, '#1f6a73', 2)
    if (warden) {
      ctx.save()
      rounded(ctx, -faceSize / 2, -faceSize / 2, faceSize, faceSize, 6)
      ctx.clip()
      if (HAS_FILTER) ctx.filter = 'brightness(1.9) saturate(1.3)'
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(warden, 10, 42, 16, 16, -faceSize / 2, -faceSize / 2, faceSize, faceSize)
      ctx.restore()
    }
    ctx.restore()
  }
  if (words.alpha > 0) {
    ctx.save()
    ctx.globalAlpha *= words.alpha
    ctx.font = `700 18px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const text = '监守者醒了'
    const width = ctx.measureText(text).width + 28
    const wy = top + faceSize + 12 + 17 + words.shift
    ctx.fillStyle = '#0a1a1fe6'
    rounded(ctx, cx - width / 2, wy - 17, width, 34, 8)
    ctx.fill()
    ctx.strokeStyle = '#1f6a73'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = '#b9f6ff'
    ctx.fillText(text, cx, wy + 1)
    ctx.restore()
  }
  ctx.restore()
}

/**
 * 当前卡的光晕（以前 .map-card::after）：一圈 3 像素的淡金边加一圈 46 像素的金光，画好一张存着，
 * 每帧只贴（模糊很贵）。px：画布上 1 个世界像素合几个画布像素。
 */
export function focusSprite(px: number) {
  if (typeof document === 'undefined') return null
  const pad = Math.ceil(70 * px)
  const side = Math.ceil((CARD_PX + 6) * px)
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = side + pad * 2
  const ctx = sprite.getContext('2d')
  if (!ctx) return null
  const away = sprite.width + side * 2
  ctx.save()
  ctx.shadowColor = '#e9b56b40'
  ctx.shadowBlur = 46 * px
  ctx.shadowOffsetX = away
  ctx.fillStyle = '#000'
  rounded(ctx, pad - away, pad, side, side, 8 * px)
  ctx.fill()
  ctx.restore()
  ctx.lineWidth = 3 * px
  ctx.strokeStyle = '#e9b56b4d'
  rounded(ctx, pad - 1.5 * px, pad - 1.5 * px, side + 3 * px, side + 3 * px, 9.5 * px)
  ctx.stroke()
  return { sprite, pad }
}
