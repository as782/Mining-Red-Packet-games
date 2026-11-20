import { useAtomValue, useSetAtom } from 'jotai'
import { motion } from 'motion/react'
import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import { CARD_PX, SLOT_PX } from './camera'
import { McText } from './McText'
import { Watchers } from './Peers'
import { aboutMoney, chanceWords, decayingNoiseOf, leftoversOf, noiseOf, PLENTY, regionName, richestOf, tellOf } from './regions'
import { dialogAtom, digIntervalAtom, focusRequestAtom, gameAtom, hongbaoAtom, uidAtom } from './state'
import type { Kind, PublicCard, WokeBy } from './types'
import { KIND_NAMES, money } from './types'

/**
 * 卡周围的说明（docs/V3_ITEMS.md §9，2026-11-11 用户：区块本身要有说明，底栏那些不用了，都放在卡周围）：
 * 挖卡这一级，当前卡的上面一行是区块名字带问号（点开是说明弹窗）和挖了几格，下面一行是余量（只说还有
 * 什么值得挖），深暗之域下面是噪音条。放在地图里（跟着拖动走），字按镜头缩放反着缩，屏幕上一直一样大；
 * 镜头在挖卡这一级上下各留了一行的地方（camera.ts LABEL_SPACE）。换卡时淡出淡入。
 */
export function CardLabels({ card }: { card: PublicCard }) {
  const setDialog = useSetAtom(dialogAtom)
  const style = {
    left: card.x * SLOT_PX - CARD_PX / 2,
    top: card.y * SLOT_PX - CARD_PX / 2,
    width: CARD_PX,
    height: CARD_PX,
  } as CSSProperties
  const fixed = Object.keys(card.fixed ?? {}).length
  const dug = card.cells.filter(cell => cell && !cell.burn).length
  const deep = card.kind === 'deep'
  return <motion.div className="card-labels" style={style} aria-label={`${regionName(card)}的说明`}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
    <div className="card-head">
      {/* 谁在看紧挨着区块名字（2026-11-13 用户：靠近区块说明，看得出是这张卡的） */}
      <span className="card-head-start">
        <button type="button" className={`region-name is-${card.kind ?? 'normal'}`} onClick={() => setDialog({ type: 'region', cardId: card.id })}
          aria-label={`${regionName(card)}：点开看说明`}>
          {regionName(card)}<i aria-hidden="true">?</i>
        </button>
        <Watchers cardId={card.id} />
      </span>
      {deep ? <Leftovers card={card} /> : <span className="card-progress">
        {card.finished ? '挖完了' : `已挖 ${dug}/${card.cells.length - fixed}`}
      </span>}
    </div>
    <div className="card-foot">
      {deep ? <Noise card={card} /> : <Leftovers card={card} />}
    </div>
  </motion.div>
}

/**
 * 余量（docs/V3_ITEMS.md §9）：还藏着约多少钱、有哪几样宝贝（几个用原版乱码盖住，每一帧跳）；
 * 挖得差不多了（挖完、关了也一样）就指去最富的那张，点一下飞过去。
 */
function Leftovers({ card }: { card: PublicCard }) {
  const game = useAtomValue(gameAtom)
  const unit = useAtomValue(hongbaoAtom)?.unit ?? 'LDC'
  const focus = useSetAtom(focusRequestAtom)
  if (!game) return null
  const { worth, kinds, poor } = leftoversOf(card, game.rules, game.left)
  if (poor) {
    const richest = richestOf(game.cards, game.rules, game.left, card.id)
    const open = !card.finished && !card.closed
    if (!richest) return open ? <span className="leftovers is-empty">宝贝都被挖走了</span> : null
    const where = regionName(richest.card)
    return <span className="leftovers is-poor">
      {open ? <span className="leftovers-label">这张挖得差不多了</span> : null}
      <button type="button" className="go-richest" onClick={() => focus({ cardId: richest.card.id, at: Date.now(), dig: true })}>
        去{where} ➜ 还藏着约 <b>{aboutMoney(richest.worth)}</b> {unit}
      </button>
    </span>
  }
  // 余量怎么说（docs/V3_ITEMS.md §15）：乱码、模糊、准数，一张卡只用一种
  const { tell, covered } = tellOf(card)
  const countOf = (kind: Kind) => card.left[kind] ?? 0
  const said = kinds.map(kind => tell === 'exact' ? `${KIND_NAMES[kind]} ${countOf(kind)} 个` : tell === 'fuzzy' && countOf(kind) >= PLENTY ? `${KIND_NAMES[kind]}不少` : KIND_NAMES[kind]).join('、')
  return <span className={`leftovers is-${tell}`} aria-label={`还藏着约 ${aboutMoney(worth)} ${unit}${kinds.length ? `${tell === 'exact' ? `，最后 ${covered} 格里有` : '，有'}${said}` : ''}`}>
    <span className="leftovers-label">还藏着约</span>
    <b className="leftovers-worth">{aboutMoney(worth)}</b>
    <span className="leftovers-label">{unit}</span>
    {tell === 'exact' && kinds.length ? <span className="leftovers-label">最后 {covered} 格</span> : null}
    {kinds.map(kind => <span key={kind} className="leftover"><ItemIcon kind={kind} size={18} />
      {tell === 'garble' ? <McText text={HIDDEN_COUNT} color="#ffaa00" obfuscate />
        : tell === 'exact' ? <McText text={String(countOf(kind))} color="#ffaa00" />
          : countOf(kind) >= PLENTY ? <span className="leftover-plenty">不少</span> : null}
    </span>)}
  </span>
}

