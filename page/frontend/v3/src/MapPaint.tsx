import type { MotionValue } from 'motion/react'
import { useEffect, useRef } from 'react'
import type { Direction, Level, Viewport } from './camera'
import { BLOCK_PX, CARD_PX, SLOT_PX } from './camera'
import type { AimInfo } from './aim'
import type { Held } from './items'
import type { Glow } from './MapCanvas'
import { FarMap, glowOf, glowSprite, PAINT_EVERY_MS } from './MapCanvas'
import type { Fresh, Live, Look } from './paint'
import { focusSprite, paintCard } from './paint'
import { whenImages } from './thumb'
import type { Kind, PublicCard } from './types'

// 地图画布（docs/V3_ITEMS.md §22）：整张地图画在一块和地图区一样大的画布上。以前每格一个网页元素、每个图标
// 一张图，远处的卡画在几块和整张地图一样大的画布上：放大缩小、几百张卡时浏览器要留很多块和窗口一样大的图块，
// 矿洞和红包站同一个站点、共用一份显存，显存紧的电脑上内容一帧一帧被丢掉（闪），红包站也跟着闪
// （2026-11-14 量过：矿洞的图块显存 22～195 MB）。现在只有这一块画布：镜头动、内容变、有动画时才画一帧，闲着不画。
//
// 画的顺序：全图那一级的区块底色 → 整张地图的低清位图（FarMap，全图那一级就是它）→ 近处的卡（放大以后）：
// 光、当前卡的光晕、卡（每张卡画好一张存着，变了才重画；当前卡和正在动的卡每帧现画）→ 指着的区块 → 四周的雾。

/** 画布的像素比最多 2（再高看不出来，显存多一倍） */
const MAX_RATIO = 2
/** 存着的卡多宽的边（世界像素）：投影、光晕超出卡外框的那一点 */
const MARGIN = 8
/** 存着的卡的清晰度一档一档（画布像素 / 世界像素），按 √2 一档 */
const STEPS = [0.177, 0.25, 0.354, 0.5, 0.707, 1, 1.414, 2]
/** 存着的卡最多占多少像素（约 24 MB）；超了先扔最久没画过的 */
const CACHE_PIXELS = 6_000_000
/** 一帧最多重画几张卡（其余的先用低清的，下一帧接着画），从全图放大时不卡一下 */
const RENDERS_PER_FRAME = 6
/** 镜头停下多久才算停稳（停稳了才按新的清晰度重画存着的卡） */
const SETTLE_MS = 160
/** 光、光晕的贴图最多这么清楚（本来就是糊的，画小一点放大贴，省显存） */
const GLOW_RES = 0.5
/** 存着的卡多久没画就扔（缩到全图以后近处那些） */
const IDLE_DROP_MS = 5000

export interface PaintInput {
  cards: PublicCard[]
  rich: Map<number, number>
  view: Viewport
  level: Level
  focusId: number | null
  uid: number | null
  version: number
  reduced: boolean
  /** 自己用望远镜、藏宝图看到的（卡号 → 格 → 是什么） */
  peeks: Map<number, Map<number, Kind>>
  /** 自己开过的宝库（卡号 → 格） */
  opened: Map<number, Set<number>>
  /** 正在挖的格子（“卡号:格”） */
  pending: Record<string, true>
  /** 刚开出来的格子（“卡号:格”） */
  fresh: Record<string, Fresh>
  /** 当前卡：能不能挖、冷却中、手里的道具、预览 */
  diggable: boolean
  cooling: boolean
  held: Held | null
  preview: (AimInfo & { at: number }) | null
  peeked: { cardId: number; index: number; at: number } | null
  entrance: { cardId: number; edge: Direction; land: number; start: number } | null
  /** 指着的卡（全图、附近，挖卡那一级的邻卡）、当前卡上指着、按着的格 */
  hoverCard: number | null
  hoverCell: number | null
  pressedCell: number | null
  hbNow: () => number
}

interface Cached { key: string; canvas: HTMLCanvasElement; res: number; complete: boolean; used: number }

const EMPTY_KINDS = new Map<number, Kind>()
const EMPTY_SET = new Set<number>()
const tokens = new WeakMap<object, number>()
let nextToken = 1
/** 卡对象换了（推送来了新的）就换一个号：存着的那张靠它认出要不要重画 */
const tokenOf = (value: object) => {
  let token = tokens.get(value)
  if (!token) tokens.set(value, (token = nextToken++))
  return token
}

/** 需要的清晰度取一档（容许放大两成多，附近那一级 1.2 用 1，省一半显存） */
function stepFor(needed: number) {
  return STEPS.find(step => step >= needed * 0.8) ?? STEPS[STEPS.length - 1]
}

