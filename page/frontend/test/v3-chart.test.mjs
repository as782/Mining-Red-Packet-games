import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// 收益卡的曲线（v3/src/chart.ts）和自己挖到东西时放哪个音效（v3/src/sound.ts）。
let server
let chart
let sound
let quips
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  chart = await server.ssrLoadModule('/v3/src/chart.ts')
  sound = await server.ssrLoadModule('/v3/src/sound.ts')
  quips = await server.ssrLoadModule('/v3/src/quips.ts')
})
after(async () => { await server?.close() })

const box = { width: 100, height: 60, padX: 0, padTop: 10, padBottom: 0 }

test('从 0 分起，最高的点在最上面，最后一格是手里的分', () => {
  const trail = [{ k: 'emerald', a: 10, p: 10 }, { k: 'diamond', a: 50, p: 60 }, { k: 'tnt', a: -30, p: 30 }]
  const out = chart.chartOf(trail, box)
  assert.equal(out.line, 'M0,60L33.3,51.7L66.7,10L100,35')
  assert.equal(out.baseY, 60)
  assert.ok(out.area.endsWith('L100,60L0,60Z'))
  assert.deepEqual(out.peak, { x: 66.7, y: 10, points: 60 })
  assert.deepEqual(out.end, { x: 100, y: 35, points: 30 })
  assert.deepEqual(out.markers.map(marker => [marker.step, marker.mark]), [[2, 'big'], [3, 'boom']])
})

test('盾牌挡住、金苹果、末影水晶打点；扣到 0 的雷也算；一直 0 分没有最高点', () => {
  const trail = [{ k: 'apple', a: 10, p: 10 }, { k: 'crystal', a: 0, p: 10, b: 1 }, { k: 'crystal', a: -10, p: 0 }]
  const out = chart.chartOf(trail, box)
  assert.deepEqual(out.markers.map(marker => marker.mark), ['apple', 'blocked', 'boom'])
  const flat = chart.chartOf([{ k: 'totem', a: 0, p: 0 }], box)
  assert.equal(flat.peak, null)
  assert.equal(flat.markers.length, 0)
})

test('线上挂的图标按加减多少挑、挨得近的跳过；条形码加往上扣往下；图例按物品排、不加不减的合成其他', () => {
  const trail = [
    { k: 'emerald', a: 10, p: 10 }, { k: 'diamond', a: 50, p: 60 }, { k: 'coal', a: 0, p: 60 }, { k: 'tnt', a: -20, p: 40 },
    { k: 'poison', a: -2, p: 38 }, { k: 'tnt', a: 0, p: 38, b: 1 }, { k: 'debris', a: 100, p: 138 }, { k: 'crystal', a: -69, p: 69 },
  ]
  const wide = { width: 320, height: 132, padX: 0, padTop: 10, padBottom: 0 }
  const out = chart.chartOf(trail, wide)
  // 绿宝石、中毒、煤炭不挂；挡住的按一笔中等的算
  assert.deepEqual(chart.picksOf(out).map(point => point.kind), ['diamond', 'tnt', 'tnt', 'debris', 'crystal'])
  // 挨得近（图上 100 以内）就只留加减最多的
  assert.deepEqual(chart.picksOf(out, 6, 100).map(point => point.kind), ['diamond', 'debris'])
  assert.deepEqual(chart.picksOf(out, 2).map(point => point.kind), ['debris', 'crystal'])
  const bars = chart.barsOf(out)
  assert.equal(bars.length, 8)
  assert.deepEqual(bars.map(bar => Math.sign(bar.size)), [1, 1, 0, -1, -1, 1, 1, -1])
  assert.equal(bars[6].size, 1)
  assert.equal(bars[2].color, chart.COLORS.other)
  assert.equal(bars[5].color, chart.COLORS.blocked)
  assert.deepEqual(chart.legendOf(out).map(entry => [entry.key, entry.count]),
    [['debris', 1], ['diamond', 1], ['emerald', 1], ['blocked', 1], ['tnt', 1], ['crystal', 1], ['poison', 1], ['other', 1]])
})

