import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import { play } from './sound'
import type { Kind, Rules } from './types'
import { money } from './types'

// 首次练习（docs/V3_MAP.md §6）：两张 3×3 的小卡，演示挖到奖励、末影珍珠长出新卡、
// 换到新卡、TNT 扣分和见好就收。有道具栏的局（docs/V3_ITEMS.md §5）多两步：挖到望远镜进了
// 工具条，拿起来看一格（手机上先点一下预览、再点一次才用；电脑上指着预览、点一下就用）。
// 全在这里，不连游戏站，不用真机会。

type Step = 'first' | 'pearl' | 'move' | 'tnt' | 'spy' | 'hold' | 'aim' | 'done'
const SCRIPT: Record<'first' | 'pearl' | 'tnt', Kind> = { first: 'emerald', pearl: 'pearl', tnt: 'tnt' }
/** 练习里望远镜看到的那一格是什么 */
const LOOK: Kind = 'diamond'

export const GUIDE_SEEN = 'kddb:v3:guide'

export function Guide({ rules, unit, onClose }: { rules: Rules; unit: string; onClose: () => void }) {
  const reduced = useReducedMotion() ?? false
  const [step, setStep] = useState<Step>('first')
  const [opened, setOpened] = useState<Record<string, Kind>>({})
  const [points, setPoints] = useState(0)
  const [onB, setOnB] = useState(false)
  /** 有道具栏的局：拿着望远镜、预览在哪一格、看到了哪一格 */
  const [held, setHeld] = useState(false)
  const [aimAt, setAimAt] = useState<number | null>(null)
  const [peekAt, setPeekAt] = useState<number | null>(null)
  const items = !!rules.items
  const mouse = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
  const penalty = Math.floor(((rules.smallReward) * rules.tntPercent) / 100)
  const grown = step !== 'first' && step !== 'pearl'

  const dig = (card: 'a' | 'b', index: number) => {
    const key = `${card}${index}`
    if (opened[key]) return
    if (card === 'a' && (step === 'first' || step === 'pearl')) {
      const kind = SCRIPT[step]
      setOpened(value => ({ ...value, [key]: kind }))
      play('dig')
      if (kind === 'emerald') {
        play('emerald')
        setPoints(rules.smallReward)
        setStep('pearl')
      } else {
        play('throw')
        play('teleport', { delay: 450 })
        setStep('move')
      }
    } else if (card === 'b' && step === 'tnt') {
      play('dig')
      play('tnt')
      setOpened(value => ({ ...value, [key]: 'tnt' }))
      setPoints(value => value - penalty)
      setStep(items ? 'spy' : 'done')
    } else if (card === 'b' && step === 'spy') {
      play('dig')
      play('pop')
      setOpened(value => ({ ...value, [key]: 'spyglass' }))
      setStep('hold')
    } else if (card === 'b' && step === 'aim') {
      // 拿着望远镜：手机上第一下只预览，再点同一格才用；鼠标点一下就用
      if (!mouse && aimAt !== index) {
        setAimAt(index)
        return
      }
      play('spyglass')
      setPeekAt(index)
      setHeld(false)
      setAimAt(null)
      setStep('done')
    }
  }

  const words: Record<Step, [string, string]> = {
    first: ['点一格，试着挖一下', '放大到一张卡上才能挖。'],
    pearl: [`挖到绿宝石，+${money(rules.smallReward)} ${unit}`, '奖励先记在矿洞里。再挖一格试试。'],
    move: ['末影珍珠！旁边长出了一张新卡', '旧卡挖完以前一直能挖。在地图上拖动或直接点新卡就能过去，这里点「移到新卡」。'],
    tnt: ['到了新卡，再挖一格', '每张卡上都有各种道具，也有 TNT。'],
    spy: [`TNT！扣掉 ${rules.tntPercent}%（${money(penalty)} ${unit}）`, '再挖一格试试。'],
    hold: ['挖到望远镜，它进了下面的工具条', '道具都放在工具条里。点它就能使用。'],
    aim: ['使用望远镜', mouse ? '指着格子就能预览要看哪一格，点一下确认；右键、Esc 或再点它取消。' : '点一格预览，再点一下确认。拖动还是挪地图。'],
    done: items && peekAt !== null ? ['望远镜看见了：钻石，只有你看得见', `点「见好就收」才算领到；镐子都用完、奖池分完时会自动领取。截止前 2 分钟停止挖掘，没领的作废。`]
      : [`TNT！扣掉 ${rules.tntPercent}%（${money(penalty)} ${unit}）`, `点「见好就收」才算领到；镐子都用完、奖池分完时会自动领取。截止前 2 分钟停止挖掘，没领的作废。`],
  }

  const card = (id: 'a' | 'b') => <div className={`guide-card${(id === 'b') === onB ? ' is-focused' : ''}`}>
    {Array.from({ length: 9 }, (_, index) => {
      const kind = opened[`${id}${index}`]
      const live = id === 'a' ? (step === 'first' || step === 'pearl') && !onB : (step === 'tnt' || step === 'spy' || step === 'aim') && onB
      const looked = id === 'b' && peekAt === index
      return kind
        ? <div key={index} className={`map-cell revealed kind-${kind} is-mine`}><ItemIcon kind={kind} size={22} /></div>
        : <button key={index} type="button" className={`map-cell covered${looked ? ' has-peek' : ''}${id === 'b' && step === 'aim' && aimAt === index ? ' in-look' : ''}`}
          disabled={!live} onClick={() => dig(id, index)}
          onPointerMove={event => { if (event.pointerType === 'mouse' && step === 'aim' && id === 'b') setAimAt(index) }}
          aria-label={`练习格子 ${index + 1}${step === 'aim' ? '，点按看看里面是什么' : ''}`}>
          {looked ? <ItemIcon kind={LOOK} size={20} className="peek-icon" /> : null}
        </button>
    })}
  </div>

  return <div className="rules-backdrop" onClick={onClose}>
    <section className="guide" role="dialog" aria-modal="true" aria-label="练习" onClick={event => event.stopPropagation()}>
      <header className="guide-head"><span>练习（不算数）</span><button type="button" className="guide-close" onClick={onClose} aria-label="关闭练习">×</button></header>
      <div className="guide-copy" role="status"><h2>{words[step][0]}</h2><p>{words[step][1]}</p></div>
      <div className="guide-score">示例奖励 <b>{money(points)}</b> {unit}</div>
      <div className="guide-map">
        <motion.div className="guide-world" animate={{ x: onB ? '-50%' : '0%' }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 220, damping: 30 }}>
          {card('a')}
          <AnimatePresence>{grown ? <motion.div key="b" initial={reduced ? false : { opacity: 0, scale: .4, x: -40 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ duration: .6 }}>{card('b')}</motion.div> : null}</AnimatePresence>
        </motion.div>
      </div>
      {items && (step === 'hold' || step === 'aim' || (step === 'done' && peekAt !== null)) ? <div className="guide-tools" role="toolbar" aria-label="练习的工具条">
        <button type="button" className={`tool-slot is-pickaxe${held ? '' : ' is-selected'}`} aria-label="镐子" onClick={() => { setHeld(false); setAimAt(null); if (step === 'aim') setStep('hold') }}><ItemIcon kind="pickaxe" size={30} /></button>
        {peekAt === null ? <button type="button" className={`tool-slot is-spyglass${held ? ' is-selected' : ''}${step === 'hold' ? ' is-hint' : ''}`} aria-label="望远镜 1" aria-pressed={held}
          onClick={() => {
            if (held) {
              setHeld(false)
              setAimAt(null)
              setStep('hold')
              return
            }
            play('click')
            setHeld(true)
            setStep('aim')
          }}><ItemIcon kind="spyglass" size={30} /></button> : null}
      </div> : null}
      <div className="guide-actions">
        {step === 'move' ? <button type="button" className="guide-next" onClick={() => { setOnB(true); setStep('tnt') }}>▶ 移到新卡</button> : null}
        {step === 'done' ? <>
          <button type="button" className="guide-again" onClick={() => { setStep('first'); setOpened({}); setPoints(0); setOnB(false); setHeld(false); setAimAt(null); setPeekAt(null) }}>再试一次</button>
          <button type="button" className="guide-start" onClick={onClose}>开始挖宝</button>
        </> : <button type="button" className="guide-skip" onClick={onClose}>跳过练习</button>}
      </div>
    </section>
  </div>
}
