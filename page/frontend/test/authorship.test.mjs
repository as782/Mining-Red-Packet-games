import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

let server
let isOwnCell
let readPublic
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  ;({ isOwnCell, readPublic } = await server.ssrLoadModule('/src/game.ts'))
})
after(async () => { await server?.close() })

const cell = { index: 3, kind: 'emerald', by: '同名玩家', at: 1000 }
const own = { actorKey: 'u:1', lastResult: { cardId: 1, index: 3, kind: 'emerald' } }

test('同名玩家不能依赖显示名被标成自己，已确认身份优先于旧私人结果', () => {
  assert.equal(isOwnCell({ ...cell, actorKey: 'u:2' }, 1, own), false)
  assert.equal(isOwnCell({ ...cell, actorKey: 'u:1' }, 1, { ...own, lastResult: null }), true)
  assert.equal(isOwnCell(cell, 1, { ...own, lastResult: null }), false)
})
test('旧判定器仅用相同卡片与格子的本人私人结果提供兼容标记', () => {
  assert.equal(isOwnCell(cell, 1, own), true)
  assert.equal(isOwnCell(cell, 2, own), false)
  assert.equal(isOwnCell({ ...cell, index: 2 }, 1, own), false)
  assert.equal(isOwnCell({ ...cell, kind: null }, 1, own), false)
  assert.equal(isOwnCell(cell, 1, null), false)
})
test('公开牌面兼容旧作者字段，拒绝隐藏格带身份或非字符串身份', () => {
  const board = { version: 1, cardId: 1, cells: Array.from({ length: 25 }, (_, index) => ({ index, kind: null, by: null, at: null })), counts: Object.fromEntries(['emerald', 'diamond', 'apple', 'totem', 'tnt', 'pearl', 'shield', 'spyglass'].map(kind => [kind, 1])), rules: { initialChances: 7, waitSeconds: 10, smallReward: 10, bigMultiplier: 5, totemBonus: 3, tntPercent: 25 }, stats: { digs: 0, players: 0 }, feed: [] }
  assert.ok(readPublic(board))
  board.cells[3] = { ...cell, actorKey: 'u:1' }
  assert.ok(readPublic(board))
  board.cells[3] = { ...cell, actorKey: 1 }
  assert.equal(readPublic(board), null)
  board.cells[3] = { ...cell, kind: null, actorKey: 'u:1' }
  assert.equal(readPublic(board), null)
})