test('图下面六格：平均每格按挖到的算；踩到雷（挡住的也算）断开连着没踩雷；扣掉的分开记，存进末影箱不算', () => {
  const trail = [
    { k: 'emerald', a: 10, p: 10 }, { k: 'diamond', a: 50, p: 60 }, { k: 'tnt', a: 0, p: 60, b: 1 }, { k: 'emerald', a: 10, p: 70 },
    { k: 'emerald', a: 10, p: 80 }, { k: 'coal', a: 0, p: 80 }, { k: 'tnt', a: -20, p: 60 }, { k: 'poison', a: -3, p: 57 },
    { k: 'ender', a: -28, p: 29 }, { k: 'creeper', a: -5, p: 24 },
  ]
  assert.deepEqual(chart.statsOf(trail), { digs: 7, average: 11, longest: 3, blocked: 1, lost: 28, bomb: 20, poison: 3, other: 5 })
  assert.deepEqual(chart.statsOf([]), { digs: 0, average: 0, longest: 0, blocked: 0, lost: 0, bomb: 0, poison: 0, other: 0 })
})

test('挖到什么放什么：挡住是格挡声，重复盾牌和望远镜转小奖是经验球，珍珠和眼跟着动画放', () => {
  const of = (kind, amount = 0, blocked = false) => sound.soundOfResult({ kind, amount, blocked })
  assert.equal(of('emerald', 10), 'emerald')
  assert.equal(of('diamond', 50), 'diamond')
  assert.equal(of('tnt', -5), 'tnt')
  assert.equal(of('crystal', -5), 'crystal')
  assert.equal(of('tnt', 0, true), 'block')
  assert.equal(of('shield'), 'shield')
  assert.equal(of('shield', 10), 'emerald')
  assert.equal(of('spyglass', 10), 'emerald')
  assert.equal(of('pearl'), null)
  assert.equal(of('eye'), null)
})

test('最大的一笔和扣得最多的一下（中毒、苦力怕也算）；拖到哪一步说哪一步', () => {
  const trail = [
    { k: 'emerald', a: 10, p: 10 }, { k: 'diamond', a: 50, p: 60 }, { k: 'tnt', a: -15, p: 45 }, { k: 'apple', a: 45, p: 90 },
    { k: 'creeper', a: -18, p: 72 }, { k: 'tnt', a: 0, p: 72, b: 1 }, { k: 'emerald', a: 10, p: 82 },
  ]
  const out = chart.chartOf(trail, box)
  assert.deepEqual([out.best.kind, out.best.amount], ['diamond', 50])
  assert.deepEqual([out.worst.kind, out.worst.amount], ['creeper', -18])
  const money = points => (points / 100).toFixed(2)
  assert.equal(out.points.length, 8)
  const names = { emerald: '绿宝石', diamond: '钻石' }
  assert.equal(chart.pointWords(chart.pointAt(out, 0), money, names), '开始：待领取 0.00')
  assert.equal(chart.pointWords(chart.pointAt(out, 29), money, names), '第 2 次挖 · 钻石 +0.50 · 待领取 0.60')
  assert.equal(chart.pointWords(chart.pointAt(out, 72), money, names), '苦力怕 -0.18 · 待领取 0.72')
  assert.equal(chart.pointWords(chart.pointAt(out, 100), money, names), '第 6 次挖 · 绿宝石 +0.10 · 待领取 0.82')
})

