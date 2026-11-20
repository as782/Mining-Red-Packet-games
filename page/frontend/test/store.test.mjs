import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

let server
let gameStore
let sdk
let submissions
const previousWindow = globalThis.window

const own = overrides => ({ version: 1, actorKey: 'u:1', chances: 6, shield: false, peeks: [], digs: 1, status: 'playing', lastResult: null, ...overrides })
const me = overrides => ({ signedIn: true, name: '小明', open: true, settled: false, pending: '0.50', claim: null, ...overrides })
const board = () => ({
  version: 1, cardId: 1,
  cells: Array.from({ length: 25 }, (_, index) => ({ index, kind: null, by: null, at: null })),
  counts: { emerald: 10, diamond: 3, apple: 1, totem: 2, tnt: 4, pearl: 2, shield: 2, spyglass: 1 },
  rules: { initialChances: 7, waitSeconds: 10, smallReward: 10, bigMultiplier: 5, totemBonus: 3, tntPercent: 25 },
  lastMove: null, stats: { digs: 0, players: 0 }, feed: [],
})

async function connectEvents() {
  const listeners = new Map()
  sdk.ready = async () => ({ hongbao: { unit: 'LDC', status: 'active' } })
  sdk.on = (kind, listener) => { listeners.set(kind, listener); return () => listeners.delete(kind) }
  sdk.view = async () => ({ data: board() })
  await gameStore.connect()
  return listeners
}

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  gameStore = await server.ssrLoadModule('/src/store.ts')
})

after(async () => {
  gameStore?.disconnect()
  await server?.close()
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
})

beforeEach(async () => {
  submissions = []
  sdk = {
    submit: async input => { submissions.push(input); return { judged: false, reason: 'unconfirmed' } },
    mine: async () => ({ items: [{ input: 'dig 1 1', reply: '挖到了钻石大奖' }] }),
    me: async () => me(),
    myView: async () => ({ data: own() }),
    view: async () => null,
    now: () => 1000,
  }
  globalThis.window = { hb: sdk }
  const { store } = gameStore
  store.set(gameStore.connectionAtom, 'ready')
  store.set(gameStore.pendingActionAtom, null)
  store.set(gameStore.unconfirmedInputAtom, null)
  store.set(gameStore.checkingResultAtom, false)
  store.set(gameStore.settlementAtom, null)
  store.set(gameStore.meAtom, me())
  store.set(gameStore.privateAtom, null)
  store.set(gameStore.hongbaoAtom, { unit: 'LDC', status: 'active' })
  store.set(gameStore.toastAtom, null)
  await connectEvents()
  store.set(gameStore.privateAtom, null)
})

test('an unconfirmed submit queries records and never resubmits', async () => {
  await gameStore.submit('dig 1 1')
  assert.deepEqual(submissions, ['dig 1 1'])
  assert.equal(gameStore.store.get(gameStore.unconfirmedInputAtom), null)
  assert.equal(gameStore.store.get(gameStore.privateAtom).chances, 6)
  assert.match(gameStore.store.get(gameStore.toastAtom).text, /钻石大奖/)
})

test('a slow submit stays locked without revealing a cell or changing rewards before confirmation', async () => {
  let finishSubmit
  sdk.submit = input => {
    submissions.push(input)
    return new Promise(resolve => { finishSubmit = resolve })
  }
  const request = gameStore.submit('dig 1 1')
  assert.equal(gameStore.store.get(gameStore.pendingActionAtom), 'dig 1 1')
  assert.equal(gameStore.store.get(gameStore.presentationAtom).busy, true)
  assert.equal(gameStore.store.get(gameStore.presentationAtom).effect, null)
  assert.equal(gameStore.store.get(gameStore.presentationAtom).game.cells[0].kind, null)
  assert.equal(gameStore.store.get(gameStore.presentationAtom).me.pending, '0.50')

  await gameStore.submit('dig 1 1')
  await gameStore.submit('dig 1 2')
  await gameStore.submit('cashout')
  assert.deepEqual(submissions, ['dig 1 1'])

  finishSubmit({ judged: false, reason: 'try_later' })
  await request
  assert.equal(gameStore.store.get(gameStore.pendingActionAtom), null)
  assert.equal(gameStore.store.get(gameStore.presentationAtom).busy, false)
  assert.equal(gameStore.store.get(gameStore.presentationAtom).effect, null)
  assert.equal(gameStore.store.get(gameStore.presentationAtom).game.cells[0].kind, null)
  assert.equal(gameStore.store.get(gameStore.presentationAtom).me.pending, '0.50')
  assert.deepEqual(submissions, ['dig 1 1'])
})

