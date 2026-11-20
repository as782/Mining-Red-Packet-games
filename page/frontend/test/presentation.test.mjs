import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

let server
let createPresentationController

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  ;({ createPresentationController } = await server.ssrLoadModule('/src/presentation.ts'))
})

after(async () => { await server?.close() })

function board({ cardId = 1, digs = 0, cells = [], feed = [], lastMove = null } = {}) {
  return {
    version: 1,
    cardId,
    cells: Array.from({ length: 25 }, (_, index) => ({ index, kind: null, by: null, at: null, ...cells.find(cell => cell.index === index) })),
    counts: { emerald: 10, diamond: 3, apple: 1, totem: 2, tnt: 4, pearl: 2, shield: 2, spyglass: 1 },
    rules: { initialChances: 7, waitSeconds: 10, smallReward: 10, bigMultiplier: 5, totemBonus: 3, tntPercent: 25 },
    lastMove,
    stats: { digs, players: digs ? 1 : 0 },
    feed,
  }
}

function sizedBoard(size, options = {}) {
  const legacy = board(options)
  return { ...legacy, version: 2, size, cells: Array.from({ length: size ** 2 }, (_, index) => ({ index, kind: null, by: null, at: null, ...options.cells?.find(cell => cell.index === index) })), rules: { ...legacy.rules, version: 2, difficulty: 'hard', boardSpec: 'random', compositionVariation: 'slight' } }
}

function own(overrides = {}) {
  return { version: 1, actorKey: 'u:1', chances: 7, shield: false, peeks: [], digs: 0, status: 'playing', lastResult: null, ...overrides }
}

function me(overrides = {}) {
  return { signedIn: true, name: '小明', open: true, cooldownUntil: null, claim: null, registered: false, pending: '0.00', settled: false, ...overrides }
}

function move({ id = 1, actor = '小明', actorKey = 'u:1', cardId = 1, index = 0, kind = 'diamond', at = 1000 } = {}) {
  return {
    feed: { id, actor, kind, text: `挖到了 ${kind}`, at, cardId, index },
    lastMove: { actorKey, name: actor, at, cardId, index },
    cell: { index, kind, by: actor, at, actorKey },
  }
}

function harness(initial = {}) {
  let now = 0
  let nextHandle = 0
  const tasks = new Map()
  const updates = []
  const controller = createPresentationController({
    onChange: snapshot => updates.push(snapshot),
    schedule: (callback, delay) => { const handle = ++nextHandle; tasks.set(handle, { callback, at: now + delay }); return handle },
    cancel: handle => tasks.delete(handle),
  })
  controller.receive({ game: board(), own: own(), me: me(), ...initial })
  function step() {
    const next = [...tasks.entries()].sort((left, right) => left[1].at - right[1].at)[0]
    assert.ok(next, 'an animation timer is scheduled')
    tasks.delete(next[0])
    now = next[1].at
    next[1].callback()
    return controller.getSnapshot()
  }
  function finish() {
    let guard = 20
    while (tasks.size && guard-- > 0) step()
    assert.ok(guard > 0, 'presentation queue finishes in bounded time')
    return controller.getSnapshot()
  }
  return { controller, step, finish, tasks, updates, time: () => now, get: () => controller.getSnapshot() }
}

test('the final dig waits for the enlarged showcase to land before updating its tile and money', () => {
  const h = harness({ own: own({ chances: 1 }), me: me({ pending: '0.20' }) })
  const result = move()
  assert.equal(h.controller.begin('dig 1 1'), true)
  h.controller.receive({ game: board({ digs: 1, cells: [result.cell], feed: [result.feed], lastMove: result.lastMove }) })
  h.controller.receive({ own: own({ chances: 0, digs: 1, status: 'settled', lastResult: { kind: 'diamond', cardId: 1, index: 0, amount: 50, blocked: false, text: '钻石大奖 +0.50' } }) })
  h.controller.receive({ me: me({ open: false, pending: '0.00', settled: true, claim: { amount: '0.70', unit: 'LDC', payment: 'paid' } }) })
  assert.equal(h.get().game.cells[0].kind, null)
  assert.equal(h.get().own.chances, 1)
  assert.equal(h.get().me.settled, false)
  h.controller.complete('dig 1 1')
  assert.equal(h.get().phase, 'reveal')
  assert.equal(h.get().effect.amountDelta, 50)
  assert.equal(h.get().effect.chanceDelta, -1)
  assert.equal(h.get().effect.isOwn, true)
  assert.equal(h.controller.begin('cashout'), false)
  assert.equal(h.step().phase, 'effect')
  const showcaseStarted = h.time()
  assert.equal(h.get().game.cells[0].kind, null, 'the board waits while the large item explains the effect')
  assert.equal(h.get().me.pending, '0.20')
  assert.equal(h.step().phase, 'transfer')
  assert.ok(h.time() - showcaseStarted >= 1200, 'the explanation has a readable hold')
  assert.equal(h.get().own.chances, 1, 'the icon is still in flight')
  assert.equal(h.get().me.pending, '0.20')
  assert.equal(h.get().game.cells[0].kind, null)
  assert.equal(h.step().phase, 'resolve')
  assert.equal(h.get().game.cells[0].kind, 'diamond')
  assert.equal(h.get().own.chances, 0)
  assert.equal(h.get().me.claim.amount, '0.70')
  assert.equal(h.get().busy, true, 'settlement UI can wait until the sequence is idle')
  assert.equal(h.finish().busy, false)
  assert.equal(h.get().phase, 'idle')
})

