import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useReducedMotion } from './useReducedMotion'
import { ItemIcon } from './ItemIcon'
import { formatMoney, loot } from './game'
import type { PresentationEffect } from './presentation'
import './reward-feedback.css'

export function StoneBreak({ reduced }: { reduced: boolean }) {
  return <span className="stone-break" aria-hidden="true">
    <span className="breaking-crack" />
    {!reduced && [0, 1, 2, 3].map(i => <motion.i className={`stone-fragment fragment-${i}`} key={i} initial={{ opacity: .9, x: 0, y: 0, rotate: 0 }} animate={{ opacity: 0, x: (i % 2 ? 1 : -1) * 21, y: (i < 2 ? -1 : 1) * 24, rotate: (i % 2 ? 1 : -1) * 16 }} transition={{ duration: .32, ease: 'easeOut' }}/>) }
  </span>
}

interface FeedbackCopy {
  detail: string
  value?: string
  tone?: 'gain' | 'loss' | 'protected'
}

function feedbackCopy(effect: PresentationEffect): FeedbackCopy {
  const text = effect.text.replaceAll('不死图腾', '双铁镐')
  // Public events never contain another player's private amount or hints.
  if (!effect.isOwn) return { detail: text || loot[effect.kind].description }

  const money = effect.amountDelta > 0 ? `+${formatMoney(effect.amountDelta)}` : undefined
  const capped = text.includes('剩余奖池不足') ? '，已按奖池余额发放' : ''
  switch (effect.kind) {
    case 'emerald':
      return { value: money, tone: 'gain', detail: money ? `获得一份小奖励${capped}` : text || loot.emerald.description }
    case 'diamond':
      return { value: money, tone: 'gain', detail: money ? `获得一份大奖励${capped}` : text || loot.diamond.description }
    case 'apple':
      return { value: money, tone: 'gain', detail: `${loot.apple.description}${capped}` }
    case 'totem': {
      // The confirmed chance delta includes the one pickaxe spent to dig.
      const bonus = text.match(/机会\s*\+\s*(\d+)/)?.[1]
        ?? (effect.chanceDelta > 0 ? String(effect.chanceDelta + 1) : null)
      return { value: bonus ? `+${bonus} 次机会` : undefined, tone: 'gain', detail: bonus ? `本次用掉 1 把，再获得 ${bonus} 把镐子` : loot.totem.description }
    }
    case 'tnt': {
      if (effect.blocked) return { value: '盾牌抵挡', tone: 'protected', detail: '盾牌挡住了 TNT，奖励保留，盾牌已消耗' }
      const percent = text.match(/（(\d+)%/)?.[1]
      return { value: effect.amountDelta < 0 ? `−${formatMoney(-effect.amountDelta)}` : undefined, tone: 'loss', detail: percent ? `扣除当前待结算奖励的 ${percent}%，向下取整到分` : text || loot.tnt.description }
    }
    case 'shield':
      return money
        ? { value: money, tone: 'gain', detail: '已持有盾牌，重复道具转换为小奖励' }
        : { value: '获得保护', tone: 'protected', detail: text || loot.shield.description }
    case 'spyglass':
      return money
        ? { value: money, tone: 'gain', detail: '没有新的格子可看，转换为一份小奖励' }
        : { value: '私密情报', detail: text || loot.spyglass.description }
    case 'pearl':
      return { value: '全体换卡', detail: '一起进入下一张卡，个人机会与道具保留' }
  }
}

interface FeedbackGeometry {
  sourceX: number
  sourceY: number
  centerX: number
  centerY: number
  targetX: number
  targetY: number
  targetScale: number
  canFly: boolean
}

function targetSelector(effect: PresentationEffect) {
  if (!effect.isOwn || effect.kind === 'tnt' || effect.kind === 'pearl') return null
  if (effect.amountDelta > 0) return '[data-hud-target="reward"]'
  if (effect.kind === 'totem') return '[data-hud-target="chances"]'
  if (effect.kind === 'shield') return '[data-hud-target="shield"]'
  if (effect.kind === 'spyglass') {
    const target = effect.targetIndex
    return target !== null && target !== undefined ? `[data-card-id="${effect.cardId}"][data-cell-index="${target}"]` : `[data-card-id="${effect.cardId}"][data-private-hint]`
  }
  return null
}

