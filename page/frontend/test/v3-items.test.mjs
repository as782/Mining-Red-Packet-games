import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// 道具栏（v3/src/items.ts）和推送里的新东西（live.ts）：形状盖住哪几格、火把插在哪个角、
// 岩浆吞的格子、火把颜色变了、整张卡换掉时格子只增不减（docs/V3_ITEMS.md）。
let server
let items
let live
let chart
let regions
let mcfont
let layout
let types
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  items = await server.ssrLoadModule('/v3/src/items.ts')
  live = await server.ssrLoadModule('/v3/src/live.ts')
  chart = await server.ssrLoadModule('/v3/src/chart.ts')
  regions = await server.ssrLoadModule('/v3/src/regions.ts')
  mcfont = await server.ssrLoadModule('/v3/src/mcfont.ts')
  layout = await server.ssrLoadModule('/v3/src/layout.ts')
  types = await server.ssrLoadModule('/v3/src/types.ts')
})
after(() => server.close())

const stats = { digs: 0, players: 0, claimed: 0, claimedPoints: 0 }
function card(size, extra = {}) {
  return { id: 1, x: 0, y: 0, size, cells: Array(size * size).fill(null), left: { emerald: 3, tnt: 1, diamond: 1 }, finished: false, ...extra }
}
function game(cards) {
  return { seq: 0, rules: {}, pool: 1000, left: 1000, deadlineAt: null, wrapUpAt: null, over: false, stats, cards, feed: [] }
}

test('附魔镐：形状挪进卡里，盖住的格子从上到下、从左到右', () => {
  assert.deepEqual(items.clampCenter(5, 0, 0, 'x'), { row: 1, col: 1 })
  assert.deepEqual(items.clampCenter(5, 2, 4, 'h'), { row: 2, col: 3 })
  assert.deepEqual(items.clampCenter(5, 4, 2, 'h'), { row: 4, col: 2 })
  assert.deepEqual(items.shapeCells(5, 12, 'x'), [7, 11, 12, 13, 17])
  assert.deepEqual(items.shapeCells(5, 12, 'v'), [7, 12, 17])
  // 出界的不算
  assert.deepEqual(items.shapeCells(5, 0, 'x'), [0, 1, 5])
})

test('火把：点在格子的哪个四分之一，插在离得最近的角；卡边上的角挪到里面', () => {
  // 第 6 格（第 2 行第 2 列）的左上角：那个角右下的格子就是 6
  assert.equal(items.cornerOf(5, 6, 0, 0), 6)
  assert.equal(items.cornerOf(5, 6, 1, 1), 12)
  // 第 0 格的左上角在卡边上：挪到里面（右下的格子 6）
  assert.equal(items.cornerOf(5, 0, 0, 0), 6)
  assert.equal(items.cornerOf(5, 24, 1, 1), 24)
  assert.deepEqual(items.cornerCells(5, 6), [0, 1, 5, 6])
})

test('能不能挖：装饰、宝库、岩浆、开了的、卡关了都不能', () => {
  const c = card(5, { fixed: { 0: 'deco', 1: 'vault', 2: 'lava' } })
  c.cells[3] = { kind: 'emerald', uid: 1, name: 'a', at: 1 }
  assert.deepEqual([0, 1, 2, 3, 4].map(index => items.diggable(c, index)), [false, false, false, false, true])
  assert.equal(items.diggable({ ...c, closed: true }, 4), false)
})

test('工具条：主动的按顺序，被动的在后面；镐子和附魔镐都用完才算挖不动', () => {
  const me = {
    chances: 0, shield: true, shields: 2, spyglasses: 1, peeks: [], points: 10, digs: 3, status: 'playing', lastResult: null,
    items: { torch: 1, map: 0, potion: 1, ender: 0, table: 0, key: 2, pick: { h: 0, v: 2, x: 0 } }, coal: 1, stick: 0, poison: 3,
  }
  // 中毒不在工具条上（画成身上的效果，Effects.tsx）
  assert.deepEqual(items.slotsOf(me, true), { active: ['pick-v', 'spyglass', 'torch', 'key', 'potion'], passive: ['shield', 'coal'] })
  assert.equal(items.countOf(me, 'pick-v'), 2)
  assert.equal(items.countOf(me, 'key'), 2)
  assert.equal(items.outOfPicks(me), false)
  assert.equal(items.outOfPicks({ ...me, items: { ...me.items, pick: { h: 0, v: 0, x: 0 } } }), true)
})