test('the last pickaxe gains three opportunities after the paired-pickaxe showcase lands', () => {
  const h = harness({ own: own({ chances: 1 }) })
  const result = move({ kind: 'totem' })
  result.feed.text = '双铁镐增加了 3 次机会'
  assert.equal(h.controller.begin('dig 1 1'), true)
  h.controller.receive({
    game: board({ digs: 1, cells: [result.cell], feed: [result.feed], lastMove: result.lastMove }),
    own: own({ chances: 3, digs: 1, lastResult: { kind: 'totem', cardId: 1, index: 0, amount: 0, blocked: false, text: '双铁镐！机会 +3' } }),
  })
  assert.equal(h.get().own.chances, 1)
  h.controller.complete('dig 1 1')
  assert.equal(h.get().effect.chanceDelta, 2, 'one opportunity is spent before the three are awarded')
  assert.equal(h.get().effect.text, '双铁镐！机会 +3')
  assert.equal(h.step().phase, 'effect')
  assert.equal(h.get().own.chances, 1)
  assert.equal(h.step().phase, 'transfer')
  assert.equal(h.get().own.chances, 1, 'the counter waits until the icon lands')
  const final = h.finish()
  assert.equal(final.own.chances, 3)
  assert.equal(final.own.status, 'playing')
  assert.equal(final.busy, false)
})

test('a pearl reveals the confirmed old tile before replacing the board', () => {
  const h = harness()
  const result = move({ kind: 'pearl', index: 12 })
  h.controller.begin('dig 1 13')
  h.controller.receive({
    game: board({ cardId: 2, digs: 1, feed: [result.feed], lastMove: result.lastMove }),
    own: own({ chances: 6, digs: 1, lastResult: { kind: 'pearl', cardId: 1, index: 12, amount: 0, blocked: false, text: '末影珍珠！全体换卡' } }),
    me: me(),
  })
  h.controller.complete('dig 1 13')
  assert.equal(h.get().game.cardId, 1)
  assert.equal(h.get().effect.kind, 'pearl')
  assert.equal(h.step().game.cells[12].kind, null)
  assert.equal(h.step().game.cardId, 1, 'money transfer still displays the old board')
  assert.equal(h.step().game.cells[12].kind, 'pearl', 'the pearl lands on the old card first')
  assert.equal(h.step().phase, 'transition')
  assert.equal(h.get().game.cardId, 2)
  assert.equal(h.get().transitionFrom.cardId, 1)
  assert.equal(h.get().transitionFrom.cells[12].kind, 'pearl', 'old faces remain available throughout each staggered flip')
  assert.ok(h.get().game.cells.every(cell => cell.kind === null))
  assert.equal(h.finish().effect, null)
  assert.equal(h.get().transitionFrom, null)
})

test('a late next-card public packet flips once without replaying a resolved private pearl', () => {
  const h = harness()
  const result = move({ kind: 'pearl', index: 12 })
  h.controller.receive({ own: own({ chances: 6, digs: 1, lastResult: { kind: 'pearl', cardId: 1, index: 12, amount: 0, blocked: false, text: '末影珍珠！全体换卡' } }) })
  h.finish()
  assert.equal(h.get().game.cardId, 1)
  assert.equal(h.get().game.cells[12].kind, 'pearl')
  const updatesBeforePublic = h.updates.length
  const publicGame = board({ cardId: 2, digs: 1, feed: [result.feed], lastMove: result.lastMove })
  h.controller.receive({ game: publicGame })
  assert.equal(h.get().phase, 'transition', 'the delayed board starts directly at the flip')
  assert.equal(h.get().transitionFrom.cells[12].kind, 'pearl')
  assert.equal(h.get().game.cardId, 2)
  assert.equal(h.get().own.chances, 6, 'the opportunity is spent only once')
  h.finish()
  h.controller.receive({ game: publicGame })
  assert.equal(h.get().phase, 'idle')
  assert.equal(h.get().transitionFrom, null)
  assert.ok(h.updates.slice(updatesBeforePublic).every(update => update.phase === 'transition' || update.phase === 'idle'), 'no second showcase or reward flight')
})

test('spyglass keeps the new private target hidden until its flight lands', () => {
  const h = harness()
  const result = move({ kind: 'spyglass', index: 7 })
  h.controller.receive({ game: board({ digs: 1, cells: [result.cell], feed: [result.feed], lastMove: result.lastMove }) })
  assert.equal(h.get().effect.targetIndex, null, 'a public event has no private target')
  h.controller.receive({ own: own({ chances: 6, digs: 1, peeks: [{ cardId: 1, index: 18, kind: 'emerald' }], lastResult: { kind: 'spyglass', cardId: 1, index: 7, amount: 0, blocked: false, text: '望远镜情报' } }) })
  assert.equal(h.get().effect.targetIndex, 18)
  h.step()
  assert.deepEqual(h.get().own.peeks, [])
  h.step()
  assert.deepEqual(h.get().own.peeks, [], 'the target tile waits throughout transfer')
  h.step()
  assert.equal(h.get().own.peeks[0].index, 18)
  h.finish()
})

test('failed attempts do not reanimate a previous reward or guess hidden kinds', () => {
  const prior = move()
  const initial = board({ digs: 1, cells: [prior.cell], feed: [prior.feed], lastMove: prior.lastMove })
  const miner = own({ chances: 6, digs: 1, lastResult: { kind: 'diamond', cardId: 1, index: 0, amount: 50, blocked: false, text: '钻石大奖' } })
  const h = harness({ game: initial, own: miner, me: me({ pending: '0.50' }) })
  assert.equal(h.get().phase, 'idle', 'initial feed history is never replayed')
  h.controller.begin('dig 1 1')
  h.controller.receive({ game: initial, own: miner, me: me({ pending: '0.50' }) })
  h.controller.complete('dig 1 1')
  assert.equal(h.get().effect, null)
  assert.equal(h.get().me.pending, '0.50')
  assert.equal(h.tasks.size, 0)
  h.controller.receive({ game: board({ cardId: 2, digs: 2 }) })
  assert.equal(h.get().game.cardId, 2)
  assert.equal(h.get().effect, null, 'a card change without lastMove/feed evidence has no invented pearl')
  assert.ok(h.get().game.cells.every(cell => cell.kind === null))
})

