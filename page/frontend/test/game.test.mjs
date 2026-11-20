import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

let server
let game
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  game = await server.ssrLoadModule('/src/game.ts')
})
after(async () => { await server?.close() })

function publicCard(size = 7) {
  const composition = {
    5: { emerald: 11, diamond: 3, apple: 1, totem: 2, tnt: 4, pearl: 1, shield: 2, spyglass: 1 },
    6: { emerald: 14, diamond: 4, apple: 2, totem: 3, tnt: 6, pearl: 1, shield: 3, spyglass: 3 },
    7: { emerald: 20, diamond: 6, apple: 2, totem: 4, tnt: 8, pearl: 1, shield: 4, spyglass: 4 },
  }[size]
  return {
    version: 2, size, cardId: 2, composition, counts: { ...composition },
    cells: Array.from({ length: size ** 2 }, (_, index) => ({ index, kind: null, by: null, at: null })),
    rules: { ...game.defaultRules, version: 2, difficulty: 'hard', boardSpec: 'random', compositionVariation: 'slight' },
    lastMove: null, stats: { digs: 0, players: 0 }, feed: [],
  }
}

test('all new sizes parse without changing the saved specification or composition', () => {
  for (const size of [5, 6, 7]) {
    const card = publicCard(size)
    assert.equal(game.readPublic(card), card)
    assert.equal(game.boardSize(card), size)
    assert.equal(game.cardComposition(card).pearl, 1)
    card.cells[size ** 2 - 1] = { index: size ** 2 - 1, kind: 'diamond', by: '玩家', actorKey: 'u:1', at: 1000 }
    card.counts.diamond--
    assert.ok(game.readPublic(card))
  }
})

test('a size mismatch or contradictory actual counts fails closed', () => {
  const card = publicCard()
  for (const invalid of [
    { ...card, size: 6 },
    { ...card, cells: card.cells.slice(0, 48) },
    { ...card, counts: { ...card.counts, pearl: 2 } },
    { ...card, composition: { ...card.composition, emerald: 19 } },
    { ...card, composition: { ...card.composition, shield: -1, emerald: 25 } },
    { ...card, counts: { ...card.counts, diamond: NaN } },
    { ...card, rules: { ...card.rules, difficulty: 'unknown' } },
    { ...card, rules: { ...card.rules, tntPercent: 101 } },
  ]) assert.equal(game.readPublic(invalid), null)
})

test('historical events keep the previous card size while the new board is smaller', () => {
  const card = publicCard(5)
  card.feed = [{ id: 1, actor: '玩家', actorKey: 'u:1', kind: 'pearl', text: '全体换卡', at: 1000, cardId: 1, index: 48, size: 7 }]
  card.lastMove = { actorKey: 'u:1', name: '玩家', at: 1000, cardId: 1, index: 48, size: 7 }
  assert.ok(game.readPublic(card))
  assert.equal(game.coordinate(48, card.feed[0].size), 'G7')
  assert.equal(game.coordinate(24, 5), 'E5')
  assert.equal(game.coordinate(35, 6), 'F6')
  assert.equal(game.coordinate(24), 'E5', 'v1 coordinates retain their five-column meaning')
  assert.equal(game.readPublic({ ...card, feed: [{ ...card.feed[0], size: 5 }] }), null)
  assert.equal(game.readPublic({ ...card, lastMove: { ...card.lastMove, index: 49 } }), null)
})

test('malformed events and metadata do not reach rendering', () => {
  const card = publicCard()
  assert.equal(game.readPublic({ ...card, feed: [null] }), null)
  assert.equal(game.readPublic({ ...card, lastMove: { actorKey: 'u:1', name: '玩家', at: Infinity, cardId: 1, size: 7, index: 0 } }), null)
  assert.equal(game.readPublic({ ...card, cells: card.cells.map((cell, index) => index === 0 ? { ...cell, by: 'secret' } : cell) }), null)
})

test('private v2 results retain old coordinates and validate spyglass kinds', () => {
  const own = { version: 2, actorKey: 'u:1', chances: 6, shield: false, peeks: [{ cardId: 2, index: 48, kind: 'diamond' }], digs: 1, status: 'playing', lastResult: { kind: 'pearl', cardId: 1, index: 48, size: 7, amount: 0, blocked: false, text: '全体换卡' } }
  assert.ok(game.readPrivate(own))
  assert.equal(game.readPrivate({ ...own, lastResult: { ...own.lastResult, size: 5 } }), null)
  assert.equal(game.readPrivate({ ...own, lastResult: { ...own.lastResult, amount: 0.1 } }), null)
  assert.equal(game.readPrivate({ ...own, peeks: [{ cardId: 2, index: 49, kind: 'diamond' }] }), null)
  assert.equal(game.readPrivate({ ...own, peeks: [{ cardId: 2, index: 0, kind: 'secret' }] }), null)
})

test('legacy rules, two pearls and private results stay compatible', () => {
  const card = publicCard(5)
  card.version = 1
  delete card.size
  delete card.composition
  card.counts.emerald = 10
  card.counts.pearl = 2
  card.rules = { ...game.defaultRules, initialChances: 3, tntPercent: 40 }
  assert.ok(game.readPublic(card))
  assert.equal(game.boardSize(card), 5)
  assert.equal(game.cardComposition(card).pearl, 2)
  assert.equal(game.readPublic({ ...card, size: 7 }), null, 'a legacy card cannot acquire a new coordinate system')
  assert.equal(game.rulesLabel(card.rules), '经典规则')
  const own = { version: 1, actorKey: 'u:1', chances: 2, shield: false, peeks: [], digs: 1, status: 'playing', lastResult: { kind: 'diamond', cardId: 1, index: 24, amount: 50, blocked: false, text: '大奖' } }
  assert.ok(game.readPrivate(own))
})

test('effective custom numbers are displayed without reapplying a difficulty preset', () => {
  const rules = { ...game.defaultRules, difficulty: 'hell', compositionVariation: 'slight' }
  assert.equal(game.rulesLabel(rules), '地狱 · 已自定义')
  assert.equal(rules.initialChances, 7)
  assert.equal(rules.tntPercent, 25)
  assert.equal(game.rulesLabel({ ...rules, initialChances: 4, tntPercent: 75 }), '地狱')
  assert.equal(game.rulesLabel({ ...rules, difficulty: 'easy', initialChances: 9, tntPercent: 15, compositionVariation: 'fixed' }), '简单')
  assert.equal(game.rulesLabel({ ...rules, difficulty: 'hard' }), '困难')
})

test('a golden apple cap in the rules parses; a zero or broken one fails closed', () => {
  const card = publicCard()
  const capped = { ...card, rules: { ...card.rules, appleCap: 30 } }
  assert.equal(game.readPublic(capped)?.rules.appleCap, 30)
  assert.equal(game.readPublic(card)?.rules.appleCap, undefined)
  for (const appleCap of [0, -1, 1.5, '30']) assert.equal(game.readPublic({ ...card, rules: { ...card.rules, appleCap } }), null)
})
