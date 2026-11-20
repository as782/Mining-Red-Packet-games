import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// v3 地图的镜头（v3/src/camera.ts）：三级缩放、居中、最近的卡、往哪个方向走、NEW 指向。
let server
let camera
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  camera = await server.ssrLoadModule('/v3/src/camera.ts')
})
after(async () => { await server?.close() })

const phone = { width: 390, height: 600 }
const wide = { width: 900, height: 700 }
const cards = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 1 }]

test('挖卡这一级画面放得下就是原大；放不下一张卡（加留白）才缩小；附近那级固定、更小，画面小时放得下两块多；总览不比附近大', () => {
  assert.equal(camera.digScale(wide), 1)
  assert.equal(camera.digScale({ width: 2000, height: 2000 }), 1)
  assert.ok(Math.abs(camera.digScale({ width: 300, height: 600 }) * camera.CARD_PX - (300 - camera.MARGIN * 2)) < 1)
  assert.equal(camera.midScale(wide), camera.MID_SCALE)
  assert.ok(camera.midScale(phone) < camera.digScale(phone))
  assert.ok(camera.midScale(phone) * camera.SLOT_PX * 2.2 <= phone.width + 0.01)
  assert.ok(camera.overviewScale(phone, [{ x: 0, y: 0 }]) <= camera.midScale(phone))
  assert.ok(camera.overviewScale(phone, [{ x: -6, y: 0 }, { x: 6, y: 0 }]) < camera.midScale(phone))
})

test('区块一样大、间距一样：卡在区块正中，画面大小不改屏幕上的间距', () => {
  assert.equal(camera.BLOCK_PX + camera.BLOCK_GAP, camera.SLOT_PX)
  assert.ok(camera.CARD_PX <= camera.BLOCK_PX)
  const big = { width: 1400, height: 1000 }
  const step = view => {
    const at = camera.cameraAt(camera.centerOf({ x: 0, y: 0 }), camera.digScale(view), view)
    return camera.centerOf({ x: 1, y: 0 }).x * at.scale - camera.centerOf({ x: 0, y: 0 }).x * at.scale
  }
  assert.equal(step(wide), step(big))
})

test('总览放得下所有卡，四周留出边', () => {
  const view = wide
  const at = camera.overviewCamera(view, cards)
  for (const card of cards) assert.ok(camera.onScreen(card, at, view), JSON.stringify(card))
})

test('镜头对准一张卡：它在正中；最近的卡就是它', () => {
  const scale = camera.digScale(phone)
  const at = camera.cameraAt(camera.centerOf({ x: -1, y: 1 }), scale, phone)
  const center = camera.worldCenter(at, phone)
  assert.deepEqual([Math.round(center.x), Math.round(center.y)], [-camera.SLOT_PX, camera.SLOT_PX])
  assert.deepEqual(camera.nearestCard(cards, at, phone), { x: -1, y: 1 })
})

test('捏合松手吸到最近的那一级', () => {
  assert.equal(camera.nearestLevel(camera.digScale(phone) * 1.1, phone, cards), 2)
  assert.equal(camera.nearestLevel(camera.midScale(phone) * 0.95, phone, cards), 1)
})

test('方向：在那个方向 45° 以内（含 45°）、先近后正；没有就是 null', () => {
  const from = { x: 0, y: 0 }
  assert.deepEqual(camera.cardToward(cards, from, 'right'), { x: 1, y: 0 })
  assert.deepEqual(camera.cardToward(cards, from, 'down'), { x: 0, y: 1 })
  assert.equal(camera.cardToward(cards, from, 'up'), null)
  assert.deepEqual(camera.cardToward(cards, from, 'left'), { x: -1, y: 1 }) // 正好 45° 也算，不然按左没反应
  assert.deepEqual(camera.cardToward(cards, { x: 0, y: 1 }, 'left'), { x: -1, y: 1 })
})

test('NEW 指向：镜头外的卡在屏幕边上，箭头朝它', () => {
  const at = camera.cameraAt(camera.centerOf({ x: 0, y: 0 }), camera.digScale(phone), phone)
  assert.equal(camera.onScreen({ x: -1, y: 1 }, at, phone), false)
  const pointer = camera.edgePointer({ x: -1, y: 1 }, at, phone)
  assert.ok(pointer.x >= 0 && pointer.x <= phone.width && pointer.y >= 0 && pointer.y <= phone.height)
  assert.ok(pointer.angle > 90 && pointer.angle < 180) // 左下
})

test('滚轮都是缩放：一下的第一个事件就换一级；同一下里同方向再攒够、隔够了再换；停一下重新算', () => {
  const step = (state, deltaY, now, deltaMode = 0) => camera.wheelZoom(state, { deltaMode, deltaY }, now)
  let r = step(null, 4, 0) // macOS 慢慢滚一格只有几像素，也要动
  assert.equal(r.step, -1)
  r = step(r.state, 4, 100)
  assert.equal(r.step, 0) // 同一下里，隔得太近
  r = step(r.state, 30, 200)
  assert.equal(r.step, 0)
  r = step(r.state, 30, 300)
  assert.equal(r.step, 0) // 隔够了，但同一下里还没攒够 80
  r = step(r.state, 30, 400)
  assert.equal(r.step, -1)
  r = step(r.state, -10, 500)
  assert.equal(r.step, 0) // 反方向：重新攒，也还没隔够
  r = step(r.state, -3, 900) // 停过一下，是新的一下
  assert.equal(r.step, 1)
  assert.equal(step(null, -1, 0, 1).step, 1) // Firefox 按行滚
  assert.equal(step(null, 0, 0).step, 0)
})