test('peer pearls use public lastMove/feed evidence and never expose private estimates', () => {
  const h = harness()
  const peer = move({ actor: '小红', actorKey: 'u:2', kind: 'pearl', index: 8 })
  h.controller.receive({ game: board({ cardId: 2, digs: 1, feed: [peer.feed], lastMove: peer.lastMove }) })
  assert.equal(h.get().phase, 'resolve')
  assert.equal(h.get().effect.kind, 'pearl')
  assert.equal(h.get().effect.isOwn, false)
  assert.equal(h.get().effect.amountDelta, 0)
  assert.equal(h.get().effect.chanceDelta, 0)
  assert.equal(h.get().effect.actor, '小红')
  assert.equal(h.get().game.cells[8].kind, 'pearl')
  assert.equal(h.get().game.cells.filter(cell => cell.kind !== null).length, 1)
  assert.equal(h.step().phase, 'transition')
  assert.equal(h.get().transitionFrom.cells[8].kind, 'pearl')
  assert.equal(h.get().effect.actor, '小红')
  assert.equal(h.finish().game.cardId, 2)
  assert.ok(h.updates.every(update => update.effect?.isOwn || !['effect', 'transfer'].includes(update.phase)))
})

test('a peer with the same displayed name is never classified as the current player', () => {
  const h = harness({ own: null })
  const peer = move({ actor: '小明', actorKey: 'u:2' })
  h.controller.receive({ game: board({ digs: 1, cells: [peer.cell], feed: [peer.feed], lastMove: peer.lastMove }) })
  assert.equal(h.get().effect.isOwn, false)
  assert.equal(h.get().effect.amountDelta, 0)
  assert.equal(h.get().busy, false)
})

test('separate private SDK packets enrich a confirmed reveal before committing balances', () => {
  const h = harness({ me: me({ pending: '1.00' }), own: own({ shield: true }) })
  const blocked = move({ kind: 'tnt' })
  h.controller.receive({ game: board({ digs: 1, cells: [blocked.cell], feed: [blocked.feed], lastMove: blocked.lastMove }) })
  assert.equal(h.get().phase, 'reveal')
  h.controller.receive({ own: own({ chances: 6, shield: false, digs: 1, lastResult: { kind: 'tnt', cardId: 1, index: 0, amount: 0, blocked: true, text: '盾牌挡住了 TNT' } }) })
  h.controller.receive({ me: me({ pending: '1.00' }) })
  assert.equal(h.get().effect.blocked, true)
  assert.equal(h.get().effect.amountDelta, 0)
  assert.equal(h.get().effect.chanceDelta, -1)
  assert.equal(h.get().own.shield, true)
  h.step()
  assert.equal(h.get().own.shield, true)
  h.step()
  assert.equal(h.get().own.shield, true, 'the HUD is unchanged during flight')
  h.step()
  assert.equal(h.get().own.shield, false)
  assert.equal(h.finish().own.digs, 1)
  h.controller.receive({ own: own({ shield: true }) })
  assert.equal(h.get().own.digs, 1, 'an older private packet cannot undo the confirmed dig')
})

test('me-first and private-first packets preserve the old HUD and board until the flight lands', () => {
  const h = harness({ own: null })
  const result = move()
  const confirmedOwn = own({ chances: 6, digs: 1, lastResult: { kind: 'diamond', cardId: 1, index: 0, amount: 50, blocked: false, text: '钻石大奖 +0.50' } })
  h.controller.receive({ me: me({ pending: '0.50' }) })
  assert.equal(h.get().me.pending, '0.00')
  assert.equal(h.get().phase, 'idle')
  assert.equal(h.get().busy, true, 'a financial packet waits for proof or a coherent refresh')
  h.controller.receive({ own: confirmedOwn })
  assert.equal(h.get().phase, 'reveal')
  assert.equal(h.get().effect.amountDelta, 50)
  assert.equal(h.get().effect.chanceDelta, -1, 'the first dig uses the public initialChances baseline')
  assert.equal(h.get().own, null)
  assert.equal(h.get().me.pending, '0.00')
  h.step()
  assert.equal(h.get().game.cells[0].kind, null)
  assert.equal(h.get().game.stats.digs, 0, 'a private result does not invent public counters')
  assert.equal(h.get().game.cells.filter(cell => cell.kind !== null).length, 0)
  h.controller.receive({ game: board({ digs: 1, cells: [result.cell], feed: [result.feed], lastMove: result.lastMove }) })
  assert.equal(h.get().own, null)
  assert.equal(h.get().me.pending, '0.00')
  h.step()
  assert.equal(h.get().phase, 'transfer')
  assert.equal(h.get().own, null)
  assert.equal(h.get().me.pending, '0.00')
  h.step()
  assert.equal(h.get().phase, 'resolve')
  assert.equal(h.get().game.stats.digs, 1, 'the delayed public packet enriches the current target')
  assert.equal(h.get().own.chances, 6)
  assert.equal(h.get().me.pending, '0.50')
  h.finish()
  assert.equal(new Set(h.updates.flatMap(snapshot => snapshot.effect ? [snapshot.effect.id] : [])).size, 1)
})