test('推送：岩浆吞掉的格子翻开、火把换颜色、噪音只增不减，装饰不算没挖完', () => {
  const before = card(2, { kind: 'nether', fixed: { 3: 'lava' }, torches: [{ at: 3, level: 1, name: 'a' }], left: { emerald: 1, diamond: 1, lava: 0 } })
  const step = {
    type: 'cell', seq: 1, cardId: 1, index: 0, cell: { kind: 'emerald', uid: 7, name: 'b', at: 5 }, newCard: null, text: '', left: 990, over: false, stats,
    burned: [{ index: 1, kind: 'diamond' }], torches: [{ at: 3, level: 0, name: 'a' }],
  }
  const merged = live.mergeLive(game([before]), new Map(), [step])
  const after = merged.game.cards[0]
  assert.equal(after.cells[1].burn, 1)
  assert.equal(after.cells[1].kind, 'diamond')
  assert.equal(after.torches[0].level, 0)
  assert.equal(after.left.diamond, 0)
  assert.equal(after.finished, false)
  assert.deepEqual(merged.opened.map(cell => cell.index), [0, 1])
  // 最后一格挖开：装饰（岩浆）不算，卡挖完了
  const last = live.mergeLive(merged.game, new Map(), [{ ...step, seq: 2, index: 2, burned: undefined, torches: undefined }])
  assert.equal(last.game.cards[0].finished, true)
})

test('整张卡（火把插上、宝库开了）：格子只增不减，火把和宝库用新的', () => {
  const mine = card(2)
  mine.cells[0] = { kind: 'emerald', uid: 1, name: 'a', at: 1 }
  const pushed = card(2, { torches: [{ at: 3, level: 2, name: 'b' }], vaults: { 1: 3 } })
  const merged = live.mergeLive(game([mine]), new Map(), [{ type: 'card', card: pushed }])
  const after = merged.game.cards[0]
  assert.equal(after.cells[0].kind, 'emerald')
  assert.deepEqual(after.torches, [{ at: 3, level: 2, name: 'b' }])
  assert.deepEqual(after.vaults, { 1: 3 })
  assert.equal(merged.game.seq, 0)
})

test('监守者醒了：卡关了就算挖完', () => {
  const deep = card(2, { kind: 'deep', noise: 2 })
  const step = { type: 'cell', seq: 1, cardId: 1, index: 0, cell: { kind: 'emerald', uid: 7, name: 'b', at: 5 }, newCard: null, text: '', left: 990, over: false, stats, noise: 3, closed: true }
  const after = live.mergeLive(game([deep]), new Map(), [step]).game.cards[0]
  assert.equal(after.closed, true)
  assert.equal(after.noise, 3)
  assert.equal(after.finished, true)
})

test('会退的噪音：按 noiseAt 取新的那份（不取大的）；谁吵醒的跟着来（docs/V3_ITEMS.md §16）', () => {
  const deep = card(2, { kind: 'deep', noise: 5, noiseAt: 1000 })
  const step = { type: 'cell', seq: 1, cardId: 1, index: 0, cell: { kind: 'emerald', uid: 7, name: 'b', at: 5 }, newCard: null, text: '', left: 990, over: false, stats, noise: 3.2, noiseAt: 40000 }
  const after = live.mergeLive(game([deep]), new Map(), [step]).game.cards[0]
  assert.deepEqual([after.noise, after.noiseAt], [3.2, 40000])
  // 晚到的旧一份不盖掉新的
  assert.deepEqual(live.newerNoise({ noise: 3.2, noiseAt: 40000 }, { noise: 5, noiseAt: 1000 }), { noise: 3.2, noiseAt: 40000 })
  assert.deepEqual(live.newerNoise({ noise: 2 }, { noise: 3 }), { noise: 3 })
  assert.deepEqual(live.newerNoise({}, {}), {})
  const woke = { ...step, seq: 2, index: 1, closed: true, wokeBy: { uid: 7, name: 'b', amount: 255, at: 41000 } }
  const shut = live.mergeLive(game([deep]), new Map(), [step, woke]).game.cards[0]
  assert.deepEqual([shut.closed, shut.finished, shut.wokeBy?.name], [true, true, 'b'])
})