/** 余量里乱码的那几样：不管几个都画两个字，照真实位数写会露出是一位数还是两位数（2026-11-12 用户：两位数的还会更长） */
const HIDDEN_COUNT = '00'

/** 深暗之域的噪音条：旧局前面一段安全、斜纹那段是危险区；新局噪音会退，从安静到很吵一条颜色（NoiseDecaying）。 */
function Noise({ card }: { card: PublicCard }) {
  const uid = useAtomValue(uidAtom)
  if (card.closed) return <span className="noise-line is-closed"><ItemIcon kind="sculk" size={16} />{wokeWords(card.wokeBy, uid)}</span>
  if (card.noiseAt !== undefined) return <NoiseDecaying card={card} />
  const noise = noiseOf(card)
  const at = (value: number) => `${Math.min(100, (value / noise.cells) * 100)}%`
  return <span className={`noise-line${noise.danger ? ' is-danger' : ''}`} role="status">
    <ItemIcon kind="sculk" size={16} />
    <b>噪音 {noise.noise}</b>
    <span className="noise-track" style={{ '--a': at(noise.low), '--b': at(noise.high), '--n': at(noise.noise) } as CSSProperties} aria-hidden="true"><i /></span>
    <span className="noise-words">{noise.danger ? '随时可能惊醒监守者' : `再挖 ${noise.toDanger} 格进入危险区`}</span>
  </span>
}

/**
 * 监守者醒了以后卡下面那一行：谁吵醒的、待领取的被抢走一半（旧的游戏站没记谁）。卡关了不用再说，
 * 卡上已经暗下来、写着监守者醒了（2026-11-12 用户）。
 */
export function wokeWords(woke: WokeBy | undefined, uid: number | null) {
  if (!woke) return '监守者醒了，吵醒它的人待领取的被抢走一半'
  const who = woke.uid === uid ? '你' : woke.name
  return woke.amount > 0 ? `${who}吵醒了监守者，待领取的被抢走一半（-${money(woke.amount)}）` : `${who}吵醒了监守者，好在手上没有待领取的`
}

/**
 * 会退的噪音（docs/V3_ITEMS.md §16）：条上的点自己往回走（NoiseRail，不重画网页）；字只在变的那一刻重画
 * （安全时“还能安全挖几格”多一格的那一刻，危险时每秒看一次这一下的可能）。
 */
function NoiseDecaying({ card }: { card: PublicCard }) {
  const digInterval = useAtomValue(digIntervalAtom)
  const rules = { digInterval }
  const [now, setNow] = useState(() => hb.now())
  const noise = decayingNoiseOf(card, rules, now)
  useEffect(() => {
    if (noise.next === null) return
    const timer = window.setTimeout(() => setNow(hb.now()), noise.next)
    return () => window.clearTimeout(timer)
  }, [noise.next, now])
  // 卡变了（有人挖了）就按这一刻重算
  useEffect(() => setNow(hb.now()), [card.noise, card.noiseAt])
  const danger = noise.chance > 0
  return <span className={`noise-line${danger ? ' is-danger' : ''}`} role="status">
    <ItemIcon kind="sculk" size={16} />
    <b>噪音</b>
    <span className="noise-track is-v2" style={{ '--from': `${(noise.from / noise.cells) * 100}%` } as CSSProperties} aria-hidden="true">
      <NoiseRail card={card} cells={noise.cells} decay={noise.decay} />
    </span>
    <span className="noise-words">{danger ? chanceWords(noise.chance) : `还能安全挖 ${noise.safe} 格`}</span>
  </span>
}

/**
 * 噪音条上的点：从 noiseAt 那一刻的噪音照着退的速度一直走回 0，用 CSS 动画在合成层上走，网页不用每帧重画。
 * 新的噪音来了（noiseAt 变了）就换一个重新走。
 */
export function NoiseRail({ card, cells, decay }: { card: Pick<PublicCard, 'noise' | 'noiseAt'>; cells: number; decay: number }) {
  const peak = Math.min(1, (card.noise ?? 0) / Math.max(1, cells))
  const style = {
    '--n0': `${peak * 100}%`,
    animationDuration: `${Math.max(1, (card.noise ?? 0) * decay)}ms`,
    animationDelay: `${-Math.max(0, hb.now() - (card.noiseAt ?? 0))}ms`,
  } as CSSProperties
  return <span key={card.noiseAt} className="noise-rail" style={style}><i /></span>
}
