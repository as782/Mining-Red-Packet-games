import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// 这一局的规矩是谁定的（v3/src/ownerRules.ts，docs/V3_ITEMS.md §21）：一样一行，用发红包表单里的词，规矩里没有的不写。
let server
let owner
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  owner = await server.ssrLoadModule('/v3/src/ownerRules.ts')
})
after(async () => { await server?.close() })

const base = { difficulty: 'normal', smallReward: 29, tntPercent: 25, initialChances: 20, appleCap: 0, totemBonus: 3, bigMultiplier: 5 }

test('新局：难度带 TNT 和末影水晶扣多少，镐子、苦力怕、末影之眼、奖池和绿宝石的价', () => {
  const rows = owner.ruleRows({ ...base, difficulty: 'tough', tntPercent: 50, items: 2, creeper: 60, eyeEvery: 3, digInterval: 10 }, 10000, 'LDC')
  assert.deepEqual(rows, [
    { label: '难度', value: '困难：踩中 TNT，待领取的扣掉一半；挖到末影水晶全部扣光' },
    { label: '镐子', value: '每人能挖 20 下，两下之间要隔 10 秒' },
    { label: '苦力怕', value: '手上有待领取的、1 分钟不挖，会来炸掉 20%' },
    { label: '末影之眼', value: '每 3 张卡藏一颗' },
    { label: '奖池', value: '100.00 LDC，绿宝石每颗 0.29' },
  ])
})

test('关掉的写“这一局没有”；间隔 1 秒不提；3 分钟写分钟', () => {
  const rows = owner.ruleRows({ ...base, difficulty: 'easy', tntPercent: 15, items: 2, creeper: 0, eyeEvery: 0 }, 500, '🐟')
  assert.deepEqual(rows.map(row => row.value), ['简单：踩中 TNT，待领取的扣掉 15%', '每人能挖 20 下', '这一局没有', '这一局没有', '5.00 🐟，绿宝石每颗 0.29'])
  assert.equal(owner.ruleRows({ ...base, items: 2, creeper: 180 }, 500, 'LDC')[2].value, '手上有待领取的、3 分钟不挖，会来炸掉 20%')
})

test('以前开的局：规矩里没有苦力怕、末影之眼的就不写', () => {
  assert.deepEqual(owner.ruleRows(base, 1000, 'LDC').map(row => row.label), ['难度', '镐子', '奖池'])
})

test('谁的矿洞：红包站还没给名字时不编一个', () => {
  assert.equal(owner.ownerTitle('小明'), '小明的矿洞')
  assert.equal(owner.ownerWords('小明'), '这一局的规矩是小明定的')
  assert.equal(owner.ownerTitle(null), '这一局的矿洞')
  assert.equal(owner.ownerWords(null), '这一局的规矩是发红包的人定的')
})