test('整局补回来时：开的格子没变，但火把、宝库变了，也换成新的那一份（card 推送漏了靠这个补）', () => {
  const mine = card(2, { vaults: { 1: 4 } })
  const fresh = card(2, { vaults: { 1: 3 }, torches: [{ at: 3, level: 0, name: 'b' }] })
  const merged = live.mergeState(game([mine]), { ...game([fresh]), seq: 1 }, new Map())
  assert.deepEqual(merged.game.cards[0].vaults, { 1: 3 })
  assert.equal(merged.game.cards[0].torches.length, 1)
  // 什么都没变：沿用手上那一份（同一个对象，卡不重画）
  const same = live.mergeState(game([mine]), { ...game([card(2, { vaults: { 1: 4 } })]), seq: 1 }, new Map())
  assert.equal(same.game.cards[0], mine)
})

test('格子推送带着宝库还能开几次：跟着改', () => {
  const trial = card(2, { kind: 'trial', fixed: { 1: 'vault' }, vaults: { 1: 4 } })
  const step = { type: 'cell', seq: 1, cardId: 1, index: 0, cell: { kind: 'emerald', uid: 7, name: 'b', at: 5 }, newCard: null, text: '', left: 990, over: false, stats, vaults: { 1: 2 } }
  assert.deepEqual(live.mergeLive(game([trial]), new Map(), [step]).game.cards[0].vaults, { 1: 2 })
})

test('收益图：第几格只数挖的，中毒、末影箱、宝库这些不算', () => {
  const trail = [
    { k: 'emerald', a: 10, p: 10 }, { k: 'poison', a: -1, p: 9 }, { k: 'ender', a: -4, p: 5 }, { k: 'diamond', a: 50, p: 55 },
  ]
  const marker = chart.chartOf(trail).markers.find(item => item.kind === 'diamond')
  assert.equal(marker.dig, 2)
  const point = chart.chartOf(trail).points.find(item => item.kind === 'diamond')
  assert.match(chart.pointWords(point, value => String(value), { diamond: '钻石' }), /^第 2 次挖 · 钻石/)
})

test('手里还有附魔台就不算挖不动（换得到附魔镐）', () => {
  const me = { chances: 0, shield: false, peeks: [], points: 0, digs: 3, status: 'playing', lastResult: null, items: { torch: 0, map: 0, potion: 0, ender: 0, table: 1, key: 0, pick: { h: 0, v: 0, x: 0 } } }
  assert.equal(items.outOfPicks(me), false)
  assert.equal(items.outOfPicks({ ...me, items: { ...me.items, table: 0 } }), true)
})

test('宝库：卡挖完了照样能开（关了的不行）', () => {
  assert.equal(items.vaultsLeft(card(2, { finished: true, vaults: { 1: 1 } })), true)
  assert.equal(items.vaultsLeft(card(2, { finished: true, vaults: { 1: 0 } })), false)
  assert.equal(items.vaultsLeft(card(2, { closed: true, vaults: { 1: 2 } })), false)
})


test('第 2 版：煤炭、木棍排在火把后面；火把照 3×3（出界的不算），只插挖开的格子', () => {
  const me = {
    chances: 3, shield: false, shields: 0, spyglasses: 1, peeks: [], points: 10, digs: 3, status: 'playing', lastResult: null,
    items: { torch: 1, map: 0, potion: 1, ender: 0, table: 0, key: 2, pick: { h: 0, v: 0, x: 0 } }, coal: 3, stick: 0, poison: 2,
  }
  assert.deepEqual(items.slotsOf(me, true, 2), { active: ['spyglass', 'torch', 'coal', 'key', 'potion'], passive: [] })
  assert.deepEqual(items.torchArea(5, 0), [0, 1, 5, 6])
  assert.deepEqual(items.torchArea(5, 12), [6, 7, 8, 11, 12, 13, 16, 17, 18])
  const c = card(5, { fixed: { 1: 'lava' } })
  c.cells[0] = { kind: 'emerald', uid: 1, name: 'a', at: 1 }
  c.cells[2] = { kind: 'diamond', uid: 0, name: '', at: 1, burn: 1 }
  assert.deepEqual([0, 1, 2, 3].map(index => items.dugCell(c, index)), [true, false, false, false])
  assert.equal(items.aimWhat('torch', 2), '点一个挖开的格子，照亮周围 9 格')
  assert.equal(items.howToAim('torch', 1), '在地图上点四个格子相交的角预览，再点一下确认。')
  const about = items.aboutSlot('coal', me, true, 1, null, 2)
  assert.deepEqual(about.count, '3 个')
})

