import { useAtomValue } from 'jotai'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import { FaceIcon } from './Faces'
import type { IconKind } from '../../src/game'
import type { Point } from './chart'
import { barsOf, CHART, chartOf, colorOf, legendOf, picksOf, pointAt, pointWords, statsOf } from './chart'
import { factsOf, quipOf } from './quips'
import { Avatar, OwnerTag } from './Owner'
import { hongbaoAtom, loadSummary, settledAtom, uidAtom, viewerAtom } from './state'
import type { Summary } from './types'
import { KIND_NAMES, money } from './types'

// 收益卡（docs/V3_MAP.md §6）：底栏“收益”点开，这一局对他结束了（领到了、奖池分完或机会
// 用完而手里没分）自动弹一次。打开时才向游戏站要数据、才画曲线，平时不占资源。排成一张
// 能直接截图分享的卡：红包名、领到多少、收益曲线、我的数据、全场前几名。

export function SummaryCard({ reason, onClose }: { reason: 'button' | 'end'; onClose: () => void }) {
  const hongbao = useAtomValue(hongbaoAtom)
  const settled = useAtomValue(settledAtom)
  const uid = useAtomValue(uidAtom)
  const viewer = useAtomValue(viewerAtom)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [problem, setProblem] = useState('')
  // 拖到（电脑上指着）的那一步：说那一步挖到了什么；电脑上移开就收，手机上点别处就收
  const [scrub, setScrub] = useState<Point | null>(null)
  const unit = settled?.unit ?? hongbao?.unit ?? 'LDC'

  const load = () => {
    setProblem('')
    loadSummary().then(setSummary, (error: unknown) => setProblem(error instanceof Error ? error.message : '没读到，再试一次'))
  }
  useEffect(load, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const chart = useMemo(() => summary?.me.trail?.length ? chartOf(summary.me.trail) : null, [summary])
  chartRef.current = chart
  const picks = useMemo(() => (chart ? picksOf(chart) : []), [chart])
  const bars = useMemo(() => (chart ? barsOf(chart) : []), [chart])
  const legend = useMemo(() => (chart ? legendOf(chart) : []), [chart])
  const six = useMemo(() => (summary?.me.trail?.length ? statsOf(summary.me.trail) : null), [summary])
  // 一局的评语（quips.ts）：挖过才有；同一局每次打开都是同一条
  const quip = useMemo(() => (summary && summary.me.digs > 0 ? quipOf(factsOf(summary, uid), `${hongbao?.id ?? ''}:${uid ?? ''}:${summary.me.digs}`, money) : null), [summary, uid, hongbao?.id])
  /** 线上挂的里面加得最多、扣得最多的那一下写数 */
  const bestPick = picks.reduce<Point | null>((most, point) => (point.amount > 0 && (!most || point.amount > most.amount) ? point : most), null)
  const worstPick = picks.reduce<Point | null>((most, point) => (point.amount < 0 && (!most || point.amount < most.amount) ? point : most), null)
  const barWidth = chart ? Math.min(4, Math.max(1.4, ((CHART.width - CHART.padX * 2) / Math.max(1, bars.length)) * 0.62)) : 0
  const me = summary?.me
  const ended = reason === 'end'
  const headline = settled ? `领到 ${settled.amount}`
    : me?.status === 'claimed' ? `领取 ${money(me.points)}`
      : me && me.points > 0 ? money(me.points)
        : null

  return <div className="summary-backdrop" onClick={onClose}>
    <motion.section className="summary" role="dialog" aria-modal="true" aria-label="我的收益" onClick={event => {
      event.stopPropagation()
      setScrub(null)
    }}
      initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}>
      <header className="summary-head">
        <span className="summary-brand"><ItemIcon kind="pickaxe" size={16} />{hongbao?.title ? (hongbao.title.includes('矿洞夺宝') ? hongbao.title : `矿洞夺宝 · ${hongbao.title}`) : '矿洞夺宝'}</span>
        <button type="button" className="summary-close" onClick={onClose} aria-label="关闭">×</button>
      </header>
      <h2>{ended ? '这一局结束了' : '我的收益'}</h2>
      {/* 谁的矿洞、什么难度：规矩是谁定的，截图分享时也看得出来（docs/V3_ITEMS.md §21） */}
      <OwnerTag />
      {problem ? <div className="summary-problem"><p>{problem}</p><button type="button" onClick={load}>再试一次</button></div>
        : !summary || !me ? <div className="summary-loading" aria-label="正在读"><div className="sheen summary-sheen" /><div className="sheen summary-sheen is-short" /></div>
          : <>
            <p className="summary-amount">
              {headline ? <span className="summary-figure"><strong>{headline}</strong> <small>{unit}</small></span> : <strong className="is-none">这一局没挖到奖励</strong>}
              <span className="summary-me"><Avatar name={me.name} src={viewer?.avatar} size={18} />{me.name}{settled || me.status === 'claimed' ? '' : me.points > 0 ? ' · 还在矿洞里，没领' : ''}</span>
            </p>
            {/* 一局的评语：原版“进度达成”的样子，称号 + 一句（docs/V3_ITEMS.md §12） */}
            {quip ? <div className="summary-quip" role="note">
              <span className="quip-frame" aria-hidden="true">{quip.icon === 'creeper' ? <FaceIcon who="creeper" size={24} /> : <ItemIcon kind={quip.icon} size={24} />}</span>
              <strong>{quip.title}</strong>
              <span>{quip.line}</span>
            </div> : null}
            {chart ? <figure className="summary-chart" aria-label={`收益曲线：挖了 ${me.digs} 格，最高 ${money(chart.peak?.points ?? 0)}，最后 ${money(chart.end.points)}`}>
              <div className="chart-plot">
                <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="summary-fill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0" stopColor="#e9b56b" stopOpacity=".38" />
                      <stop offset="1" stopColor="#e9b56b" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <line x1={CHART.padX} x2={CHART.width - CHART.padX} y1={chart.baseY} y2={chart.baseY} className="chart-base" />
                  {chart.peak ? <line x1={CHART.padX} x2={chart.peak.x} y1={chart.peak.y} y2={chart.peak.y} className="chart-high" /> : null}
                  <motion.path d={chart.area} fill="url(#summary-fill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.5 }} />
                  <motion.path d={chart.line} className="chart-line" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
                </svg>
                <span className="chart-zero" style={{ top: `${(chart.baseY / CHART.height) * 100}%` }} aria-hidden="true">0</span>
                {/* 最高点：一条虚线拉到左边，数写在左上（线上的图标不会压着它） */}
                {chart.peak ? <span className="chart-peak" style={{ top: `${(chart.peak.y / CHART.height) * 100}%` }}>最高 {money(chart.peak.points)}</span> : null}
                {/* 线上挂几件加减最多的事（最多 6 个，挨得太近的跳过）；加的挂在线上面，扣的挂在下面 */}
                {picks.map(point => {
                  const up = point.amount > 0 || !!point.blocked
                  const label = point === bestPick ? <b>+{money(point.amount)}</b> : point === worstPick ? <b className="is-bad">{money(point.amount)}</b> : null
                  return <span key={point.step} className="chart-mark" style={{ left: `${(point.x / CHART.width) * 100}%`, top: `${(point.y / CHART.height) * 100}%` }}>
                    <i className="chart-pin" style={{ borderColor: colorOf(point) }} />
                    <span className={`chart-badge ${up ? 'is-up' : 'is-down'}`}>{up ? <>{label}{pointIcon(point)}</> : <>{pointIcon(point)}{label}</>}</span>
                  </span>
                })}
                {/* 拖动、指着：竖线跟着走，说这一步 */}
                <div className="chart-scrub" aria-hidden="true"
                  onPointerDown={event => {
                    event.stopPropagation()
                    event.currentTarget.setPointerCapture(event.pointerId)
                    setScrub(scrubAt(event.currentTarget, event.clientX))
                  }}
                  onPointerMove={event => {
                    if (event.pointerType === 'mouse' || event.buttons) setScrub(scrubAt(event.currentTarget, event.clientX))
                  }}
                  onPointerLeave={event => { if (event.pointerType === 'mouse') setScrub(null) }}
                  onClick={event => event.stopPropagation()} />
                {scrub ? <>
                  <span className="chart-guide" style={{ left: `${(scrub.x / CHART.width) * 100}%` }} aria-hidden="true" />
                  <span className="chart-guide-dot" style={{ left: `${(scrub.x / CHART.width) * 100}%`, top: `${(scrub.y / CHART.height) * 100}%` }} aria-hidden="true" />
                  <span className={`chart-tip${side(scrub.x)}`} style={{ left: `${(scrub.x / CHART.width) * 100}%` }} role="status">{pointWords(scrub, money, KIND_NAMES)}</span>
                </> : null}
              </div>
              {/* 条形码：每一步一根，颜色照物品本身，加分往上、扣分往下，不加不减的是中间一个小点 */}
              <svg className="chart-code" viewBox={`0 0 ${CHART.width} 26`} preserveAspectRatio="none" aria-hidden="true">
                <line x1={CHART.padX} x2={CHART.width - CHART.padX} y1={13} y2={13} className="chart-code-base" />
                {bars.map(bar => <rect key={bar.step} x={bar.x - barWidth / 2} width={barWidth} rx={0.8} fill={bar.color}
                  y={bar.size === 0 ? 11.6 : bar.size > 0 ? 13 - 12 * bar.size : 13} height={bar.size === 0 ? 2.8 : 12 * Math.abs(bar.size)} opacity={bar.size === 0 ? 0.75 : 1} />)}
              </svg>
              {/* 图例：小图标就是颜色说明，带次数 */}
              <div className="chart-legend">
                {legend.map(entry => <span key={entry.key} style={{ borderColor: entry.color }} title={LEGEND_NAMES[entry.key] ?? KIND_NAMES[entry.key as keyof typeof KIND_NAMES] ?? ''}>
                  {legendIcon(entry.key)}{entry.count}
                </span>)}
              </div>
              <figcaption>
                <span>第 1 次挖</span>
                <span>第 {me.digs} 次挖</span>
              </figcaption>
            </figure>
              : <p className="summary-note">{me.trail === null ? '你来的时候这一局还没开始记录，所以没有收益曲线。' : '还没挖过，挖几格以后这里会画出收益曲线。'}</p>}
            {/* 六格（docs/V3_ITEMS.md §10）：从逐格记录算；没有记录的老局只有游戏站给的那几个 */}
            <dl className="summary-stats">
              <div><dt>挖了</dt><dd>{me.digs} 格</dd></div>
              <div><dt>平均每格</dt><dd>{six && six.digs ? `+${money(six.average)}` : '—'}</dd></div>
              <div><dt>最长没踩雷</dt><dd>{six ? `${six.longest} 格` : '—'}</dd></div>
              <div><dt>最大一笔</dt><dd>{me.best > 0 ? `+${money(me.best)}` : '—'}</dd></div>
              <div title={six && six.lost > 0 ? lostWords(six) : undefined}><dt>被扣掉</dt><dd>{(six ? six.lost : me.lost) > 0 ? `-${money(six ? six.lost : me.lost)}` : '—'}</dd></div>
              <div><dt>盾牌挡住</dt><dd>{six ? six.blocked : me.blocked} 次</dd></div>
            </dl>
            <section className="summary-top" aria-label="全场领得最多">
              <h3>全场领得最多</h3>
              {summary.top.length === 0 ? <p className="summary-note">还没有人领到奖励。</p>
                : <ol>{summary.top.map((entry, index) => <li key={entry.uid} className={entry.uid === uid ? 'is-me' : ''}>
                  <span className="top-rank">{index + 1}</span>
                  <span className="top-name">{entry.uid === uid ? `${entry.name}（我）` : entry.name}</span>
                  <span className="top-points">{money(entry.points)} <small>{unit}</small></span>
                </li>)}</ol>}
            </section>
            <p className="summary-foot">{summary.stats.players} 人挖过 · {summary.stats.claimed} 人领了 · 奖池{summary.over ? '已经分完' : `还剩 ${money(summary.left)} ${unit}`}</p>
          </>}
      <div className="summary-actions">
        <span>截图就能分享这份战绩</span>
        <button type="button" onClick={onClose}>{ended ? '好的' : '知道了'}</button>
      </div>
    </motion.section>
  </div>
}

