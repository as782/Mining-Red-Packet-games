import assert from 'node:assert/strict'
import { after, before, mock, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// 在场（v3/src/presence.ts，docs/V3_ITEMS.md §20）：房间发来的一批怎么放进网页手上的“谁在看、指针、表情”。
let server
let presence
let state

before(async () => {
  globalThis.window = { location: { href: 'https://game.test/v3/' }, matchMedia: () => ({ matches: true }) }
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  globalThis.localStorage = { getItem: () => null, setItem() {} }
  globalThis.__API_BASE__ = '/v3/api/'
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  presence = await server.ssrLoadModule('/v3/src/presence.ts')
  state = await server.ssrLoadModule('/v3/src/state.ts')
})
after(() => server.close())

test('刚连上换成整份名单；换卡、走了跟着改；同一个人两个标签页算一个，自己不算', () => {
  const { store, uidAtom } = state
  store.set(uidAtom, 1)
  presence.onText(JSON.stringify({ hi: 'me', w: [['me', 1, '我', 5], ['a', 2, '小明', 5], ['b', 3, '小红', 6], ['a2', 2, '小明', 5]], P: [] }))
  const watchers = () => Object.fromEntries([...store.get(presence.watchersAtom)].map(([card, list]) => [card, list.map(item => item.name)]))
  assert.deepEqual(watchers(), { 5: ['小明'], 6: ['小红'] })
  assert.equal(store.get(presence.onlineAtom), 3)
  presence.onText(JSON.stringify({ w: [['b', 3, '小红', 5], ['a', 2, '小明', null], ['a2', 2, '小明', null]] }))
  assert.deepEqual(watchers(), { 5: ['小红'] })
  // 再连上：整份名单换掉手上的
  presence.onText(JSON.stringify({ hi: 'me2', w: [['c', 4, '小刚', 7]], P: [] }))
  assert.deepEqual(watchers(), { 7: ['小刚'] })
})

test('指针：P 是全部、p 是动了的，只有座位号的收起；带着手上的道具（没带是镐子 0）；不看了的人指针也收起', () => {
  const { store } = state
  presence.onText(JSON.stringify({ hi: 'me', w: [['a', 2, '小明', 5], ['b', 3, '小红', 5]], P: [['a', 10, 20]] }))
  assert.deepEqual(store.get(presence.pointersAtom), { a: [10, 20, 0] })
  presence.onText(JSON.stringify({ p: [['b', 1, 2, 3], ['a']] }))
  assert.deepEqual(store.get(presence.pointersAtom), { b: [1, 2, 3] })
  presence.onText(JSON.stringify({ w: [['b', 3, '小红', null]] }))
  assert.deepEqual(store.get(presence.pointersAtom), {})
  presence.onText(JSON.stringify({ P: [['a', 3, 3]] }))
  assert.deepEqual(store.get(presence.pointersAtom), { a: [3, 3, 0] })
})

test('表情按人记：有指针的冒在指针旁，没有的冒在“在看”的名字上；看不懂的不要', () => {
  const { store } = state
  presence.onText(JSON.stringify({ hi: 'me', w: [['a', 2, '小明', 5], ['b', 3, '小红', 5]], P: [['a', 10, 20]] }))
  presence.onText(JSON.stringify({ e: [['a', 1], ['b', 4], ['x', 2]] }))
  const bubbles = store.get(presence.bubblesAtom)
  assert.deepEqual({ a: bubbles['2'] && [bubbles['2'].n, bubbles['2'].onPointer], b: bubbles['3'] && [bubbles['3'].n, bubbles['3'].onPointer] }, { a: [1, true], b: [4, false] })
  assert.equal(Object.keys(bubbles).length, 2)
  presence.onText('不是 JSON')
  presence.onText(JSON.stringify({ w: [[1, 2, 3]] }))
  assert.equal(Object.keys(store.get(presence.seatsAtom)).length, 2)
})

test('页面在后台满一分钟断开在场的连接，回到前台再连；没满一分钟就回来的不断', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const listeners = {}
  globalThis.document = { visibilityState: 'visible', addEventListener: (type, fn) => { listeners[type] = fn }, removeEventListener: type => { delete listeners[type] } }
  let opened = 0
  let closed = 0
  const api = { presence: () => { opened += 1; return { send: () => true, close: () => { closed += 1 } } } }
  const hidden = yes => {
    document.visibilityState = yes ? 'hidden' : 'visible'
    listeners.visibilitychange()
  }
  try {
    presence.startPresence(api)
    assert.equal(opened, 1)
    hidden(true)
    mock.timers.tick(presence.HIDDEN_DROP_MS - 1)
    hidden(false)
    mock.timers.tick(presence.HIDDEN_DROP_MS)
    assert.deepEqual([opened, closed], [1, 0])
    hidden(true)
    mock.timers.tick(presence.HIDDEN_DROP_MS)
    assert.deepEqual([opened, closed], [1, 1])
    hidden(false)
    assert.deepEqual([opened, closed], [2, 1])
    presence.stopPresence()
    assert.deepEqual([opened, closed], [2, 2])
    assert.equal(listeners.visibilitychange, undefined)
  } finally {
    presence.stopPresence()
    mock.timers.reset()
    globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  }
})
