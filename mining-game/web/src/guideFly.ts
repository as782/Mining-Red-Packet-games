/**
 * 引导弹窗和步骤条问号的联动（docs/ITEM_UX.md §4、docs/V3_ITEMS.md §13）：
 * - 第一次的引导点“知道了”：弹窗收进问号——字和按钮先淡掉，外框先原地收到一半（先快后慢），再先慢后快飞到问号上
 *   （和煤炭、木棍流进火把格同一条曲线），中途沿飞的方向稍拉长，颜色变成问号按钮的颜色；落到时问号果冻弹一下
 *   （工具条落定那组）、金边亮一会儿、一声 pop。
 * - 问号打开的说明从问号里长出来；关掉时原路收回去，问号轻弹一下。
 * 飞的是一个不接收点击的影子，真的弹窗当场就关了，地图马上能点。没有问号（苦力怕挡着顶上）就不飞；
 * 减少动态时不飞也不弹，只让问号亮一会儿。
 */
import { play } from './sound'

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const helpButton = () => document.querySelector<HTMLElement>('.step-bar .step-help')

/** 问号现在在哪（去掉步骤条自己进场那一下的位移，取落定的位置） */
function helpRect(button: HTMLElement) {
  const rect = button.getBoundingClientRect()
  const bar = button.closest<HTMLElement>('.step-bar')
  let dy = 0
  if (bar) {
    const transform = getComputedStyle(bar).transform
    if (transform && transform !== 'none') dy = new DOMMatrixReadOnly(transform).m42
  }
  return { x: rect.left, y: rect.top - dy, w: rect.width, h: rect.height }
}

/** 问号弹一下（soft 是轻的）；金边亮一会儿 */
function land(button: HTMLElement, soft: boolean) {
  const k = soft ? 0.5 : 1
  button.animate([
    { transform: `scale(${1 + 0.18 * k}, ${1 - 0.18 * k})` },
    { transform: `scale(${1 - 0.07 * k}, ${1 + 0.07 * k})`, offset: 0.4 },
    { transform: `scale(${1 + 0.03 * k}, ${1 - 0.03 * k})`, offset: 0.72 },
    { transform: 'scale(1)' },
  ], { duration: 340, easing: 'ease-out' })
  if (!soft) {
    glow(button)
    play('pop')
  }
}
function glow(button: HTMLElement) {
  button.classList.remove('is-fresh')
  void button.offsetWidth
  button.classList.add('is-fresh')
  button.addEventListener('animationend', () => button.classList.remove('is-fresh'), { once: true })
}

/** 等步骤条的问号出来（拿起道具以后 React 下一次提交才画步骤条），最多等几帧 */
function whenHelp(run: (button: HTMLElement | null) => void, frames = 4) {
  const button = helpButton()
  if (button || frames <= 0) return run(button)
  requestAnimationFrame(() => whenHelp(run, frames - 1))
}

/**
 * 把弹窗收进问号。section 是弹窗本身（还在页面上时调用），close 关掉真的弹窗；first 是第一次的“知道了”
 * （飞 380 ms、金边、声音），否则是问号打开的说明收回去（260 ms、轻弹）。
 */
export function flyIntoHelp(section: HTMLElement | null, close: () => void, { first }: { first: boolean }) {
  if (!section || reduced()) {
    close()
    if (reduced()) whenHelp(button => button && glow(button))
    return
  }
  const from = section.getBoundingClientRect()
  const host = section.closest<HTMLElement>('.v3-app') ?? document.body
  const ghost = section.cloneNode(true) as HTMLElement
  ghost.removeAttribute('role')
  ghost.removeAttribute('aria-modal')
  ghost.removeAttribute('aria-label')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.classList.add('guide-ghost')
  Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, transform: 'none', opacity: '1' })
  const shade = document.createElement('div')
  shade.className = 'guide-shade'
  host.append(shade, ghost)
  shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).onfinish = () => shade.remove()
  for (const child of Array.from(ghost.children)) child.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: 'forwards' })
  close()
  whenHelp(button => {
    if (!button) {
      ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 140, easing: 'ease-in', fill: 'forwards' }).onfinish = () => ghost.remove()
      return
    }
    const to = helpRect(button)
    const dx = to.x + to.w / 2 - (from.left + from.width / 2)
    const dy = to.y + to.h / 2 - (from.top + from.height / 2)
    const sx = to.w / from.width
    const sy = to.h / from.height
    const tall = Math.abs(dy) >= Math.abs(dx) ? [0.2, 0.3] : [0.3, 0.2]
    const end = getComputedStyle(button).backgroundColor
    const fly = ghost.animate([
      { transform: 'translate(0, 0) scale(1, 1)', borderRadius: '12px', opacity: 1, easing: 'cubic-bezier(.22, 1, .36, 1)' },
      { transform: 'translate(0, 0) scale(.5, .5)', borderRadius: '24px', opacity: 1, offset: 0.3, easing: 'cubic-bezier(.5, 0, 1, 1)' },
      { transform: `translate(${dx * 0.35}px, ${dy * 0.35}px) scale(${tall[0]}, ${tall[1]})`, borderRadius: '40%', opacity: 1, offset: 0.62, easing: 'linear' },
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: '50%', backgroundColor: end, opacity: 0.9, offset: 0.9 },
      { transform: `translate(${dx}px, ${dy}px) scale(${sx * 0.8}, ${sy * 0.8})`, borderRadius: '50%', backgroundColor: end, opacity: 0 },
    ], { duration: first ? 380 : 260, fill: 'forwards' })
    fly.onfinish = () => {
      ghost.remove()
      land(button, !first)
    }
  })
}

/** 问号打开的说明从问号里长出来（弹窗刚画出来时调用） */
export function growFromHelp(section: HTMLElement | null) {
  const button = helpButton()
  if (!section || !button || reduced()) return false
  const to = section.getBoundingClientRect()
  const from = helpRect(button)
  const dx = from.x + from.w / 2 - (to.left + to.width / 2)
  const dy = from.y + from.h / 2 - (to.top + to.height / 2)
  section.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${from.w / to.width}, ${from.h / to.height})`, borderRadius: '50%', opacity: 0.6 },
    { transform: 'none', borderRadius: '12px', opacity: 1 },
  ], { duration: 240, easing: 'cubic-bezier(.22, 1, .36, 1)' })
  for (const child of Array.from(section.children)) child.animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], { duration: 240 })
  return true
}
