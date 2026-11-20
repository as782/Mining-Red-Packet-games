import type { Kind, Step } from './types'

// 收益曲线（收益卡里）：每挖一格后待领取多少，连成一条线，标最高点；线上挂几件加减最多的事的图标
// （最多 6 个，挨得太近的跳过）；图下面一条“条形码”，每一步一根，颜色照物品本身，加分往上、扣分往下，
// 再下面一行小图标是图例（2026-11-11 晚用户选的 A，docs/V3_ITEMS.md §10）；在图上拖动（电脑上指着）
// 看每一步是什么。纯函数，测试直接算。

export interface ChartBox { width: number; height: number; padX: number; padTop: number; padBottom: number }
export const CHART: ChartBox = { width: 320, height: 132, padX: 8, padTop: 16, padBottom: 10 }

export type Mark = 'big' | 'apple' | 'boom' | 'blocked' | 'loss'
export interface Marker {
  x: number; y: number; mark: Mark; step: number
  /** 第几次挖（逐格记录里还有中毒、末影箱、宝库、苦力怕、监守者这些不是挖的，不算） */
  dig?: number
  /** 挖到的是什么、多了（少了）多少分 */
  kind: Kind | Step['k']; amount: number
}

/** 图上拖到的那一步：位置、第几次挖（不是挖的没有）、是什么、加减多少、之后待领取多少。 */
export interface Point { x: number; y: number; step: number; dig?: number; kind: Step['k']; amount: number; points: number; blocked?: true }

export interface Chart {
  /** 折线 */
  line: string
  /** 折线下面的面（填渐变） */
  area: string
  /** 0 分那条基线的 y */
  baseY: number
  /** 刻度上的事：钻石、金苹果、踩雷、盾牌挡住，和中毒、苦力怕、监守者扣的 */
  markers: Marker[]
  /** 线上标的：最大的一笔（加的）、被炸得最狠的一下（扣的）；没有就是 null */
  best: Marker | null
  worst: Marker | null
  /** 每一步的位置（拖动时找最近的那一步） */
  points: Point[]
  /** 最高点（标数） */
  peak: { x: number; y: number; points: number } | null
  /** 最后一格的位置和分 */
  end: { x: number; y: number; points: number }
  max: number
}

const markOf = (kind: Step['k'], step: Step): Mark | null => {
  if (step.b) return 'blocked'
  if ((kind === 'tnt' || kind === 'crystal') && step.a < 0) return 'boom'
  if (kind === 'diamond') return 'big'
  if (kind === 'apple' && step.a > 0) return 'apple'
  if ((kind === 'poison' || kind === 'creeper' || kind === 'warden') && step.a < 0) return 'loss'
  return null
}

/** 逐格记录里不是挖格子的几种（有道具栏的局）：中毒、苦力怕、监守者、末影箱、宝库 */
const NOT_DIGS = new Set<string>(['poison', 'creeper', 'warden', 'ender', 'vault'])

