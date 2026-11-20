import { useAtomValue } from 'jotai'
import type { CSSProperties } from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { CARD_PX, SLOT_PX } from './camera'
import { ARROW } from './cursor'
import { colorOf, EMOTES, initialOf, pathsOf } from './emotes'
import { McText } from './McText'
import type { Watcher } from './presence'
import { bubblesAtom, canPoint, emoteReadyAtAtom, onlineAtom, pointersAtom, seatsAtom, sendEmote, setSettings, settingsAtom, watchersAtom } from './presence'
import { gameAtom, toast, uidAtom } from './state'
import type { PublicCard } from './types'

// 在场（docs/V3_ITEMS.md §20）：别人的指针、卡旁边谁在看、表情气泡、扔表情的按钮。指针和“在看”放在地图里
// （跟着拖动走，按镜头缩放反着缩，屏幕上一直一样大）；指针用 CSS 补间滑到新位置，停下就不画。

/**
 * 指针上画的道具（号码随指针发给游戏站，只能往后加）：镐子、冷却中的镐子、附魔镐、火把、钥匙。图标是
 * cursor.ts 画好的 --tool-*，和自己的指针一样。拿着望远镜时不发指针。
 */
export const TOOLS = ['pick', 'cool', 'ench', 'torch', 'key'] as const
/** 同屏最多画几个指针（离当前卡近的优先），多的不画 */
const MAX_POINTERS = 20
const NO_WATCHERS: Watcher[] = []

const ARROW_PATHS = (() => {
  const outline: string[] = []
  const fill: string[] = []
  ARROW.forEach((row, y) => [...row].forEach((pixel, x) => {
    if (pixel === 'X') outline.push(`M${x} ${y}h1v1h-1z`)
    else if (pixel === 'W') fill.push(`M${x} ${y}h1v1h-1z`)
  }))
  return { outline: outline.join(''), fill: fill.join('') }
})()

/** 一个表情的图：像素图画成 SVG，像素字用原版字体。 */
export const EmoteArt = memo(function EmoteArt({ n, size }: { n: number; size: number }) {
  const emote = EMOTES[n]
  if (!emote) return null
  if (emote.text) return <McText text={emote.text} color={emote.color} scale={Math.max(1, Math.round(size / 11))} className="emote-text" />
  return <svg className="emote-art" width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
    {pathsOf(emote.grid ?? []).map(path => <path key={path.color} d={path.d} fill={path.color} />)}
  </svg>
})

/** 冒出来的表情：飘起来、3 秒后淡出（CSS 动画，换一个表情换一个 key 从头来）。 */
export function EmoteBubble({ n }: { n: number }) {
  return <span className="emote-bubble" aria-label={EMOTES[n]?.label}><EmoteArt n={n} size={30} /></span>
}

/** 别人的指针：在看附近这几张卡的人，电脑上的才有。 */
export function PeerPointers({ near }: { near: { x: number; y: number } | null }) {
  const pointers = useAtomValue(pointersAtom)
  const seats = useAtomValue(seatsAtom)
  const bubbles = useAtomValue(bubblesAtom)
  const settings = useAtomValue(settingsAtom)
  const me = useAtomValue(uidAtom)
  if (!settings.pointers) return null
  const list = Object.entries(pointers).flatMap(([sid, [x, y, tool]]) => {
    const seat = seats[sid]
    return seat && seat.uid !== me ? [{ sid, x, y, tool, uid: seat.uid, name: seat.name }] : []
  })
  if (near && list.length > MAX_POINTERS) {
    const cx = near.x * SLOT_PX
    const cy = near.y * SLOT_PX
    list.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
  }
  return <div className="peers" aria-hidden="true">
    {list.slice(0, MAX_POINTERS).map(peer => {
      const bubble = settings.emotes ? bubbles[String(peer.uid)] : undefined
      return <PeerPointer key={peer.sid} x={peer.x} y={peer.y} tool={peer.tool} uid={peer.uid} name={peer.name} bubble={bubble?.onPointer ? bubble : undefined} />
    })}
  </div>
}

const PeerPointer = memo(function PeerPointer({ x, y, tool, uid, name, bubble }: { x: number; y: number; tool: number; uid: number; name: string; bubble?: { n: number; at: number } }) {
  return <div className="peer" style={{ transform: `translate3d(${x}px, ${y}px, 0)`, '--peer': colorOf(uid) } as CSSProperties}>
    <div className="peer-body">
      <svg className="peer-arrow" width="11" height="16" viewBox="0 0 11 16" shapeRendering="crispEdges">
        <path d={ARROW_PATHS.outline} fill="#000" />
        <path d={ARROW_PATHS.fill} fill="var(--peer)" />
      </svg>
      <i className="peer-tool" style={{ backgroundImage: `var(--tool-${TOOLS[tool] ?? 'pick'})` }} />
      <span className="peer-name">{name}</span>
      {bubble ? <EmoteBubble key={bubble.at} n={bubble.n} /> : null}
    </div>
  </div>
})

