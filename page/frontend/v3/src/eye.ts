import type { PublicCard } from './types'

// 末影之眼和它开出来的特殊区块（docs/V3_MAP.md §5、docs/V3_ITEMS.md §17）：每第 eyeEvery 张普通卡藏一颗眼，
// 挖到它远处开出一张特殊区块（以前开的局只有末地宝藏；2026-11-12 起开的局是末地宝藏、深暗之域或下界）。
// 底栏的一行和 JP 提示都看这里。

export type EyeStatus =
  /** 这一局不开末影之眼（参数 0，或开局时还没有这个参数） */
  | { kind: 'off' }
  /** 有特殊区块还没挖完：最要紧，先说它（最新开的那张） */
  | { kind: 'special'; card: PublicCard }
  /** 有一颗眼还没挖到 */
  | { kind: 'eye'; card: PublicCard }
  /** 再长几张普通卡出下一颗眼 */
  | { kind: 'coming'; cards: number }

export const isTreasure = (card: Pick<PublicCard, 'kind'>) => card.kind === 'end'
/** 末影之眼开出来的特殊区块：末地宝藏一直是；新局的深暗之域、下界带 fromEye（旧局的是末影珍珠长的，不算） */
export const isSpecial = (card: Pick<PublicCard, 'kind' | 'fromEye'>) => card.kind === 'end' || !!card.fromEye
/** 还开着的特殊区块（没挖完，深暗之域没关） */
export const openSpecial = (card: PublicCard) => isSpecial(card) && !card.finished && !card.closed

/** 离 (x, y) 最近的还开着的特殊区块（JP 指它）；一样近取新开的 */
export function nearestSpecial(cards: PublicCard[], x: number, y: number) {
  let best: PublicCard | null = null
  let far = Infinity
  for (const card of cards) {
    if (!openSpecial(card)) continue
    const distance = (card.x - x) ** 2 + (card.y - y) ** 2
    if (distance <= far) {
      best = card
      far = distance
    }
  }
  return best
}

/** 末影水晶扣还没领的奖励的百分之几：TNT 的两倍，最多 100（和 game/shared/rules.mjs 一样）。 */
export const crystalPercent = (rules: { tntPercent: number }) => Math.min(100, rules.tntPercent * 2)

export function eyeStatus(cards: PublicCard[], eyeEvery: number | undefined): EyeStatus {
  if (!eyeEvery) return { kind: 'off' }
  const special = [...cards].reverse().find(openSpecial)
  if (special) return { kind: 'special', card: special }
  const eye = cards.find(card => !isSpecial(card) && (card.left.eye ?? 0) > 0)
  if (eye) return { kind: 'eye', card: eye }
  const normal = cards.filter(card => !isSpecial(card)).length
  return { kind: 'coming', cards: eyeEvery - (normal % eyeEvery) }
}
