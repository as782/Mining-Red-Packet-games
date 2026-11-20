import { motion } from 'motion/react'
import { ItemIcon } from '../../src/ItemIcon'
import { CARD_PX } from './camera'

// 新卡入场“珍珠传送”（docs/V3_MAP.md §6）：珍珠从挖开的那格弹起，拖着紫色的尾巴
// 划一道弧线飞到新卡朝着旧卡的那条边，落地荡开一圈波纹、溅出几颗像素粒子，新卡随后翻出来。
// 都在地图的世界坐标里，跟着地图一起动和缩放。等着的时候（delay 里）停在第一帧，
// 所以波纹和粒子的第一帧都是透明的，免得落地前就露出一个点。

/** 珍珠先在格子里亮一下再弹起。 */
export const LIFT_S = 0.25
export const FLIGHT_S = 0.55
/** 末影之眼：浮起来转一圈（HOVER_S）再飞，飞得更远更久，尾巴是金色的。 */
export const HOVER_S = 0.5
export const EYE_FLIGHT_S = 0.8

export type Flight = 'pearl' | 'eye'

/** 落地的时刻（毫秒）：新卡从这时开始出现。 */
export const landMs = (variant: Flight) => (variant === 'eye' ? LIFT_S + HOVER_S + EYE_FLIGHT_S : LIFT_S + FLIGHT_S) * 1000
export const LAND_MS = landMs('pearl')

const PEARL = 40
const TRAIL = 5
const SPARKS = 10
const RIPPLE = CARD_PX * 0.8
const EASE = [0.45, 0, 0.55, 1] as const

export interface Point { x: number; y: number }

/** 弧线的顶点：连线中点往上（竖着飞时往右）拱起距离的三成。 */
function apex(from: Point, to: Point): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  let nx = dy / length
  let ny = -dx / length
  if (ny > 0 || (ny === 0 && nx < 0)) {
    nx = -nx
    ny = -ny
  }
  const lift = length * 0.3
  return { x: (from.x + to.x) / 2 + nx * lift, y: (from.y + to.y) / 2 + ny * lift }
}

export function PearlFlight({ from, to, variant = 'pearl' }: { from: Point; to: Point; variant?: Flight }) {
  const top = apex(from, to)
  const eye = variant === 'eye'
  // 眼：先在原地往上浮 40、转一圈，再沿弧线飞；珍珠直接飞
  const total = eye ? HOVER_S + EYE_FLIGHT_S : FLIGHT_S
  const hover = eye ? HOVER_S / total : 0
  const path = eye
    ? { x: [from.x, from.x, top.x, to.x], y: [from.y, from.y - 40, top.y, to.y] }
    : { x: [from.x, top.x, to.x], y: [from.y, top.y, to.y] }
  const times = eye ? [0, hover, hover + (1 - hover) / 2, 1] : [0, 0.5, 1]
  const land = landMs(variant) / 1000
  return <div className={`pearl-flight${eye ? ' is-eye' : ''}`} aria-hidden="true">
    {Array.from({ length: TRAIL }, (_, index) => {
      const size = 12 - index * 1.6
      return <motion.span key={`t${index}`} className="pearl-trail" style={{ width: size, height: size, left: -size / 2, top: -size / 2 }}
        initial={{ x: from.x, y: from.y, opacity: 0 }}
        animate={{ ...path, opacity: eye ? [0, 0, 0.85 - index * 0.12, 0] : [0, 0.85 - index * 0.12, 0] }}
        transition={{ duration: total, delay: LIFT_S + (index + 1) * 0.04, ease: EASE, times }} />
    })}
    <motion.div className="pearl-flyer" style={{ width: PEARL, height: PEARL, left: -PEARL / 2, top: -PEARL / 2 }}
      initial={{ x: from.x, y: from.y, scale: 0.8, rotate: 0, opacity: 0 }}
      animate={eye
        ? { ...path, scale: [0.8, 1.2, 1.6, 0.8], rotate: [0, 360, 360, 360], opacity: [1, 1, 1, 0] }
        : { ...path, scale: [0.8, 1.4, 0.7], opacity: [1, 1, 0] }}
      transition={{ duration: total, delay: LIFT_S, ease: EASE, times }}>
      <ItemIcon kind={eye ? 'eye' : 'pearl'} size={PEARL} />
    </motion.div>
    <motion.span className="pearl-ripple" style={{ width: RIPPLE, height: RIPPLE, left: to.x - RIPPLE / 2, top: to.y - RIPPLE / 2 }}
      initial={{ scale: 0.15, opacity: 0 }}
      animate={{ scale: [0.15, 0.3, 1.15], opacity: [0, 0.9, 0] }}
      transition={{ duration: 0.55, delay: land, ease: 'easeOut', times: [0, 0.1, 1] }} />
    {Array.from({ length: SPARKS }, (_, index) => {
      const angle = (index / SPARKS) * Math.PI * 2 + 0.3
      const reach = 110 + (index % 3) * 35
      return <motion.span key={`s${index}`} className="pearl-spark" style={{ left: to.x - 4, top: to.y - 4 }}
        initial={{ x: 0, y: 0, opacity: 0 }}
        animate={{ x: [0, Math.cos(angle) * reach * 0.15, Math.cos(angle) * reach], y: [0, Math.sin(angle) * reach * 0.15, Math.sin(angle) * reach], opacity: [0, 1, 0] }}
        transition={{ duration: 0.6, delay: land, ease: 'easeOut', times: [0, 0.1, 1] }} />
    })}
  </div>
}
