import { useAtomValue, useSetAtom } from 'jotai'
import { motion } from 'motion/react'
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import { aimInfo, torchHoverAtom, torchWords } from './aim'
import { useCooling } from './Hud'
import { aimWhat, confirmWords, hasMouse, SLOT_ICONS, SLOT_NAMES } from './items'
import { aimAtom, aimedCardAtom, creeperShownAtom, dialogAtom, heldAtom, itemsVersionAtom, meAtom, putDown } from './state'

/**
 * 电脑上跟着指针的小提示（docs/V3_ITEMS.md §5）：指到火把上说颜色的意思，指到宝库上说还能开几次，
 * 镐子冷却时说还要等几秒。选位置这一步时不出（步骤条在说）。
 * 只有鼠标有；样式和工具条上的提示框一样。位置直接改样式，不让地图跟着重画。
 */
export function FollowTip({ box }: { box: RefObject<HTMLDivElement | null> }) {
  const held = useAtomValue(heldAtom)
  const torch = useAtomValue(torchHoverAtom)
  const cooling = useCooling()
  const tip = useRef<HTMLDivElement>(null)
  const [inside, setInside] = useState(false)
  const [vault, setVault] = useState<string | null>(null)

  useEffect(() => {
    const element = box.current
    if (!element) return
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      const rect = element.getBoundingClientRect()
      const node = tip.current
      if (node) {
        const x = Math.max(6, Math.min(event.clientX - rect.left + 16, rect.width - node.offsetWidth - 6))
        const y = Math.min(event.clientY - rect.top + 20, rect.height - node.offsetHeight - 6)
        node.style.transform = `translate(${x}px, ${y}px)`
      }
      const target = event.target instanceof Element ? event.target.closest('[data-vault]') : null
      setVault(target?.getAttribute('data-vault') ?? null)
      setInside(true)
    }
    const leave = () => setInside(false)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerleave', leave)
    return () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', leave)
    }
  }, [box])

  // 选位置这一步时不出：顶上的步骤条已经在说这一下会怎样（docs/ITEM_UX.md §3.3，免得说两遍）
  let text = ''
  if (held) text = ''
  else if (torch) text = torchWords(torch)
  else if (vault) text = vault
  else if (cooling.seconds) text = `还要等 ${cooling.seconds} 秒才能再挖`
  return <div ref={tip} className="follow-tip" hidden={!inside || !text} aria-hidden="true">{text}</div>
}

/**
 * 步骤条（docs/ITEM_UX.md §3.3）：瞄准类道具在选位置这一步时，地图顶上一直有一行：这件道具、现在该做什么
 * （没预览时说点什么，预览以后说这一下会怎样、怎么确认，不能用时说为什么）、问号（再看引导）、取消。
 * 手机和电脑一样。苦力怕来了时让开。
 */
export function StepBar() {
  const held = useAtomValue(heldAtom)
  const aim = useAtomValue(aimAtom)
  const card = useAtomValue(aimedCardAtom)
  const me = useAtomValue(meAtom)
  const creeper = useAtomValue(creeperShownAtom)
  const version = useAtomValue(itemsVersionAtom)
  const setDialog = useSetAtom(dialogAtom)
  if (!held || creeper) return null
  let line = aimWhat(held, version)
  let tone = ''
  if (aim && card) {
    const info = aimInfo(held, card, aim.index, me)
    line = info.ok ? `${info.words}，${confirmWords(hasMouse())}` : info.words
    tone = info.ok ? ' is-ready' : ' is-bad'
  }
  return <motion.div key={held} className={`item-tip top-hint step-bar${tone}`} role="status"
    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}>
    <ItemIcon kind={SLOT_ICONS[held]} size={22} />
    <p><b>{SLOT_NAMES[held]}</b>{line}</p>
    <button type="button" className="step-help" aria-label={`${SLOT_NAMES[held]}怎么用`} onClick={() => setDialog({ type: 'item', slot: held, mode: 'help' })}>?</button>
    <button type="button" onClick={putDown}>取消</button>
  </motion.div>
}
