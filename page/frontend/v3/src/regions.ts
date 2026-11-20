// 卡周围的说明（docs/V3_ITEMS.md §9）：区块叫什么、点问号看的说明、卡下面的余量和深暗之域的噪音。
// 纯函数，网页和测试共用。
import type { IconKind } from '../../src/game'
import type { Biome, Kind, PublicCard, Rules } from './types'
import { BIOME_NAMES, currentStep, decimalsOf, stepMinor } from './types'

/** 卡上面那一行的名字：区块名，普通卡是第几张。 */
export const regionName = (card: Pick<PublicCard, 'id' | 'kind'>) => (card.kind ? BIOME_NAMES[card.kind] : `第 ${card.id} 张卡`)

/** 说明弹窗的图标。 */
export function regionIcon(card: Pick<PublicCard, 'kind'>): IconKind {
  switch (card.kind) {
    case 'trial': return 'vault'
    case 'mine': return 'minecart'
    case 'nether': return 'debris'
    case 'deep': return 'sculk'
    case 'end': return 'eye'
    default: return 'pickaxe'
  }
}

/** 点区块名字旁边的问号看的说明（一两段，大白话）。 */
export function regionAbout(card: Pick<PublicCard, 'kind'>, rules: Pick<Rules, 'items' | 'tntPercent' | 'special' | 'loot'>): string[] {
  const cobweb = (rules.items ?? 0) >= 2 ? 10 : 5
  switch (card.kind) {
    case 'trial': return [
      '四角和正中的凝灰岩是装饰，不能挖。中间偏左、偏右各有一个宝库：用试炼钥匙点它可以打开一次，开出小奖、钻石、附魔台或盾牌。每个宝库每人只能开一次，一共能开 4 次。',
      rules.loot ? '这张卡里有 2 把试炼钥匙，普通的卡里也偶尔有，挖到末影珍珠也可能捡到。' : '这张卡里有 2 把试炼钥匙，普通的卡里也偶尔有。',
    ]
    case 'mine': return [
      `中间一行的铁轨是装饰，不能挖。这里有蜘蛛网（下一次挖要多等 ${cobweb} 秒）、刷怪笼（中毒，之后 3 次每挖一次扣待领取的 5%）和箱子矿车（${rules.loot ? '小奖、藏宝图、火把或附魔台' : '小奖、火把或藏宝图'}），煤炭和木棍也多。`,
    ]
    case 'nether': return [
      '岩浆开局就看得见，不能挖。这张卡上每挖开 3 格，岩浆往旁边流一格，吞掉的格子就没了，里面的奖励留在奖池里。',
      '远古残骸烧不掉，一个值 10 份小奖。',
    ]
    case 'deep': return (rules.special ?? 0) >= 2 ? [
      '钻石最多（8 颗）。谁挖一格噪音都加一，大家共用一条噪音条；一会儿没人挖，噪音慢慢退下去。',
      '噪音过了前面安静的那一段，每挖一格都可能吵醒监守者，越吵越容易醒。吵醒它的人，待领取的奖励被抢走一半（盾牌挡不住，末影箱里的不算），这张卡关掉，剩下的格子谁也挖不了。挖慢一点、等噪音退一退再挖，就有机会整张挖完。',
    ] : [
      '钻石最多（8 颗）。每挖开一格，噪音加一，大家共用一个数。',
      '噪音进了危险区，每挖一格都可能惊醒监守者：挖出这一下的人，待领取的奖励扣掉一半（盾牌挡不住，末影箱里的不算），这张卡关掉，剩下的格子谁也挖不了。',
    ]
    case 'end': return [
      '末影之眼开出来的宝藏，3×3。钻石多，也藏着末影水晶：踩中扣掉待领取的两倍 TNT 的比例。这里不会再长新卡。',
    ]
    default: return [
      `普通的卡：绿宝石、钻石、附魔金苹果，也有 TNT（扣待领取的 ${rules.tntPercent}%）。挖到末影珍珠，旁边会长出一张新卡${(rules.special ?? 0) >= 2 ? '（普通的卡、废弃矿井或试炼密室）；挖到末影之眼，远处会开出末地宝藏、深暗之域或下界' : ''}。`,
    ]
  }
}

/**
 * 余量（docs/V3_ITEMS.md §9，2026-11-11 用户选的“按第 9 节全做”）：不报“还剩几个”（只剩一个反而劝退），
 * 报这张卡还藏着多少钱、有哪几样宝贝（几个用原版乱码盖住），挖得差不多了就指去最富的那张。
 * 钱只按大家本来就看得到的余量算，没多给信息。
 */

/** 每样东西大约值几份小奖：钻石按规则的倍数；附魔金苹果让手上的翻倍（有上限），按 3 份；箱子矿车一半是 2～4 份小奖。 */
export function worthEach(rules: Pick<Rules, 'bigMultiplier'>): Partial<Record<Kind, number>> {
  return { emerald: 1, diamond: rules.bigMultiplier || 5, debris: 10, apple: 3, minecart: 1.5 }
}

