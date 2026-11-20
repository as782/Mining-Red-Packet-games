import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ItemIcon } from './ItemIcon'
import { formatMoney, rulesLabel } from './game'
import type { Rules } from './game'
import { useReducedMotion } from './useReducedMotion'

type PracticeCell = { index: number; kind: 'emerald' | 'tnt' }

// All practice state stays here. No SDK, live board, or real submissions.
export function GuideDemo({ rules, unit, active, finishLabel, onFinish }: { rules: Rules; unit: string; active: boolean; finishLabel: string; onFinish: () => void }) {
  const [cells, setCells] = useState<PracticeCell[]>([])
  const [pickup, setPickup] = useState<PracticeCell | null>(null)
  const [collected, setCollected] = useState(false)
  const board = useRef<HTMLDivElement>(null)
  const finishButton = useRef<HTMLButtonElement>(null)
  const reduced = useReducedMotion()
  const penalty = Math.floor(rules.smallReward * rules.tntPercent / 100)
  const amount = cells.length === 0 ? 0 : cells.length === 2 ? rules.smallReward - penalty : rules.smallReward
  const chances = 2 - cells.length
  const finished = collected || chances === 0

  useEffect(() => {
    if (!pickup || !active) return
    const timer = setTimeout(() => {
      setCells(previous => [...previous, pickup])
      setPickup(null)
    }, reduced ? 1000 : 1300)
    return () => clearTimeout(timer)
  }, [pickup, reduced, active])
  useEffect(() => {
    if (finished) finishButton.current?.focus({ preventScroll: true })
    else board.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }, [cells, finished])

  const dig = (index: number) => {
    if (pickup || finished || cells.some(cell => cell.index === index)) return
    setPickup({ index, kind: cells.length === 0 ? 'emerald' : 'tnt' })
  }
  const title = pickup ? pickup.kind === 'emerald' ? '挖到绿宝石！' : '这次遇到了 TNT' : collected ? '奖励收好，挖掘结束' : chances === 0 ? '机会用完，奖励自动结算' : cells.length ? '再挖一格，还是见好就收？' : '点一格，试着挖一下'
  const detail = pickup ? pickup.kind === 'emerald' ? `奖励 +${formatMoney(rules.smallReward)} ${unit}` : `当前奖励扣除 ${rules.tntPercent}%` : collected ? '提前领取会放弃剩余机会，不能再挖这个红包。' : chances === 0 ? `TNT 扣掉了 ${formatMoney(penalty)} ${unit}，剩下的奖励已结算。` : cells.length ? '再挖可能多赚，也可能遇到 TNT 扣奖励。' : '一把镐子可以挖开一个格子。'

  return <article className="guide-demo" data-testid="guide-demo">
    <header className="demo-heading"><span>练习 · 不消耗真实机会</span><button className="dialog-close" aria-label="关闭练习" onClick={onFinish}>×</button></header>
    <p className="demo-effective-rules">{rulesLabel(rules)} · 正式游戏初始 {rules.initialChances} 次 · TNT {rules.tntPercent}%<br />练习用 2 把镐子，奖励按当前规则演示。</p>
    <div className="demo-copy" role="status"><h2 id="rules-title">{title}</h2><p>{detail}</p></div>
    <div className="demo-summary">
      <div className="demo-summary-topline">
        <div className="demo-reward"><span>{finished ? '示例已结算' : '示例奖励'}</span><strong data-testid="demo-amount">{formatMoney(amount)} <small>{unit}</small></strong></div>
        <button className="secondary-button demo-cashout" aria-label="练习见好就收，不领取真实奖励" disabled={!cells.length || Boolean(pickup) || finished} onClick={() => setCollected(true)}><ItemIcon kind="chest" size={22} />{finished ? '已结算' : '见好就收'}</button>
      </div>
      <div className={`demo-chances ${chances === 1 && !finished ? 'last-chance' : ''}`}>
        <div className="chance-heading"><span>挖掘机会</span><span><b data-testid="demo-chances">{chances}</b> 次</span></div>
        <div className="demo-pickaxes" aria-label={`练习剩余 ${chances} 次机会`}><AnimatePresence initial={false}>{Array.from({ length: chances }, (_, i) => <motion.span key={i} exit={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : .7 }} transition={{ duration: .25 }}><ItemIcon kind="pickaxe" size={28} /></motion.span>)}</AnimatePresence></div>
        <p>{finished ? '这次练习的挖掘已结束' : chances === 1 ? '最后一把 · 用完自动结算' : '一把挖一格 · 用完自动结算'}</p>
      </div>
    </div>
    <div className="demo-board" ref={board} aria-label="练习格子" aria-busy={Boolean(pickup)}>
      {Array.from({ length: 6 }, (_, index) => {
        const cell = cells.find(value => value.index === index)
        return <motion.button key={index} className={`demo-cell ${cell ? 'is-open' : ''}`} data-testid={`demo-cell-${index}`} aria-label={`练习格子 ${index + 1}${cell ? cell.kind === 'emerald' ? '，已挖到绿宝石' : '，已挖到 TNT' : '，点按挖开'}`} disabled={Boolean(cell) || Boolean(pickup) || finished} autoFocus={index === 0} whileTap={reduced ? undefined : { scale: .95 }} onClick={() => dig(index)}>{cell ? <ItemIcon kind={cell.kind} size={40} /> : <span className="stone-cover" />}</motion.button>
      })}
      <AnimatePresence>{pickup && <motion.div key={pickup.index} className="demo-pickup" initial={{ opacity: 0, scale: reduced ? 1 : .85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? .08 : .24 }} aria-hidden="true"><ItemIcon kind={pickup.kind} size={84} /><strong className={pickup.kind === 'tnt' ? 'negative' : ''}>{pickup.kind === 'emerald' ? '+' : '−'}{formatMoney(pickup.kind === 'emerald' ? rules.smallReward : penalty)}</strong></motion.div>}</AnimatePresence>
    </div>
    <div className="demo-actions">{finished ? <><button className="text-button" onClick={() => { setCells([]); setCollected(false) }}>再试一次</button><button className="primary-button" ref={finishButton} onClick={onFinish}>{finishLabel}</button></> : <button className="text-button" onClick={onFinish}>跳过练习</button>}</div>
  </article>
}
