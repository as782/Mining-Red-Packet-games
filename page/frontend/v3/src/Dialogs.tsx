import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { IconKind } from '../../src/game'
import { ItemIcon } from '../../src/ItemIcon'
import { flyIntoHelp, growFromHelp } from './guideFly'
import { aboutSlot, countOf, hasMouse, howToAim, isHeld, learnGuide, SHAPE_NAMES, SHAPES, shapeOf, SLOT_ICONS, SLOT_NAMES } from './items'
import type { Slot } from './items'
import { regionAbout, regionIcon, regionName } from './regions'
import { applyItem, blockedAtom, craftTorchesAtom, dialogAtom, digIntervalAtom, gameAtom, heldAtom, itemsGameAtom, itemsVersionAtom, meAtom } from './state'
import type { Shape } from './types'
import { money } from './types'

/**
 * 道具的弹窗（docs/V3_ITEMS.md §3、§5）：末影箱（存一半、毁一半，先看清楚再确认）、附魔台
 * （两种形状挑一种）、宝库开出了什么，和工具条上点一格（用户选的 B：说明和按钮在一起）。
 * 点遮罩、按 Esc、点取消都是关掉，不用道具。
 */
export function ItemDialogs() {
  const [dialog, setDialog] = useAtom(dialogAtom)
  const me = useAtomValue(meAtom)
  const items = useAtomValue(itemsGameAtom)
  const version = useAtomValue(itemsVersionAtom)
  const made = useAtomValue(craftTorchesAtom)
  const game = useAtomValue(gameAtom)
  const interval = useAtomValue(digIntervalAtom)
  const blocked = useAtomValue(blockedAtom)
  const setHeld = useSetAtom(heldAtom)
  const first = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  /** 问号打开的说明（关掉回到选位置）：从问号里长出来，关掉时收回去 */
  const fromHelp = dialog?.type === 'item' && dialog.mode === 'help'
  const close = () => setDialog(null)
  const dismiss = () => (fromHelp ? flyIntoHelp(panel.current, close, { first: false }) : close())
  const dismissRef = useRef(dismiss)
  dismissRef.current = dismiss
  useEffect(() => {
    if (!dialog) return
    first.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismissRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog])
  useLayoutEffect(() => {
    if (dialog?.type === 'item' && dialog.mode === 'help') growFromHelp(panel.current)
  }, [dialog])
  if (!dialog || !me) return null
  let body: ReactNode = null
  let title = ''
  let icon: IconKind = 'vault'
  let note: ReactNode = null
  if (dialog.type === 'item') {
    const slot = dialog.slot
    const about = aboutSlot(slot, me, items, interval, blocked, version, made)
    title = SLOT_NAMES[slot]
    icon = SLOT_ICONS[slot]
    note = about.count
    const held = isHeld(slot) ? slot : null
    body = <>
      {held && shapeOf(held) ? <div className="item-demo"><span className="shape-pick"><ShapeGlyph shape={shapeOf(held)!} big /><ItemIcon kind="pickaxe" size={32} /><span className="glint" /></span></div> : null}
      {held === 'torch' ? <TorchDemo version={version} /> : null}
      <p>{about.words}</p>
      {about.rule ? <p className="item-rule">{about.rule}</p> : null}
      {held && (dialog.mode === 'enter' || dialog.mode === 'help') ? <p className="item-how">{howToAim(held, version, hasMouse())}</p> : null}
      {/* 按钮（docs/ITEM_UX.md §3.2）：主按钮在最右。“知道了”是看完了、接着做刚才要做的事，什么都不花掉 */}
      <div className="dialog-actions">
        {held && dialog.mode === 'enter' ? <>
          <button type="button" onClick={close}>取消</button>
          <button type="button" ref={first} className="is-primary" onClick={() => {
            learnGuide(held)
            setHeld(held)
            flyIntoHelp(panel.current, close, { first: true })
          }}>知道了</button>
        </> : dialog.mode === 'help' ? <button type="button" ref={first} className="is-primary" onClick={dismiss}>知道了</button>
          : slot === 'map' || slot === 'potion' ? <>
          <button type="button" ref={first} onClick={close}>取消</button>
          <button type="button" className="is-primary" disabled={!!blocked} onClick={() => {
            close()
            void applyItem(slot)
          }}>使用</button>
        </> : <button type="button" ref={first} className="is-primary" onClick={close}>知道了</button>}
      </div>
    </>
  } else if (dialog.type === 'ender') {
    title = '末影箱'
    icon = 'ender'
    const half = Math.floor(me.points / 2)
    body = me.points <= 0 ? <>
      <p>还没有待领取的奖励，现在存不了，先留着。</p>
      <div className="dialog-actions"><button type="button" ref={first} onClick={close}>知道了</button></div>
    </> : <>
      <div className="chest-flow">
        <span className="chip">待领取 {money(me.points)}</span>
        <span aria-hidden="true">→</span>
        <span className="chip is-green"><ItemIcon kind="ender" size={14} />存进 {money(half)}</span>
        <span className="chip is-gone">退回奖池 {money(me.points - half)}</span>
      </div>
      {/* 存多少、退多少上面一行画出来了，这里只说拿不准的那件事 */}
      <p>存进去的不会被炸掉，也不会被金苹果翻倍，领取时一起算上。</p>
      <div className="dialog-actions">
        <button type="button" ref={first} onClick={close}>取消</button>
        <button type="button" className="is-primary" onClick={() => { close(); void applyItem('ender') }}>使用</button>
      </div>
    </>
  } else if (dialog.type === 'table') {
    title = '附魔台'
    icon = 'table'
    const choices = me.tableChoices ?? []
    body = <>
      {/* 只留两张卡片（形状、一次挖几格）；标题行写着“二选一” */}
      <div className="shape-choices">
        {choices.map((shape: Shape) => <button key={shape} type="button" onClick={() => { close(); void applyItem('table', { choice: shape }) }}>
          <span className="shape-pick"><ShapeGlyph shape={shape} big /><ItemIcon kind="pickaxe" size={32} /><span className="glint" /></span>
          <b>{SHAPE_NAMES[shape]}</b>
          <small>一次挖 {SHAPES[shape].length} 格</small>
        </button>)}
      </div>
      <div className="dialog-actions"><button type="button" ref={first} onClick={close}>取消</button></div>
    </>
  } else if (dialog.type === 'region') {
    const card = game?.cards.find(item => item.id === dialog.cardId)
    title = card ? regionName(card) : '这张卡'
    icon = card ? regionIcon(card) : 'pickaxe'
    body = <>
      {card && game ? regionAbout(card, game.rules).map(text => <p key={text}>{text}</p>) : null}
      <div className="dialog-actions"><button type="button" ref={first} className="is-primary" onClick={close}>知道了</button></div>
    </>
  } else if (dialog.type === 'last') {
    // 最后一下（docs/V3_ITEMS.md §13）：挖完这一局就结束了，手里还有用得上的没用。取消、遮罩、Esc 都是“俺去瞅瞅”
    title = '最后一下了'
    icon = 'pickaxe'
    const go = dialog.go
    body = <>
      <p>挖完这一下，这一局就结束了。手里还有：</p>
      <p className="last-items">{dialog.slots.map(slot => <span key={slot}><ItemIcon kind={SLOT_ICONS[slot]} size={18} />{SLOT_NAMES[slot]} {countOf(me, slot)}</span>)}</p>
      <div className="dialog-actions">
        <button type="button" ref={first} onClick={() => { close(); nudge(dialog.slots) }}>俺去瞅瞅</button>
        <button type="button" className="is-primary" onClick={() => { close(); go() }}>这就是最后一舞</button>
      </div>
    </>
  } else if (dialog.type === 'vault') {
    title = '宝库开了'
    body = <>
      <p className="vault-result">{dialog.kind ? <ItemIcon kind={dialog.kind} size={32} /> : null}<span>{dialog.text}</span></p>
      <div className="dialog-actions"><button type="button" ref={first} className="is-primary" onClick={close}>知道了</button></div>
    </>
  }
  return <div className="item-dialog-backdrop" onClick={dismiss}>
    <motion.section ref={panel} className="item-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}
      initial={fromHelp ? false : { opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      <h2><ItemIcon kind={icon} size={22} />{title}{dialog.type === 'ender' ? <small>只能用一次</small> : dialog.type === 'table' ? <small>二选一</small> : note ? <small>{note}</small> : null}</h2>
      {body}
    </motion.section>
  </div>
}

/** 俺去瞅瞅：工具条上没用的那几格扫一道光、弹一下，放不下时滚到第一格 */
function nudge(slots: Slot[]) {
  slots.forEach((slot, order) => {
    const button = document.querySelector<HTMLElement>(`.tool-cell[data-slot="${slot}"] .tool-slot`)
    if (!button) return
    if (order === 0) button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    button.classList.remove('is-nudge')
    void button.offsetWidth
    button.classList.add('is-nudge')
    button.addEventListener('animationend', () => button.classList.remove('is-nudge'), { once: true })
  })
}

/** 附魔镐的形状：3×3 的小格子，亮的是会挖的。 */
export function ShapeGlyph({ shape, big = false }: { shape: Shape; big?: boolean }) {
  const on = new Set(SHAPES[shape].map(([row, col]) => `${row},${col}`))
  return <span className={`shape-glyph${big ? ' is-big' : ''}`} aria-hidden="true">
    {[-1, 0, 1].flatMap(row => [-1, 0, 1].map(col => <i key={`${row},${col}`} className={on.has(`${row},${col}`) ? 'on' : ''} />))}
  </span>
}

/**
 * 火把：3×3 的小格子。第 1 版亮着四格、火把插在中间那个角上；第 2 版插在中间那一格上，九格都亮，
 * 下面四种颜色说危险有几个。
 */
function TorchDemo({ version }: { version: number }) {
  if (version >= 2) return <div className="item-demo is-torch2"><span className="torch-demo is-v2" aria-hidden="true">
    {Array.from({ length: 9 }, (_, index) => <i key={index} className="on" />)}
    <ItemIcon kind="torch" size={26} className="torch-demo-torch" />
  </span>
    <span className="torch-levels" aria-hidden="true">{TORCH_LEVEL_WORDS.map((words, level) => <span key={level} className={`torch-level is-${level}`}><i />{words}</span>)}</span>
  </div>
  return <div className="item-demo"><span className="torch-demo" aria-hidden="true">
    {Array.from({ length: 9 }, (_, index) => <i key={index} className={[1, 2, 4, 5].includes(index) ? 'on' : ''} />)}
    <ItemIcon kind="torch" size={26} className="torch-demo-torch" />
  </span></div>
}
const TORCH_LEVEL_WORDS = ['没有危险', '危险 1～2 个', '危险 3～4 个', '危险 5 个以上']