/** 一张卡还藏着多少钱（和奖池一样的单位，整数）：不超过奖池剩下的。 */
export function worthOf(card: Pick<PublicCard, 'left'>, rules: Pick<Rules, 'smallReward' | 'bigMultiplier'>, poolLeft: number) {
  const each = worthEach(rules)
  let small = 0
  for (const [kind, worth] of Object.entries(each) as [Kind, number][]) small += (card.left[kind] ?? 0) * worth
  return Math.max(0, Math.min(Math.round(small * rules.smallReward), poolLeft))
}

/** “还藏着约 X”：1 以上取一位小数，不到 1 取两位（10000 → "100.0"，85 → "0.85"）。 */
export function aboutMoney(points: number) {
  // 按这个红包的最小单位换成分再估（三方积分红包是多少个最小单位，docs/V3_ITEMS.md §11）；整数的积分只写整数
  const minor = points * stepMinor(currentStep())
  if (decimalsOf(currentStep()) === 0) return String(Math.round(minor / 100))
  return minor >= 100 ? (Math.round(minor / 10) / 10).toFixed(1) : (minor / 100).toFixed(2)
}

/** 卡下面列出来的宝贝（最多 4 样，按这个先后）：值钱的、能长出新卡的。 */
export const TREASURES: Kind[] = ['debris', 'diamond', 'apple', 'eye', 'pearl', 'minecart', 'emerald']

/**
 * 余量怎么说（docs/V3_ITEMS.md §15，2026-11-12 用户定的）：乱码是不劝退（有，但不说多少），模糊是吸引（4 个以上写“不少”），
 * 准数最吸引，只在数字好看的时候用（剩下的格子少，带上“最后 N 格”；或者本来就是大奖）。一张卡同一时刻只用一种。
 * 按区块和这张卡挖到哪一段：开头（挖开不到三成）、中段、收尾（没挖开的剩 6 格以内，或不到两成）。
 */
export type Tell = 'garble' | 'fuzzy' | 'exact'
const TELLS: Record<Biome | 'normal', [Tell, Tell, Tell]> = {
  normal: ['garble', 'fuzzy', 'exact'],
  // 又黑又危险（蜘蛛网、刷怪笼），最后才亮
  mine: ['garble', 'garble', 'exact'],
  // 宝库是主角（宝库还能开几次照旧写准数），宝贝只说多不多
  trial: ['fuzzy', 'fuzzy', 'fuzzy'],
  // 岩浆一直在吞格子，个数在变少要看得见
  nether: ['fuzzy', 'exact', 'exact'],
  // 越挖越吵、会惊醒监守者，故意不给准数
  deep: ['garble', 'garble', 'fuzzy'],
  // 开出来就是大奖，摆在明面上抢
  end: ['exact', 'exact', 'exact'],
}
/** 模糊的时候，几个以上写“不少” */
export const PLENTY = 4
/** 还没挖开的格子（装饰、宝库、岩浆这些固定的不算） */
export function coveredOf(card: Pick<PublicCard, 'cells' | 'fixed'>) {
  let covered = 0
  card.cells.forEach((cell, index) => { if (!cell && !card.fixed?.[index]) covered += 1 })
  return covered
}
export function tellOf(card: Pick<PublicCard, 'cells' | 'fixed' | 'kind'>): { tell: Tell; covered: number } {
  const total = card.cells.length - Object.keys(card.fixed ?? {}).length
  const covered = coveredOf(card)
  const stage = covered <= 6 || covered < total * 0.2 ? 2 : total - covered < total * 0.3 ? 0 : 1
  return { tell: TELLS[card.kind ?? 'normal'][stage], covered }
}

/** 还没挖完、没关的卡。 */
const open = (card: Pick<PublicCard, 'finished' | 'closed'>) => !card.finished && !card.closed

/** 这张卡算挖得差不多了：挖完、关了，或者藏着的不到 2 份小奖。 */
export const poorCard = (card: Pick<PublicCard, 'finished' | 'closed'>, worth: number, rules: Pick<Rules, 'smallReward'>) =>
  !open(card) || worth < rules.smallReward * 2

/** 卡下面那一行：还藏着多少钱、有哪几样宝贝。 */
export function leftoversOf(card: Pick<PublicCard, 'left' | 'finished' | 'closed'>, rules: Pick<Rules, 'smallReward' | 'bigMultiplier'>, poolLeft: number) {
  const worth = worthOf(card, rules, poolLeft)
  const kinds = TREASURES.filter(kind => (card.left[kind] ?? 0) > 0).slice(0, 4)
  return { worth, kinds, poor: poorCard(card, worth, rules) }
}

