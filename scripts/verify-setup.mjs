// tests.json skips setup. Verify the actual opening/dealing path and its seeded
// replay in workerd; enumerate composition boundaries separately in Node.
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { openSandbox } from '../cli/lib/sandbox.mjs'
import { setupSeed } from '../runtime/seeds.mjs'
import { paramValues, readParams } from '../runtime/params.mjs'
import { judgeNext, startScenario } from '../runtime/scenario.mjs'
import { params as declarations, setup } from '../judge.js'

const sandbox = await openSandbox(await readFile(new URL('../judge.js', import.meta.url), 'utf8'))
const declared = readParams(declarations)
assert.ok(declared.list, JSON.stringify(declared.problems))
const valuesOf = given => {
  const read = paramValues(declared.list, given)
  assert.ok(read.values, JSON.stringify(read.problems))
  return read.values
}
const params = valuesOf({})
// count/minEach are official runtime compatibility fields, not game share limits.
const pool = { title: 'setup verification', total: 10000, count: 100, minEach: 1 }
const now = Date.parse('2026-10-31T12:00:00+08:00')
const kinds = ['emerald', 'diamond', 'apple', 'totem', 'tnt', 'pearl', 'shield', 'spyglass']
const bases = {
  5: { emerald: 11, diamond: 3, apple: 1, totem: 2, tnt: 4, pearl: 1, shield: 2, spyglass: 1 },
  6: { emerald: 14, diamond: 4, apple: 2, totem: 3, tnt: 6, pearl: 1, shield: 3, spyglass: 3 },
  7: { emerald: 20, diamond: 6, apple: 2, totem: 4, tnt: 8, pearl: 1, shield: 4, spyglass: 4 },
}
const presets = {
  easy: { initialChances: 9, tntPercent: 15, compositionVariation: 'fixed', tnt: [3, 4, 6] },
  hard: { initialChances: 7, tntPercent: 25, compositionVariation: 'slight', tnt: [4, 6, 8] },
  hell: { initialChances: 4, tntPercent: 75, compositionVariation: 'slight', tnt: [8, 12, 17] },
}
let checks = 0
const checked = (condition, message) => { assert.ok(condition, message); checks++ }
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++ }
const sizesSeen = new Set()
const metrics = { maxStateBytes: 0, maxPublicBytes: 0 }
function inspect(opened) {
  checked(opened && !opened.failure, JSON.stringify(opened))
  const state = opened.state.value
  const view = opened.view.value.data
  checked([5, 6, 7].includes(state.size))
  equal(state.version, 2)
  equal(view.version, 2)
  equal(view.size, state.size)
  equal(state.deck.length, state.size ** 2)
  equal(state.opened.length, state.deck.length)
  equal(view.cells.length, state.deck.length)
  const actual = Object.fromEntries(kinds.map(kind => [kind, state.deck.filter(value => value === kind).length]))
  equal(actual, state.composition)
  equal(view.composition, actual)
  equal(view.counts, actual)
  equal(actual.pearl, 1)
  equal(actual.spyglass, bases[state.size].spyglass)
  equal(actual.apple, bases[state.size].apple)
  checked(view.cells.every(cell => cell.kind === null && cell.by === null && cell.at === null))
  checked(!['deck', 'opened', 'seed', 'peeks'].some(key => key in view))
  equal(view.rules, state.rules)
  metrics.maxStateBytes = Math.max(metrics.maxStateBytes, Buffer.byteLength(JSON.stringify(state)))
  metrics.maxPublicBytes = Math.max(metrics.maxPublicBytes, Buffer.byteLength(JSON.stringify(view)))
  return { state, view }
}
const secret = 'a'.repeat(64)
const open = (given = params, seed = secret) => sandbox.setup(given, pool, { now, seed: setupSeed('review', seed) })
const scenarioFrom = (opened, values) => startScenario({
  hongbao: { ...pool, openedAt: now - 60000, endsAt: now + 86400000 },
  hongbaoId: 'review', secret, params: values,
  state: structuredClone(opened.state.value), view: structuredClone(opened.view.value),
})
const user = (id, username = `玩家${id}`) => ({ id, username, level: 2 })
async function move(scenario, id, input, step = 0) {
  const result = await judgeNext(scenario, { user: user(id), input, at: now + step * 1000 }, sandbox.run)
  checked(!result.refused && result.answer && !result.answer.failure && result.reading && !result.reading.error, JSON.stringify(result))
  return result
}