test('a public packet arriving after a private-led sequence preserves its known tile without replay', () => {
  const h = harness({ me: me({ pending: '1.00' }) })
  const result = move({ kind: 'tnt' })
  h.controller.receive({ own: own({ chances: 6, digs: 1, lastResult: { kind: 'tnt', cardId: 1, index: 0, amount: -25, blocked: false, text: 'TNT -0.25' } }) })
  assert.equal(h.get().phase, 'reveal')
  assert.equal(h.get().effect.amountDelta, -25)
  assert.equal(h.get().own.chances, 7)
  h.controller.receive({ me: me({ pending: '0.75' }) })
  assert.equal(h.get().me.pending, '1.00')
  h.finish()
  assert.equal(h.get().game.cells[0].kind, 'tnt')
  assert.equal(h.get().game.stats.digs, 0)
  assert.equal(h.get().own.chances, 6)
  assert.equal(h.get().me.pending, '0.75')
  h.controller.receive({ game: board({ digs: 1, cells: [result.cell], feed: [result.feed], lastMove: result.lastMove }) })
  assert.equal(h.get().game.stats.digs, 1)
  assert.equal(h.get().game.cells[0].kind, 'tnt')
  assert.equal(h.get().phase, 'idle')
  assert.equal(h.tasks.size, 0)
  assert.equal(new Set(h.updates.flatMap(snapshot => snapshot.effect ? [snapshot.effect.id] : [])).size, 1)
})

test('a coherent terminal refresh releases a staged me packet and any peer decoration', () => {
  const h = harness({ me: me({ pending: '1.00' }) })
  const peer = move({ actor: '小红', actorKey: 'u:2' })
  const publicBoard = board({ digs: 1, cells: [peer.cell], feed: [peer.feed], lastMove: peer.lastMove })
  h.controller.receive({ game: publicBoard })
  const settledMe = me({ pending: '0.00', settled: true, open: false, claim: { amount: '1.00', unit: 'LDC', payment: 'paid' } })
  h.controller.receive({ me: settledMe })
  assert.equal(h.get().me.settled, false)
  assert.equal(h.get().busy, true)
  h.controller.receive({ game: publicBoard, own: own({ status: 'settled' }), me: settledMe })
  assert.equal(h.get().me.settled, true)
  assert.equal(h.get().own.status, 'settled')
  assert.equal(h.get().phase, 'idle')
  assert.equal(h.get().busy, false)
  assert.equal(h.tasks.size, 0)
})

test('eleven continuous peer updates never prevent a local action from taking priority', () => {
  const h = harness()
  const moves = []
  for (let index = 0; index < 11; index++) {
    const peer = move({ id: index + 1, actor: `peer${index}`, actorKey: `u:${index + 2}`, index, kind: 'emerald', at: 1000 + index })
    moves.push(peer)
    h.controller.receive({ game: board({ digs: index + 1, cells: moves.map(item => item.cell), feed: moves.map(item => item.feed).reverse(), lastMove: peer.lastMove }) })
    assert.equal(h.get().busy, false, 'peer presentation does not lock local controls')
    assert.ok(h.get().queued <= 1)
  }
  assert.equal(h.controller.begin('dig 1 25'), true)
  assert.equal(h.get().game.stats.digs, 11, 'begin flushes directly to the newest authoritative board')
  assert.equal(h.get().game.cells.filter(cell => cell.kind !== null).length, 11)
  assert.equal(h.get().phase, 'idle')
  assert.equal(h.get().busy, true)
  assert.equal(h.tasks.size, 0, 'the interrupted peer timer is canceled')
  h.controller.complete('dig 1 25')
  assert.equal(h.get().busy, false)
  assert.equal(h.get().effect, null)
})

test('a mismatched old-card feed cannot fabricate a peer pearl', () => {
  const h = harness()
  const peer = move({ actor: '小红', actorKey: 'u:2', kind: 'pearl', index: 8 })
  h.controller.receive({ game: board({ cardId: 2, digs: 1, feed: [{ ...peer.feed, at: 999 }], lastMove: peer.lastMove }) })
  assert.equal(h.get().phase, 'idle')
  assert.equal(h.get().game.cardId, 2)
  assert.equal(h.get().effect, null)
  assert.equal(h.tasks.size, 0)
})

test('rapid peer packets coalesce, ignore stale boards and finish in reduced motion', () => {
  const h = harness()
  h.controller.setReducedMotion(true)
  const first = move({ actor: '小红', actorKey: 'u:2', index: 0, kind: 'emerald' })
  const second = move({ id: 2, actor: '小蓝', actorKey: 'u:3', index: 1, kind: 'tnt', at: 2000 })
  const third = move({ id: 3, actor: '小绿', actorKey: 'u:4', index: 2, kind: 'totem', at: 3000 })
  const firstBoard = board({ digs: 1, cells: [first.cell], feed: [first.feed], lastMove: first.lastMove })
  h.controller.receive({ game: firstBoard })
  h.controller.receive({ game: board({ digs: 2, cells: [first.cell, second.cell], feed: [second.feed, first.feed], lastMove: second.lastMove }) })
  h.controller.receive({ game: board({ digs: 3, cells: [first.cell, second.cell, third.cell], feed: [third.feed, second.feed, first.feed], lastMove: third.lastMove }) })
  assert.ok(h.get().queued <= 1)
  h.controller.receive({ game: firstBoard })
  const final = h.finish()
  assert.equal(final.game.stats.digs, 3)
  assert.equal(final.game.cells[1].kind, 'tnt')
  assert.equal(final.game.cells[2].kind, 'totem')
  assert.equal(final.busy, false)
  assert.equal(final.queued, 0)
  assert.ok(h.time() <= 600, `remote reveals finish without enlarged showcases: ${h.time()} ms`)
  assert.ok(h.updates.every(update => !['effect', 'transfer'].includes(update.phase)))
  const effectIds = new Set(h.updates.flatMap(snapshot => snapshot.effect ? [snapshot.effect.id] : []))
  assert.equal(effectIds.size, 2, 'the middle packet is coalesced instead of building an unbounded replay queue')
  h.controller.receive({ game: firstBoard })
  assert.equal(h.get().game.stats.digs, 3)
  assert.equal(h.tasks.size, 0)
})