/** 最富的那张（不算 except，不算挖得差不多的）；没有就是 null。 */
export function richestOf(cards: PublicCard[], rules: Pick<Rules, 'smallReward' | 'bigMultiplier'>, poolLeft: number, except?: number) {
  let best: { card: PublicCard; worth: number } | null = null
  for (const card of cards) {
    if (card.id === except || !open(card)) continue
    const worth = worthOf(card, rules, poolLeft)
    if (poorCard(card, worth, rules)) continue
    if (!best || worth > best.worth) best = { card, worth }
  }
  return best
}

/**
 * 地图上越富越亮（静止的金光，三档）：和最富的那张比，三分之二以上 3 档，三分之一以上 2 档，
 * 别的 1 档；挖得差不多的不亮。只给有亮光的卡（键是卡号）。
 */
export function richnessOf(cards: PublicCard[], rules: Pick<Rules, 'smallReward' | 'bigMultiplier'>, poolLeft: number) {
  const worths = new Map<number, number>()
  for (const card of cards) {
    const worth = worthOf(card, rules, poolLeft)
    if (!poorCard(card, worth, rules)) worths.set(card.id, worth)
  }
  const most = Math.max(0, ...worths.values())
  const levels = new Map<number, 1 | 2 | 3>()
  for (const [id, worth] of worths) levels.set(id, worth * 3 > most * 2 ? 3 : worth * 3 > most ? 2 : 1)
  return levels
}

/**
 * 深暗之域的噪音条，旧局（2026-11-12 以前开的）：危险区是这张卡格子数的 45%–75%（监守者在这中间某一下醒来，
 * 开局由种子定，不公开）。toDanger：还没进危险区，再挖几格进；cells：能挖的格子数。
 */
export function noiseOf(card: Pick<PublicCard, 'cells' | 'fixed' | 'noise' | 'closed'>) {
  const cells = cellsOf(card)
  const low = Math.ceil(cells * 0.45)
  const high = Math.floor(cells * 0.75)
  const noise = card.noise ?? 0
  return { noise, low, high, cells, danger: noise >= low, closed: !!card.closed, toDanger: Math.max(0, low - noise) }
}

const cellsOf = (card: Pick<PublicCard, 'cells' | 'fixed'>) => card.cells.length - Object.keys(card.fixed ?? {}).length

// 噪音会退的局（rules.special: 2，docs/V3_ITEMS.md §16），和 game/shared/rules.mjs 一样：谁挖一格噪音加一，
// 没人挖时每 noiseDecayMs 退一；噪音过了格子数的 WARDEN_FROM 以后，每挖一格按当时的噪音有一点机会醒，满了是 WARDEN_MAX
export const NOISE_DECAY_MS = 15_000
export const WARDEN_FROM = 0.25
export const WARDEN_MAX = 0.1
export const WARDEN_CURVE = 0.8
export const noiseDecayMs = (rules: Pick<Rules, 'digInterval'>) => Math.max(NOISE_DECAY_MS, (rules.digInterval ?? 1) * 5000)
export function wardenChance(noise: number, cells: number) {
  const from = cells * WARDEN_FROM
  if (noise <= from) return 0
  return WARDEN_MAX * Math.min(1, (noise - from) / (cells - from)) ** WARDEN_CURVE
}
/** 噪音会退的卡：now 这一刻的噪音 */
export function noiseNow(card: Pick<PublicCard, 'noise' | 'noiseAt'>, rules: Pick<Rules, 'digInterval'>, now: number) {
  if (card.noiseAt === undefined) return card.noise ?? 0
  return Math.max(0, (card.noise ?? 0) - Math.max(0, now - card.noiseAt) / noiseDecayMs(rules))
}

/**
 * 噪音会退的卡此刻的噪音条：noise 是现在的噪音，from 是开始有危险的那一点（都按格子数算）；
 * chance 是再挖一格吵醒监守者的可能（挖的那一下先加一再看）；safe 是不算噪音往下退、再挖几格都不会醒；
 * next 是过多久这些字会变（毫秒；不会再变是 null）。
 */
export function decayingNoiseOf(card: Pick<PublicCard, 'cells' | 'fixed' | 'noise' | 'noiseAt' | 'closed'>, rules: Pick<Rules, 'digInterval'>, now: number) {
  const cells = cellsOf(card)
  const from = cells * WARDEN_FROM
  const noise = noiseNow(card, rules, now)
  const chance = wardenChance(noise + 1, cells)
  const safe = Math.max(0, Math.floor(from - noise))
  const decay = noiseDecayMs(rules)
  // 危险时可能每一下都在变，一秒看一次；安全时等到“还能挖几格”多一格那一刻
  const next = card.closed || noise <= 0 ? null : chance > 0 ? 1000 : from - safe - 1 < 0 ? null : Math.ceil((noise - (from - safe - 1)) * decay) + 50
  return { noise, cells, from, chance, safe, closed: !!card.closed, next, decay }
}

/** 这一下吵醒监守者的可能，说给人看的 */
export function chanceWords(chance: number) {
  return chance < 0.01 ? '这一下有一点可能吵醒监守者' : `这一下约 ${Math.round(chance * 100)}% 会吵醒监守者`
}
