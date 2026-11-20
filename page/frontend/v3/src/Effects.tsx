import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useState } from 'react'
import { dialogAtom, hasteUntilAtom, meAtom, readyAtAtom, settledAtom, slowUntilAtom } from './state'
import { McNumber } from './Toolbar'

// 身上的效果（docs/V3_ITEMS.md §10，2026-11-11 用户：中毒做成专门的状态，比工具条里那一格明显）。
// 照原版右上角的效果图标：中毒（还有几次）、挖掘疲劳（蜘蛛网让这一次多等，还剩几秒）、急迫（药水还剩几秒）。
// 中毒时地图四周一圈绿光，被蜘蛛网缠着时四个角挂着蛛网；镐子上也带着标记（Toolbar.tsx）。
// 都是静止的：中毒的次数变了才闪一下，倒计时一秒改一次字（闲着不画，docs 在红包站 09-idle-frames.md）。

const BASE = 'assets/minecraft/1.21.4/textures/'
export const effectIcon = (name: 'poison' | 'mining_fatigue' | 'haste') => new URL(`${BASE}mob_effect/${name}.png`, document.baseURI).href
const COBWEB = () => new URL(`${BASE}block/cobweb.png`, document.baseURI).href

const body = (effect: Shown) => <>
  <span className="effect-text" aria-hidden="true"><b>{effect.name}</b><small>{effect.words}</small></span>
  <span className="effect-frame" aria-hidden="true">
    <img src={effectIcon(effect.icon)} alt="" draggable={false} />
    <McNumber key={effect.count} text={effect.count} tone="white" />
  </span>
</>

interface Shown { key: 'poison' | 'slow' | 'haste'; icon: Parameters<typeof effectIcon>[0]; name: string; count: string; words: string; bad: boolean }

export function Effects() {
  const me = useAtomValue(meAtom)
  const settled = useAtomValue(settledAtom)
  const hasteUntil = useAtomValue(hasteUntilAtom)
  const slowUntil = useAtomValue(slowUntilAtom)
  const readyAt = useAtomValue(readyAtAtom)
  const setDialog = useSetAtom(dialogAtom)
  const [now, setNow] = useState(() => Date.now())
  const until = Math.max(hasteUntil, slowUntil > 0 ? readyAt : 0)
  useEffect(() => {
    setNow(Date.now())
    if (until <= Date.now()) return
    const timer = window.setInterval(() => {
      const at = Date.now()
      setNow(at)
      if (at >= until) window.clearInterval(timer)
    }, 250)
    return () => window.clearInterval(timer)
  }, [until])

  const playing = !!me && me.status === 'playing' && !settled
  const poison = playing ? me.poison ?? 0 : 0
  // 蜘蛛网：这一次的等待里还有它那一段时，写还要等多久才能挖（整个等待，不只蜘蛛网那一段）
  const slow = playing && slowUntil > 0 ? Math.ceil(Math.max(0, readyAt - now) / 1000) : 0
  const haste = playing ? Math.ceil(Math.max(0, hasteUntil - now) / 1000) : 0
  const shown: Shown[] = []
  if (poison > 0) shown.push({ key: 'poison', icon: 'poison', name: '中毒', count: String(poison), words: `还有 ${poison} 次 · 每挖一次扣待领取 5%`, bad: true })
  if (slow > 0) shown.push({ key: 'slow', icon: 'mining_fatigue', name: '蜘蛛网', count: `${slow}`, words: `被缠住了 · 还要等 ${slow} 秒`, bad: true })
  if (haste > 0) shown.push({ key: 'haste', icon: 'haste', name: '急迫', count: `${haste}`, words: `还有 ${haste} 秒 · 挖只隔 1 秒`, bad: false })

  return <>
    <div className={`effect-veil${poison > 0 ? ' is-poison' : ''}${slow > 0 ? ' is-web' : ''}`} aria-hidden="true">
      {/* 次数变了（中了、又扣了一次）闪一下 */}
      {poison > 0 ? <i key={poison} className="veil-pulse" /> : null}
      {['tl', 'tr', 'bl', 'br'].map(corner => <img key={corner} className={`veil-web is-${corner}`} src={COBWEB()} alt="" draggable={false} />)}
    </div>
    {shown.length > 0 ? <ul className="effects" aria-label="身上的效果">
      {shown.map(effect => <li key={effect.key} className={`effect is-${effect.key}${effect.bad ? ' is-bad' : ''}`}>
        {/* 中毒点开看说明；另外两个字已经说全了 */}
        {effect.key === 'poison' ? <button type="button" className="effect-body" aria-label={`${effect.name}：${effect.words}`} title={effect.words}
          onClick={() => setDialog({ type: 'item', slot: 'poison' })}>{body(effect)}</button>
          : <span className="effect-body" aria-label={`${effect.name}：${effect.words}`}>{body(effect)}</span>}
      </li>)}
    </ul> : null}
  </>
}