/** 这一格还在动（刚开出来 2.4 秒内）的卡 */
function cellsOf<T>(all: Record<string, T>, cardId: number) {
  const out = new Map<number, T>()
  const prefix = `${cardId}:`
  for (const [cell, value] of Object.entries(all)) if (cell.startsWith(prefix)) out.set(Number(cell.slice(prefix.length)), value)
  return out
}

export function MapPaint({ input, x, y, scale, onClick, onPointerMove, onPointerLeave }: {
  input: PaintInput
  x: MotionValue<number>
  y: MotionValue<number>
  scale: MotionValue<number>
  onClick: (event: React.MouseEvent<HTMLCanvasElement>) => void
  onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void
  onPointerLeave: (event: React.PointerEvent<HTMLCanvasElement>) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const latest = useRef(input)
  latest.current = input
  const frame = useRef(0)
  const far = useRef<FarMap | null>(null)
  const cache = useRef(new Map<number, Cached>())
  const sprites = useRef(new Map<string, { sprite: HTMLCanvasElement; pad: number } | null>())
  const pulses = useRef(new Map<number, { glow: Glow; at: number }>())
  const farState = useRef({ cards: null as PublicCard[] | null, rich: null as Map<number, number> | null, skip: null as number | null, at: 0, timer: undefined as number | undefined })
  const camState = useRef({ x: NaN, y: NaN, scale: NaN, movedAt: 0, settleTimer: undefined as number | undefined })
  const levelState = useRef({ level: input.level, at: 0 })
  const dropTimer = useRef<number | undefined>(undefined)
  /** 输入变了（推送、指着、换级）：画一帧（下面的 effect 里接上） */
  const paintNow = useRef<() => void>(() => {})

  useEffect(() => {
    far.current ??= new FarMap()
    const request = () => {
      frame.current ||= requestAnimationFrame(draw)
    }

    function draw() {
      frame.current = 0
      const element = canvas.current
      const ctx = element?.getContext('2d')
      const map = far.current
      if (!element || !ctx || !map) return
      const p = latest.current
      const now = Date.now()
      const ratio = Math.min(MAX_RATIO, window.devicePixelRatio || 1)
      const width = Math.round(p.view.width * ratio)
      const height = Math.round(p.view.height * ratio)
      if (width === 0 || height === 0) return
      if (element.width !== width || element.height !== height) {
        element.width = width
        element.height = height
      }
      let busy = false

      // —— 整张地图的低清位图：范围变了马上整块重画；卡变了最多每 250 毫秒补画一次 ——
      const fs = farState.current
      const skip = p.entrance?.cardId ?? null
      const relaid = map.layout(p.cards, p.view, ratio)
      if (relaid || map.missing) {
        map.paintCards(p.cards, skip)
        map.paintGlows(p.cards, p.rich)
        Object.assign(fs, { cards: p.cards, rich: p.rich, skip, at: performance.now() })
      } else if (fs.cards !== p.cards || fs.rich !== p.rich || fs.skip !== skip) {
        const since = performance.now() - fs.at
        if (since >= PAINT_EVERY_MS) {
          map.paintCards(p.cards, skip)
          map.paintGlows(p.cards, p.rich)
          Object.assign(fs, { cards: p.cards, rich: p.rich, skip, at: performance.now() })
        } else fs.timer ??= window.setTimeout(() => {
          fs.timer = undefined
          request()
        }, PAINT_EVERY_MS - since)
      }

      // —— 镜头：停稳了没有 ——
      const cam = { x: x.get(), y: y.get(), scale: scale.get() }
      const cs = camState.current
      if (cam.x !== cs.x || cam.y !== cs.y || cam.scale !== cs.scale) {
        Object.assign(cs, { ...cam, movedAt: now })
        window.clearTimeout(cs.settleTimer)
        cs.settleTimer = window.setTimeout(request, SETTLE_MS + 10)
      }
      const settled = now - cs.movedAt >= SETTLE_MS
      const a = cam.scale * ratio
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.setTransform(a, 0, 0, a, cam.x * ratio, cam.y * ratio)
      ctx.imageSmoothingEnabled = true

      // —— 全图那一级的区块底色（换级时 0.18 秒淡入淡出）——
      const ls = levelState.current
      if (ls.level !== p.level) Object.assign(ls, { level: p.level, at: now })
      const fadeT = Math.min(1, (now - ls.at) / 180)
      if (fadeT < 1) busy = true
      const blocksAlpha = p.level === 0 ? fadeT : 1 - fadeT
      if (blocksAlpha > 0) {
        ctx.globalAlpha = blocksAlpha
        ctx.fillStyle = '#ffffff0a'
        ctx.strokeStyle = '#ffffff26'
        ctx.lineWidth = 1 / cam.scale
        ctx.beginPath()
        for (const card of p.cards) {
          const left = card.x * SLOT_PX - BLOCK_PX / 2
          const top = card.y * SLOT_PX - BLOCK_PX / 2
          if (ctx.roundRect) ctx.roundRect(left, top, BLOCK_PX, BLOCK_PX, 16)
          else ctx.rect(left, top, BLOCK_PX, BLOCK_PX)
        }
        ctx.fill()
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      // 放大到低清位图不够清楚了：近处的卡单独画
      const detail = p.level !== 0 && a > map.scale * 1.5
      if (!detail && map.glows) ctx.drawImage(map.glows, map.left, map.top, map.width, map.height)
      if (map.cards) ctx.drawImage(map.cards, map.left, map.top, map.width, map.height)

      if (detail) {
        const res = stepFor(a)
        const view = { x0: -cam.x / cam.scale, y0: -cam.y / cam.scale, x1: (p.view.width - cam.x) / cam.scale, y1: (p.view.height - cam.y) / cam.scale }
        const reach = 90 / cam.scale
        const visible = p.cards.filter(card => {
          const left = card.x * SLOT_PX - BLOCK_PX / 2
          const top = card.y * SLOT_PX - BLOCK_PX / 2
          return left - reach < view.x1 && left + BLOCK_PX + reach > view.x0 && top - reach < view.y1 && top + BLOCK_PX + reach > view.y0
        })
        // 光：先画（在卡下面）
        for (const card of visible) {
          const glow = glowOf(card, p.rich.get(card.id))
          if (!glow) {
            pulses.current.delete(card.id)
            continue
          }
          let pulse = pulses.current.get(card.id)
          if (!pulse || pulse.glow !== glow) pulses.current.set(card.id, (pulse = { glow, at: now }))
          // 藏着眼的、末地宝藏：出现时呼吸五下，之后一直亮着
          let alpha = 1
          if ((glow === 'eye' || glow === 'end') && !p.reduced) {
            const period = glow === 'eye' ? 2200 : 1800
            const phase = (now - pulse.at) / period
            if (phase < 5) {
              const t = phase % 1
              const up = Math.floor(phase) % 2 === 0
              alpha = 0.35 + 0.65 * (0.5 - Math.cos(Math.PI * (up ? t : 1 - t)) / 2)
              busy = true
            }
          }
          const sprite = glowFor(glow, Math.min(res, GLOW_RES), a, ratio, settled)
          if (!sprite) continue
          const left = card.x * SLOT_PX - BLOCK_PX / 2
          const top = card.y * SLOT_PX - BLOCK_PX / 2
          ctx.globalAlpha = alpha
          ctx.drawImage(sprite.sprite, left - sprite.pad / sprite.res, top - sprite.pad / sprite.res, sprite.sprite.width / sprite.res, sprite.sprite.height / sprite.res)
          ctx.globalAlpha = 1
          // 藏着眼的、末地宝藏：区块里淡淡的底色和一条细边一直亮着（只有外面那圈光呼吸）
          if (glow === 'eye' || glow === 'end') {
            const line = (glow === 'end' ? 2 : 1.5) / cam.scale
            ctx.beginPath()
            if (ctx.roundRect) ctx.roundRect(left + line / 2, top + line / 2, BLOCK_PX - line, BLOCK_PX - line, 16)
            else ctx.rect(left, top, BLOCK_PX, BLOCK_PX)
            ctx.fillStyle = glow === 'end' ? '#ffd36b17' : '#9a6bff12'
            ctx.fill()
            ctx.lineWidth = line
            ctx.strokeStyle = glow === 'end' ? '#f1c57fb3' : '#b48cff8c'
            ctx.stroke()
          }
        }
        // 当前卡的光晕
        const focused = visible.find(card => card.id === p.focusId)
        if (focused) {
          const glowRes = Math.min(res, GLOW_RES)
          const sprite = focusFor(glowRes)
          if (sprite) {
            const left = focused.x * SLOT_PX - CARD_PX / 2 - 3
            const top = focused.y * SLOT_PX - CARD_PX / 2 - 3
            ctx.drawImage(sprite.sprite, left - sprite.pad / glowRes, top - sprite.pad / glowRes, sprite.sprite.width / glowRes, sprite.sprite.height / glowRes)
          }
        }
        // 卡
        let renders = 0
        for (const card of visible) {
          const left = card.x * SLOT_PX - CARD_PX / 2
          const top = card.y * SLOT_PX - CARD_PX / 2
          const current = card.id === p.focusId
          const look: Look = {
            focused: current,
            names: p.level === 2 && current,
            myUid: p.uid,
            peeks: p.peeks.get(card.id) ?? EMPTY_KINDS,
            opened: p.opened.get(card.id) ?? EMPTY_SET,
            version: p.version,
          }
          const pending = new Set(cellsOf(p.pending, card.id).keys())
          const fresh = cellsOf(p.fresh, card.id)
          const entrance = p.entrance?.cardId === card.id ? p.entrance : null
          const woke = !!card.closed && !!card.wokeBy?.at && p.hbNow() - card.wokeBy.at < 4000
          const peeked = p.peeked?.cardId === card.id && now - p.peeked.at < 1600 ? p.peeked : null
          const moving = pending.size > 0 || [...fresh.values()].some(item => now - item.at < 2400) || !!entrance || woke || !!peeked
          const interactive = p.level === 2 && current
          if ((moving && !p.reduced) || interactive) {
            const live: Live = {
              now, hbNow: p.hbNow(), reduced: p.reduced, pending, fresh,
              hover: interactive ? p.hoverCell : null, pressed: interactive ? p.pressedCell : null,
              cooling: interactive && p.cooling, diggable: interactive && p.diggable,
              held: interactive ? p.held : null, preview: interactive ? p.preview : null,
              peeked: peeked ? { index: peeked.index, at: peeked.at } : null,
              entrance: entrance ? { start: entrance.start, land: entrance.land, edge: entrance.edge } : null,
            }
            ctx.save()
            ctx.translate(left, top)
            const out = paintCard(ctx, card, look, live)
            ctx.restore()
            if (out.busy) busy = true
            continue
          }
          // 存着的那张：卡、样子、清晰度都对就直接贴；镜头还在动时先用旧的
          const key = `${tokenOf(card)}|${look.focused ? 1 : 0}|${look.names ? 1 : 0}|${p.uid}|${[...look.peeks].join()}|${[...look.opened].join()}|${p.version}`
          let entry = cache.current.get(card.id)
          const stale = !entry || entry.key !== key || !entry.complete || (settled && entry.res !== res)
          if (stale && renders < RENDERS_PER_FRAME && (settled || !entry || entry.key !== key)) {
            renders += 1
            entry = render(card, look, key, res, entry)
          } else if (stale) busy = true
          if (!entry) continue
          entry.used = now
          ctx.drawImage(entry.canvas, left - MARGIN, top - MARGIN, CARD_PX + MARGIN * 2, CARD_PX + MARGIN * 2)
        }
        if (renders >= RENDERS_PER_FRAME) busy = true
      }
      trim(now)
      // 还存着卡：过一会儿再来看一眼，没用的扔掉（闲着时也放掉显存）
      if (cache.current.size > 0 && !busy) {
        window.clearTimeout(dropTimer.current)
        dropTimer.current = window.setTimeout(request, IDLE_DROP_MS + 100)
      }

      // —— 指着的区块：一层淡淡的亮和一圈细边（全图那一级亮一点）——
      const hover = p.hoverCard === null ? null : p.cards.find(card => card.id === p.hoverCard)
      if (hover && !(p.level === 2 && hover.id === p.focusId)) {
        const left = hover.x * SLOT_PX - BLOCK_PX / 2
        const top = hover.y * SLOT_PX - BLOCK_PX / 2
        const line = (p.level === 0 ? 1.5 : 1) / cam.scale
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(left + line / 2, top + line / 2, BLOCK_PX - line, BLOCK_PX - line, 16)
        else ctx.rect(left, top, BLOCK_PX, BLOCK_PX)
        ctx.fillStyle = p.level === 0 ? '#ffffff17' : '#ffffff0f'
        ctx.fill()
        ctx.lineWidth = line
        ctx.strokeStyle = p.level === 0 ? '#ffffff59' : '#ffffff40'
        ctx.stroke()
      }

      // —— 四周的雾（以前是盖在地图上的一层，inset 0 0 36px 18px #0d1318）——
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      fog(ctx, width, height, ratio)

      if (busy) request()
    }

    /** 画一张卡存起来（按 res 的清晰度） */
    function render(card: PublicCard, look: Look, key: string, res: number, before: Cached | undefined) {
      const side = Math.ceil((CARD_PX + MARGIN * 2) * res)
      const element = before?.canvas ?? document.createElement('canvas')
      if (element.width !== side || element.height !== side) {
        element.width = side
        element.height = side
      }
      const ctx = element.getContext('2d')
      if (!ctx) return before
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, side, side)
      ctx.setTransform(res, 0, 0, res, MARGIN * res, MARGIN * res)
      const { complete } = paintCard(ctx, card, look, null)
      const entry: Cached = { key, canvas: element, res, complete, used: Date.now() }
      cache.current.set(card.id, entry)
      return entry
    }

    /** 存着的卡：太久没画的扔掉；太多时扔掉最久没画过的 */
    function trim(now: number) {
      let total = 0
      for (const [id, entry] of cache.current) {
        if (now - entry.used > IDLE_DROP_MS) {
          entry.canvas.width = entry.canvas.height = 0
          cache.current.delete(id)
        } else total += entry.canvas.width * entry.canvas.height
      }
      if (sprites.current.size > 16) sprites.current.clear()
      if (total <= CACHE_PIXELS) return
      const old = [...cache.current].sort((a, b) => a[1].used - b[1].used)
      for (const [id, entry] of old) {
        if (total <= CACHE_PIXELS || now - entry.used < 100) break
        total -= entry.canvas.width * entry.canvas.height
        entry.canvas.width = entry.canvas.height = 0
        cache.current.delete(id)
      }
    }

    /**
     * 区块外面的光（藏着眼的紫光、末地宝藏的金光、越富越亮）：模糊很贵，按这一档清晰度画一张存着，每帧只贴。
     * 光的粗细按屏幕像素算（以前是 calc(40px * var(--px))）：存的时候按“屏幕 1 像素合几个存图像素”画，
     * 镜头还在动时先用这一档已有的那张（粗细差一点，看不出来）。
     */
    function glowFor(glow: Glow, res: number, a: number, ratio: number, settled: boolean) {
      const px = Math.round((ratio * res / a) * 4) / 4 || 0.25
      const prefix = `${glow}|${res}|`
      let key = `${prefix}${px}`
      if (!sprites.current.has(key) && !settled) key = [...sprites.current.keys()].find(item => item.startsWith(prefix)) ?? key
      if (!sprites.current.has(key)) {
        const pad = Math.ceil(84 * px)
        const sprite = glowSprite(glow, BLOCK_PX * res, pad, px, true)
        sprites.current.set(key, sprite ? { sprite, pad } : null)
      }
      const made = sprites.current.get(key)
      return made ? { ...made, res } : null
    }

    function focusFor(res: number) {
      const key = `focus|${res}`
      if (!sprites.current.has(key)) sprites.current.set(key, focusSprite(res))
      return sprites.current.get(key) ?? null
    }

    const offX = x.on('change', request)
    const offY = y.on('change', request)
    const offScale = scale.on('change', request)
    const stopImages = { current: null as (() => void) | null }
    const watchImages = () => {
      stopImages.current = whenImages(() => {
        // 贴图到了：缺图的卡、整张地图的位图重画
        for (const [id, entry] of cache.current) if (!entry.complete) cache.current.delete(id)
        if (far.current) far.current.missing = true
        request()
        watchImages()
      }) as unknown as () => void
    }
    watchImages()
    paintNow.current = request
    request()
    return () => {
      offX()
      offY()
      offScale()
      stopImages.current?.()
      cancelAnimationFrame(frame.current)
      frame.current = 0
      window.clearTimeout(camState.current.settleTimer)
      window.clearTimeout(farState.current.timer)
      window.clearTimeout(dropTimer.current)
    }
  }, [x, y, scale])

  useEffect(() => paintNow.current())

  return <canvas ref={canvas} className="map-paint" aria-hidden="true" onClick={onClick} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} />
}

/** 四周的雾：边上 0.84、18 像素处 0.5、36 处 0.16、54 处没了（和以前那层 inset 阴影差不多） */
function fog(ctx: CanvasRenderingContext2D, width: number, height: number, ratio: number) {
  const reach = 54 * ratio
  const stops: [number, number][] = [[0, 0.84], [1 / 3, 0.5], [2 / 3, 0.16], [1, 0]]
  const side = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1)
    for (const [at, alpha] of stops) gradient.addColorStop(at, `rgba(13, 19, 24, ${alpha})`)
    ctx.fillStyle = gradient
    ctx.fillRect(rx, ry, rw, rh)
  }
  side(0, 0, 0, reach, 0, 0, width, reach)
  side(0, height, 0, height - reach, 0, height - reach, width, reach)
  side(0, 0, reach, 0, 0, 0, reach, height)
  side(width, 0, width - reach, 0, width - reach, 0, reach, height)
}
