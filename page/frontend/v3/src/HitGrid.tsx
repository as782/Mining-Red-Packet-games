import { useAtomValue } from 'jotai'
import { memo } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import { torchWords } from './aim'
import { BLOCK_PX, CARD_PX, cellPx, GAP, PAD, SLOT_PX } from './camera'
import { NoiseRail } from './CardLabels'
import type { Held } from './items'
import { railOf } from './layout'
import { noiseDecayMs, WARDEN_FROM } from './regions'
import { digIntervalAtom, toast } from './state'
import type { PublicCard } from './types'
import { KIND_NAMES } from './types'

const ROWS = 'ABCDEFG'

/**
 * 当前卡上一层看不见的格子（docs/V3_ITEMS.md §22）：卡画在画布上，点格子、拿着道具指格子、键盘和读屏靠这一层。
 * 每格一个透明的按钮（没挖开的）或块（别的），和以前网页里的卡同一个位置、同一种处理；画什么都不画，
 * 浏览器不用为它留图块。指着、按着哪格由地图按坐标算（画布上亮哪格），这里不管。
 */
export const HitGrid = memo(function HitGrid({ card, diggable, held, pending, peeks, opened, onDig, onAim }: {
  card: PublicCard
  /** 能挖：挖卡那一级、没挖完、轮得到 */
  diggable: boolean
  /** 手里拿着的道具：点格子是预览、用它，不是挖 */
  held: Held | null
  /** 正在挖的格子（这张卡的“卡号:格”） */
  pending: Record<string, true>
  /** 自己知道是什么的格子（望远镜、藏宝图） */
  peeks: ReadonlyMap<number, string>
  /** 自己开过的宝库 */
  opened: ReadonlySet<number>
  onDig: (cardId: number, index: number) => void
  /** 拿着道具时点到、指到一格（qx、qy：点在这一格的右半、下半；指着时 hover 为真） */
  onAim: (cardId: number, index: number, qx: 0 | 1, qy: 0 | 1, hover: boolean) => void
}) {
  const side = cellPx(card.size)
  const style = {
    left: card.x * SLOT_PX - CARD_PX / 2,
    top: card.y * SLOT_PX - CARD_PX / 2,
    width: CARD_PX,
    height: CARD_PX,
    padding: PAD,
    gridTemplateColumns: `repeat(${card.size}, ${side}px)`,
    gridTemplateRows: `repeat(${card.size}, ${side}px)`,
    gap: GAP,
  }
  const aiming = !!held && diggable
  /** 拿着道具：点、指这一格的哪一半 */
  const half = (event: ReactMouseEvent | ReactPointerEvent): [0 | 1, 0 | 1] => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return [event.clientX - rect.left > rect.width / 2 ? 1 : 0, event.clientY - rect.top > rect.height / 2 ? 1 : 0]
  }
  const aimHandlers = (index: number) => aiming ? {
    onClick: (event: ReactMouseEvent) => {
      event.stopPropagation()
      const [qx, qy] = half(event)
      onAim(card.id, index, qx, qy, false)
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (event.pointerType !== 'mouse') return
      const [qx, qy] = half(event)
      onAim(card.id, index, qx, qy, true)
    },
  } : {}
  const torchOn = new Map((card.torches ?? []).filter(torch => torch.v === 2).map(torch => [torch.at, torch]))
  return <div className="hit-card" style={style} data-card={card.id} aria-label={`第 ${card.id} 张卡的格子`}>
    {card.cells.map((cell, index) => {
      const name = `${ROWS[Math.floor(index / card.size)]}${(index % card.size) + 1}`
      const fixed = card.fixed?.[index]
      if (fixed) {
        const left = card.vaults?.[index] ?? 0
        const mineOpened = opened.has(index)
        const rail = railOf(card, index)
        return <div key={index} {...aimHandlers(index)}
          data-vault={fixed === 'vault' ? (left <= 0 ? '宝库：开完了' : mineOpened ? `宝库：你开过了，别人还能开 ${left} 次` : `宝库：还能开 ${left} 次，拿试炼钥匙来开`) : undefined}
          className={`hit-cell fixed${aiming ? ' is-aim' : ''}`} role="img"
          aria-label={fixed === 'vault' ? `${name}：宝库，还能开 ${left} 次${mineOpened ? '，你开过了' : ''}` : fixed === 'lava' ? `${name}：岩浆` : rail ? `${name}：铁轨，不能挖` : `${name}：装饰，不能挖`} />
      }
      if (cell) {
        if (cell.burn) return <div key={index} {...aimHandlers(index)} className={`hit-cell fixed${aiming ? ' is-aim' : ''}`} role="img" aria-label={`${name}：被岩浆吞掉了（${KIND_NAMES[cell.kind]}）`} />
        const lit = torchOn.get(index)
        return <div key={index} {...(aiming ? aimHandlers(index) : lit ? { onClick: () => toast(torchWords(lit)) } : {})}
          className={`hit-cell revealed${lit ? ' has-torch' : ''}${aiming ? ' is-aim' : ''}`} role="img"
          aria-label={`${name}：${KIND_NAMES[cell.kind]}，${cell.name} 挖的${lit ? `；插着${torchWords(lit)}` : ''}`} />
      }
      const busy = !!pending[`${card.id}:${index}`]
      const peek = peeks.get(index)
      return <button
        key={index}
        type="button"
        className={`hit-cell covered${aiming ? ' is-aim' : ''}`}
        disabled={!diggable || busy || !!card.closed}
        {...(aiming ? aimHandlers(index) : {
          onClick: (event: ReactMouseEvent) => {
            event.stopPropagation()
            onDig(card.id, index)
          },
        })}
        aria-label={`${name}${peek ? `，知道是${KIND_NAMES[peek as keyof typeof KIND_NAMES]}` : ''}，${aiming ? '点按预览，再点一次就用' : diggable ? '点按挖开' : '放大以后才能挖'}`}
      />
    })}
  </div>
})

/**
 * 深暗之域卡角上的噪音（不是挖卡这一级的当前卡）：旧局写数；新局噪音会退，画一小段条，自己往回走（不重画网页）。
 * 卡画在画布上，它照旧是网页里的一小块，放在区块的左上角。
 */
export function NoiseBadge({ card }: { card: PublicCard }) {
  const digInterval = useAtomValue(digIntervalAtom)
  const style = { left: card.x * SLOT_PX - BLOCK_PX / 2, top: card.y * SLOT_PX - BLOCK_PX / 2, width: BLOCK_PX, height: BLOCK_PX }
  let body
  if (card.closed) body = <div className="card-noise" aria-label="监守者醒了"><ItemIcon kind="sculk" size={22} /><b>监守者醒了</b></div>
  else if (card.noiseAt === undefined) body = <div className="card-noise" aria-label={`噪音 ${card.noise ?? 0}`}><ItemIcon kind="sculk" size={22} /><span>噪音 {card.noise ?? 0}</span></div>
  else {
    const cells = card.cells.length - Object.keys(card.fixed ?? {}).length
    body = <div className="card-noise" aria-label="噪音">
      <ItemIcon kind="sculk" size={22} /><span>噪音</span>
      <span className="noise-track is-v2 is-small" style={{ '--from': `${WARDEN_FROM * 100}%` } as CSSProperties} aria-hidden="true">
        <NoiseRail card={card} cells={cells} decay={noiseDecayMs({ digInterval })} />
      </span>
    </div>
  }
  return <div className="noise-anchor" style={style}>{body}</div>
}
