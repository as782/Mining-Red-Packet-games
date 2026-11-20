import { CARD_BORDER, CARD_PX, cellPx, GAP, PAD } from './camera'
import { isBulb, RAIL_TEXTURE, railOf, sculkOf } from './layout'
import type { Kind, PublicCard } from './types'

// 缩略图（远处、全图时，docs/V3_MAP.md §6）：一张卡画进一块小画布，和格子画得一样——
// 没挖的是石头（宝藏卡是末地石），挖开的是同样的底色和图标。以前每格一个元素、每个
// 图标一张图，几百张卡就是上万个元素，有人挖一格浏览器每一帧都要把它们重新分一遍层，
// 手机上掉到二三十帧；画成一块画布，一张卡只有一个元素。

/** 画布的像素边长（卡的内容区 332 画成这么大；缩略图在屏幕上最大约 144，够用、也省内存） */
export const THUMB_PX = 112
/** 卡外框里面放格子的那块（border-box：减去边框和内边距） */
export const INNER_PX = CARD_PX - (PAD + CARD_BORDER) * 2

const BASE = 'assets/minecraft/1.21.4/'
export const ICONS: Partial<Record<Kind | 'pickaxe', string>> = {
  emerald: 'textures/item/emerald.png',
  diamond: 'textures/item/diamond.png',
  // 缩略图里放金苹果的静态首帧（动图在这么小的地方看不出来，还会一直重画）
  apple: 'inventory/enchanted_golden_apple.png',
  pickaxe: 'textures/item/iron_pickaxe.png',
  pearl: 'textures/item/ender_pearl.png',
  eye: 'textures/item/ender_eye.png',
  crystal: 'textures/item/end_crystal.png',
  spyglass: 'textures/item/spyglass.png',
  tnt: 'inventory/tnt.png',
  shield: 'inventory/shield.png',
  coal: 'textures/item/coal.png',
  stick: 'textures/item/stick.png',
  map: 'inventory/map.png',
  potion: 'textures/item/potion.png',
  key: 'textures/item/trial_key.png',
  debris: 'inventory/ancient_debris.png',
  cobweb: 'textures/block/cobweb.png',
  spawner: 'inventory/spawner.png',
  minecart: 'textures/item/chest_minecart.png',
  ender: 'inventory/ender_chest.png',
  vault: 'inventory/vault.png',
}
const STONE = 'textures/block/stone.png'
const PLANKS = 'textures/block/oak_planks.png'
const RAIL = 'textures/block/rail.png'
const RAIL_CORNER = 'textures/block/rail_corner.png'
const SCULK = 'textures/block/sculk.png'
const END_STONE = 'textures/block/end_stone.png'
/** 各区块没挖开的格子（docs/V3_ITEMS.md §2） */
export const GROUNDS: Partial<Record<NonNullable<PublicCard['kind']>, string>> = {
  end: END_STONE, trial: 'textures/block/tuff_bricks.png', nether: 'textures/block/netherrack.png', deep: 'textures/block/deepslate_tiles.png',
}
export const FRAMES: Partial<Record<NonNullable<PublicCard['kind']>, [string, string]>> = {
  end: ['#d9c27a', '#2a2637'], trial: ['#8c6a4a', '#2b2d2a'], mine: ['#8a6b45', '#2a2118'], nether: ['#8a3a2c', '#2a1214'], deep: ['#1f6a73', '#0d1418'],
}
/** 火把在远处只剩一个光点：绿、黄、红 */
/** 火把的光：第 1 版绿、黄、红；第 2 版（v: 2）绿、黄、橙、红 */
const TORCH_COLORS = ['#7cf08a', '#ffd75a', '#ff5a3c']
const TORCH_COLORS_2 = ['#7cf08a', '#ffd75a', '#ff9a3c', '#ff4b4b']

