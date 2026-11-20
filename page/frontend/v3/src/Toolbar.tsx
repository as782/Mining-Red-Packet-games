import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import type { Level } from './camera'
import { makeCursors } from './cursor'
import { ShapeGlyph } from './Dialogs'
import { useCooling } from './Hud'
import type { Slot } from './items'
import { classOf, CRAFT_NEED, countOf, edgesOf, isHeld, knowsGuide, SHIELD_CAP, shapeOf, SLOT_ICONS, SLOT_NAMES, slotsOf } from './items'
import { play } from './sound'
import { blockedAtom, dialogAtom, hasGameAtom, hasteUntilAtom, heldAtom, itemsGameAtom, itemsVersionAtom, meAtom, putDown, settledAtom, slowUntilAtom, store, toast } from './state'
import type { Me } from './types'

/**
 * 工具条（docs/V3_ITEMS.md §5）：像右下角的缩放一样浮在地图上（竖着的画面在左下，横着的在左边居中），
 * 只有自己那一块；挖卡时镜头让开它（camera.ts TOOLBAR_SPACE）。镐子固定在最前面，带着机会和冷却；
 * 后面是手里的道具，再隔一道线是被动的（盾牌、煤炭、木棍、中毒）。放不下时可以滑（两头渐隐，有箭头）。
 *
 * 点法（用户选的 B，2026-11-11）：道具的说明和确认都在弹窗里，按钮挨着说明，不在工具条旁边长气泡。
 * 对格子用的点一下就是使用（第一次先弹窗教一次，按钮叫“使用”），地图上预览、再点一次确认；再点它、Esc、右键取消。
 * 药水、藏宝图弹窗确认；末影箱、附魔台弹窗；被动的和镐子弹窗说明。
 */