test('卡周围的说明：余量报还藏着多少钱、有哪几样宝贝，挖得差不多了指去最富的那张；深暗之域的危险区是格子数的 45%–75%', async () => {
  const rules = { smallReward: 10, bigMultiplier: 5 }
  // 9 绿宝石 + 3 钻石 ×5 + 1 箱子矿车 ×1.5 = 25.5 份小奖 → 255（2.55），宝贝按先后最多 4 样
  const plain = { id: 1, left: { emerald: 9, diamond: 3, apple: 0, tnt: 6, pearl: 1, minecart: 1, shield: 2, coal: 3 }, finished: false }
  const out = regions.leftoversOf(plain, rules, 10000)
  assert.deepEqual(out, { worth: 255, kinds: ['diamond', 'pearl', 'minecart', 'emerald'], poor: false })
  assert.equal(regions.worthOf(plain, rules, 100), 100, '不超过奖池剩下的')
  assert.deepEqual([255, 1000, 85, 5, 0].map(regions.aboutMoney), ['2.6', '10.0', '0.85', '0.05', '0.00'])
  // 只剩一颗绿宝石：挖得差不多了；挖完、关了的也算
  assert.equal(regions.leftoversOf({ left: { emerald: 1, tnt: 2 }, finished: false }, rules, 10000).poor, true)
  assert.equal(regions.leftoversOf({ left: { diamond: 2 }, finished: true }, rules, 10000).poor, true)
  const cards = [
    { ...plain, id: 1 },
    { id: 2, left: { emerald: 1 }, finished: false },
    { id: 3, left: { debris: 3, diamond: 1 }, finished: false },
    { id: 4, left: { debris: 9 }, finished: false, closed: true },
    { id: 5, left: { emerald: 10 }, finished: false },
  ]
  assert.deepEqual(regions.richestOf(cards, rules, 10000, 2), { card: cards[2], worth: 350 })
  assert.equal(regions.richestOf(cards, rules, 10000, 3).card.id, 1)
  assert.equal(regions.richestOf([cards[1]], rules, 10000, 2), null)
  // 和最富的（350）比：255 是 2/3 以上 → 3 档，100 是 1/3 以下 → 1 档；不够 2 份小奖的、关了的不亮
  assert.deepEqual([...regions.richnessOf(cards, rules, 10000)], [[1, 3], [3, 3], [5, 1]])
  assert.deepEqual([...regions.richnessOf(cards.slice(0, 2), rules, 10000)], [[1, 3]])
  const deep = { cells: Array(49).fill(null), fixed: {}, noise: 18, closed: false }
  assert.deepEqual(regions.noiseOf(deep), { noise: 18, low: 23, high: 36, cells: 49, danger: false, closed: false, toDanger: 5 })
  assert.equal(regions.noiseOf({ ...deep, noise: 23 }).danger, true)
  // 会退的噪音（rules.special: 2）：49 格，过了 12.25 才有危险；每 15 秒退一
  const loud = { cells: Array(49).fill(null), fixed: {}, noise: 10, noiseAt: 0, closed: false }
  const calm = regions.decayingNoiseOf(loud, {}, 0)
  assert.deepEqual([calm.noise, calm.chance, calm.safe], [10, 0, 2])
  // 9.25 以下才多一格：再过 0.75 × 15 秒
  assert.equal(calm.next, 11250 + 50)
  assert.deepEqual([regions.decayingNoiseOf(loud, {}, 15000).noise, regions.decayingNoiseOf(loud, {}, 15000).safe], [9, 3])
  const danger = regions.decayingNoiseOf({ ...loud, noise: 30 }, {}, 0)
  assert.deepEqual([danger.safe, danger.next], [0, 1000])
  assert.ok(danger.chance > 0.04 && danger.chance < 0.07)
  assert.equal(regions.chanceWords(danger.chance), `这一下约 ${Math.round(danger.chance * 100)}% 会吵醒监守者`)
  assert.equal(regions.chanceWords(0.004), '这一下有一点可能吵醒监守者')
  // 挖掘间隔 5 秒的局退得慢：每 25 秒退一
  assert.equal(regions.decayingNoiseOf(loud, { digInterval: 5 }, 25000).noise, 9)
  assert.equal(regions.decayingNoiseOf({ ...loud, closed: true }, {}, 0).next, null)
  assert.match(regions.regionAbout({ kind: 'deep' }, { tntPercent: 25, special: 2 })[0], /慢慢退/)
  // 和游戏站算的一样
  const game = await import('../../../game/shared/rules.mjs')
  for (const [noise, cells] of [[13, 49], [30, 49], [49, 49], [20, 32]]) assert.equal(regions.wardenChance(noise, cells), game.wardenChance(noise, cells))
  for (const digInterval of [1, 3, 5, 10]) assert.equal(regions.noiseDecayMs({ digInterval }), game.noiseDecayMs({ digInterval }))
  assert.equal(regions.regionName({ id: 7 }), '第 7 张卡')
  assert.equal(regions.regionName({ id: 7, kind: 'deep' }), '深暗之域')
  assert.match(regions.regionAbout({ kind: 'mine' }, { items: 2, tntPercent: 25 })[0], /多等 10 秒/)
  // 开图有奖的局（rules.loot，§19）：箱子矿车能开出附魔台，钥匙也能从末影珍珠来
  assert.match(regions.regionAbout({ kind: 'mine' }, { items: 2, tntPercent: 25 })[0], /箱子矿车（小奖、火把或藏宝图）/)
  assert.match(regions.regionAbout({ kind: 'mine' }, { items: 2, tntPercent: 25, loot: 1 })[0], /箱子矿车（小奖、藏宝图、火把或附魔台）/)
  assert.match(regions.regionAbout({ kind: 'trial' }, { items: 2, tntPercent: 25, loot: 1 })[1], /挖到末影珍珠也可能捡到/)
})

