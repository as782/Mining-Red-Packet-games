// 拿着对格子用的道具时（docs/V3_ITEMS.md §5）：点到、指到哪一格算哪里，那里能不能用、会怎样，
// 和真的用。地图（点格子、指着格子）和提示框里的“用”按钮共用。
import { atom } from 'jotai'
import type { Held } from './items'
import { cornerCells, cornerOf, diggable, dugCell, shapeCells, shapeOf, clampCenter, torchArea, vaultsLeft } from './items'
import { aimAtom, gameAtom, heldAtom, meAtom, store, toast, applyItem } from './state'
import type { Me, PublicCard, Torch } from './types'

/** 鼠标指着的火把（电脑上跟着指针的小提示说它的颜色） */
export const torchHoverAtom = atom<Torch | null>(null)

/** 这一局是第几版的道具规则（rules.items；第 2 版火把插在挖开的格子上，照 3×3）。 */
export const itemsVersion = () => store.get(gameAtom)?.rules.items ?? 0

const ROWS = 'ABCDEFG'
const cellName = (size: number, index: number) => `${ROWS[Math.floor(index / size)]}${(index % size) + 1}`

/** 预览：盖住哪几格、哪几格挖过要跳过、能不能用、说一句什么。 */
export interface AimInfo { cells: number[]; skip: number[]; ok: boolean; words: string }

/**
 * 点在第 index 格（qx、qy：点在这一格的右半、下半）时，道具放在哪：形状挪进卡里以后的中心、
 * 火把离得最近的那个角（返回角右下的格子）、望远镜和钥匙就是这一格。卡关了、挖完了是 null。
 */
export function anchorFor(held: Held, card: PublicCard, index: number, qx: 0 | 1, qy: 0 | 1, version = itemsVersion()): number | null {
  // 卡挖完了，宝库照样能用钥匙开
  if (card.closed || (card.finished && !(held === 'key' && vaultsLeft(card)))) return null
  const shape = shapeOf(held)
  if (shape) {
    const { row, col } = clampCenter(card.size, Math.floor(index / card.size), index % card.size, shape)
    return row * card.size + col
  }
  if (held === 'torch') return version >= 2 ? index : card.size < 2 ? null : cornerOf(card.size, index, qx, qy)
  return index
}

export function aimInfo(held: Held, card: PublicCard, at: number, me: Me | null, version = itemsVersion()): AimInfo {
  const shape = shapeOf(held)
  if (shape) {
    const cells = shapeCells(card.size, at, shape)
    const open = cells.filter(index => diggable(card, index))
    const skip = cells.filter(index => !diggable(card, index))
    if (open.length === 0) return { cells, skip, ok: false, words: '框里没有能挖的格子，换个地方' }
    return { cells, skip, ok: true, words: `挖开 ${open.length} 格${skip.length ? `，跳过 ${skip.length} 格挖过的` : ''}` }
  }
  if (held === 'torch' && version >= 2) {
    // 第 2 版：插在挖开的格子上，照亮周围 3×3
    const cells = torchArea(card.size, at)
    if (!dugCell(card, at)) return { cells: [at], skip: [], ok: false, words: `${cellName(card.size, at)} 还没挖开：火把只能插在挖开的格子上` }
    if (card.torches?.some(torch => torch.at === at)) return { cells, skip: [], ok: false, words: '这一格已经有火把了' }
    if (!cells.some(index => diggable(card, index))) return { cells, skip: [], ok: false, words: '周围的格子都挖开了，换个地方' }
    return { cells, skip: [], ok: true, words: `插在 ${cellName(card.size, at)}，照亮周围 9 格（大家都看得见）` }
  }
  if (held === 'torch') {
    const cells = cornerCells(card.size, at)
    if (card.torches?.some(torch => torch.at === at)) return { cells, skip: [], ok: false, words: '这里已经有火把了' }
    if (!cells.some(index => diggable(card, index))) return { cells, skip: [], ok: false, words: '这 4 格都挖开了，换个地方' }
    return { cells, skip: [], ok: true, words: '插在这里，照亮这 4 格（大家都看得见）' }
  }
  if (held === 'spyglass') {
    if (!diggable(card, at)) return { cells: [at], skip: [], ok: false, words: '这一格挖开了，换一格' }
    if (me?.peeks.some(peek => peek.cardId === card.id && peek.index === at)) return { cells: [at], skip: [], ok: false, words: '这一格你已经知道了，换一格' }
    return { cells: [at], skip: [], ok: true, words: '看看这一格里是什么，只有你看得见' }
  }
  // 钥匙：只能开宝库
  if (card.fixed?.[at] !== 'vault') return { cells: [at], skip: [], ok: false, words: '点宝库才能用钥匙' }
  if ((card.vaults?.[at] ?? 0) <= 0) return { cells: [at], skip: [], ok: false, words: '这个宝库开完了' }
  if (me?.vaultsOpened?.includes(`${card.id}:${at}`)) return { cells: [at], skip: [], ok: false, words: '这个宝库你开过了，每人只能开一次' }
  return { cells: [at], skip: [], ok: true, words: `开这个宝库（还能开 ${card.vaults?.[at]} 次）` }
}

/** 用在这里：不能用就说为什么；附魔镐、火把、望远镜、钥匙各自的接口。 */
export function applyAt(cardId: number, at: number) {
  const held = store.get(heldAtom)
  const card = store.get(gameAtom)?.cards.find(item => item.id === cardId)
  if (!held || !card) return
  const info = aimInfo(held, card, at, store.get(meAtom))
  if (!info.ok) {
    toast(info.words)
    return
  }
  void applyItem(held, { cardId, index: at })
}

/** 提示框里的“用”：用在现在预览的地方。 */
export function applyAtAim() {
  const aim = store.get(aimAtom)
  if (aim) applyAt(aim.cardId, aim.index)
}

/** 火把的颜色说什么。 */
export function torchWords(torch: Torch) {
  if (torch.v === 2) {
    const what = ['绿色：周围 9 格里没有危险', '黄色：周围 9 格里有 1～2 个危险', '橙色：周围 9 格里有 3～4 个危险', '红色：周围 9 格里有 5 个以上危险'][torch.level]
    return `${what}（TNT、末影水晶、刷怪笼，挖开的也算）${torch.name ? ` · ${torch.name} 插的` : ''}`
  }
  const what = torch.level === 0 ? '绿色：这 4 格里没有危险' : torch.level === 1 ? '黄色：这 4 格里有 1～2 个危险' : '红色：这 4 格里有 3～4 个危险'
  return `${what}（TNT、末影水晶、刷怪笼）${torch.name ? ` · ${torch.name} 插的` : ''}`
}