test('switching to reduced motion shortens the current phase and disposal cancels callbacks', () => {
  const h = harness()
  const peer = move({ actor: '小红', actorKey: 'u:2' })
  h.controller.receive({ game: board({ digs: 1, cells: [peer.cell], feed: [peer.feed], lastMove: peer.lastMove }) })
  h.controller.setReducedMotion(true)
  assert.equal(h.tasks.size, 1)
  h.finish()
  assert.ok(h.time() <= 200, 'reduced motion keeps remote updates short and removes their movement')

  const next = move({ id: 2, actor: '小红', actorKey: 'u:2', index: 1, at: 2000 })
  h.controller.receive({ game: board({ digs: 2, cells: [peer.cell, next.cell], feed: [next.feed, peer.feed], lastMove: next.lastMove }) })
  const staleCallback = [...h.tasks.values()][0].callback
  const updateCount = h.updates.length
  h.controller.dispose()
  assert.equal(h.tasks.size, 0)
  staleCallback()
  h.controller.receive({ game: board() })
  assert.equal(h.updates.length, updateCount)
  assert.equal(h.controller.begin('dig 1 3'), false)
})

test('a remote reward appears in its confirmed cell immediately and has no central stages', () => {
  const h = harness()
  const peer = move({ actor: '小红', actorKey: 'u:2', kind: 'diamond', index: 4 })
  h.controller.receive({ game: board({ digs: 1, cells: [peer.cell], feed: [peer.feed], lastMove: peer.lastMove }) })
  assert.equal(h.get().phase, 'resolve')
  assert.equal(h.get().effect.actor, '小红')
  assert.equal(h.get().effect.isOwn, false)
  assert.equal(h.get().game.cells[4].kind, 'diamond')
  assert.equal(h.get().game.cells[4].by, '小红')
  assert.equal(h.get().game.stats.digs, 1)
  assert.equal(h.get().me.pending, '0.00')
  assert.equal(h.get().own.chances, 7)
  assert.equal(h.get().busy, false)
  h.finish()
  assert.ok(h.time() >= 200 && h.time() <= 400)
  assert.ok(h.updates.every(update => !['effect', 'transfer'].includes(update.phase)))
})

test('remote actor comes from the confirmed cell or feed even without lastMove', () => {
  const byCell = harness()
  byCell.controller.receive({ game: board({ digs: 1, cells: [{ index: 3, kind: 'emerald', by: '格子作者', at: 1000 }] }) })
  assert.equal(byCell.get().effect.actor, '格子作者')
  byCell.finish()
  const byFeed = harness()
  const peer = move({ actor: '动态作者', actorKey: 'u:2', index: 3, kind: 'shield' })
  byFeed.controller.receive({ game: board({ digs: 1, cells: [{ ...peer.cell, by: null }], feed: [peer.feed] }) })
  assert.equal(byFeed.get().effect.actor, '动态作者')
  byFeed.finish()
  const unknown = harness()
  unknown.controller.receive({ game: board({ digs: 1, cells: [{ index: 3, kind: 'emerald', by: null, at: 1000 }] }) })
  assert.equal(unknown.get().effect.actor, null, 'an actor is never invented from the viewer name')
  unknown.finish()
})

test('a confirmed last tile from a peer resolves before a full card flips', () => {
  const earlierCells = Array.from({ length: 24 }, (_, index) => ({ index, kind: 'emerald', by: '小红', at: index }))
  const h = harness({ game: board({ digs: 24, cells: earlierCells }) })
  const last = move({ id: 25, actor: '小蓝', actorKey: 'u:3', index: 24, kind: 'diamond', at: 25000 })
  h.controller.receive({ game: board({ cardId: 2, digs: 25, feed: [last.feed], lastMove: last.lastMove }) })
  assert.equal(h.get().phase, 'resolve')
  assert.equal(h.get().game.cardId, 1)
  assert.equal(h.get().game.cells[24].kind, 'diamond')
  assert.equal(h.get().effect.actor, '小蓝')
  h.step()
  assert.equal(h.get().phase, 'transition')
  assert.equal(h.get().transitionFrom.cells.filter(cell => cell.kind !== null).length, 25)
  assert.equal(h.finish().game.cardId, 2)
  assert.ok(h.updates.every(update => !['effect', 'transfer'].includes(update.phase)))
})

test('an own pending public move keeps its full animation while private data is late', () => {
  const h = harness()
  const result = move()
  h.controller.begin('dig 1 1')
  h.controller.receive({ game: board({ digs: 1, cells: [result.cell], feed: [result.feed], lastMove: result.lastMove }) })
  assert.equal(h.get().effect, null, 'the pending request owns presentation priority')
  h.controller.complete('dig 1 1')
  assert.equal(h.get().phase, 'reveal')
  assert.equal(h.get().effect.isOwn, true)
  assert.equal(h.get().effect.actor, '小明')
  h.controller.receive({ own: own({ chances: 6, digs: 1, lastResult: { kind: 'diamond', cardId: 1, index: 0, amount: 50, blocked: false, text: '钻石大奖 +0.50' } }), me: me({ pending: '0.50' }) })
  assert.equal(h.get().effect.amountDelta, 50)
  assert.equal(h.get().own.chances, 7)
  assert.equal(h.step().phase, 'effect')
  assert.equal(h.step().phase, 'transfer')
  assert.equal(h.step().own.chances, 6)
  assert.equal(h.finish().me.pending, '0.50')
})