const ASCII_PNG = fileURLToPath(new URL('../public/assets/minecraft/1.21.4/textures/font/ascii.png', import.meta.url))

/** 读 font/ascii.png 的不透明度（1 位调色板的 PNG，0 号色透明）：测试里不用画布也能量字宽。 */
function asciiAlpha() {
  const data = readFileSync(ASCII_PNG)
  let at = 8
  let width = 0
  const parts = []
  while (at < data.length) {
    const length = data.readUInt32BE(at)
    const type = data.toString('latin1', at + 4, at + 8)
    const body = data.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      assert.deepEqual([body[8], body[9], body[12]], [1, 3, 0], '1 位调色板、不隔行')
    }
    if (type === 'IDAT') parts.push(body)
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(parts))
  const stride = Math.ceil(width / 8)
  const rows = []
  let previous = Buffer.alloc(stride)
  for (let y = 0; y * (stride + 1) < raw.length; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let x = 0; x < stride; x++) {
      const left = x ? line[x - 1] : 0
      const up = previous[x]
      const corner = x ? previous[x - 1] : 0
      const paeth = () => {
        const p = left + up - corner
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)]
        return a <= b && a <= c ? left : b <= c ? up : corner
      }
      line[x] = (line[x] + [0, left, up, (left + up) >> 1, paeth()][filter]) & 255
    }
    rows.push(line)
    previous = line
  }
  return (x, y) => ((rows[y][x >> 3] >> (7 - (x & 7))) & 1 ? 255 : 0)
}

// 字图是 Minecraft 的素材，仓库里不带：没跑过 npm run assets 就跳过
test('原版乱码：字宽从字图量出来，乱码只换成同样宽的字，阴影是颜色的四分之一', { skip: !existsSync(ASCII_PNG) && '没有字图，先在仓库根目录跑 npm run assets' }, () => {
  const font = mcfont.measureFont(asciiAlpha())
  // 数字都是 5 像素宽（乱码里的个数不会忽长忽短），i 是 1，空格算 3
  assert.deepEqual([...'0123456789'].map(ch => font.glyphs.get(ch).w), Array(10).fill(5))
  assert.deepEqual(['i', 'l', ' ', 'W'].map(ch => font.glyphs.get(ch).w), [1, 2, 3, 5])
  assert.equal(mcfont.textWidth(font, '12'), 12)
  assert.ok(font.byWidth.get(5).length > 40, '5 像素宽的字够多，乱码看着在跳')
  for (let n = 0; n < 50; n++) {
    const shown = mcfont.obfuscated(font, '7', Math.random)
    assert.equal(shown.w, 5)
  }
  assert.equal(mcfont.obfuscated(font, ' ', () => 0.5), font.glyphs.get(' '))
  assert.equal(mcfont.shadowOf('#ffaa00'), '#3f2a00')
  assert.equal(mcfont.shadowOf('#ffffff'), '#3f3f3f')
})

