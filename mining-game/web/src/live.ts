// 推送、整局、单张卡怎么放进网页手上的整局（docs/V3_MAP.md §7）：纯函数，state.ts 和测试共用。
//
// 开格子只增不减，所以格子不管先后、不管序号接不接得上，先放上去（看得见），放过的不再放；
// 序号、动态、奖池、统计按序号一条条接，接不上的留在 ahead 里，等推送晚到的那条或者
// 找游戏站按序号补（GET /since）。手上的整局从不往回退：比手上旧的整局不要。
import type { FeedItem, Kind, Live, LiveStep, PublicCard, PublicGame } from './types'

export interface Merge {
  game: PublicGame
  /** 这次新放上去的格子（别人挖的闪一下） */
  opened: { cardId: number; index: number; uid: number }[]
  /** 这次长出来的卡（一批里有几张时是最后一张）、挖出它的那一格和谁挖的 */
  grown: { cardId: number; from: { cardId: number; index: number }; uid: number } | null
}

/**
 * 推送里的一段文字是哪几条：游戏站攒 100 毫秒发一次，第 2 版是一个数组（按序号）；
 * 单独一条的（以前的、回放里的）也认。看不懂的不要。
 */
export function liveMessages(text: string): Live[] {
  try {
    const data: unknown = JSON.parse(text)
    const list = Array.isArray(data) ? data : [data]
    return list.filter((item): item is Live => typeof item === 'object' && item !== null && typeof (item as { type?: unknown }).type === 'string')
  } catch {
    return []
  }
}

/** 一张卡开了几格。 */
export function openedCount(card: PublicCard) {
  let count = 0
  for (const cell of card.cells) if (cell) count += 1
  return count
}

/** 挖完了没有：不能挖的格子（装饰、宝库、开局的岩浆）不算；监守者醒了也算挖完。 */
export function finishedOf(card: Pick<PublicCard, 'fixed' | 'closed'>, cells: PublicCard['cells']) {
  return !!card.closed || cells.every((cell, index) => cell !== null || !!card.fixed?.[index])
}

/** 火把、宝库、噪音、关没关：整局里这些变了也要换成新的那一份（card 推送没有序号，漏了只能靠整局补）。 */
function sameExtras(a: PublicCard, b: PublicCard) {
  const extras = (card: PublicCard) => JSON.stringify([card.torches ?? null, card.vaults ?? null, card.noise ?? null, card.noiseAt ?? null, !!card.closed, card.wokeBy ?? null])
  return extras(a) === extras(b)
}

/**
 * 两份噪音取新的那份：会退的（有 noiseAt）按 noiseAt 取后来的，不能取大的；旧局的噪音只增不减，取大的。
 * 两份都没有（不是深暗之域）就什么也不给。
 */
export function newerNoise(before: Pick<PublicCard, 'noise' | 'noiseAt'>, after: Pick<PublicCard, 'noise' | 'noiseAt'>): Pick<PublicCard, 'noise' | 'noiseAt'> {
  if (after.noiseAt !== undefined || before.noiseAt !== undefined)
    return (after.noiseAt ?? -1) >= (before.noiseAt ?? -1) ? { noise: after.noise, noiseAt: after.noiseAt } : { noise: before.noise, noiseAt: before.noiseAt }
  if (after.noise === undefined && before.noise === undefined) return {}
  return { noise: Math.max(before.noise ?? 0, after.noise ?? 0) }
}

/** 两份同一张卡开的是不是同样那些格子。 */
function sameOpened(a: PublicCard, b: PublicCard) {
  return a.cells.length === b.cells.length && a.cells.every((cell, index) => !cell === !b.cells[index])
}

/** 动态里的一条：第 2 版推送里没有，由那一格拼出来。 */
export function feedOf(step: LiveStep): FeedItem {
  if (step.type === 'dig') return step.feed
  return {
    seq: step.seq, uid: step.cell.uid, name: step.cell.name, kind: step.cell.kind, cardId: step.cardId,
    index: step.index, text: step.text, at: step.cell.at, newCardId: step.newCard?.id ?? null,
  }
}

const FEED_LIMIT = 30

/** 接上一条：序号、奖池、统计、动态。 */
function advance(game: PublicGame, step: LiveStep): PublicGame {
  return {
    ...game, seq: step.seq, left: step.left, over: step.over, stats: step.stats,
    feed: [feedOf(step), ...game.feed].slice(0, FEED_LIMIT),
  }
}