test('a slow submit that loses its response queries state once and never retries the action', async () => {
  let rejectSubmit
  let queries = 0
  sdk.submit = input => {
    submissions.push(input)
    return new Promise((resolve, reject) => { rejectSubmit = reject })
  }
  sdk.mine = async () => { queries++; throw new Error('offline') }
  const request = gameStore.submit('dig 1 1')
  rejectSubmit(new Error('response lost'))
  await request
  await gameStore.submit('dig 1 2')
  await gameStore.submit('cashout')

  assert.equal(queries, 1)
  assert.deepEqual(submissions, ['dig 1 1'])
  assert.equal(gameStore.store.get(gameStore.pendingActionAtom), null)
  assert.equal(gameStore.store.get(gameStore.unconfirmedInputAtom), 'dig 1 1')
  assert.equal(gameStore.store.get(gameStore.presentationAtom).effect, null)
  assert.equal(gameStore.store.get(gameStore.presentationAtom).game.cells[0].kind, null)
})

test('failed record queries keep all further money actions locked', async () => {
  sdk.mine = async () => { throw new Error('offline') }
  await gameStore.submit('dig 1 1')
  await gameStore.submit('dig 1 2')
  await gameStore.submit('cashout')
  assert.deepEqual(submissions, ['dig 1 1'])
  assert.equal(gameStore.store.get(gameStore.unconfirmedInputAtom), 'dig 1 1')
  assert.equal(gameStore.store.get(gameStore.pendingActionAtom), null)
  assert.equal(gameStore.store.get(gameStore.checkingResultAtom), false)
})

test('manual recovery only queries state and permits one recovery at a time', async () => {
  gameStore.store.set(gameStore.unconfirmedInputAtom, 'dig 1 1')
  let finishQuery
  let queries = 0
  sdk.mine = () => { queries++; return new Promise(resolve => { finishQuery = resolve }) }
  const recovery = gameStore.confirmSubmission()
  await gameStore.confirmSubmission()
  assert.equal(queries, 1)
  assert.equal(gameStore.store.get(gameStore.checkingResultAtom), true)
  finishQuery({ items: [] })
  await recovery
  assert.deepEqual(submissions, [])
  assert.equal(gameStore.store.get(gameStore.unconfirmedInputAtom), null)
  assert.equal(gameStore.store.get(gameStore.meAtom).pending, '0.50')
})

test('a transport exception recovers from records without repeating the action', async () => {
  sdk.submit = async input => { submissions.push(input); throw new Error('response lost') }
  await gameStore.submit('dig 1 1')
  assert.deepEqual(submissions, ['dig 1 1'])
  assert.equal(gameStore.store.get(gameStore.unconfirmedInputAtom), null)
  assert.match(gameStore.store.get(gameStore.toastAtom).text, /已刷新最近记录/)
})

test('a zero settlement is shown even when claimed is false', async () => {
  sdk.submit = async input => { submissions.push(input); return { judged: true, settled: true, claimed: false, reply: '已收手' } }
  sdk.me = async () => ({ signedIn: true, name: '小明', open: false, settled: true, pending: '0.00', claim: null })
  await gameStore.submit('cashout')
  assert.deepEqual(gameStore.store.get(gameStore.settlementAtom), { amount: '0.00', unit: 'LDC', reason: 'collected', digs: 1 })
  assert.equal(gameStore.store.get(gameStore.unconfirmedInputAtom), null)
})