test('工具条两头的箭头：只按格子排出来的长度算，放得下就没有；差 4 像素以内不算', () => {
  // 收起的那一格浮起来、把 scrollWidth 撑到 121 的那一刻：按排版只有 48，没有箭头
  assert.deepEqual(items.edgesOf(0, 48, 48), { start: false, end: false })
  assert.deepEqual(items.edgesOf(0, 51, 48), { start: false, end: false })
  assert.deepEqual(items.edgesOf(0, 300, 200), { start: false, end: true })
  assert.deepEqual(items.edgesOf(50, 300, 200), { start: true, end: true })
  assert.deepEqual(items.edgesOf(98, 300, 200), { start: true, end: false })
  // 滚过了头（浮起来的格子撑出来的地方）也不会两头都亮
  assert.deepEqual(items.edgesOf(60, 48, 48), { start: false, end: false })
})

test('火把一直在工具条上：没有时是 0，点开说怎么做出来（2026-11-11 用户转述的反馈）', () => {
  const me = {
    chances: 3, shield: false, shields: 0, spyglasses: 0, peeks: [], points: 0, digs: 1, status: 'playing', lastResult: null,
    items: { torch: 0, map: 0, potion: 0, ender: 0, table: 0, key: 0, pick: { h: 0, v: 0, x: 0 } }, coal: 1, stick: 0,
  }
  assert.deepEqual(items.slotsOf(me, true, 2), { active: ['torch', 'coal'], passive: [] })
  assert.equal(items.countOf(me, 'torch'), 0)
  const about = items.aboutSlot('torch', me, true, 1, null, 2)
  assert.equal(about.count, '还没有')
  assert.match(about.words, /^还没有火把。煤炭和木棍各挖到一个，会自动做成一个。插在挖开的格子上/)
  // 2026-11-13 起的局一合成 4 个（rules.craftTorches）
  assert.match(items.aboutSlot('torch', me, true, 1, null, 2, 4).words, /^还没有火把。煤炭和木棍各挖到一个，会自动做成 4 个。插在/)
  assert.match(items.aboutSlot('torch', { ...me, items: { ...me.items, torch: 2 } }, true, 1, null, 2).words, /^插在挖开的格子上/)
  // 没有道具栏的局没有火把
  assert.deepEqual(items.slotsOf({ ...me, items: undefined, coal: 0 }, false), { active: [], passive: [] })
})

test('区块的样子（layout.ts）：铁轨按游戏站给的形状、以前的局是横着的一排；正中的装饰是铜灯；幽匿块按卡号定、不压固定格子', () => {
  const old = { kind: 'mine', size: 6, fixed: { 13: 'deco', 14: 'deco' } }
  assert.equal(layout.railOf(old, 13), 'ew')
  assert.equal(layout.railOf(old, 12), null)
  assert.equal(layout.railOf({ ...old, rails: { 13: 'se', 14: 'nw' } }, 13), 'se')
  assert.equal(layout.railOf({ kind: 'trial', size: 7, fixed: { 13: 'deco' } }, 13), null)
  assert.deepEqual(layout.RAIL_TEXTURE.sw, { corner: true, turn: 90 })
  assert.equal(layout.isBulb({ kind: 'trial', size: 7, fixed: { 24: 'deco', 0: 'deco' } }, 24), true)
  assert.equal(layout.isBulb({ kind: 'trial', size: 7, fixed: { 24: 'deco', 0: 'deco' } }, 0), false)
  const deep = { id: 42, kind: 'deep', size: 7, fixed: { 3: 'deco' } }
  const sculk = layout.sculkOf(deep)
  assert.ok(sculk.size >= 2 && sculk.size <= 14, String(sculk.size))
  assert.equal(sculk.has(3), false)
  assert.ok([...sculk.values()].every(frame => frame >= 0 && frame <= 3))
  assert.deepEqual([...layout.sculkOf({ ...deep })], [...sculk])
  assert.equal(layout.sculkOf({ id: 1, kind: 'mine', size: 6 }).size, 0)
})