/** 从 0 分开始，第 i 格挖完是 trail[i - 1].p；横轴按挖的次数平分。 */
export function chartOf(trail: Step[], box: ChartBox = CHART): Chart {
  const values = [0, ...trail.map(step => step.p)]
  const max = Math.max(1, ...values)
  const innerWidth = box.width - box.padX * 2
  const innerHeight = box.height - box.padTop - box.padBottom
  const xOf = (index: number) => box.padX + (values.length === 1 ? innerWidth : (index / (values.length - 1)) * innerWidth)
  const yOf = (points: number) => box.padTop + innerHeight - (points / max) * innerHeight
  const round = (value: number) => Math.round(value * 10) / 10
  const points = values.map((value, index) => `${round(xOf(index))},${round(yOf(value))}`)
  const line = `M${points.join('L')}`
  const baseY = round(yOf(0))
  const area = `${line}L${round(xOf(values.length - 1))},${baseY}L${round(xOf(0))},${baseY}Z`
  const markers: Marker[] = []
  const stepPoints: Point[] = [{ x: round(xOf(0)), y: round(yOf(0)), step: 0, kind: 'emerald', amount: 0, points: 0 }]
  let digs = 0
  trail.forEach((step, index) => {
    const dig = NOT_DIGS.has(step.k) ? undefined : (digs += 1)
    const x = round(xOf(index + 1))
    const y = round(yOf(step.p))
    stepPoints.push({ x, y, step: index + 1, ...(dig ? { dig } : {}), kind: step.k, amount: step.a, points: step.p, ...(step.b ? { blocked: true as const } : {}) })
    const mark = markOf(step.k, step)
    if (mark) markers.push({ x, y, mark, step: index + 1, dig: dig ?? digs, kind: step.k, amount: step.a })
  })
  const gains = markers.filter(marker => marker.amount > 0)
  const losses = markers.filter(marker => marker.amount < 0)
  const best = gains.reduce<Marker | null>((most, marker) => (!most || marker.amount > most.amount ? marker : most), null)
  const worst = losses.reduce<Marker | null>((most, marker) => (!most || marker.amount < most.amount ? marker : most), null)
  let peakAt = 0
  values.forEach((value, index) => {
    if (value > values[peakAt]) peakAt = index
  })
  const last = values.length - 1
  return {
    line, area, baseY, markers, best, worst, points: stepPoints, max,
    peak: values[peakAt] > 0 ? { x: round(xOf(peakAt)), y: round(yOf(values[peakAt])), points: values[peakAt] } : null,
    end: { x: round(xOf(last)), y: round(yOf(values[last])), points: values[last] },
  }
}

const STEP_NAMES: Partial<Record<Step['k'], string>> = { poison: '中毒', creeper: '苦力怕', warden: '监守者', ender: '存进末影箱', vault: '宝库' }

/** 拖到 x（图的坐标）时最近的那一步。 */
export function pointAt(chart: Pick<Chart, 'points'>, x: number) {
  let best = chart.points[0]
  for (const point of chart.points) if (Math.abs(point.x - x) < Math.abs(best.x - x)) best = point
  return best
}

/** 拖到的那一步说的那一句：第几次挖、挖到什么、加减多少、之后待领取多少。names 是物品名（网页给）。 */
export function pointWords(point: Point, money: (points: number) => string, names: Partial<Record<string, string>>) {
  if (point.step === 0) return `开始：待领取 ${money(0)}`
  const what = point.dig ? `第 ${point.dig} 次挖 · ${names[point.kind] ?? ''}` : STEP_NAMES[point.kind] ?? ''
  const change = point.amount > 0 ? ` +${money(point.amount)}` : point.amount < 0 ? ` ${money(point.amount)}` : ''
  return `${what}${change} · 待领取 ${money(point.points)}`
}

/** 每一样的颜色（条形码、图例、线上的小点）：照物品本身；盾牌挡住蓝；不加不减的灰。 */
export const COLORS: Record<string, string> = {
  emerald: '#41d36b', diamond: '#4fe0e0', apple: '#ffcf40', debris: '#c47b55', minecart: '#c99b5c', vault: '#6fd8ff', pearl: '#2fa78f', eye: '#9ccf4a',
  blocked: '#8fb4ff', tnt: '#e8473d', crystal: '#d77bff', poison: '#b6d34a', creeper: '#5fbf4f', warden: '#2aa3ad', ender: '#3c8f7f', other: '#5b6068',
}
/** 踩到 TNT、末影水晶却没扣到（手上是 0）也算踩雷，照它的颜色画 */
const isBomb = (point: Pick<Point, 'kind'>) => point.kind === 'tnt' || point.kind === 'crystal'
const keyOf = (point: Pick<Point, 'kind' | 'blocked' | 'amount'>) => (point.blocked ? 'blocked' : point.amount === 0 && !isBomb(point) ? 'other' : point.kind)
export const colorOf = (point: Pick<Point, 'kind' | 'blocked' | 'amount'>) => COLORS[keyOf(point)] ?? COLORS.other