test('a pending own cell is identified by actorKey after a newer peer becomes lastMove', () => {
  const h = harness()
  const mine = move()
  const peer = move({ id: 2, actor: '小红', actorKey: 'u:2', index: 1, at: 2000 })
  h.controller.begin('dig 1 1')
  h.controller.receive({ game: board({ digs: 2, cells: [mine.cell, peer.cell], feed: [peer.feed, mine.feed], lastMove: peer.lastMove }) })
  h.controller.complete('dig 1 1')
  assert.equal(h.get().phase, 'reveal')
  assert.equal(h.get().effect.actor, '小明')
  assert.equal(h.get().effect.isOwn, true)
  assert.equal(h.get().effect.index, 0)
  h.controller.receive({ own: own({ chances: 6, digs: 1, lastResult: { kind: 'diamond', cardId: 1, index: 0, amount: 50, blocked: false, text: '钻石大奖 +0.50' } }), me: me({ pending: '0.50' }) })
  h.finish()
  assert.equal(h.get().game.stats.digs, 2)
  assert.equal(h.get().own.chances, 6)
})

test('late private proof upgrades a short public resolve into the full own feedback', () => {
  const h = harness({ own: null })
  const result = move()
  h.controller.receive({ game: board({ digs: 1, cells: [result.cell], feed: [result.feed], lastMove: result.lastMove }) })
  assert.equal(h.get().phase, 'resolve')
  assert.equal(h.get().effect.isOwn, false, 'a display name alone is not identity proof')
  h.controller.receive({ own: own({ chances: 6, digs: 1, lastResult: { kind: 'diamond', cardId: 1, index: 0, amount: 50, blocked: false, text: '钻石大奖 +0.50' } }), me: me({ pending: '0.50' }) })
  assert.equal(h.get().phase, 'reveal')
  assert.equal(h.get().effect.isOwn, true)
  assert.equal(h.get().effect.amountDelta, 50)
  assert.equal(h.get().own, null)
  assert.equal(h.get().me.pending, '0.00')
  assert.equal(h.step().phase, 'effect')
  assert.equal(h.step().phase, 'transfer')
  assert.equal(h.step().own.chances, 6)
  assert.equal(h.finish().me.pending, '0.50')
})

test('private proof arriving after the short public resolve still gets one own showcase', () => {
  const h = harness({ own: null })
  const result = move()
  h.controller.receive({ game: board({ digs: 1, cells: [result.cell], feed: [result.feed], lastMove: result.lastMove }) })
  h.finish()
  assert.equal(h.get().game.cells[0].kind, 'diamond')
  h.controller.receive({ own: own({ chances: 6, digs: 1, lastResult: { kind: 'diamond', cardId: 1, index: 0, amount: 50, blocked: false, text: '钻石大奖 +0.50' } }), me: me({ pending: '0.50' }) })
  assert.equal(h.get().phase, 'reveal')
  assert.equal(h.get().effect.isOwn, true)
  h.finish()
  assert.equal(h.get().own.chances, 6)
  assert.equal(h.get().me.pending, '0.50')
  const ownEffectIds = new Set(h.updates.flatMap(update => update.effect?.isOwn && update.phase === 'effect' ? [update.effect.id] : []))
  assert.equal(ownEffectIds.size, 1)
})

test('late private results from an old card do not reveal a tile on the new card', () => {
  const h = harness({ own: null })
  const mine = move()
  h.controller.receive({ game: board({ digs: 1, cells: [mine.cell], feed: [mine.feed], lastMove: mine.lastMove }) })
  h.finish()
  const peer = move({ id: 2, actor: '小红', actorKey: 'u:2', index: 12, kind: 'pearl', at: 2000 })
  h.controller.receive({ game: board({ cardId: 2, digs: 2, feed: [peer.feed, mine.feed], lastMove: peer.lastMove }) })
  h.finish()
  h.controller.receive({ own: own({ chances: 6, digs: 1, lastResult: { kind: 'diamond', cardId: 1, index: 0, amount: 50, blocked: false, text: '钻石大奖 +0.50' } }), me: me({ pending: '0.50' }) })
  assert.equal(h.get().phase, 'reveal')
  assert.equal(h.get().effect.cardId, 1)
  assert.equal(h.get().effect.isOwn, true)
  assert.equal(h.get().game.cardId, 2)
  h.finish()
  assert.equal(h.get().game.cardId, 2)
  assert.ok(h.get().game.cells.every(cell => cell.kind === null))
  assert.equal(h.get().own.chances, 6)
  assert.equal(h.get().me.pending, '0.50')
})