try {
  equal(sandbox.declarations.problems, [])
  equal(params, { difficulty: 'hard', boardSpec: 'random', smallReward: 10, initialChances: 7, tntPercent: 25, waitSeconds: 10, compositionVariation: 'slight' })
  const first = await open()
  inspect(first)
  equal(first, await open(), '同种子完整重放 setup')
  checked(JSON.stringify(first.state.value.deck) !== JSON.stringify((await open(params, 'b'.repeat(64))).state.value.deck), '不同种子的牌序有区别')

  for (const [difficulty, preset] of Object.entries(presets)) {
    for (const [offset, size] of [5, 6, 7].entries()) {
      const values = valuesOf({ difficulty, boardSpec: String(size), initialChances: preset.initialChances, tntPercent: preset.tntPercent, compositionVariation: 'fixed' })
      const { state, view } = inspect(await open(values))
      equal(state.size, size)
      const expected = { ...bases[size], tnt: preset.tnt[offset] }
      expected.emerald += bases[size].tnt - expected.tnt
      equal(state.composition, expected, `${difficulty} ${size}x${size} 固定构成`)
      equal(view.rules.initialChances, preset.initialChances)
      equal(view.rules.tntPercent, preset.tntPercent)
      equal(view.rules.totemBonus, 3)
    }
  }

  // A finite sample checks all three random branches are reachable. It does not
  // claim statistical fairness; equal selection is also reviewed in source.
  for (let sample = 0; sample < 36; sample++) {
    const opened = await open(params, sample.toString(16).padStart(64, '0'))
    const { state } = inspect(opened)
    sizesSeen.add(state.size)
  }
  equal([...sizesSeen].sort(), [5, 6, 7])

  // A refresh/new player does not deal again. Saved rules control an existing
  // v2 game even if submission params contain different final author values.
  const fixed = valuesOf({ boardSpec: '7', compositionVariation: 'fixed' })
  const opened = await open(fixed)
  const scenario = scenarioFrom(opened, fixed)
  const emerald = scenario.state.deck.indexOf('emerald')
  scenario.params = valuesOf({ difficulty: 'hell', boardSpec: '5', initialChances: 1, tntPercent: 100, smallReward: 20, compositionVariation: 'slight' })
  await move(scenario, 1, `dig 1 ${emerald + 1}`)
  equal(scenario.state.rules, opened.state.value.rules, '生效规则存档，不随之后的提交参数漂移')
  equal(scenario.state.size, 7)
  equal(scenario.state.composition, opened.state.value.composition)
  equal(scenario.state.deck, opened.state.value.deck)
  equal(scenario.people.get(1).pending, 10)
  equal(scenario.people.get(1).state.chances, 6)
  const beforeRejection = structuredClone({ state: scenario.state, view: scenario.view })
  await move(scenario, 2, `dig 1 ${emerald + 1}`, 1)
  equal({ state: scenario.state, view: scenario.view }, beforeRejection, '抢同格不变更卡、机会或接棒记录')
  equal(scenario.people.get(2).state, null)

  const pearl = scenario.state.deck.indexOf('pearl')
  await move(scenario, 2, `dig 1 ${pearl + 1}`, 2)
  equal(scenario.state.cardId, 2)
  equal(scenario.state.size, 7, '新卡仍使用存档的固定规格')
  equal(scenario.view.data.lastMove.size, 7)
  equal(scenario.people.get(2).state.lastResult.size, 7)
  equal(scenario.view.data.feed[0].size, 7)
  equal(scenario.state.composition.pearl, 1)
  const beforeStale = structuredClone({ state: scenario.state, view: scenario.view })
  await move(scenario, 3, `dig 1 ${pearl + 1}`, 3)
  equal({ state: scenario.state, view: scenario.view }, beforeStale, '旧卡命令不转投新卡')
  equal(scenario.people.get(3).state, null)

  const spy = scenario.state.deck.indexOf('spyglass')
  await move(scenario, 1, `dig 2 ${spy + 1}`, 4)
  const peeks = scenario.people.get(1).view.data.peeks
  checked(peeks.length > 0)
  for (const peek of peeks) {
    equal(scenario.view.data.cells[peek.index].kind, null)
    equal(peek.kind, scenario.state.deck[peek.index])
  }
  checked(!('peeks' in scenario.view.data) && !('deck' in scenario.view.data))
  equal(scenario.people.get(2).view.data.peeks, [], '其他玩家看不到本人望远镜情报')

  const valid = await sandbox.check(params, { ...pool, total: 50 })
  const invalid = await sandbox.check(params, { ...pool, total: 49 })
  equal(valid.problems, [])
  equal(invalid.problems[0].key, 'smallReward')
  const large = await sandbox.check({ ...params, smallReward: Math.floor(Number.MAX_SAFE_INTEGER / 5) }, { ...pool, total: Number.MAX_SAFE_INTEGER })
  equal(large.problems, [])

  // Enumerate all 81 sequences of four ternary draws for each size/difficulty
  // through the production setup export. No private generator is copied here.
  // The first four draws are the four allowed variations; shuffle draws follow.
  let compositionCases = 0
  const originalRandom = Math.random
  try {
    for (const difficulty of Object.keys(presets)) for (const size of [5, 6, 7]) for (let sequence = 0; sequence < 81; sequence++) {
      const draws = Array.from({ length: 4 }, (_, index) => (Math.floor(sequence / 3 ** index) % 3 + 0.5) / 3)
      let draw = 0
      Math.random = () => draws[draw++] ?? 0.5
      const generated = setup(valuesOf({ difficulty, boardSpec: String(size), compositionVariation: 'slight' }))
      const composition = generated.state.composition
      const baselineTnt = presets[difficulty].tnt[size - 5]
      assert.equal(generated.state.deck.length, size ** 2)
      assert.equal(Object.values(composition).reduce((sum, count) => sum + count, 0), size ** 2)
      assert.ok(Object.values(composition).every(count => Number.isInteger(count) && count >= 0))
      assert.equal(composition.pearl, 1)
      assert.equal(composition.spyglass, bases[size].spyglass)
      assert.equal(composition.apple, bases[size].apple)
      for (const kind of ['diamond', 'totem', 'tnt', 'shield']) assert.ok(Math.abs(composition[kind] - (kind === 'tnt' ? baselineTnt : bases[size][kind])) <= 1)
      compositionCases++
    }
  } finally { Math.random = originalRandom }
  equal(compositionCases, 729)
  checked(metrics.maxStateBytes < 65536 && metrics.maxPublicBytes < 16384)

  console.log(JSON.stringify({ checks, compositionCases, randomSizesReached: [...sizesSeen].sort(), ...metrics, setupReproducible: true, savedRulesStable: true, privatePeeksIsolated: true, crossFieldCheck: true }))
} finally {
  await sandbox.close()
}
