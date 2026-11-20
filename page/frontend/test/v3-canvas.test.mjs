import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// 整张地图的画布（v3/src/MapCanvas.tsx）：上千张卡时，长一张新卡、光变一张，不再整张重画。
let server
let canvas
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  canvas = await server.ssrLoadModule('/v3/src/MapCanvas.tsx')
})
after(async () => { await server?.close() })

test('画布范围：四周留地图跨度的一成五（至少 2 格），卡在范围里时不变', () => {
  const small = canvas.areaOf({ minX: 0, maxX: 3, minY: -1, maxY: 2 }, null)
  assert.deepEqual(small, { minX: -2, maxX: 5, minY: -3, maxY: 4 })
  const big = canvas.areaOf({ minX: -20, maxX: 20, minY: -10, maxY: 30 }, null)
  assert.deepEqual(big, { minX: -26, maxX: 26, minY: -16, maxY: 36 })
  assert.equal(canvas.areaOf({ minX: -25, maxX: 20, minY: -10, maxY: 35 }, big), big)
  assert.notEqual(canvas.areaOf({ minX: -27, maxX: 20, minY: -10, maxY: 30 }, big), big)
})

test('光的粗细按 2^¼ 一档：地图长一点不变', () => {
  assert.equal(canvas.stepped(9.6), canvas.stepped(10.2))
  assert.ok(canvas.stepped(10) < canvas.stepped(13))
})

test('光变了的卡：灭了的、换色的、新亮的', () => {
  const drawn = new Map([[1, 'eye'], [2, 'eye'], [3, 'end']])
  const wanted = new Map([[1, 'eye'], [3, 'eye'], [4, 'end']])
  assert.deepEqual(canvas.glowChanges(drawn, wanted).sort(), [2, 3, 4])
  assert.deepEqual(canvas.glowChanges(wanted, new Map(wanted)), [])
})

test('远处的光：末地宝藏、藏着眼的照旧，别的按越富越亮的档位（docs/V3_ITEMS.md §9）', () => {
  const plain = { id: 1, left: { diamond: 2 }, finished: false }
  assert.equal(canvas.glowOf(plain), null)
  assert.equal(canvas.glowOf(plain, 0), null)
  assert.deepEqual([1, 2, 3].map(rich => canvas.glowOf(plain, rich)), ['rich1', 'rich2', 'rich3'])
  assert.equal(canvas.glowOf({ ...plain, left: { eye: 1 } }, 3), 'eye')
  assert.equal(canvas.glowOf({ ...plain, kind: 'end' }, 3), 'end')
  assert.equal(canvas.glowOf({ ...plain, kind: 'end', finished: true }, 3), null)
})

test('地图画布（docs/V3_ITEMS.md §22）：格子的位置和按坐标找格子对得上，缝里不算；火把第 1 版在角上、第 2 版在格子正中', async () => {
  const paint = await server.ssrLoadModule('/v3/src/paint.ts')
  for (const size of [3, 5, 6, 7]) {
    const card = { size }
    for (let index = 0; index < size * size; index++) {
      const box = paint.cellBox(card, index)
      assert.equal(paint.cellUnder(card, box.x + box.side / 2, box.y + box.side / 2), index)
      assert.equal(paint.cellUnder(card, box.x + 0.5, box.y + 0.5), index)
    }
    // 第一格和第二格之间的缝
    const first = paint.cellBox(card, 0)
    assert.equal(paint.cellUnder(card, first.x + first.side + 2, first.y + 2), null)
    // 卡外框、内边距上
    assert.equal(paint.cellUnder(card, 5, 5), null)
  }
  const card = { size: 6 }
  const cell = paint.cellBox(card, 14)
  assert.deepEqual(paint.torchPoint(card, 14, true), { x: cell.x + cell.side / 2, y: cell.y + cell.side / 2 })
  assert.deepEqual(paint.torchPoint(card, 14, false), { x: cell.x - 2, y: cell.y - 2 })
})

test('地图画布：自己挖开时格子上飘的字', async () => {
  const paint = await server.ssrLoadModule('/v3/src/paint.ts')
  const result = (over) => ({ kind: 'emerald', cardId: 1, index: 0, amount: 0, blocked: false, text: '', newCardId: null, ...over })
  assert.equal(paint.floatText(result({ amount: 70 })), '+0.70')
  assert.equal(paint.floatText(result({ kind: 'tnt', amount: -25 })), '-0.25')
  assert.equal(paint.floatText(result({ kind: 'tnt', blocked: true })), '挡住了')
  assert.equal(paint.floatText(result({ kind: 'pearl', loot: 'key' })), '新卡 +1 钥匙')
  assert.equal(paint.floatText(result({ kind: 'coal', text: '煤炭已经够了' })), '够了，不算')
})