/**
 * 线上挂图标的几步：按加减多少挑（挡住的按最高点的十分之一算），绿宝石和中毒那种小的不挂，图上挨得比 gap 近的跳过，
 * 最多 most 个。按先后排好。
 */
export function picksOf(chart: Pick<Chart, 'points' | 'max'>, most = 6, gap = 26): Point[] {
  const weight = (point: Point) => Math.abs(point.amount) || (point.blocked ? chart.max / 10 : 0)
  const order = chart.points.filter(point => point.step > 0 && weight(point) > 0 && point.kind !== 'emerald' && point.kind !== 'poison')
    .sort((a, b) => weight(b) - weight(a) || a.step - b.step)
  const chosen: Point[] = []
  for (const point of order) {
    if (chosen.length >= most) break
    if (chosen.some(other => Math.abs(other.x - point.x) < gap)) continue
    chosen.push(point)
  }
  return chosen.sort((a, b) => a.step - b.step)
}

/** 条形码的每一根：位置、往上（正）往下（负）多长（满格 1）、颜色。不加不减的是 0（画一个小点）。 */
export function barsOf(chart: Pick<Chart, 'points'>) {
  const steps = chart.points.slice(1)
  const most = Math.max(1, ...steps.map(point => Math.abs(point.amount)))
  return steps.map(point => ({
    x: point.x, step: point.step, color: colorOf(point),
    size: point.blocked ? 0.6 : point.amount === 0 ? (isBomb(point) ? -0.25 : 0) : Math.sign(point.amount) * (0.25 + 0.75 * Math.sqrt(Math.abs(point.amount) / most)),
  }))
}

const LEGEND = ['debris', 'diamond', 'apple', 'minecart', 'vault', 'emerald', 'pearl', 'eye', 'blocked', 'tnt', 'crystal', 'poison', 'creeper', 'warden', 'ender', 'other']
/** 图例：这一局出现过的几样（有加减的、挡住的），每样几次；不加不减的合成“其他”。 */
export function legendOf(chart: Pick<Chart, 'points'>) {
  const counts = new Map<string, number>()
  for (const point of chart.points.slice(1)) counts.set(keyOf(point), (counts.get(keyOf(point)) ?? 0) + 1)
  return [...counts].sort(([a], [b]) => LEGEND.indexOf(a) - LEGEND.indexOf(b)).map(([key, count]) => ({ key, count, color: COLORS[key] ?? COLORS.other }))
}

/**
 * 图下面六格（docs/V3_ITEMS.md §10）：挖了几格、平均每格挖到多少（加的分 ÷ 格数）、最长连着几格没踩雷
 * （TNT、末影水晶，挡住的也算踩了）、被扣掉多少（炸的、中毒、苦力怕和监守者；存进末影箱不算）、盾牌挡住几次。
 */
export function statsOf(trail: Step[]) {
  let digs = 0, gained = 0, streak = 0, longest = 0, blocked = 0, bomb = 0, poison = 0, other = 0
  for (const step of trail) {
    if (step.b) blocked += 1
    if (step.a < 0) {
      if (step.k === 'tnt' || step.k === 'crystal') bomb -= step.a
      else if (step.k === 'poison') poison -= step.a
      else if (step.k === 'creeper' || step.k === 'warden') other -= step.a
    }
    if (NOT_DIGS.has(step.k)) continue
    digs += 1
    if (step.a > 0) gained += step.a
    if (step.k === 'tnt' || step.k === 'crystal') streak = 0
    else longest = Math.max(longest, (streak += 1))
  }
  return { digs, average: digs ? Math.round(gained / digs) : 0, longest, blocked, lost: bomb + poison + other, bomb, poison, other }
}