test('一局的评语：100 条以上，称号不长、一句不长；对得上的条件里按少见程度抽，同一局每次一样，数换进句子', () => {
  const all = Object.values(quips.QUIPS).flatMap(group => group.lines)
  assert.ok(all.length >= 100, String(all.length))
  for (const [key, group] of Object.entries(quips.QUIPS)) {
    assert.ok(group.lines.length >= 2, key)
    assert.ok(quips.RARITY[key] > 0, key)
  }
  for (const [title, line] of all) {
    assert.ok([...title].length >= 2 && [...title].length <= 6, title)
    // 换进去的数按 4 个字算
    assert.ok([...line.replace(/\{\w+\}/g, '1234')].length <= 34, line)
  }
  const money = points => (points / 100).toFixed(2)
  const summary = (trail, extra = {}) => ({ me: { name: '我', status: 'playing', points: trail.at(-1)?.p ?? 0, digs: trail.filter(step => !['poison', 'creeper', 'warden', 'ender', 'vault'].includes(step.k)).length, trail, best: 0, tnt: 0, blocked: 0, lost: 0, ...extra }, top: [], over: false })
  // 第一下就是钻石，又有 3 颗钻石：两个都对得上，都会被抽到，第一下钻石更少见、抽到得多；同一局每次一样
  const diamonds = [{ k: 'diamond', a: 50, p: 50 }, { k: 'diamond', a: 50, p: 100 }, { k: 'emerald', a: 10, p: 110 }, { k: 'diamond', a: 50, p: 160 }]
  const facts = quips.factsOf(summary(diamonds), 7)
  assert.deepEqual(quips.keysOf(facts).slice(0, 2), ['firstDiamond', 'diamonds'])
  const picked = { firstDiamond: 0, diamonds: 0 }
  for (let n = 0; n < 400; n++) picked[quips.quipOf(facts, `hb${n}:7:4`, money).key] += 1
  assert.ok(picked.firstDiamond > picked.diamonds && picked.diamonds > 60, JSON.stringify(picked))
  const one = quips.quipOf(facts, 'hb1:7:4', money)
  assert.deepEqual(quips.quipOf(facts, 'hb1:7:4', money), one)
  // 新的几个条件：开出新卡、开宝库、存末影箱、跌下去又挖回来、连着有进账
  const busy = [{ k: 'pearl', a: 0, p: 0 }, { k: 'emerald', a: 10, p: 10 }, { k: 'pearl', a: 0, p: 10 }, { k: 'vault', a: 30, p: 40 }, { k: 'tnt', a: -30, p: 10 }, { k: 'ender', a: -5, p: 5 }, { k: 'diamond', a: 50, p: 55 }]
  const busyKeys = quips.keysOf(quips.factsOf(summary(busy), 7))
  for (const key of ['pearls', 'vaults', 'ender', 'comeback']) assert.ok(busyKeys.includes(key), `${key} ${busyKeys}`)
  const hot = Array.from({ length: 7 }, (_, n) => ({ k: 'emerald', a: 10, p: 10 * (n + 1) }))
  assert.equal(quips.factsOf(summary(hot), 7).streak, 7)
  assert.ok(quips.keysOf(quips.factsOf(summary(hot), 7)).includes('streak'))
  // 过山车：数换进句子
  const coaster = [{ k: 'emerald', a: 10, p: 10 }, { k: 'debris', a: 0, p: 10 }, { k: 'apple', a: 90, p: 100 }, { k: 'emerald', a: 10, p: 110 }, { k: 'tnt', a: -80, p: 30 }, { k: 'emerald', a: 10, p: 40 }]
  const ride = quips.factsOf(summary(coaster), 7)
  assert.ok(quips.keysOf(ride).includes('coaster'))
  let rides = 0
  for (let n = 0; n < 60; n++) {
    const text = quips.quipOf({ ...ride, debris: false }, `s${n}`, money)
    assert.ok(!text.line.includes('{'), text.line)
    if (text.key !== 'coaster') continue
    rides += 1
    if (text.line.includes('{') || /最高|跌|冲|跳|起伏/.test(text.line)) assert.ok(text.line.includes('0.40'), text.line)
  }
  assert.ok(rides > 0)
  // 挖了 12 格一分没有；全场第一；什么都没对上
  const nothing = Array.from({ length: 12 }, () => ({ k: 'spyglass', a: 0, p: 0 }))
  assert.equal(quips.quipOf(quips.factsOf(summary(nothing), 7), 'x', money).key, 'empty')
  const top = { ...summary([{ k: 'emerald', a: 10, p: 10 }]), top: [{ uid: 7, name: '我', points: 10 }] }
  assert.equal(quips.quipOf(quips.factsOf(top, 7), 'x', money).key, 'top')
  assert.equal(quips.quipOf(quips.factsOf(summary([{ k: 'emerald', a: 10, p: 10 }]), 7), 'x', money).key, 'gained')
  // 没有逐格记录的老局：只按游戏站给的几个数
  const old = { me: { name: '我', status: 'claimed', points: 30, digs: 3, trail: null, best: 20, tnt: 0, blocked: 0, lost: 0 }, top: [], over: false }
  assert.equal(quips.quipOf(quips.factsOf(old, 7), 'x', money).key, 'quick')
})

test('手上是 0 时踩到 TNT（没扣到）也算踩雷：条形码里是红的、往下一小截，图例算进 TNT', () => {
  const out = chart.chartOf([{ k: 'tnt', a: 0, p: 0 }, { k: 'emerald', a: 10, p: 10 }, { k: 'coal', a: 0, p: 10 }], box)
  const bars = chart.barsOf(out)
  assert.deepEqual([bars[0].color, bars[0].size], [chart.COLORS.tnt, -0.25])
  assert.deepEqual(chart.legendOf(out).map(entry => entry.key), ['emerald', 'tnt', 'other'])
  assert.equal(chart.statsOf([{ k: 'tnt', a: 0, p: 0 }, { k: 'emerald', a: 10, p: 10 }]).longest, 1)
})