/**
 * 谁在看这张卡：几个带名字首字的小圆点（正冒着表情的排前面），多的写 +N。words 时后面写“在看”。
 * 手机上点一下说出所有人的名字，电脑上指着看。
 */
export function Watchers({ cardId, words = true }: { cardId: number; words?: boolean }) {
  const watchers = useAtomValue(watchersAtom).get(cardId) ?? NO_WATCHERS
  const bubbles = useAtomValue(bubblesAtom)
  const showEmotes = useAtomValue(settingsAtom).emotes
  if (watchers.length === 0) return null
  const bubbleOf = (watcher: Watcher) => {
    const bubble = showEmotes ? bubbles[String(watcher.uid)] : undefined
    return bubble && !bubble.onPointer ? bubble : undefined
  }
  const shown = [...watchers].sort((a, b) => Number(!!bubbleOf(b)) - Number(!!bubbleOf(a))).slice(0, 3)
  const names = watchers.map(watcher => watcher.name)
  const said = `${names.slice(0, 10).join('、')}${names.length > 10 ? ` 等 ${names.length} 人` : ''}在看这张卡`
  return <button type="button" className="watchers" title={said} aria-label={said} onClick={() => toast(said)}>
    {shown.map(watcher => {
      const bubble = bubbleOf(watcher)
      return <span key={watcher.uid} className="watcher" style={{ '--peer': colorOf(watcher.uid) } as CSSProperties}>
        {initialOf(watcher.name)}
        {bubble ? <EmoteBubble key={bubble.at} n={bubble.n} /> : null}
      </span>
    })}
    {watchers.length > 3 ? <span className="watcher-more">+{watchers.length - 3}</span> : null}
    {words ? <span className="watcher-words">在看</span> : null}
  </button>
}

/** 全图上“最近有人挖”算多久。 */
const RECENT_DIG_MS = 20_000

/**
 * 全图那一级（2026-11-13 用户：全图上怎么知道哪里热闹）：每张有人在看、最近有人挖的卡正中一个小牌子，写几人在看，
 * 人越多越亮；最近 20 秒有人挖过画一把镐子（不动，到时候就撤）；那张卡上有人扔表情时牌子跳一下。不画指针，
 * 全图上看不清，还要把所有人的指针都发过来。点牌子就是点那张卡（牌子不接收点击）。
 */
export function HeatBadges({ cards }: { cards: PublicCard[] }) {
  const watchers = useAtomValue(watchersAtom)
  const bubbles = useAtomValue(bubblesAtom)
  const feed = useAtomValue(gameAtom)?.feed
  const [now, setNow] = useState(() => hb.now())
  const dugAt = new Map<number, number>()
  // 时钟对不上（比现在晚很多）的不算
  for (const item of feed ?? []) if (now - item.at < RECENT_DIG_MS && item.at - now < 5000) dugAt.set(item.cardId, Math.max(dugAt.get(item.cardId) ?? 0, item.at))
  // 最早到时候的那把镐子到点了再画一次（没有就不定时）
  const next = dugAt.size ? Math.min(...dugAt.values()) + RECENT_DIG_MS - now : null
  useEffect(() => {
    if (next === null) return
    const timer = window.setTimeout(() => setNow(hb.now()), Math.max(50, next))
    return () => window.clearTimeout(timer)
  }, [next])
  useEffect(() => setNow(hb.now()), [feed])
  const byId = new Map(cards.map(card => [card.id, card]))
  const ids = new Set([...watchers.keys(), ...dugAt.keys()])
  return <>{[...ids].map(id => {
    const card = byId.get(id)
    if (!card) return null
    const people = watchers.get(id) ?? NO_WATCHERS
    const count = people.length
    const tier = count >= 10 ? 4 : count >= 5 ? 3 : count >= 2 ? 2 : count
    const pulse = people.reduce((latest, watcher) => Math.max(latest, bubbles[String(watcher.uid)]?.at ?? 0), 0)
    const dug = dugAt.has(id)
    const said = `${count ? `${count} 人在看` : ''}${count && dug ? '，' : ''}${dug ? '刚有人在挖' : ''}`
    return <div key={id} className="heat-badge" style={{ left: card.x * SLOT_PX, top: card.y * SLOT_PX }} aria-label={said} title={said}>
      <span key={pulse} className={`heat-tag tier-${tier}${pulse ? ' is-pulse' : ''}`}>
        {count ? `${count} 人` : null}
        {dug ? <i className="heat-dig" aria-hidden="true" /> : null}
      </span>
    </div>
  })}</>
}

/** 别的卡上谁在看（当前卡的写在卡上面那一行里）：卡的左上角上面一个小牌子。 */
export function WatchBadges({ cards }: { cards: PublicCard[] }) {
  const watchers = useAtomValue(watchersAtom)
  return <>{cards.map(card => watchers.get(card.id)?.length
    ? <div key={card.id} className="watch-badge" style={{ left: card.x * SLOT_PX - CARD_PX / 2, top: card.y * SLOT_PX - CARD_PX / 2 }}>
      <Watchers cardId={card.id} words={false} />
    </div>
    : null)}</>
}