test('an own sequence shows a large remote burst as it comes without playing a remote backlog', () => {
  const h = harness()
  const mine = move()
  h.controller.begin('dig 1 1')
  h.controller.receive({ game: board({ digs: 1, cells: [mine.cell], feed: [mine.feed], lastMove: mine.lastMove }), own: own({ chances: 6, digs: 1, lastResult: { kind: 'diamond', cardId: 1, index: 0, amount: 50, blocked: false, text: '钻石大奖 +0.50' } }), me: me({ pending: '0.50' }) })
  h.controller.complete('dig 1 1')
  const peers = []
  for (let index = 1; index <= 20; index++) {
    const peer = move({ id: index + 1, actor: `远端${index}`, actorKey: `u:${index + 1}`, index, kind: 'emerald', at: 1000 + index })
    peers.push(peer)
    h.controller.receive({ game: board({ digs: index + 1, cells: [mine.cell, ...peers.map(item => item.cell)], feed: [...peers.map(item => item.feed).reverse(), mine.feed], lastMove: peer.lastMove }) })
    assert.equal(h.get().effect.isOwn, true)
    assert.ok(h.get().queued <= 1)
    // Others' cells land at once; the own one, its count and line wait for the showcase.
    assert.equal(h.get().game.cells[index].kind, 'emerald')
    assert.equal(h.get().game.counts.emerald, Math.max(0, 10 - index))
    assert.equal(h.get().game.cells[0].kind, null)
    assert.equal(h.get().game.counts.diamond, 3)
    assert.ok(h.get().game.feed.every(item => item.index !== 0))
  }
  const final = h.finish()
  assert.equal(final.game.stats.digs, 21)
  assert.equal(final.game.cells.filter(cell => cell.kind !== null).length, 21)
  assert.equal(final.own.chances, 6)
  assert.equal(final.me.pending, '0.50')
  assert.ok(h.time() < 4000, `the burst does not add seconds of replay: ${h.time()} ms`)
  const remoteCentral = h.updates.filter(update => update.effect && !update.effect.isOwn && ['effect', 'transfer'].includes(update.phase))
  assert.equal(remoteCentral.length, 0)
  const remoteIds = new Set(h.updates.flatMap(update => update.effect && !update.effect.isOwn ? [update.effect.id] : []))
  assert.ok(remoteIds.size <= 1, 'only the newest remote snapshot can be pending')
})

test('peer cells land while one\'s own dig is on its way, and the dug cell stays covered until its showcase', () => {
  const h = harness()
  assert.equal(h.controller.begin('dig 1 1'), true)
  const peer = move({ id: 2, actor: '小红', actorKey: 'u:2', index: 6, kind: 'emerald', at: 1500 })
  h.controller.receive({ game: board({ digs: 1, cells: [peer.cell], feed: [peer.feed], lastMove: peer.lastMove }) })
  assert.equal(h.get().busy, true)
  assert.equal(h.get().game.cells[6].kind, 'emerald')
  assert.equal(h.get().game.cells[6].by, '小红')
  assert.equal(h.get().game.counts.emerald, 9)
  assert.deepEqual(h.get().game.feed.map(item => item.id), [2])
  // The own move comes in public first: still covered, its count and line too.
  const mine = move({ index: 0, kind: 'diamond', at: 2000 })
  h.controller.receive({ game: board({ digs: 2, cells: [peer.cell, mine.cell], feed: [mine.feed, peer.feed], lastMove: mine.lastMove }) })
  assert.equal(h.get().game.cells[0].kind, null)
  assert.equal(h.get().game.counts.diamond, 3)
  assert.deepEqual(h.get().game.feed.map(item => item.id), [2])
  h.controller.receive({ own: own({ chances: 6, digs: 1, lastResult: { kind: 'diamond', cardId: 1, index: 0, amount: 50, blocked: false, text: '钻石大奖 +0.50' } }), me: me({ pending: '0.50' }) })
  h.controller.complete('dig 1 1')
  assert.equal(h.get().effect.isOwn, true)
  assert.equal(h.get().phase, 'reveal')
  assert.equal(h.get().game.cells[0].kind, null)
  assert.equal(h.get().game.cells[6].kind, 'emerald')
  h.step()
  h.step()
  assert.equal(h.get().phase, 'transfer')
  assert.equal(h.get().game.cells[0].kind, null)
  assert.equal(h.get().own.chances, 7, 'the HUD still waits for the flight')
  h.step()
  assert.equal(h.get().phase, 'resolve')
  assert.equal(h.get().game.cells[0].kind, 'diamond')
  assert.equal(h.get().game.cells[6].kind, 'emerald')
  const final = h.finish()
  assert.equal(final.game.stats.digs, 2)
  assert.equal(final.own.chances, 6)
  // The peer cell was shown beside it: not played again afterwards.
  assert.equal(h.updates.filter(update => update.effect && !update.effect.isOwn).length, 0)
})

test('a new card that comes while one\'s own dig is on its way waits for its answer', () => {
  const h = harness()
  h.controller.begin('dig 1 1')
  const peer = move({ id: 2, actor: '小红', actorKey: 'u:2', index: 12, kind: 'pearl', at: 1500 })
  h.controller.receive({ game: board({ cardId: 2, digs: 1, feed: [peer.feed], lastMove: peer.lastMove }) })
  assert.equal(h.get().game.cardId, 1)
  assert.equal(h.get().game.cells[12].kind, null)
  // Judged on the old card: turned down. What changed it plays as it would
  // have: the pearl on the old card, then the flip, not a jump.
  h.controller.receive({ game: board({ cardId: 2, digs: 1, feed: [peer.feed], lastMove: peer.lastMove }), own: own(), me: me() })
  h.controller.complete('dig 1 1')
  assert.equal(h.get().busy, false)
  assert.equal(h.get().game.cardId, 1)
  assert.equal(h.get().game.cells[12].kind, 'pearl')
  assert.equal(h.get().game.cells[12].by, '小红')
  assert.equal(h.get().effect.isOwn, false)
  h.step()
  assert.equal(h.get().phase, 'transition')
  assert.equal(h.get().transitionFrom.cardId, 1)
  assert.equal(h.finish().game.cardId, 2)
})