/** 推送放进整局；ahead（接不上的那些）原地改。 */
export function mergeLive(game: PublicGame, ahead: Map<number, LiveStep>, messages: Live[]): Merge {
  let cards: PublicCard[] | null = null
  let positions: Map<number, number> | null = null
  const position = () => (positions ??= new Map(game.cards.map((card, at) => [card.id, at])))
  const find = (id: number) => {
    const at = position().get(id)
    return at === undefined ? undefined : (cards ?? game.cards)[at]
  }
  const put = (card: PublicCard) => {
    cards ??= game.cards.slice()
    const at = position().get(card.id)
    if (at === undefined) {
      position().set(card.id, cards.length)
      cards.push(card)
    } else cards[at] = card
  }
  const opened: Merge['opened'] = []
  let grown: Merge['grown'] = null

  /** 格子和新卡先放上去（放过的不再放）。 */
  const show = (step: LiveStep) => {
    const cardId = step.type === 'dig' ? step.feed.cardId : step.cardId
    const index = step.type === 'dig' ? step.feed.index : step.index
    const uid = step.type === 'dig' ? step.feed.uid : step.cell.uid
    const card = find(cardId)
    if (step.type === 'dig') {
      // 第 1 版带整张卡：比手上的新才换
      if (!card || openedCount(step.card) > openedCount(card)) {
        put(step.card)
        if (!card?.cells[index] && step.card.cells[index]) opened.push({ cardId, index, uid })
      }
    } else if (card && (!card.cells[index] || step.torches || step.burned || step.noise !== undefined || step.closed || step.vaults)) {
      const cells = card.cells.slice()
      const left = { ...card.left }
      const take = (kind: Kind) => {
        const count = left[kind]
        if (count !== undefined) left[kind] = Math.max(0, count - 1)
      }
      if (!cells[index]) {
        cells[index] = step.cell
        take(step.cell.kind)
        opened.push({ cardId, index, uid })
      }
      // 岩浆吞掉的格子：翻开给大家看一下
      for (const burned of step.burned ?? []) if (!cells[burned.index]) {
        cells[burned.index] = { kind: burned.kind, uid: 0, name: '', at: step.cell.at, burn: 1 }
        take(burned.kind)
        opened.push({ cardId, index: burned.index, uid: 0 })
      }
      const next = {
        ...card, cells, left,
        ...(step.torches ? { torches: step.torches } : {}),
        ...(step.vaults ? { vaults: step.vaults } : {}),
        ...(step.noise !== undefined ? newerNoise(card, step) : {}),
        ...(step.closed ? { closed: true } : {}),
        ...(step.wokeBy ? { wokeBy: step.wokeBy } : {}),
      }
      put({ ...next, finished: finishedOf(next, cells) })
    }
    if (step.newCard && !find(step.newCard.id)) {
      put(step.newCard)
      grown = { cardId: step.newCard.id, from: { cardId, index }, uid }
    }
  }

  let next = game
  for (const message of messages) {
    if (message.type === 'card') {
      // 火把、宝库变了：换成这一份，格子只增不减（这条可能比手上的格子晚）
      const card = find(message.card.id)
      put(card ? unionCard(card, message.card) : message.card)
      // 宝库开出的奖励也从奖池里出：剩下的跟着它（推送按先后到，用最新的）
      if (message.left !== undefined) next = { ...next, left: message.left, over: next.over || !!message.over }
      continue
    }
    if (message.type === 'claim') {
      next = { ...next, stats: message.stats }
      continue
    }
    // 不领的人被苦力怕炸了：炸掉的回到奖池（docs/V3_ITEMS.md §9）
    if (message.type === 'drain') {
      next = { ...next, left: message.left, over: next.over || message.over }
      continue
    }
    show(message)
    if (message.seq <= next.seq) continue
    if (message.seq > next.seq + 1) {
      ahead.set(message.seq, message)
      continue
    }
    next = advance(next, message)
    for (let step = ahead.get(next.seq + 1); step; step = ahead.get(next.seq + 1)) {
      ahead.delete(step.seq)
      next = advance(next, step)
    }
  }
  for (const seq of ahead.keys()) if (seq <= next.seq) ahead.delete(seq)
  return { game: { ...next, cards: cards ?? next.cards }, opened, grown }
}

/**
 * 整局（认人、补不上时）：比手上的旧就不要（null）；开的格子没变的卡沿用手上那一份
 * （同一个对象：卡不重画，整张地图的画布也不重画）；最后把 ahead 里比它新的再放上去。
 */
export function mergeState(current: PublicGame | null, next: PublicGame, ahead: Map<number, LiveStep>): Merge | null {
  if (current && next.seq < current.seq) return null
  const before = new Map(current?.cards.map(card => [card.id, card]))
  const cards = next.cards.map(card => {
    const kept = before.get(card.id)
    return kept && kept.finished === card.finished && sameOpened(kept, card) && sameExtras(kept, card) ? kept : card
  })
  const rest = [...ahead.values()].filter(step => step.seq > next.seq).sort((a, b) => a.seq - b.seq)
  ahead.clear()
  return mergeLive({ ...next, cards }, ahead, rest)
}

/**
 * 游戏站给的一张卡放到手上那张上：开的格子两边合起来（只增不减），剩下的数取少的，
 * 火把、宝库、噪音用游戏站这一份。
 */
export function unionCard(before: PublicCard, card: PublicCard): PublicCard {
  const cells = card.cells.map((cell, index) => cell ?? before.cells[index] ?? null)
  const left = { ...card.left }
  for (const [kind, count] of Object.entries(before.left)) {
    const key = kind as keyof typeof left
    if (count !== undefined && (left[key] === undefined || count < (left[key] as number))) left[key] = count
  }
  const next = { ...card, cells, left, ...newerNoise(before, card), closed: before.closed || card.closed, ...(card.wokeBy ?? before.wokeBy ? { wokeBy: card.wokeBy ?? before.wokeBy } : {}) }
  return { ...next, finished: card.finished || finishedOf(next, cells) }
}

/** 一张卡现在的样子（没挖成时游戏站给的）：开的格子合起来，火把、宝库用这一份。 */
export function mergeCard(game: PublicGame, card: PublicCard): Merge {
  const before = game.cards.find(item => item.id === card.id)
  if (before && openedCount(before) >= openedCount(card) && !card.torches && !card.vaults && card.noise === undefined) return { game, opened: [], grown: null }
  const merged = before ? unionCard(before, card) : card
  const cards = before ? game.cards.map(item => (item.id === card.id ? merged : item)) : [...game.cards, card]
  const opened = merged.cells.flatMap((cell, index) => (cell && !before?.cells[index] ? [{ cardId: card.id, index, uid: cell.uid }] : []))
  return { game: { ...game, cards }, opened, grown: null }
}