test('卡的外框都一样大，格子小的卡格子大；边框算在宽度里，格子正好铺满内容区', () => {
  assert.equal(camera.cellPx(7), 44)
  assert.ok(camera.cellPx(5) > camera.cellPx(6) && camera.cellPx(6) > camera.cellPx(7))
  for (const size of [5, 6, 7]) {
    const content = camera.CARD_PX - (camera.PAD + camera.CARD_BORDER) * 2
    assert.ok(Math.abs(content - (size * camera.cellPx(size) + (size - 1) * camera.GAP)) < 1e-9)
  }
})

test('整张在画面里才不提醒 NEW：露出一部分也提醒', () => {
  const big = { width: 1400, height: 1000 }
  const at = camera.cameraAt(camera.centerOf({ x: 0, y: 0 }), camera.digScale(big), big)
  assert.equal(camera.fullyOnScreen({ x: 0, y: 0 }, at, big), true)
  assert.equal(camera.fullyOnScreen({ x: 1, y: 0 }, at, big), true) // 1400 宽放得下右边那张
  assert.equal(camera.fullyOnScreen({ x: 0, y: 1 }, at, big), false) // 1000 高只露出一部分
  assert.equal(camera.onScreen({ x: 0, y: 1 }, at, big), true)
})

test('珍珠传送：格子中心、新卡朝着旧卡的边、一波一波翻出来的先后', () => {
  const card = { x: 0, y: 0, size: 5 }
  const first = camera.cellCenter(card, 0)
  const last = camera.cellCenter(card, 24)
  assert.ok(Math.abs(first.x + last.x) < 1e-9 && Math.abs(first.y + last.y) < 1e-9) // 关于卡中心对称
  assert.ok(Math.abs(camera.cellCenter(card, 12).x) < 1e-9) // 正中那格在中心
  assert.equal(camera.edgeFacing({ x: 0, y: 1 }, { x: 0, y: 0 }), 'up')
  assert.equal(camera.edgeFacing({ x: -1, y: 0 }, { x: 0, y: 0 }), 'right')
  assert.equal(camera.edgeFacing({ x: 1, y: 1 }, { x: 0, y: 0 }), 'left') // 斜着一样远：先看左右
  // 从上边进来：第一行正中最先，最后一行角上最晚
  const waves = Array.from({ length: 25 }, (_, index) => camera.entranceWave(5, index, 'up'))
  assert.equal(Math.min(...waves), waves[2])
  assert.equal(waves[2], 0)
  assert.equal(Math.max(...waves), waves[20])
  assert.ok(waves[7] > waves[2] && waves[1] > waves[2])
  // 落点在新卡朝着旧卡那条边往里一点：在卡里，比中心更靠近旧卡
  const landing = camera.entryPoint({ x: 0, y: 1 }, 'up')
  const center = camera.centerOf({ x: 0, y: 1 })
  assert.equal(landing.x, center.x)
  assert.ok(landing.y < center.y && landing.y > center.y - camera.CARD_PX / 2)
})

test('滚轮放大朝指针下面那张卡', () => {
  const at = camera.overviewCamera(wide, cards)
  const target = { x: -1, y: 1 }
  const point = { x: camera.centerOf(target).x * at.scale + at.x, y: camera.centerOf(target).y * at.scale + at.y }
  assert.deepEqual(camera.cardNear(cards, at, point), target)
})

test('屏幕上看得到的格位：正中那张和露出一点的都算；放大缩小、挪动都跟着', () => {
  const view = { width: 1280, height: 650 }
  // 挖卡那一级原大，正中是 (0, 0)：左右各 640，格位 408、区块 392，左右各露出两张（第二张露出一点）
  const at = camera.cameraAt({ x: 0, y: 0 }, 1, view)
  assert.deepEqual(camera.slotsOnScreen(at, view), { x0: -2, y0: -1, x1: 2, y1: 1 })
  // 正中挪到 (3, 0)
  const moved = camera.cameraAt({ x: 3 * camera.SLOT_PX, y: 0 }, 1, view)
  assert.deepEqual(camera.slotsOnScreen(moved, view), { x0: 1, y0: -1, x1: 5, y1: 1 })
  // 手机竖屏：只看得到正中那张（上下露出一点）
  const phone = { width: 390, height: 640 }
  assert.deepEqual(camera.slotsOnScreen(camera.cameraAt({ x: 0, y: 0 }, 0.94, phone), phone), { x0: 0, y0: -1, x1: 0, y1: 1 })
})


test('附近这一级跟着全图走（docs/V3_ITEMS.md §23）：地图小时照旧，卡多了取全图和挖卡两级的中间', () => {
  const wide = { width: 892, height: 611, left: 70 }
  const small = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
  assert.equal(camera.nearScale(wide, small), camera.midScale(wide))
  assert.equal(camera.scaleOf(1, wide, small), camera.midScale(wide))
  // 34×29 个格位的大地图（生产上 343 张卡那一局的大小）
  const big = [{ x: -17, y: -14 }, { x: 17, y: 15 }]
  const over = camera.overviewScale(wide, big)
  const near = camera.scaleOf(1, wide, big)
  const dig = camera.digScale(wide)
  assert.ok(near < camera.midScale(wide) && near > over * 2)
  // 两边差的倍数差不多
  assert.ok(Math.abs(Math.log(near / over) - Math.log(dig / near)) < 0.01)
  assert.equal(camera.nearestLevel(near * 1.1, wide, big), 1)
  assert.equal(camera.nearestLevel(over * 1.2, wide, big), 0)
})
