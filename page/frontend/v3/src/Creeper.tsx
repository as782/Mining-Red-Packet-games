import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { play } from './sound'
import { creeperAtAtom, creeperBoom, creeperShownAtom, meAtom, settledAtom, store, toast, totalOf } from './state'
import { money } from './types'

/** 苦力怕探头以后倒数多久（游戏站核对时也是 10 秒）。 */
export const CREEPER_WARN_MS = 10_000

/**
 * 苦力怕（docs/V3_ITEMS.md §3、§9，防蹲守）：手上有分、开着网页、很久没挖也没用道具，它从地图右边
 * 探头，“嘶……”，倒数 10 秒：头 1 秒从右边探进来，之后一点点往里挤、越变越大，白闪从一秒一次加快到
 * 一秒八次（2026-11-11 用户：要吓人）。这 10 秒里挖一格、用道具或领取，游戏站重新计时，它就走开；
 * 没走开就炸掉待领取的 20%（至少 0.01，末影箱里的炸不到），由游戏站核对时间再扣。只在这 10 秒里
 * 每一帧动（直接改样式，不重画组件），平时不画。
 */
export function Creeper() {
  const at = useAtomValue(creeperAtAtom)
  const me = useAtomValue(meAtom)
  const settled = useAtomValue(settledAtom)
  const [now, setNow] = useState(() => Date.now())
  const [flash, setFlash] = useState(0)
  const booming = useRef<number | null>(null)
  const hissed = useRef<number | null>(null)
  const active = at !== null && !settled && me?.status === 'playing' && (me?.points ?? 0) > 0

  // 没到时候就睡到那一刻（以前一直每 250 毫秒走一下）；来了以后每 250 毫秒走一下，倒数和胀大要用
  useEffect(() => {
    if (!active || at === null) return
    let timer = 0
    const tick = () => {
      const time = Date.now()
      setNow(time)
      timer = window.setTimeout(tick, time < at ? Math.min(at - time, 60_000) : 250)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [active, at])

  // 只在看得见的时候来：网页在后台（切走的标签页、锁屏回来）时不倒数，回来以后从头给 10 秒（审查发现：
  // 后台里倒数没人看见，手机锁屏回来一打开就炸了）
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  /** 本机：苦力怕在画面上探头的时刻（从这时起倒数 10 秒） */
  const [shownAt, setShownAt] = useState<number | null>(null)
  const due = active && at !== null && now >= at
  // 游戏站给了新的时刻（挖了、用了道具、没炸成）：重新来过
  const lastAt = useRef(at)
  useEffect(() => {
    const changed = lastAt.current !== at
    lastAt.current = at
    if (!due || !visible || changed) setShownAt(due && visible ? Date.now() : null)
    else setShownAt(value => value ?? Date.now())
  }, [due, visible, at])
  const coming = due && visible && shownAt !== null
  // 顶上那一行它最优先：步骤条、通知让开
  useEffect(() => {
    store.set(creeperShownAtom, coming)
    return () => store.set(creeperShownAtom, false)
  }, [coming])
  const left = coming && shownAt !== null ? shownAt + CREEPER_WARN_MS - now : CREEPER_WARN_MS

  useEffect(() => {
    if (!coming || shownAt === null || hissed.current === shownAt) return
    hissed.current = shownAt
    play('fuse')
  }, [coming, shownAt])

  useEffect(() => {
    if (!coming || shownAt === null || left > 0 || booming.current === shownAt) return
    booming.current = shownAt
    void creeperBoom().then(lost => {
      if (!lost) return
      setFlash(Date.now())
      play('tnt')
      toast(`苦力怕炸掉了待领取的 ${money(lost)}`, 'bad')
    })
  }, [coming, shownAt, left])

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(0), 700)
    return () => window.clearTimeout(timer)
  }, [flash])

  // 进场、变大、闪：倒数这 10 秒里每一帧直接改样式
  const body = useRef<HTMLDivElement>(null)
  const face = useRef<HTMLSpanElement>(null)
  const hiss = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const element = body.current
    if (!coming || shownAt === null || !element) return
    // 减少动画：探出来就停着，不变大、不闪
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      element.style.transform = 'translateX(45%) rotate(-10deg)'
      return () => {
        element.style.transform = ''
      }
    }
    let frame = 0
    let phase = 0
    let last = performance.now()
    const tick = () => {
      const time = performance.now()
      const t = Math.min(1, (Date.now() - shownAt) / CREEPER_WARN_MS)
      // 头 10% 从右边探进来（藏一半），之后一点点往里挤到只藏一成
      const enter = t < 0.1 ? 1 - (1 - t / 0.1) ** 3 : 1
      const creep = t < 0.1 ? 0 : (t - 0.1) / 0.9
      const hidden = 1.1 - enter * 0.55 - creep * creep * 0.45
      const scale = 1 + t ** 1.6 * 1.9
      element.style.transform = `translateX(${hidden * 100}%) scale(${scale}) rotate(${-14 + t * 10}deg)`
      // 白闪：一秒一次加快到一秒八次
      phase += ((time - last) / 1000) * (1 + t ** 1.3 * 7)
      last = time
      if (face.current) face.current.style.filter = phase % 1 > 0.62 ? 'brightness(2.6) saturate(.05)' : ''
      if (hiss.current) {
        hiss.current.style.fontSize = `${13 + t * 8}px`
        hiss.current.style.right = `${40 + scale * 40}px`
      }
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      element.style.transform = ''
      if (face.current) face.current.style.filter = ''
    }
  }, [coming, shownAt])

  const chest = me && totalOf(me) > me.points
  return <>
    <div ref={body} className={`creeper${coming ? ' is-on' : ''}`} aria-hidden="true">
      <span ref={face} className="creeper-face" />
    </div>
    {coming ? <p ref={hiss} className="creeper-hiss" aria-hidden="true">嘶……</p> : null}
    {coming ? <div className="item-tip creeper-tip" role="alert">
      <b className="is-green">苦力怕来了</b>
      {Math.max(0, Math.ceil(left / 1000))} 秒内挖一格、用个道具或者见好就收，它就走开；不然炸掉待领取的 20%{chest ? '，末影箱里的炸不到' : ''}。
    </div> : null}
    {flash ? <div key={flash} className="creeper-flash" aria-hidden="true" /> : null}
  </>
}