test('recovered zero cashout opens settlement from confirmed own state', async () => {
  gameStore.store.set(gameStore.meAtom, { signedIn: true, name: '小明', settled: false, pending: '0.00' })
  sdk.mine = async () => ({ items: [{ input: 'cashout', reply: '已收手' }] })
  sdk.me = async () => ({ signedIn: true, name: '小明', open: false, settled: true, pending: '0.00', claim: null })
  sdk.myView = async () => ({ data: own({ digs: 0, chances: 7, status: 'settled' }) })
  await gameStore.submit('cashout')
  assert.deepEqual(gameStore.store.get(gameStore.settlementAtom), { amount: '0.00', unit: 'LDC', reason: 'collected', digs: 0 })
  assert.equal(gameStore.store.get(gameStore.unconfirmedInputAtom), null)
  assert.deepEqual(submissions, ['cashout'])
  assert.match(gameStore.store.get(gameStore.toastAtom).text, /领取奖励/)
  assert.doesNotMatch(gameStore.store.get(gameStore.toastAtom).text, /收手/)
})

test('a refresh started before disconnect cannot overwrite the next connection', async () => {
  let finishOld
  sdk.me = () => new Promise(resolve => { finishOld = resolve })
  const stale = gameStore.refreshOwn()
  gameStore.disconnect()
  const currentMe = { signedIn: true, name: '小红', settled: false, pending: '0.80' }
  gameStore.store.set(gameStore.meAtom, currentMe)
  finishOld({ signedIn: true, name: '小明', settled: false, pending: '0.10' })
  await stale
  assert.deepEqual(gameStore.store.get(gameStore.meAtom), currentMe)
})

test('platform settlement events open one result and do not reopen after dismissal', async () => {
  let remoteMe = { signedIn: true, name: '小明', open: true, settled: false, pending: '0.50', claim: null }
  sdk.me = async () => remoteMe
  const listeners = await connectEvents()
  assert.equal(gameStore.store.get(gameStore.settlementAtom), null)
  remoteMe = { ...remoteMe, open: false, pending: '0.00', settled: true, claim: { amount: '0.50', unit: 'LDC', payment: 'paid' } }
  listeners.get('me')(remoteMe)
  await Promise.resolve()
  assert.deepEqual(gameStore.store.get(gameStore.settlementAtom), { amount: '0.50', unit: 'LDC', reason: 'unknown', digs: null })
  gameStore.store.set(gameStore.settlementAtom, null)
  listeners.get('me')(remoteMe)
  await Promise.resolve()
  assert.equal(gameStore.store.get(gameStore.settlementAtom), null)
  gameStore.disconnect()
})

test('a coherent exhausted private result explains the final dig and amount', async () => {
  sdk.me = async () => me({ settled: true, open: false, pending: '0.00', claim: { amount: '0.80', unit: 'LDC', payment: 'paid' } })
  sdk.myView = async () => ({ data: own({ chances: 0, digs: 10, status: 'settled' }) })
  await gameStore.refreshOwn()
  assert.deepEqual(gameStore.store.get(gameStore.settlementAtom), { amount: '0.80', unit: 'LDC', reason: 'exhausted', digs: 10 })
})

test('old private atom data cannot supply an exhaustion reason for a new settlement', async () => {
  gameStore.store.set(gameStore.privateAtom, own({ chances: 0, digs: 1, status: 'settled' }))
  sdk.me = async () => me({ settled: true, open: false, pending: '0.00' })
  sdk.myView = async () => ({ data: own({ chances: 2, digs: 2 }) })
  await gameStore.refreshOwn()
  assert.deepEqual(gameStore.store.get(gameStore.settlementAtom), { amount: '0.00', unit: 'LDC', reason: 'unknown', digs: 2 })
})