/**
 * 扔表情（地图右下角，缩放按钮上面）：点开 8 个表情，点一个扔出去、收起；2.5 秒一个。下面是开关：
 * 显示别人的表情、显示别人的指针、让别人看到我的指针（只有电脑上有）。
 */
/** 扔完一个表情以后的 2.5 秒（按钮、表情圈里的表情变暗）。 */
function useEmoteCooling() {
  const readyAt = useAtomValue(emoteReadyAtAtom)
  const [, setTick] = useState(0)
  const left = readyAt - Date.now()
  useEffect(() => {
    if (left <= 0) return
    const timer = window.setTimeout(() => setTick(value => value + 1), left)
    return () => window.clearTimeout(timer)
  }, [left, readyAt])
  return left > 0
}

export function EmoteButton() {
  const [open, setOpen] = useState(false)
  const cooling = useEmoteCooling()
  const mine = useAtomValue(bubblesAtom).me
  const online = useAtomValue(onlineAtom)
  const settings = useAtomValue(settingsAtom)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  const pick = (n: number) => {
    if (sendEmote(n)) setOpen(false)
  }
  return <div className="emote-float" ref={box}>
    {open ? <div className="emote-panel" role="dialog" aria-label="扔个表情">
      <p className="emote-online">{online} 人在矿洞里，表情只有看得见你这张卡的人看得到</p>
      <div className="emote-grid">
        {EMOTES.map((emote, n) => <button key={emote.label} type="button" title={emote.label} aria-label={emote.label} disabled={cooling} onClick={() => pick(n)}>
          <EmoteArt n={n} size={30} />
        </button>)}
      </div>
      <label className="emote-switch"><input type="checkbox" checked={settings.emotes} onChange={event => setSettings({ emotes: event.target.checked })} />显示别人的表情</label>
      <label className="emote-switch"><input type="checkbox" checked={settings.pointers} onChange={event => setSettings({ pointers: event.target.checked })} />显示别人的指针</label>
      {canPoint() ? <label className="emote-switch"><input type="checkbox" checked={settings.mine} onChange={event => setSettings({ mine: event.target.checked })} />让别人看到我的指针</label> : null}
    </div> : null}
    <button type="button" className={`emote-toggle${cooling ? ' is-cooling' : ''}`} aria-expanded={open} aria-label="扔个表情" onClick={() => setOpen(value => !value)}>
      <EmoteArt n={0} size={22} />
      {mine && !mine.where ? <EmoteBubble key={mine.at} n={mine.n} /> : null}
    </button>
  </div>
}

/** 自己在地图上右键扔的表情：从扔的地方冒出来（地图里，跟着拖动走）。 */
export function MyBubble() {
  const mine = useAtomValue(bubblesAtom).me
  if (!mine?.where) return null
  return <div className="peer is-me" aria-hidden="true" style={{ transform: `translate3d(${mine.where[0]}px, ${mine.where[1]}px, 0)` }}>
    <div className="peer-body"><EmoteBubble key={mine.at} n={mine.n} /></div>
  </div>
}

/**
 * 电脑上在地图上点右键（手上没拿道具时）：鼠标周围一圈 8 个表情，点一个就从这里扔出去；Esc、点别处、
 * 滚轮收起。x、y 是在地图区里的位置，靠边时往里挪一点，整圈都在画面里。
 */
export function EmoteWheel({ x, y, width, height, onPick, onClose }: {
  x: number; y: number; width: number; height: number; onPick: (n: number) => void; onClose: () => void
}) {
  const cooling = useEmoteCooling()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onClose, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onClose)
    }
  }, [onClose])
  const reach = WHEEL_RADIUS + 26
  const cx = Math.min(Math.max(x, reach), Math.max(reach, width - reach))
  const cy = Math.min(Math.max(y, reach), Math.max(reach, height - reach))
  return <div className="emote-wheel" ref={box} role="menu" aria-label="扔个表情" style={{ left: cx, top: cy }} onContextMenu={event => event.preventDefault()}>
    {EMOTES.map((emote, n) => {
      const angle = -Math.PI / 2 + (n / EMOTES.length) * Math.PI * 2
      return <button key={emote.label} type="button" role="menuitem" className="emote-wheel-item" title={emote.label} aria-label={emote.label} disabled={cooling}
        style={{ '--dx': `${Math.round(Math.cos(angle) * WHEEL_RADIUS)}px`, '--dy': `${Math.round(Math.sin(angle) * WHEEL_RADIUS)}px` } as CSSProperties}
        onClick={() => onPick(n)}>
        <EmoteArt n={n} size={28} />
      </button>
    })}
  </div>
}

const WHEEL_RADIUS = 58