/** 拖到的位置（屏幕上的 x）→ 最近的那一步。 */
function scrubAt(element: HTMLElement, clientX: number) {
  const rect = element.getBoundingClientRect()
  return pointAt(chartRef.current!, ((clientX - rect.left) / rect.width) * CHART.width)
}
/** 拖动时找点用的那张图（每次画都换） */
const chartRef: { current: ReturnType<typeof chartOf> | null } = { current: null }

/** 贴着图左右两头的提示往里靠，不出框。 */
function side(x: number) {
  return x > CHART.width * 0.7 ? ' is-right' : x < CHART.width * 0.3 ? ' is-left' : ''
}

/** 有图标的几样（ItemIcon）；中毒画原版的效果图标；苦力怕、监守者画原版的脸（Faces.tsx）。 */
const ICON_KINDS = new Set<string>(['emerald', 'diamond', 'apple', 'debris', 'minecart', 'vault', 'pearl', 'eye', 'tnt', 'crystal', 'ender', 'totem', 'shield', 'spyglass', 'coal', 'stick', 'map', 'potion', 'key', 'cobweb', 'spawner'])
const POISON_ICON = () => new URL('assets/minecraft/1.21.4/textures/mob_effect/poison.png', document.baseURI).href
function pointIcon(point: Point) {
  if (point.blocked) return <ItemIcon kind="shield" size={18} />
  if (ICON_KINDS.has(point.kind)) return <ItemIcon kind={point.kind as IconKind} size={18} />
  if (point.kind === 'poison') return <img className="effect-mini" src={POISON_ICON()} alt="" />
  if (point.kind === 'creeper' || point.kind === 'warden') return <FaceIcon who={point.kind} size={18} />
  return null
}
const LEGEND_NAMES: Record<string, string> = { blocked: '盾牌挡住', poison: '中毒', creeper: '苦力怕', warden: '监守者', ender: '存进末影箱', vault: '宝库', other: '不加不减的（煤炭、木棍、道具……）' }
function legendIcon(key: string) {
  if (key === 'blocked') return <ItemIcon kind="shield" size={14} />
  if (ICON_KINDS.has(key)) return <ItemIcon kind={key as IconKind} size={14} />
  if (key === 'poison') return <img className="effect-mini" src={POISON_ICON()} alt="" />
  if (key === 'creeper' || key === 'warden') return <FaceIcon who={key} size={14} />
  return <small>其他</small>
}
function lostWords(six: ReturnType<typeof statsOf>) {
  return [six.bomb ? `炸掉 ${money(six.bomb)}` : '', six.poison ? `中毒 ${money(six.poison)}` : '', six.other ? `苦力怕、监守者 ${money(six.other)}` : ''].filter(Boolean).join('，')
}