function RewardShowcase({ effect, reduced }: { effect: PresentationEffect; reduced: boolean }) {
  const art = useRef<HTMLDivElement>(null)
  const [geometry, setGeometry] = useState<FeedbackGeometry | null>(null)
  const transfer = effect.phase === 'transfer'
  const copy = feedbackCopy(effect)
  const easing = [.22, 1, .36, 1] as const

  useLayoutEffect(() => {
    const measure = () => {
      const origin = art.current?.getBoundingClientRect()
      if (!origin) return
      const source = document.querySelector(`[data-card-id="${effect.cardId}"][data-cell-index="${effect.index}"]`)?.getBoundingClientRect()
      const selector = targetSelector(effect)
      const targetElement = (selector ? document.querySelector(selector) : null)
        ?? (effect.isOwn && effect.kind === 'shield' && !effect.amountDelta ? document.querySelector('.board-heading') : null)
      const target = targetElement?.getBoundingClientRect()
      const centerX = origin.x + origin.width / 2
      const centerY = origin.y + origin.height / 2
      setGeometry({
        sourceX: source ? source.x + source.width / 2 : centerX,
        sourceY: source ? source.y + source.height / 2 : centerY,
        centerX,
        centerY,
        targetX: target ? target.x + target.width / 2 : centerX,
        targetY: target ? target.y + target.height / 2 : centerY,
        targetScale: target ? Math.min(.38, Math.max(.18, Math.min(target.width, target.height) / 120)) : 1,
        canFly: Boolean(target),
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [effect.id, effect.phase, effect.index, effect.kind, effect.isOwn, effect.amountDelta, effect.chanceDelta, effect.text, effect.targetIndex, effect.blocked])

  const dx = geometry ? geometry.targetX - geometry.centerX : 0
  const dy = geometry ? geometry.targetY - geometry.centerY : 0
  const fly = !reduced && geometry?.canFly
  const transferAnimation = fly
    ? { x: [0, dx * .3, dx], y: [0, dy * .34 - 28, dy], scale: [1, .86, geometry.targetScale], opacity: [1, 1, 0] }
    : { x: 0, y: reduced ? 0 : effect.kind === 'tnt' ? 12 : -8, scale: reduced ? 1 : effect.kind === 'pearl' ? 1.14 : .94, opacity: 0 }

  return <motion.section className={`reward-showcase reward-showcase-${effect.kind} ${effect.isOwn ? 'is-own' : 'is-peer'} ${effect.blocked ? 'is-blocked' : ''}`} data-testid="reward-showcase" data-reward-kind={effect.kind} data-reward-phase={effect.phase} aria-label={`${loot[effect.kind].name}，${copy.detail}`} initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? .05 : .12 }}>
    <motion.div className="reward-showcase-veil" initial={{ opacity: 0 }} animate={{ opacity: transfer ? 0 : 1 }} transition={{ duration: reduced ? .05 : transfer ? .34 : .3 }} />
    <motion.div className="reward-showcase-panel" initial={{ opacity: 0 }} animate={{ opacity: transfer ? 0 : 1 }} transition={{ duration: reduced ? .05 : transfer ? .24 : .28 }}>
      <span className="reward-showcase-eyebrow">{effect.isOwn ? '你挖到了' : '同场发现'}</span>
      <div ref={art} className="reward-showcase-art" aria-hidden="true">
        <motion.span className="reward-showcase-halo" initial={{ opacity: 0, scale: reduced ? 1 : .78 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: reduced ? .05 : .55, ease: easing }} />
        {effect.kind === 'pearl' && <motion.span className="reward-showcase-portal" initial={{ opacity: 0, scale: reduced ? 1 : .76 }} animate={{ opacity: .7, scale: 1 }} transition={{ duration: reduced ? .05 : .6, ease: easing }} />}
      </div>
      <motion.div className="reward-showcase-copy" initial={{ opacity: 0, y: reduced ? 0 : 9 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? .05 : .3, delay: reduced ? 0 : .17, ease: easing }}>
        <h3>{loot[effect.kind].name}</h3>
        {copy.value && <strong className={`reward-showcase-value ${copy.tone ? `is-${copy.tone}` : ''}`}>{copy.value}</strong>}
        <p>{copy.detail}</p>
      </motion.div>
    </motion.div>
    {geometry && <motion.div className="reward-showcase-item" aria-hidden="true" style={{ left: geometry.centerX, top: geometry.centerY }} initial={reduced ? { opacity: 0, scale: 1, x: 0, y: 0 } : { opacity: 0, scale: .28, x: geometry.sourceX - geometry.centerX, y: geometry.sourceY - geometry.centerY }} animate={transfer ? transferAnimation : { opacity: 1, x: 0, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? .05 : transfer ? .66 : .46, ease: easing, ...(transfer && fly ? { times: [0, .42, 1] } : {}) }}>
      <div className="reward-showcase-icon"><ItemIcon kind={effect.kind} size={120} moving /></div>
      {effect.isOwn && effect.blocked && <motion.span className="reward-showcase-intercept" initial={{ opacity: 0, x: reduced ? 0 : -35, scale: reduced ? 1 : .8 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ duration: reduced ? .05 : .38, delay: reduced ? 0 : .28, ease: easing }}><ItemIcon kind="shield" size={92}/></motion.span>}
    </motion.div>}
  </motion.section>
}

/** This sequence presents confirmed results; it never changes gameplay or money. */
export function BoardFeedback({ effect }: { effect: PresentationEffect | null }) {
  const reduced = Boolean(useReducedMotion())
  const visible = effect?.isOwn && (effect.phase === 'effect' || effect.phase === 'transfer')
  return createPortal(<div className="reward-showcase-layer" aria-live="polite" aria-atomic="true"><AnimatePresence>{visible && effect && <RewardShowcase key={effect.id} effect={effect} reduced={reduced}/>}</AnimatePresence></div>, document.body)
}
