import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// v3 的推送怎么放进整局（v3/src/live.ts）：先后颠倒、漏了、整局比手上旧，都不往回退、不重画没变的卡。
let server
let live
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  live = await server.ssrLoadModule('/v3/src/live.ts')
})
after(async () => { await server?.close() })

const stats = seq => ({ digs: seq, players: 1, claimed: 0, claimedPoints: 0 })
const card = (id, cells = Array(25).fill(null)) => ({ id, x: id, y: 0, size: 5, cells, left: { emerald: 25 }, finished: false })
const game = (cards = [card(1)], seq = 0) => ({ seq, rules: {}, pool: 1000, left: 1000, deadlineAt: null, wrapUpAt: null, over: false, stats: stats(seq), cards, feed: [] })
const step = (seq, index, fields = {}) => ({
  type: 'cell', seq, cardId: 1, index, cell: { kind: 'emerald', uid: 7, name: 'p', at: seq },
  newCard: null, text: '挖到了绿宝石', left: 1000 - seq, over: false, stats: stats(seq), ...fields,
})

test('按序号接上：格子放上去、剩下的数减一、动态多一条', () => {
  const ahead = new Map()
  const out = live.mergeLive(game(), ahead, [step(1, 0), step(2, 3)])
  assert.equal(out.game.seq, 2)
  assert.equal(out.game.cards[0].left.emerald, 23)
  assert.deepEqual(out.game.feed.map(item => [item.seq, item.index]), [[2, 3], [1, 0]])
  assert.deepEqual(out.opened.map(cell => cell.index), [0, 3])
  assert.equal(ahead.size, 0)
})

test('接不上的格子先放上去，序号等漏的那条到了再接；同一格不放两次', () => {
  const ahead = new Map()
  const first = live.mergeLive(game(), ahead, [step(2, 5)])
  assert.equal(first.game.seq, 0)
  assert.ok(first.game.cards[0].cells[5])
  assert.equal(ahead.size, 1)
  const second = live.mergeLive(first.game, ahead, [step(1, 0), step(2, 5)])
  assert.equal(second.game.seq, 2)
  assert.equal(ahead.size, 0)
  assert.deepEqual(second.opened.map(cell => cell.index), [0])
  assert.equal(second.game.cards[0].left.emerald, 23)
})

test('整局比手上的旧：不要；一样或新：没变的卡沿用手上那一份，ahead 里更新的再放上去', () => {
  const ahead = new Map()
  const now = live.mergeLive(game([card(1), card(2)]), ahead, [step(1, 0), step(3, 4)]).game
  assert.equal(now.seq, 1)
  assert.equal(live.mergeState(now, game([card(1), card(2)], 0), ahead), null)
  const cells = Array(25).fill(null)
  cells[0] = { kind: 'emerald', uid: 7, name: 'p', at: 1 }
  cells[2] = { kind: 'emerald', uid: 8, name: 'q', at: 2 }
  const snapshot = game([card(1, cells), card(2)], 2)
  const out = live.mergeState(now, snapshot, ahead)
  assert.equal(out.game.seq, 3)
  assert.equal(out.game.cards[1], now.cards[1])
  assert.ok(out.game.cards[0].cells[2] && out.game.cards[0].cells[4])
  assert.equal(ahead.size, 0)
})

test('新卡长出来一次；第 1 版推送（整张卡）比手上旧时不换', () => {
  const ahead = new Map()
  const out = live.mergeLive(game(), ahead, [step(1, 0, { cell: { kind: 'pearl', uid: 7, name: 'p', at: 1 }, newCard: card(2) })])
  assert.deepEqual(out.grown, { cardId: 2, from: { cardId: 1, index: 0 }, uid: 7 })
  const again = live.mergeLive(out.game, ahead, [step(1, 0, { newCard: card(2) })])
  assert.equal(again.grown, null)
  const newer = out.game.cards[0]
  const stale = { type: 'dig', seq: 1, card: card(1), newCard: null, feed: { seq: 1, uid: 7, name: 'p', kind: 'emerald', cardId: 1, index: 0, text: '', at: 1, newCardId: null }, left: 0, over: false, stats: stats(1) }
  assert.equal(live.mergeLive(out.game, ahead, [stale]).game.cards[0], newer)
})

test('推送：游戏站攒着发的数组拆成一条条，单独一条也认，看不懂的不要', () => {
  assert.deepEqual(live.liveMessages(JSON.stringify([step(1, 0), step(2, 3)])).map(item => item.seq), [1, 2])
  assert.equal(live.liveMessages(JSON.stringify(step(4, 1)))[0].seq, 4)
  assert.deepEqual(live.liveMessages(JSON.stringify([{ type: 'claim', name: 'p', points: 1, stats: stats(0) }, 3, null])).map(item => item.type), ['claim'])
  assert.deepEqual(live.liveMessages('{'), [])
})

test('没挖成时游戏站给的卡：开得多才换', () => {
  const cells = Array(25).fill(null)
  cells[9] = { kind: 'tnt', uid: 8, name: 'q', at: 1 }
  const now = game()
  const out = live.mergeCard(now, card(1, cells))
  assert.ok(out.game.cards[0].cells[9])
  assert.deepEqual(out.opened, [{ cardId: 1, index: 9, uid: 8 }])
  assert.equal(live.mergeCard(out.game, card(1)).game, out.game)
})