/** 挖开的格子底色（和 v3.css 的 .map-cell.kind-* 一样） */
export const CELL_COLORS: Partial<Record<Kind, string>> = {
  diamond: '#20363e', apple: '#3a302e', tnt: '#3b292b', totem: '#2e382e', pearl: '#2c2b3c',
  shield: '#34312f', spyglass: '#2c323a', crystal: '#33263d',
}
const OPENED = '#19232d'

const images = new Map<string, HTMLImageElement>()
const waiting = new Set<() => void>()

/** 贴图：第一次要时开始加载，加载好了通知画过缺图的画布重画一次。 */
export function image(path: string) {
  let img = images.get(path)
  if (!img) {
    img = new Image()
    img.decoding = 'async'
    img.src = new URL(BASE + path, document.baseURI).href
    img.onload = () => {
      const listeners = [...waiting]
      waiting.clear()
      for (const listener of listeners) listener()
    }
    images.set(path, img)
  }
  return img.complete && img.naturalWidth > 0 ? img : null
}

/** 缺图时登记一下，图到了再画一次。 */
export function whenImages(listener: () => void) {
  waiting.add(listener)
  return () => waiting.delete(listener)
}

/** 每一格在画布上的位置（和网格一样：格子边长 cellPx，格间距 GAP）。 */
export function cellRect(size: number, index: number, scale = THUMB_PX / INNER_PX) {
  const side = cellPx(size)
  const row = Math.floor(index / size)
  const col = index % size
  return { x: col * (side + GAP) * scale, y: row * (side + GAP) * scale, side: side * scale }
}

/** 把一张卡的格子画进小画布（单张卡的缩略图）；有贴图还没到时返回 false（等它到了再画）。 */
export function drawThumb(context: CanvasRenderingContext2D, card: PublicCard) {
  context.clearRect(0, 0, THUMB_PX, THUMB_PX)
  return drawCells(context, card, 0, 0, THUMB_PX / INNER_PX)
}

/**
 * 整张卡（外框、底色、格子）画在 (left, top) 起、按 scale 缩放的地方；整张地图的画布用。
 * 挖完的卡盖一层暗色（DOM 上是灰度加变暗的 filter）。
 */
export function drawCard(context: CanvasRenderingContext2D, card: PublicCard, left: number, top: number, scale: number) {
  const [frame, back] = (card.kind && FRAMES[card.kind]) ?? ['#67533e', '#211f20']
  const size = CARD_PX * scale
  const border = CARD_BORDER * scale
  context.fillStyle = frame
  roundRect(context, left, top, size, size, 6 * scale)
  context.fillStyle = back
  context.fillRect(left + border, top + border, size - border * 2, size - border * 2)
  const inset = (PAD + CARD_BORDER) * scale
  const complete = drawCells(context, card, left + inset, top + inset, scale)
  if (card.finished) {
    context.fillStyle = '#0a0d10a6'
    roundRect(context, left, top, size, size, 6 * scale)
  }
  return complete
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath()
  if (context.roundRect) context.roundRect(x, y, width, height, radius)
  else context.rect(x, y, width, height)
  context.fill()
}