export const Toolbar = memo(function Toolbar({ level, onNeedDig }: { level: Level; onNeedDig: () => void }) {
  const me = useAtomValue(meAtom)
  // 只订阅规则里用到的：别人每挖一格 gameAtom 都换，工具条不该跟着重画、重新量一遍（2026-11-11 量过）
  const hasGame = useAtomValue(hasGameAtom)
  /** 有格子可画（不然是个空框） */
  const shown = !!me && hasGame
  const items = useAtomValue(itemsGameAtom)
  const version = useAtomValue(itemsVersionAtom)
  const blocked = useAtomValue(blockedAtom)
  const settled = useAtomValue(settledAtom)
  const [held, setHeld] = useAtom(heldAtom)
  const setDialog = useSetAtom(dialogAtom)
  const cooling = useCooling()
  const hasteUntil = useAtomValue(hasteUntilAtom)
  const slowUntil = useAtomValue(slowUntilAtom)
  const reduced = useReducedMotion() ?? false
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const slotRefs = useRef(new Map<Slot, HTMLElement>())
  const [ends, setEnds] = useState({ start: false, end: false })
  const crafted = useCraft(me, slotRefs, box, reduced || version >= 2)
  const goo = useRef<HTMLDivElement>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  useCraftDrop(me, version, reduced, drop, setDrop, slotRefs, goo)

  const slots = me ? slotsOf(me, items, version) : { active: [], passive: [] }
  // 第 2 版正在合成（水滴）：两格之间流过去的这一会儿，按动画的进度排（docs/V3_ITEMS.md §9）
  const active = drop ? dropOrder(slots.active, drop) : slots.active
  const { passive } = slots
  // 第 1 版正在合成：煤炭、木棍满着多留一会儿，飞去火把那一格
  const shownPassive: Slot[] = crafted ? [...passive.filter(slot => slot !== 'coal' && slot !== 'stick'), 'coal', 'stick'] : passive
  const order: Slot[] = ['pickaxe', ...active, ...shownPassive]
  /** 格子的排法：变了才量、才做 layout 动画（以前每次重画 motion 都把每一格量一遍） */
  const orderKey = order.join()
  const playing = !!me && me.status === 'playing' && !settled

  useEffect(makeCursors, [])

  // 道具用完了、没了：放下它
  useEffect(() => {
    if (held && (!order.includes(held) || (me && countOf(me, held) === 0) || !playing)) putDown()
  })
  // 拿起来时不在挖卡这一级：飞到当前卡（弹窗里点“使用”也一样）
  const needDig = useRef(onNeedDig)
  needDig.current = onNeedDig
  const levelNow = useRef(level)
  levelNow.current = level
  useEffect(() => {
    if (held && levelNow.current !== 2) needDig.current()
  }, [held])

  // 点一格：按道具的类走流程（docs/ITEM_UX.md §4）
  const tap = (slot: Slot) => {
    const kind = classOf(slot)
    // 在选位置这一步时点镐子、再点那一格：取消
    if (held && (slot === 'pickaxe' || held === slot)) {
      putDown()
      play('click')
      return
    }
    // 被动的、镐子，和一直摆着但现在没有的（火把是 0）：只看说明
    if (kind === 'base' || kind === 'passive' || (me && countOf(me, slot) === 0)) {
      setDialog({ type: 'item', slot })
      return
    }
    if (!playing || blocked) {
      toast(blocked ?? '已经领取了，不能再用')
      return
    }
    if (held) putDown()
    if (isHeld(slot)) {
      if (!knowsGuide(slot)) {
        setDialog({ type: 'item', slot, mode: 'enter' })
        return
      }
      setHeld(slot)
      play('click')
      return
    }
    if (kind === 'choice') setDialog({ type: slot === 'ender' ? 'ender' : 'table' })
    else setDialog({ type: 'item', slot })
  }
  const tapRef = useRef(tap)
  tapRef.current = tap
  const orderRef = useRef(order)
  orderRef.current = order

  // 键盘：1–9 选第几格，Esc 放下
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') {
        // 开着弹窗时 Esc 只关弹窗（步骤条的问号打开的引导关掉以后还在这一步）
        if (event.defaultPrevented || store.get(dialogAtom)) return
        putDown()
        return
      }
      const n = Number(event.key)
      if (event.key.length === 1 && Number.isInteger(n) && n >= 1 && n <= Math.min(9, orderRef.current.length)) {
        event.preventDefault()
        tapRef.current(orderRef.current[n - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 放不下时：两头渐隐、箭头（哪头还有就显示哪头）。按格子排出来的长度量（items.ts edgesOf）
  const measure = () => {
    const next = scrollEdges(scroller.current)
    if (next) setEnds(before => (before.start === next.start && before.end === next.end ? before : next))
  }
  // 只在格子变了时量；大小变了有 ResizeObserver；合成的水滴流完再量一次（流的时候垫的壳会撑出地方）
  useLayoutEffect(measure, [orderKey])
  // 收起的那一格要等它自己的收起动画走完才离开（之前量到的还算着它）
  useEffect(() => {
    if (drop) return
    const later = window.setTimeout(measure, 500)
    return () => window.clearTimeout(later)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop === null])
  // 水滴流的时候格子在长、在收：两头的渐隐和箭头先不出
  const edges = drop ? { start: false, end: false } : ends
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    // 里面的格子长出来、收起来时外面不一定变大小：两个都看着
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    const onWheel = (event: WheelEvent) => {
      // 竖着滚轮也能横着滚（横屏时工具条本来就是竖的）
      if (!isVertical(element) && overflowOf(element) > 2 && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        element.scrollLeft += event.deltaY
        event.preventDefault()
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    // 刚打开时格子还在长出来、字体还在加载：过一会儿再量一次
    const later = window.setTimeout(measure, 600)
    return () => {
      window.clearTimeout(later)
      observer.disconnect()
      element.removeEventListener('wheel', onWheel)
    }
    // 还没有游戏时工具条只是个空框（下面提前 return），没有可量的；有了再装
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])
  const scrollBy = (sign: 1 | -1) => {
    const element = scroller.current
    if (!element) return
    const vertical = isVertical(element)
    element.scrollBy({ [vertical ? 'top' : 'left']: sign * 112, behavior: reduced ? 'auto' : 'smooth' })
  }
  // 鼠标按住拖也能滚；拖过的那下不算点
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  const dragged = useRef(0)
  // 新拿起的那格滚进来
  useEffect(() => {
    const element = held ? slotRefs.current.get(held) : null
    element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [held, reduced])

  if (!shown) return <div className="toolbar" ref={box} />
  const haste = Math.max(0, hasteUntil - Date.now())
  // 镐子身上的效果（Effects.tsx 是画面上的那份）：中毒、被蜘蛛网缠着（冷却里蜘蛛网那一段还没过完）
  const poisoned = (me.poison ?? 0) > 0 && playing
  const webbed = slowUntil > 0 && cooling.seconds > 0

  const slotView = (slot: Slot) => {
    /** 激活（docs/ITEM_UX.md §3.1）：手上拿着的那一件，金边、变大；什么都没拿时是镐子，一次只有一格 */
    const selected = slot === 'pickaxe' ? held === null : held === slot
    const count = drop ? dropCount(slot, drop, countOf(me, slot)) : countOf(me, slot)
    const shape = isHeld(slot) ? shapeOf(slot) : null
    const craftFull = crafted && (slot === 'coal' || slot === 'stick')
    // 第 1 版的煤炭、木棍是进度条；第 2 版写个数（不封顶）
    const fill = version < 2 && (slot === 'coal' || slot === 'stick') ? Math.min(1, craftFull ? 1 : count / CRAFT_NEED) : null
    const label = slot === 'pickaxe' ? `镐子，还能挖 ${me.chances} 次${cooling.seconds ? `，还要等 ${cooling.seconds} 秒` : ''}`
      : slot === 'shield' ? `盾牌 ${count}/${items ? SHIELD_CAP : 1} 面`
        : fill !== null ? `${SLOT_NAMES[slot]} ${count}/${CRAFT_NEED}` : `${SLOT_NAMES[slot]} ${count}`
    /** 一直摆着、现在没有（火把 0）：灰的，写 0 */
    const empty = slot !== 'pickaxe' && count === 0
    const number = slot === 'pickaxe' || shape || empty ? String(count) : slot === 'shield' ? `${count}/${items ? SHIELD_CAP : 1}`
      : fill !== null ? '' : count > 1 ? String(count) : ''
    return <motion.div key={slot} className={`tool-cell${slot === 'pickaxe' ? ' is-pinned' : ''}`} data-slot={slot}
      ref={(element: HTMLDivElement | null) => {
        if (element) slotRefs.current.set(slot, element)
        else slotRefs.current.delete(slot)
      }}
      layout={!reduced} layoutDependency={orderKey} initial={slot === 'pickaxe' || reduced ? false : { opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.3 }} transition={{ type: 'spring', stiffness: 520, damping: 30 }}>
      <button type="button"
        className={`tool-slot is-${slot}${selected ? ' is-selected' : ''}${empty ? ' is-empty' : ''}${fill === 1 ? ' is-full' : ''}${slot === 'pickaxe' && haste > 0 ? ' is-haste' : ''}${slot === 'pickaxe' && poisoned ? ' is-poisoned' : ''}${slot === 'pickaxe' && webbed ? ' is-webbed' : ''}`}
        aria-label={label} aria-pressed={isHeld(slot) || slot === 'pickaxe' ? selected : undefined} aria-haspopup={isHeld(slot) ? undefined : 'dialog'}
        title={SLOT_NAMES[slot]}
        onClick={() => {
          if (performance.now() - dragged.current < 200) return
          tap(slot)
        }}
        onContextMenu={event => {
          event.preventDefault()
          putDown()
        }}>
        <ItemIcon kind={SLOT_ICONS[slot]} size={30} />
        {shape ? <><span className="glint" aria-hidden="true" /><ShapeGlyph shape={shape} /></> : null}
        {slot === 'pickaxe' && cooling.seconds ? <span className="cooling-veil" style={{ transform: `scaleY(${cooling.left})` }} aria-hidden="true" /> : null}
        {slot === 'pickaxe' && cooling.seconds ? <span className="cooling-text" aria-hidden="true">{cooling.seconds}</span> : null}
        {slot === 'pickaxe' && haste > 0 ? <span className="haste-badge" aria-hidden="true"><ItemIcon kind="potion" size={12} /></span> : null}
        {slot === 'pickaxe' && poisoned ? <img className="poison-badge" src={new URL('assets/minecraft/1.21.4/textures/mob_effect/poison.png', document.baseURI).href} alt="" aria-hidden="true" draggable={false} /> : null}
        {fill !== null ? <span className="tool-bar" aria-hidden="true"><i style={{ width: `${fill * 100}%`, background: `hsl(${Math.round(fill * 120)} 85% 50%)` }} /></span> : null}
        {number ? <McNumber key={number} text={number} tone={empty ? 'gray' : 'white'} /> : null}
      </button>
    </motion.div>
  }

  // 手里只有镐子：后面那一截不画（空着是一个小框）；量的东西还在，第一件道具来了照样长出来
  const alone = active.length + shownPassive.length === 0
  return <div className={`toolbar${playing ? '' : ' is-done'}${alone ? ' is-alone' : ''}`} ref={box} role="toolbar" aria-label="工具条">
    {slotView('pickaxe')}
    <span className="toolbar-divider is-pin" aria-hidden="true" />
    <div className="toolbar-scroll-wrap">
      <div className={`toolbar-scroll${edges.start ? ' fade-start' : ''}${edges.end ? ' fade-end' : ''}`} ref={scroller} onScroll={measure}
        onPointerDown={event => {
          if (event.pointerType !== 'mouse') return
          const element = scroller.current!
          drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop, moved: false }
        }}
        onPointerMove={event => {
          const start = drag.current
          if (!start || event.buttons !== 1) return
          const dx = event.clientX - start.x
          const dy = event.clientY - start.y
          if (!start.moved && Math.hypot(dx, dy) < 5) return
          start.moved = true
          const element = scroller.current!
          element.scrollLeft = start.left - dx
          element.scrollTop = start.top - dy
        }}
        onPointerUp={() => {
          if (drag.current?.moved) dragged.current = performance.now()
          drag.current = null
        }}
        onPointerLeave={() => {
          drag.current = null
        }}>
        <div className="toolbar-slots">
          {/* 合成的水滴：两格之间的液桥画在格子后面（docs/V3_ITEMS.md §9） */}
          {version >= 2 ? <>
            <svg className="craft-defs" width="0" height="0" aria-hidden="true"><defs><filter id="craft-goo" x="-20%" y="-50%" width="140%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" /><feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" />
            </filter></defs></svg>
            <div className="craft-goo" ref={goo} aria-hidden="true" />
          </> : null}
          <AnimatePresence initial={false} mode="popLayout" onExitComplete={measure}>
            {active.map(slotView)}
            {shownPassive.length > 0 ? <motion.span key="divider" layout={!reduced} layoutDependency={orderKey} className="toolbar-divider" aria-hidden="true"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} /> : null}
            {shownPassive.map(slotView)}
          </AnimatePresence>
        </div>
      </div>
      {edges.start ? <button type="button" className="toolbar-arrow is-start" onClick={() => scrollBy(-1)} aria-label="往前看">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button> : null}
      {edges.end ? <button type="button" className="toolbar-arrow is-end" onClick={() => scrollBy(1)} aria-label="往后看">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6l-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button> : null}
    </div>
  </div>
})

/**
 * 第 2 版的合成（docs/V3_ITEMS.md §9，用户选的“水滴”）：煤炭、木棍各一个就合成，游戏站在同一下里把一样减一、
 * 火把加 rules.craftTorches 个（2026-11-13 起的局 4 个，以前 1 个，§18）。看到这样的变化时：挖到的那一样（incoming）先在手里那一样（from）旁边长出来，像水滴一样流进去、
 * 融成一滴，火把从里面长出来，再顺着流进旁边的火把格，火把数字跳一下（不到一秒）。两格之间的液桥是一层
 * 模糊再收边的“壳”（.craft-goo），垫在格子后面。显示的数按动画的进度走，动画完了就是游戏站的数。
 */
interface Drop {
  at: number
  from: 'coal' | 'stick'
  incoming: 'coal' | 'stick'
  /** 合成以前的火把数、from 的数 */
  torch0: number
  from0: number
  stage: 'grow' | 'torch' | 'flow' | 'done'
}

/** 动画进行中工具条怎么排：from（和长出来的 incoming）排在火把后面。 */
function dropOrder(active: Slot[], drop: Drop): Slot[] {
  const rest = active.filter(slot => slot !== 'coal' && slot !== 'stick')
  let at = rest.indexOf('torch') + 1
  if (at === 0) at = rest.filter(slot => ['pick-h', 'pick-v', 'pick-x', 'spyglass'].includes(slot)).length
  const showFrom = drop.stage !== 'done' || drop.from0 - 1 > 0
  const mine = [...(showFrom ? [drop.from] : []), ...(drop.stage === 'grow' ? [drop.incoming] : [])]
  return [...rest.slice(0, at), ...mine, ...rest.slice(at)]
}

/** 动画进行中这一格写几个。 */
function dropCount(slot: Slot, drop: Drop, real: number) {
  if (slot === 'torch') return drop.stage === 'done' ? real : drop.torch0
  if (slot === drop.from) return drop.stage === 'grow' ? drop.from0 : drop.from0 - 1
  if (slot === drop.incoming) return drop.stage === 'grow' ? 1 : real
  return real
}

function useCraftDrop(me: Me | null, version: number, reduced: boolean, drop: Drop | null, setDrop: Dispatch<SetStateAction<Drop | null>>,
  slots: MutableRefObject<Map<Slot, HTMLElement>>, goo: RefObject<HTMLDivElement | null>) {
  const before = useRef<{ coal: number; stick: number; torch: number } | null>(null)
  // 在画出来以前发现：from 那一格不会先收起来又长回来
  useLayoutEffect(() => {
    if (!me || version < 2) return
    const now = { coal: me.coal ?? 0, stick: me.stick ?? 0, torch: me.items?.torch ?? 0 }
    const last = before.current
    before.current = now
    if (!last || reduced || now.torch <= last.torch) return
    const from = now.coal === last.coal - 1 && last.stick === 0 && now.stick === 0 ? 'coal'
      : now.stick === last.stick - 1 && last.coal === 0 && now.coal === 0 ? 'stick' : null
    if (!from) return
    setDrop({ at: Date.now(), from, incoming: from === 'coal' ? 'stick' : 'coal', torch0: last.torch, from0: last[from], stage: 'grow' })
  }, [me, version, reduced, setDrop])

  const at = drop?.at
  useEffect(() => {
    if (!drop || at === undefined) return
    const timers: number[] = []
    const made: HTMLElement[] = []
    /** 留在格子原有图标上的动画（停住不放的），动画完了撤掉，图标回到原样 */
    const kept: Animation[] = []
    const later = (ms: number, run: () => void) => timers.push(window.setTimeout(run, ms))
    const stage = (next: Drop['stage']) => setDrop(value => (value && value.at === at ? { ...value, stage: next } : value))
    const end = () => setDrop(value => (value && value.at === at ? null : value))
    const cell = (slot: Slot) => slots.current.get(slot) ?? null
    const slotOf = (element: HTMLElement) => element.querySelector<HTMLElement>('.tool-slot') ?? element
    /** 垫在一格后面的“壳”（液桥是它们模糊再收边连起来的） */
    const shell = (element: HTMLElement, round = false) => {
      const piece = document.createElement('i')
      piece.className = `craft-shell${round ? ' is-drop' : ''}`
      piece.style.left = `${element.offsetLeft}px`
      piece.style.top = `${element.offsetTop}px`
      goo.current?.appendChild(piece)
      made.push(piece)
      return piece
    }
    const jelly = (elements: HTMLElement[]) => {
      for (const element of elements) element.animate([{ transform: 'scale(1.18, .82)' }, { transform: 'scale(.93, 1.07)', offset: 0.4 }, { transform: 'scale(1.03, .97)', offset: 0.72 }, { transform: 'scale(1)' }], { duration: 340, easing: 'ease-out' })
    }
    // 1 挖到的那一样长出来（React 放进工具条，带它自己的长出来）；2 流进 from
    later(170, () => {
      const from = cell(drop.from)
      const incoming = cell(drop.incoming)
      if (!from || !incoming) return end()
      const dx = from.offsetLeft - incoming.offsetLeft
      const dy = from.offsetTop - incoming.offsetTop
      const stretch = Math.abs(dx) >= Math.abs(dy) ? '1.12, .9' : '.9, 1.12'
      const flow: Keyframe[] = [
        { transform: 'translate(0, 0) scale(1, 1)' },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45}px) scale(${stretch})`, offset: 0.5 },
        { transform: `translate(${dx * 0.85}px, ${dy * 0.85}px) scale(.55, .7)`, offset: 0.85 },
        { transform: `translate(${dx}px, ${dy}px) scale(.2, .3)` },
      ]
      const under = shell(from)
      const moving = shell(incoming)
      const options: KeyframeAnimationOptions = { duration: 230, easing: 'cubic-bezier(.55, 0, .75, .2)', fill: 'forwards' }
      slotOf(incoming).animate(flow, options)
      slotOf(incoming).animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 230, fill: 'forwards' })
      moving.animate(flow, options)
      later(230, () => {
        moving.remove()
        stage('torch')
        play('pop')
        const slot = slotOf(from)
        jelly([slot, under])
        // 3 火把从里面长出来（原来那一样先缩下去）
        const flash = document.createElement('span')
        flash.className = 'craft-flash'
        slot.appendChild(flash)
        made.push(flash)
        const grow = document.createElement('img')
        grow.className = 'craft-grow'
        grow.src = new URL('assets/minecraft/1.21.4/textures/block/torch.png', document.baseURI).href
        grow.alt = ''
        slot.appendChild(grow)
        made.push(grow)
        const icon = slot.querySelector<HTMLElement>(':scope > .item-icon')
        const hide = icon?.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.4)' }], { duration: 110, fill: 'forwards' })
        if (hide) kept.push(hide)
        grow.animate([{ transform: 'translateY(8px) scale(0)' }, { transform: 'translateY(-4px) scale(1.25)', offset: 0.65 }, { transform: 'translateY(0) scale(1)' }], { duration: 190, easing: 'ease-out', fill: 'forwards' })
        later(190, () => {
          const lastOne = drop.from0 - 1 <= 0
          // 火把格一直在（没有时是灰的 0），一滴流进去；万一没找到那一格：长出来的那个火把淡掉
          const torch = cell('torch')
          if (!torch) {
            grow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' })
            const back = !lastOne ? icon?.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 200, delay: 80, fill: 'forwards' }) : null
            if (back) kept.push(back)
            stage('done')
            later(400, end)
            return
          }
          // 4 一滴流进火把那一格
          grow.remove()
          const back = !lastOne ? icon?.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 200, delay: 80, fill: 'forwards' }) : null
          if (back) kept.push(back)
          stage('flow')
          const target = shell(torch)
          const blob = shell(from, true)
          const droplet = document.createElement('span')
          droplet.className = 'craft-drop'
          droplet.style.left = `${from.offsetLeft}px`
          droplet.style.top = `${from.offsetTop}px`
          droplet.append(grow)
          goo.current?.parentElement?.appendChild(droplet)
          made.push(droplet)
          const tx = torch.offsetLeft - from.offsetLeft
          const ty = torch.offsetTop - from.offsetTop
          const move: Keyframe[] = [
            { transform: 'translate(0, 0) scale(.95)' },
            { transform: `translate(${tx * 0.5}px, ${ty * 0.5}px) scale(.8, .88)`, offset: 0.5 },
            { transform: `translate(${tx}px, ${ty}px) scale(.6)` },
          ]
          const moveOptions: KeyframeAnimationOptions = { duration: 240, easing: 'cubic-bezier(.45, 0, .55, 1)', fill: 'forwards' }
          droplet.animate(move, moveOptions)
          blob.animate(move, moveOptions)
          if (lastOne) for (const element of [slot, under]) element.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.2)', opacity: 0 }], { duration: 240, easing: 'cubic-bezier(.55, 0, .75, .2)', fill: 'forwards' })
          later(240, () => {
            droplet.remove()
            blob.remove()
            stage('done')
            jelly([slotOf(torch), target])
            later(380, end)
          })
        })
      })
    })
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
      for (const element of made) element.remove()
      for (const animation of kept) animation.cancel()
    }
    // 只跟着这一次合成走（stage 变了不重来）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at])
}

/** 横屏时工具条是竖的（样式里只让它上下滚）。按样式判断，不按内容：格子长出来时会高出一两个像素。 */
function isVertical(element: HTMLElement) {
  return getComputedStyle(element).overflowX === 'hidden'
}

/** 格子排出来比看得见的长多少（offsetWidth：不算 transform，不算收起时浮起来的那一格；见 items.ts edgesOf）。 */
function overflowOf(element: HTMLElement) {
  const slots = element.firstElementChild
  if (!(slots instanceof HTMLElement)) return 0
  return isVertical(element) ? slots.offsetHeight - element.clientHeight : slots.offsetWidth - element.clientWidth
}

/** 工具条两头还有没有。 */
function scrollEdges(element: HTMLElement | null) {
  const slots = element?.firstElementChild
  if (!element || !(slots instanceof HTMLElement)) return null
  return isVertical(element)
    ? edgesOf(element.scrollTop, slots.offsetHeight, element.clientHeight)
    : edgesOf(element.scrollLeft, slots.offsetWidth, element.clientWidth)
}

/** Minecraft 物品栏那种像素数字（带阴影），右下角。 */
const GLYPHS: Record<string, number[]> = {
  0: [5, 14, 17, 19, 21, 25, 17, 14], 1: [5, 4, 12, 4, 4, 4, 4, 31], 2: [5, 14, 17, 1, 6, 8, 17, 31], 3: [5, 14, 17, 1, 6, 1, 17, 14],
  4: [5, 3, 5, 9, 17, 31, 1, 1], 5: [5, 31, 16, 30, 1, 1, 17, 14], 6: [5, 6, 8, 16, 30, 17, 17, 14], 7: [5, 31, 17, 1, 2, 4, 4, 4],
  8: [5, 14, 17, 17, 14, 17, 17, 14], 9: [5, 14, 17, 17, 15, 1, 2, 12], '/': [5, 1, 2, 2, 4, 8, 8, 16],
}
export function McNumber({ text, tone }: { text: string; tone: 'white' | 'green' | 'gray' }) {
  const rects: string[] = []
  const shadows: string[] = []
  let x = 0
  for (const char of text) {
    const glyph = GLYPHS[char]
    if (!glyph) continue
    const [width, ...rows] = glyph
    rows.forEach((bits, y) => {
      for (let column = 0; column < width; column++) if (bits & (1 << (width - 1 - column))) {
        rects.push(`M${x + column} ${y}h1v1h-1z`)
        shadows.push(`M${x + column + 1} ${y + 1}h1v1h-1z`)
      }
    })
    x += width + 1
  }
  const width = Math.max(1, x)
  return <svg className={`tool-count is-${tone}`} viewBox={`0 0 ${width} 8`} width={width * 2} height={16} shapeRendering="crispEdges" aria-hidden="true">
    <path className="shadow" d={shadows.join('')} />
    <path d={rects.join('')} />
  </svg>
}

/**
 * 合成火把：游戏站在同一下里把煤炭、木棍清零、火把加一。看到这样的变化时，煤炭、木棍满着多留
 * 一会儿，两样飞到一起、闪一下，变成火把飞进火把那一格（减少动画时直接换）。
 */
function useCraft(me: Me | null, slots: MutableRefObject<Map<Slot, HTMLElement>>, box: RefObject<HTMLDivElement | null>, reduced: boolean) {
  const before = useRef<{ coal: number; stick: number; torch: number } | null>(null)
  const [crafting, setCrafting] = useState(0)
  // 在画出来以前发现：煤炭、木棍那两格不会先收起来又长回来
  useLayoutEffect(() => {
    if (!me) return
    const now = { coal: me.coal ?? 0, stick: me.stick ?? 0, torch: me.items?.torch ?? 0 }
    const last = before.current
    before.current = now
    if (!last || reduced) return
    if (now.torch > last.torch && now.coal === 0 && now.stick === 0 && (last.coal > 0 || last.stick > 0)) setCrafting(Date.now())
  }, [me, reduced])
  useEffect(() => {
    if (!crafting) return
    const stage = box.current?.closest('.map-stage') as HTMLElement | null
    const coal = slots.current.get('coal')
    const stick = slots.current.get('stick')
    if (!stage || !coal || !stick) {
      setCrafting(0)
      return
    }
    const timers: number[] = []
    const frame = stage.getBoundingClientRect()
    const rect = (element: HTMLElement) => {
      const r = element.getBoundingClientRect()
      return { x: r.left - frame.left + r.width / 2, y: r.top - frame.top + r.height / 2 }
    }
    const fly = (src: string, from: { x: number; y: number }, to: { x: number; y: number }, ms: number) => {
      const image = document.createElement('img')
      image.className = 'craft-fly'
      image.src = new URL(`assets/minecraft/1.21.4/${src}`, document.baseURI).href
      image.alt = ''
      image.style.left = `${from.x - 14}px`
      image.style.top = `${from.y - 14}px`
      stage.appendChild(image)
      const animation = image.animate([
        { transform: 'translate(0, 0) scale(1)' },
        { transform: `translate(${(to.x - from.x) / 2}px, ${(to.y - from.y) / 2 - 36}px) scale(1.25)` },
        { transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(0.7)` },
      ], { duration: ms, easing: 'cubic-bezier(.4,0,.2,1)' })
      animation.onfinish = () => image.remove()
      return animation
    }
    const a = rect(coal)
    const b = rect(stick)
    const meet = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 56 }
    timers.push(window.setTimeout(() => {
      fly('textures/item/coal.png', a, meet, 420)
      fly('textures/item/stick.png', b, meet, 420)
      play('pop')
    }, 300))
    timers.push(window.setTimeout(() => {
      const burst = document.createElement('span')
      burst.className = 'craft-burst'
      burst.style.left = `${meet.x}px`
      burst.style.top = `${meet.y}px`
      stage.appendChild(burst)
      timers.push(window.setTimeout(() => burst.remove(), 500))
      setCrafting(0)
      const torch = slots.current.get('torch')
      const to = torch ? rect(torch) : meet
      fly('textures/block/torch.png', meet, to, 520)
    }, 740))
    return () => timers.forEach(timer => window.clearTimeout(timer))
  }, [crafting, box, slots])
  return crafting !== 0
}
