import type { PublicCard, RailShape } from './types'

// 区块里固定格子画成什么样（docs/V3_ITEMS.md §10）：铁轨每一格的贴图和方向、试炼密室正中的铜灯、
// 深暗之域石头上爬着的幽匿块。纯函数，地图画布（paint.ts）和整张地图的低清位图（thumb.ts）共用。

/** 原版的 rail 是南北向的直道、rail_corner 连着南和东；顺时针转多少度得到每一种。 */
export const RAIL_TEXTURE: Record<RailShape, { corner: boolean; turn: 0 | 90 | 180 | 270 }> = {
  ns: { corner: false, turn: 0 }, ew: { corner: false, turn: 90 },
  se: { corner: true, turn: 0 }, sw: { corner: true, turn: 90 }, nw: { corner: true, turn: 180 }, ne: { corner: true, turn: 270 },
}

/** 这一格是铁轨的话是什么形状：新局按游戏站给的；以前开的局是第 3 行中间横着的 4 格。 */
export function railOf(card: Pick<PublicCard, 'kind' | 'fixed' | 'rails'>, index: number): RailShape | null {
  if (card.kind !== 'mine' || card.fixed?.[index] !== 'deco') return null
  return card.rails?.[index] ?? 'ew'
}

/** 试炼密室正中那一格是装饰时放铜灯（亮的），别的装饰是雕纹凝灰岩。 */
export const isBulb = (card: Pick<PublicCard, 'kind' | 'size' | 'fixed'>, index: number) =>
  card.kind === 'trial' && card.fixed?.[index] === 'deco' && index === (card.size * card.size - 1) / 2

const sculkCache = new Map<number, Map<number, number>>()
/**
 * 深暗之域：没挖的格子里一两串连着的格子换成幽匿块的贴图，像藤蔓一样（只是样子，和下面藏着什么无关）；
 * 按卡号定，谁看都一样。值是用幽匿块动画的第几帧（0～3，看着不那么整齐）。
 */
export function sculkOf(card: Pick<PublicCard, 'id' | 'kind' | 'size' | 'fixed'>): Map<number, number> {
  if (card.kind !== 'deep') return NONE
  const cached = sculkCache.get(card.id)
  if (cached) return cached
  let seed = (card.id * 2654435761) >>> 0
  const next = () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (low: number, high: number) => low + Math.floor(next() * (high - low + 1))
  const size = card.size
  const cells = new Map<number, number>()
  for (let vine = int(1, 2); vine > 0; vine--) {
    let r = int(0, size - 1)
    let c = int(0, size - 1)
    for (let step = int(4, 7); step > 0; step--) {
      const index = r * size + c
      if (!card.fixed?.[index]) cells.set(index, int(0, 3))
      const [dr, dc] = [[0, 1], [1, 0], [0, -1], [-1, 0]][int(0, 3)]
      r = Math.min(size - 1, Math.max(0, r + dr))
      c = Math.min(size - 1, Math.max(0, c + dc))
    }
  }
  sculkCache.set(card.id, cells)
  return cells
}
const NONE = new Map<number, number>()