test('a delayed private snapshot cannot regress digs or invent exhaustion', async () => {
  gameStore.store.set(gameStore.privateAtom, own({ chances: 3, digs: 5 }))
  sdk.me = async () => me({ settled: true, open: false, pending: '0.00' })
  sdk.myView = async () => ({ data: own({ chances: 0, digs: 4, status: 'settled' }) })
  await gameStore.refreshOwn()
  assert.deepEqual(gameStore.store.get(gameStore.settlementAtom), { amount: '0.00', unit: 'LDC', reason: 'unknown', digs: null })
  assert.equal(gameStore.store.get(gameStore.privateAtom).digs, 5)
})

test('a me-only settlement is enriched after the fresh private bundle arrives', async () => {
  let remoteMe = me()
  sdk.me = async () => remoteMe
  const listeners = await connectEvents()
  let finishPrivate
  sdk.myView = () => new Promise(resolve => { finishPrivate = resolve })
  remoteMe = me({ settled: true, open: false, pending: '0.00' })
  listeners.get('me')(remoteMe)
  assert.equal(gameStore.store.get(gameStore.settlementAtom).reason, 'unknown')
  finishPrivate({ data: own({ chances: 0, digs: 7, status: 'settled' }) })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(gameStore.store.get(gameStore.settlementAtom), { amount: '0.00', unit: 'LDC', reason: 'exhausted', digs: 7 })
})

test('fresh cause evidence cannot reopen a result dismissed during its query', async () => {
  let remoteMe = me()
  sdk.me = async () => remoteMe
  const listeners = await connectEvents()
  let finishPrivate
  sdk.myView = () => new Promise(resolve => { finishPrivate = resolve })
  remoteMe = me({ settled: true, open: false, pending: '0.00' })
  listeners.get('me')(remoteMe)
  gameStore.store.set(gameStore.settlementAtom, null)
  finishPrivate({ data: own({ chances: 0, digs: 7, status: 'settled' }) })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(gameStore.store.get(gameStore.settlementAtom), null)
})