test('三方积分红包（docs/V3_ITEMS.md §11）：数是多少个最小单位，写法跟着最小单位；余量的“约”也一样', () => {
  assert.equal(types.formatUnits(10000), '100.00')
  assert.equal(types.formatUnits(2000, '1'), '2000')
  assert.equal(types.formatUnits(3, '0.5'), '1.5')
  assert.equal(types.formatUnits(3, '100'), '300')
  assert.equal(types.formatUnits(-7, '0.25'), '-1.75')
  try {
    types.setMoneyStep('1')
    assert.equal(types.money(1234), '1234')
    // 红包站说领到 "66"（积分）：就是 66 个最小单位
    assert.equal(types.unitsOf('66'), 66)
    assert.equal(regions.aboutMoney(1234), '1234')
    types.setMoneyStep('0.5')
    assert.equal(types.money(3), '1.5')
    assert.equal(regions.aboutMoney(3), '1.5')
    types.setMoneyStep(undefined)
    assert.equal(types.unitsOf('12.34'), 1234)
    assert.equal(types.money(1234), '12.34')
    assert.equal(regions.aboutMoney(1234), '12.3')
    assert.equal(regions.aboutMoney(40), '0.40')
  } finally {
    types.setMoneyStep(undefined)
  }
})

// docs/V3_ITEMS.md §13（2026-11-12）：引导只弹一次、说明从玩家的角度写、最后一下先问一句
test('道具说明只写玩家用得上的：不说机会、不说用掉几个，数在标题行；规矩最多一句小字', () => {
  const me = {
    uid: 1, name: 'a', chances: 5, shield: false, shields: 2, spyglasses: 1, peeks: [], points: 300, digs: 3, status: 'playing', lastResult: null,
    items: { torch: 1, map: 1, potion: 1, ender: 1, table: 1, key: 1, pick: { h: 2, v: 1, x: 1 } }, coal: 1, stick: 0, poison: 2,
  }
  const slots = ['pickaxe', 'pick-h', 'pick-v', 'pick-x', 'spyglass', 'torch', 'key', 'map', 'potion', 'ender', 'table', 'shield', 'coal', 'stick', 'poison']
  for (const version of [1, 2]) {
    for (const slot of slots) {
      const about = items.aboutSlot(slot, me, true, 3, null, version)
      for (const text of [about.words, about.rule ?? '']) {
        assert.doesNotMatch(text, /机会|不花|用掉|同一处/, `${slot} 第 ${version} 版：${text}`)
      }
      if (about.rule) assert.equal(about.rule.split('。').filter(Boolean).length, 1, `${slot} 的小字只有一句：${about.rule}`)
    }
  }
  assert.deepEqual(items.aboutSlot('pickaxe', me, true, 3, null, 2), { count: '还剩 5 次', words: '点没挖开的格子就能挖。', rule: '两次之间至少隔 3 秒。' })
  assert.equal(items.aboutSlot('pickaxe', me, true, 1, null, 2).rule, undefined)
  assert.equal(items.aboutSlot('pick-x', me, true, 1, null, 2).words, '一下挖开十字形的 5 格。')
  assert.equal(items.aboutSlot('stick', { ...me, coal: 0, stick: 1 }, true, 1, null, 2).words, '再挖到一块煤炭，就自动做成一个火把。')
  assert.equal(items.aboutSlot('coal', { ...me, coal: 1, stick: 0 }, true, 1, null, 2, 4).words, '再挖到一根木棍，就自动做成 4 个火把。')
})

test('怎么点：触屏“点…预览，再点一下确认”，鼠标“指着预览，点一下确认”；步骤条只接一句', () => {
  assert.equal(items.howToAim('torch', 2), '在地图上点挖开的格子预览，再点一下确认。')
  assert.equal(items.howToAim('key', 2), '在地图上点宝库预览，再点一下确认。')
  assert.equal(items.howToAim('pick-h', 2), '在地图上点一格预览，再点一下确认。')
  assert.equal(items.howToAim('spyglass', 2, true), '鼠标指着预览，点一下确认。')
  assert.equal(items.confirmWords(false), '再点一下确认')
  assert.equal(items.confirmWords(true), '点一下确认')
})

