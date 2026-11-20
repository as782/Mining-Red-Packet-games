import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// v3 的末影之眼和末地宝藏（v3/src/eye.ts）：底栏那一行和 JP 提示看的状况。
let server
let eye
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  eye = await server.ssrLoadModule('/v3/src/eye.ts')
})
after(async () => { await server?.close() })

const card = (id, fields = {}) => ({ id, x: id, y: 0, size: 5, cells: [], left: {}, finished: false, ...fields })

test('参数 0 或旧局没有这个参数：不开', () => {
  assert.equal(eye.eyeStatus([card(1)], 0).kind, 'off')
  assert.equal(eye.eyeStatus([card(1)], undefined).kind, 'off')
})

test('还没有眼：再长几张普通卡出（宝藏卡不算张数）', () => {
  assert.deepEqual(eye.eyeStatus([card(1)], 3), { kind: 'coming', cards: 2 })
  assert.deepEqual(eye.eyeStatus([card(1), card(2)], 3), { kind: 'coming', cards: 1 })
  // 第 3 张的眼挖掉了、宝藏也挖完了：下一颗在第 6 张
  const cards = [card(1), card(2), card(3, { left: { eye: 0 } }), card(4, { kind: 'end', finished: true })]
  assert.deepEqual(eye.eyeStatus(cards, 3), { kind: 'coming', cards: 3 })
})

test('有眼没挖到就说眼在哪；宝藏卡没挖完最要紧', () => {
  const withEye = [card(1), card(2), card(3, { left: { eye: 1 } })]
  const status = eye.eyeStatus(withEye, 3)
  assert.equal(status.kind, 'eye')
  assert.equal(status.card.id, 3)
  const open = [...withEye, card(4, { kind: 'end' })]
  const first = eye.eyeStatus(open, 3)
  assert.equal(first.kind, 'special')
  assert.equal(first.card.id, 4)
})

test('新局（rules.special: 2）：末影之眼开的深暗之域、下界也是特殊区块；珍珠长的不是（docs/V3_ITEMS.md §17）', () => {
  const cards = [card(1), card(2, { kind: 'deep' }), card(3, { left: { eye: 0 } }), card(4, { kind: 'nether', fromEye: true })]
  assert.equal(eye.isSpecial(cards[1]), false)
  assert.equal(eye.isSpecial(cards[3]), true)
  const status = eye.eyeStatus(cards, 3)
  assert.equal(status.kind, 'special')
  assert.equal(status.card.id, 4)
  // 特殊区块不算张数：普通 3 张（含珍珠长的深暗之域），下一颗眼在第 6 张
  assert.deepEqual(eye.eyeStatus([...cards.slice(0, 3), { ...cards[3], finished: true }], 3), { kind: 'coming', cards: 3 })
  // 关了的深暗之域不算开着
  assert.equal(eye.openSpecial(card(5, { kind: 'deep', fromEye: true, closed: true, finished: true })), false)
})

test('JP 指离你最近的还开着的特殊区块，一样近取新开的', () => {
  const cards = [card(1, { kind: 'end', x: 10, y: 0 }), card(2, { kind: 'deep', fromEye: true, x: -3, y: 0 }), card(3, { kind: 'nether', fromEye: true, x: 3, y: 0 }), card(4, { kind: 'end', x: 0, y: 1, finished: true })]
  assert.equal(eye.nearestSpecial(cards, 0, 0).id, 3)
  assert.equal(eye.nearestSpecial(cards, 9, 0).id, 1)
  assert.equal(eye.nearestSpecial([card(5)], 0, 0), null)
})