/** 只画格子：(left, top) 是格子区的左上角，scale 是画布像素比 CSS 像素。 */
function drawCells(context: CanvasRenderingContext2D, card: PublicCard, left: number, top: number, scale: number) {
  let complete = true
  const need = (path: string) => {
    const img = image(path)
    if (!img) complete = false
    return img
  }
  context.imageSmoothingEnabled = false
  const ground = need((card.kind && GROUNDS[card.kind]) ?? STONE)
  // 和网页里的卡一样（layout.ts）：铁轨按形状、深暗之域的幽匿块、试炼密室正中的铜灯
  const sculks = sculkOf(card)
  const sculk = sculks.size ? need(SCULK) : null
  card.cells.forEach((cell, index) => {
    const rect = cellRect(card.size, index, scale)
    const x = left + rect.x
    const y = top + rect.y
    const { side } = rect
    // 不能挖的格子：岩浆、装饰、宝库
    const fixed = card.fixed?.[index] ?? (cell?.burn ? 'lava' : undefined)
    if (fixed) {
      context.fillStyle = fixed === 'lava' ? '#d4561c' : fixed === 'vault' ? '#3a4a4f' : card.kind === 'mine' ? '#6b5233' : isBulb(card, index) ? '#c9824a' : '#5d5f58'
      context.fillRect(x, y, side, side)
      const rail = cell ? null : railOf(card, index)
      if (rail) {
        const planks = need(PLANKS)
        if (planks) context.drawImage(planks, x, y, side, side)
        const track = need(RAIL_TEXTURE[rail].corner ? RAIL_CORNER : RAIL)
        if (track) {
          context.save()
          context.translate(x + side / 2, y + side / 2)
          context.rotate((RAIL_TEXTURE[rail].turn * Math.PI) / 180)
          context.drawImage(track, -side / 2, -side / 2, side, side)
          context.restore()
        }
      }
      if (fixed === 'vault' && side * 0.62 >= 3) {
        const img = need(ICONS.vault!)
        if (img) context.drawImage(img, x + side * 0.19, y + side * 0.19, side * 0.62, side * 0.62)
      }
      return
    }
    if (!cell) {
      const frame = sculks.get(index)
      if (frame !== undefined && sculk) context.drawImage(sculk, 0, frame * 16, 16, 16, x, y, side, side)
      else if (ground) context.drawImage(ground, x, y, side, side)
      else {
        context.fillStyle = card.kind === 'end' ? '#cfc79a' : '#6d6d6d'
        context.fillRect(x, y, side, side)
      }
      // 和格子上那层淡淡的暖色、冷色渐变差不多
      context.fillStyle = card.kind === 'end' ? '#2a1f4014' : '#0e172514'
      context.fillRect(x, y, side, side)
      return
    }
    context.fillStyle = CELL_COLORS[cell.kind] ?? OPENED
    context.fillRect(x, y, side, side)
    const icon = side * 0.62
    // 太小时只画底色（不到 3 个像素的图标看不出是什么）
    if (icon < 3) return
    const iconLeft = x + (side - icon) / 2
    const iconTop = y + (side - icon) / 2
    if (cell.kind === 'totem') {
      // 双铁镐：两把叠着
      const pick = need(ICONS.pickaxe!)
      if (pick) {
        const small = icon * 0.77
        context.drawImage(pick, iconLeft + icon - small, iconTop, small, small)
        context.drawImage(pick, iconLeft, iconTop + icon - small, small, small)
      }
      return
    }
    const path = ICONS[cell.kind]
    const img = path ? need(path) : null
    if (img) context.drawImage(img, iconLeft, iconTop, icon, icon)
  })
  // 火把：远处只剩光点，颜色和近处一样（绿、黄、红），一圈光晕
  if (card.torches?.length) {
    const side = cellPx(card.size)
    for (const torch of card.torches) {
      // 第 1 版在角上，第 2 版在格子正中
      const shift = torch.v === 2 ? side / 2 : -GAP / 2
      const cx = left + ((torch.at % card.size) * (side + GAP) + shift) * scale
      const cy = top + (Math.floor(torch.at / card.size) * (side + GAP) + shift) * scale
      const radius = Math.max(1.5, side * (torch.v === 2 ? 0.8 : 0.5) * scale)
      const color = (torch.v === 2 ? TORCH_COLORS_2 : TORCH_COLORS)[torch.level]
      const glow = context.createRadialGradient(cx, cy, 0, cx, cy, radius)
      glow.addColorStop(0, color)
      glow.addColorStop(0.25, `${color}cc`)
      glow.addColorStop(1, `${color}00`)
      context.fillStyle = glow
      context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
    }
  }
  return complete
}