test('引导学过一次就记住（这台设备）；三种附魔镐算一种；存不了照旧弹', () => {
  const saved = globalThis.localStorage
  const data = new Map()
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) }
  try {
    assert.equal(items.knowsGuide('torch'), false)
    items.learnGuide('torch')
    assert.equal(items.knowsGuide('torch'), true)
    assert.equal(items.knowsGuide('spyglass'), false)
    items.learnGuide('pick-h')
    assert.equal(items.knowsGuide('pick-x'), true)
    // 以前选过“不再提示”的记在同一个地方，算学过
    data.set('kddb:v3:skip-guide', JSON.stringify(['key']))
    assert.equal(items.knowsGuide('key'), true)
    globalThis.localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    assert.equal(items.knowsGuide('torch'), false)
    items.learnGuide('torch')
  } finally {
    globalThis.localStorage = saved
  }
})

test('最后一下：镐子、附魔镐只剩这一下、没有附魔台才算；手里还有钥匙、望远镜、火把、藏宝图才问', () => {
  const me = {
    uid: 1, name: 'a', chances: 1, shield: false, shields: 0, spyglasses: 1, peeks: [], points: 300, digs: 3, status: 'playing', lastResult: null,
    items: { torch: 0, map: 1, potion: 1, ender: 1, table: 0, key: 0, pick: { h: 0, v: 0, x: 0 } }, coal: 0, stick: 0,
  }
  assert.equal(items.isLastDig(me, 'pickaxe'), true)
  assert.deepEqual(items.leftoversOf(me), ['spyglass', 'map'])
  // 还有附魔镐、附魔台：镐子用完还能挖，不算最后一下
  assert.equal(items.isLastDig({ ...me, items: { ...me.items, pick: { h: 1, v: 0, x: 0 } } }, 'pickaxe'), false)
  assert.equal(items.isLastDig({ ...me, items: { ...me.items, table: 1 } }, 'pickaxe'), false)
  assert.equal(items.isLastDig({ ...me, chances: 2 }, 'pickaxe'), false)
  // 镐子用完了，最后一把附魔镐的最后一次
  const picks = { ...me, chances: 0, items: { ...me.items, pick: { h: 0, v: 1, x: 0 } } }
  assert.equal(items.isLastDig(picks, 'v'), true)
  assert.equal(items.isLastDig({ ...picks, items: { ...picks.items, pick: { h: 1, v: 1, x: 0 } } }, 'v'), false)
  // 药水、末影箱不提醒；什么都没有就不问
  assert.deepEqual(items.leftoversOf({ ...me, spyglasses: 0, items: { ...me.items, map: 0 } }), [])
})

// docs/V3_ITEMS.md §15（2026-11-12）：余量按区块和挖到哪一段，用乱码、模糊、准数之一说
test('余量怎么说：开头、中段、收尾三段，各区块不一样；固定的格子不算没挖开', () => {
  const at = (kind, size, dug, fixed = {}) => {
    const cells = Array.from({ length: size * size }, (_, index) => index < dug ? { kind: 'stone', uid: 1, name: 'a', at: 1 } : null)
    return { kind, cells, fixed }
  }
  // 普通 5×5：挖开 5 格（两成）是开头，挖开 10 格是中段，剩 6 格是收尾
  assert.deepEqual(regions.tellOf(at(undefined, 5, 5)), { tell: 'garble', covered: 20 })
  assert.deepEqual(regions.tellOf(at(undefined, 5, 10)), { tell: 'fuzzy', covered: 15 })
  assert.deepEqual(regions.tellOf(at(undefined, 5, 19)), { tell: 'exact', covered: 6 })
  // 7×7 剩不到两成（9 格）也是收尾
  assert.equal(regions.tellOf(at(undefined, 7, 40)).tell, 'exact')
  assert.equal(regions.tellOf(at('mine', 6, 15)).tell, 'garble')
  assert.equal(regions.tellOf(at('mine', 6, 31)).tell, 'exact')
  assert.equal(regions.tellOf(at('trial', 6, 31)).tell, 'fuzzy')
  assert.equal(regions.tellOf(at('nether', 6, 2)).tell, 'fuzzy')
  assert.equal(regions.tellOf(at('nether', 6, 15)).tell, 'exact')
  assert.equal(regions.tellOf(at('deep', 7, 30)).tell, 'garble')
  assert.equal(regions.tellOf(at('deep', 7, 44)).tell, 'fuzzy')
  assert.equal(regions.tellOf(at('end', 3, 0)).tell, 'exact')
  // 宝库、装饰这些固定的格子不算没挖开
  assert.equal(regions.coveredOf(at('trial', 5, 0, { 3: 'vault', 7: 'deco' })), 23)
  assert.equal(regions.PLENTY, 4)
})