test('a late whole-hongbao end explains an open unknown settlement', async () => {
  let remoteMe = me()
  sdk.me = async () => remoteMe
  const listeners = await connectEvents()
  remoteMe = me({ settled: true, open: false, pending: '0.00' })
  listeners.get('me')(remoteMe)
  listeners.get('hongbao')({ unit: 'LDC', status: 'ended' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(gameStore.store.get(gameStore.settlementAtom).reason, 'hongbao-ended')
  gameStore.store.set(gameStore.settlementAtom, null)
  listeners.get('hongbao')({ unit: 'LDC', status: 'ended' })
  assert.equal(gameStore.store.get(gameStore.settlementAtom), null)
})

test('an unmatched cashout recovery cannot label a whole-hongbao end as collected', async () => {
  gameStore.store.set(gameStore.hongbaoAtom, { unit: 'LDC', status: 'ended' })
  sdk.mine = async () => ({ items: [{ input: 'dig 1 1', settled: false, reply: '挖到了绿宝石' }] })
  sdk.me = async () => me({ settled: true, open: false, pending: '0.00' })
  await gameStore.submit('cashout')
  assert.equal(gameStore.store.get(gameStore.settlementAtom).reason, 'hongbao-ended')
  assert.deepEqual(submissions, ['cashout'])
})

test('a cashout record that did not settle is not confirmation of collection', async () => {
  gameStore.store.set(gameStore.hongbaoAtom, { unit: 'LDC', status: 'ended' })
  sdk.mine = async () => ({ items: [{ input: 'cashout', settled: false, claimed: false }] })
  sdk.me = async () => me({ settled: true, open: false, pending: '0.00' })
  await gameStore.submit('cashout')
  assert.equal(gameStore.store.get(gameStore.settlementAtom).reason, 'hongbao-ended')
  assert.deepEqual(submissions, ['cashout'])
})

test('cashout confirmation survives a concurrent refresh replacing its original query', async () => {
  gameStore.store.set(gameStore.unconfirmedInputAtom, 'cashout')
  sdk.mine = async () => ({ items: [{ input: 'cashout', settled: true, claimed: false }] })
  sdk.me = async () => me({ settled: true, open: false, pending: '0.00' })
  let finishOldPrivate
  sdk.myView = () => new Promise(resolve => { finishOldPrivate = resolve })
  const recovery = gameStore.confirmSubmission()
  await Promise.resolve()
  sdk.myView = async () => ({ data: own({ status: 'settled' }) })
  await gameStore.refreshOwn()
  finishOldPrivate({ data: own({ status: 'settled' }) })
  await recovery
  assert.equal(gameStore.store.get(gameStore.settlementAtom).reason, 'collected')
  assert.equal(gameStore.store.get(gameStore.unconfirmedInputAtom), null)
  assert.deepEqual(submissions, [])
})

test('a later whole-hongbao end preserves a confirmed collection reason', async () => {
  let remoteMe = me()
  sdk.me = async () => remoteMe
  const listeners = await connectEvents()
  sdk.submit = async input => {
    submissions.push(input)
    remoteMe = me({ settled: true, open: false, pending: '0.00' })
    return { judged: true, settled: true, claimed: false }
  }
  await gameStore.submit('cashout')
  listeners.get('hongbao')({ unit: 'LDC', status: 'ended' })
  assert.equal(gameStore.store.get(gameStore.settlementAtom).reason, 'collected')
})

test('a submit response cannot reopen a settlement dismissed after a me event', async () => {
  let remoteMe = me()
  sdk.me = async () => remoteMe
  const listeners = await connectEvents()
  let finishSubmit
  sdk.submit = input => { submissions.push(input); return new Promise(resolve => { finishSubmit = resolve }) }
  const request = gameStore.submit('cashout')
  remoteMe = me({ settled: true, open: false, pending: '0.00' })
  listeners.get('me')(remoteMe)
  assert.notEqual(gameStore.store.get(gameStore.settlementAtom), null)
  gameStore.store.set(gameStore.settlementAtom, null)
  finishSubmit({ judged: true, settled: true, claimed: false })
  await request
  assert.equal(gameStore.store.get(gameStore.settlementAtom), null)
})

test('a refresh that finishes last cannot overwrite a newer settled bundle', async () => {
  let finishOldMe
  let finishOldOwn
  sdk.me = () => new Promise(resolve => { finishOldMe = resolve })
  sdk.myView = () => new Promise(resolve => { finishOldOwn = resolve })
  const oldRefresh = gameStore.refreshOwn()
  sdk.me = async () => me({ settled: true, open: false, pending: '0.00' })
  sdk.myView = async () => ({ data: own({ chances: 0, digs: 7, status: 'settled' }) })
  await gameStore.refreshOwn()
  finishOldMe(me())
  finishOldOwn({ data: own({ digs: 2 }) })
  await oldRefresh
  assert.equal(gameStore.store.get(gameStore.meAtom).settled, true)
  assert.equal(gameStore.store.get(gameStore.privateAtom).digs, 7)
  assert.equal(gameStore.store.get(gameStore.settlementAtom).reason, 'exhausted')
})

test('a delayed me packet without a claim cannot erase a confirmed paid amount', async () => {
  let remoteMe = me()
  sdk.me = async () => remoteMe
  const listeners = await connectEvents()
  sdk.submit = async input => {
    submissions.push(input)
    remoteMe = me({ settled: true, open: false, pending: '0.00', claim: { amount: '0.80', unit: 'LDC', payment: 'paid' } })
    return { judged: true, settled: true, claimed: true, amount: '0.80', unit: 'LDC' }
  }
  await gameStore.submit('cashout')
  listeners.get('me')(me({ settled: true, open: false, pending: '0.00' }))
  assert.deepEqual(gameStore.store.get(gameStore.settlementAtom), { amount: '0.80', unit: 'LDC', reason: 'collected', digs: 1 })
})
