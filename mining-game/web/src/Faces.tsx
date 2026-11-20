import type { CSSProperties } from 'react'

// 原版生物的脸（docs/V3_ITEMS.md §23）：苦力怕、监守者没有道具图标，用它们的实体贴图里正面那一块
// （苦力怕 creeper.png 64×32 的 8,8 起 8×8；监守者 warden.png 128×128 的 10,42 起 16×16，
// 和屏幕边上探头的苦力怕、“监守者醒了”里的脸是同一块）。贴图路径在 App.tsx 设的 CSS 变量里。

export type Face = 'creeper' | 'warden'

/** 一张脸，size 见方；样式和道具图标一样（.item-icon），收益图上的小图标、评语的图标都用它。 */
export function FaceIcon({ who, size }: { who: Face; size: number }) {
  const style: CSSProperties = who === 'creeper'
    ? { width: size, height: size, backgroundImage: 'var(--creeper)', backgroundSize: `${size * 8}px ${size * 4}px`, backgroundPosition: `${-size}px ${-size}px` }
    : { width: size, height: size, backgroundImage: 'var(--warden)', backgroundSize: `${size * 8}px ${size * 8}px`, backgroundPosition: `${(-size * 10) / 16}px ${(-size * 42) / 16}px` }
  return <span className="item-icon face-icon" style={style} aria-hidden="true" />
}