test('a peer pearl received during an own showcase remains on the old card before the flip', () => {
  const h = harness()
  const mine = move()
  h.controller.receive({ game: board({ digs: 1, cells: [mine.cell], feed: [mine.feed], lastMove: mine.lastMove }), own: own({ chances: 6, digs: 1, lastResult: { kind: 'diamond', cardId: 1, index: 0, amount: 50, blocked: false, text: '钻石大奖 +0.50' } }), me: me({ pending: '0.50' }) })
  assert.equal(h.get().effect.isOwn, true)
  const peer = move({ id: 2, actor: '小红', actorKey: 'u:2', index: 12, kind: 'pearl', at: 2000 })
  h.controller.receive({ game: board({ cardId: 2, digs: 2, feed: [peer.feed, mine.feed], lastMove: peer.lastMove }) })
  h.step()
  h.step()
  h.step()
  assert.equal(h.get().phase, 'resolve')
  assert.equal(h.get().game.cardId, 1)
  assert.equal(h.get().game.cells[0].kind, 'diamond')
  assert.equal(h.get().game.cells[12].kind, 'pearl')
  assert.equal(h.get().game.cells[12].by, '小红')
  assert.equal(h.get().game.counts.pearl, 1)
  h.step()
  assert.equal(h.get().phase, 'transition')
  assert.equal(h.get().transitionFrom.cells[12].kind, 'pearl')
  assert.equal(h.finish().game.cardId, 2)
})

test('an old private reward stays off the current card while another peer changes it', () => {
  const h = harness({ game: board({ cardId: 2, digs: 2 }), own: own() })
  h.controller.receive({ own: own({ chances: 6, digs: 1, lastResult: { kind: 'diamond', cardId: 1, index: 0, amount: 50, blocked: false, text: '钻石大奖 +0.50' } }), me: me({ pending: '0.50' }) })
  assert.equal(h.get().effect.cardId, 1)
  const peer = move({ id: 3, actor: '小红', actorKey: 'u:2', cardId: 2, index: 12, kind: 'pearl', at: 3000 })
  h.controller.receive({ game: board({ cardId: 3, digs: 3, feed: [peer.feed], lastMove: peer.lastMove }) })
  h.step()
  h.step()
  h.step()
  assert.equal(h.get().phase, 'resolve')
  assert.equal(h.get().game.cardId, 2)
  assert.equal(h.get().game.cells[0].kind, null, 'the reward belongs to card 1 and cannot open card 2')
  assert.equal(h.get().game.cells[12].kind, 'pearl')
  h.step()
  assert.equal(h.get().transitionFrom.cells[0].kind, null)
  assert.equal(h.finish().game.cardId, 3)
  assert.ok(h.get().game.cells.every(cell => cell.kind === null))
  assert.equal(h.get().me.pending, '0.50')
})

test('a 7 by 7 pearl keeps its old G7 tile and full old grid before a 5 by 5 transition', () => {
  const h = harness({ game: sizedBoard(7), own: own({ version: 2 }) })
  const pearl = move({ kind: 'pearl', index: 48 })
  pearl.feed.size = 7
  pearl.lastMove.size = 7
  h.controller.begin('dig 1 49')
  h.controller.receive({ game: sizedBoard(5, { cardId: 2, digs: 1, feed: [pearl.feed], lastMove: pearl.lastMove }), own: own({ version: 2, digs: 1, chances: 6, lastResult: { kind: 'pearl', cardId: 1, index: 48, size: 7, amount: 0, blocked: false, text: '全体换卡' } }) })
  h.controller.complete('dig 1 49')
  assert.equal(h.get().effect.size, 7)
  assert.equal(h.get().game.size, 7)
  assert.equal(h.get().game.cells.length, 49)
  h.step()
  h.step()
  h.step()
  assert.equal(h.get().phase, 'resolve')
  assert.equal(h.get().game.cells[48].kind, 'pearl')
  h.step()
  assert.equal(h.get().phase, 'transition')
  assert.equal(h.get().transitionFrom.size, 7)
  assert.equal(h.get().transitionFrom.cells.length, 49)
  assert.equal(h.get().transitionFrom.cells[48].kind, 'pearl')
  assert.equal(h.get().game.size, 5)
  assert.equal(h.get().game.cells.length, 25)
  assert.equal(h.finish().own.chances, 6)
})

test('a late private G7 result cannot insert an out-of-range tile into a newer smaller card', () => {
  const h = harness({ game: sizedBoard(5, { cardId: 2, digs: 2 }), own: own({ version: 2 }) })
  h.controller.receive({ own: own({ version: 2, digs: 1, chances: 6, lastResult: { kind: 'diamond', cardId: 1, index: 48, size: 7, amount: 50, blocked: false, text: '钻石 +0.50' } }), me: me({ pending: '0.50' }) })
  assert.equal(h.get().phase, 'reveal')
  assert.equal(h.get().effect.cardId, 1)
  assert.equal(h.get().effect.size, 7)
  assert.equal(h.get().effect.index, 48)
  const final = h.finish()
  assert.equal(final.game.size, 5)
  assert.equal(final.game.cells.length, 25)
  assert.ok(final.game.cells.every(cell => cell.kind === null))
  assert.equal(final.me.pending, '0.50')
  assert.equal(final.own.chances, 6)
})

test('a six-column remote full-card change preserves both layouts without a central reward', () => {
  const earlier = Array.from({ length: 35 }, (_, index) => ({ index, kind: 'emerald', by: '其他玩家', actorKey: 'u:2', at: index }))
  const h = harness({ game: sizedBoard(6, { digs: 35, cells: earlier }), own: own({ version: 2 }) })
  const last = move({ id: 36, actor: '其他玩家', actorKey: 'u:2', kind: 'spyglass', index: 35, at: 36000 })
  last.feed.size = 6
  last.lastMove.size = 6
  h.controller.receive({ game: sizedBoard(7, { cardId: 2, digs: 36, feed: [last.feed], lastMove: last.lastMove }) })
  assert.equal(h.get().effect.size, 6)
  assert.equal(h.get().game.size, 6)
  assert.equal(h.get().game.cells[35].kind, 'spyglass')
  h.step()
  assert.equal(h.get().transitionFrom.cells.length, 36)
  assert.equal(h.get().game.cells.length, 49)
  h.finish()
  assert.ok(h.updates.every(update => !['effect', 'transfer'].includes(update.phase)))
})
