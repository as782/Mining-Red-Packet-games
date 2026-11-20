import { useEffect, useRef, useState } from 'react'
import type { McFont } from './mcfont'
import { measureFont, obfuscated, shadowOf, textWidth } from './mcfont'

// 原版像素字（mcfont.ts）画在一块小画布上。乱码的（obfuscate）每一帧换一次字形（用户 2026-11-11 选的
// “一直每帧跳”）：所有乱码共用一个 requestAnimationFrame，没有乱码在屏幕上就停；系统设了“减少动画”
// 就只画一次、不跳。网页在后台时浏览器自己停 requestAnimationFrame。

interface LoadedFont extends McFont { sheet: HTMLCanvasElement; tints: Map<string, HTMLCanvasElement> }

const SHEET = 'assets/minecraft/1.21.4/textures/font/ascii.png'
let loading: Promise<LoadedFont | null> | null = null
let loaded: LoadedFont | null = null

function loadFont() {
  loading ??= new Promise<LoadedFont | null>(resolve => {
    const image = new Image()
    image.onload = () => {
      const sheet = document.createElement('canvas')
      sheet.width = image.width
      sheet.height = image.height
      const context = sheet.getContext('2d', { willReadFrequently: true })
      if (!context) return resolve(null)
      context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, sheet.width, sheet.height).data
      loaded = { ...measureFont((x, y) => data[(y * sheet.width + x) * 4 + 3] ?? 0), sheet, tints: new Map() }
      resolve(loaded)
    }
    image.onerror = () => resolve(null)
    image.src = new URL(SHEET, document.baseURI).href
  })
  return loading
}

/** 白字的图染成一种颜色（原版就是白字乘颜色），每种颜色染一次。 */
function tinted(font: LoadedFont, color: string) {
  const cached = font.tints.get(color)
  if (cached) return cached
  const sheet = document.createElement('canvas')
  sheet.width = font.sheet.width
  sheet.height = font.sheet.height
  const context = sheet.getContext('2d')!
  context.drawImage(font.sheet, 0, 0)
  context.globalCompositeOperation = 'source-in'
  context.fillStyle = color
  context.fillRect(0, 0, sheet.width, sheet.height)
  font.tints.set(color, sheet)
  return sheet
}

// 所有乱码共用一个循环
const drawers = new Set<() => void>()
let frame = 0
function tick() {
  frame = drawers.size ? requestAnimationFrame(tick) : 0
  for (const draw of drawers) draw()
}
function join(draw: () => void) {
  drawers.add(draw)
  frame ||= requestAnimationFrame(tick)
  return () => {
    drawers.delete(draw)
    if (!drawers.size && frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }
  }
}

const stillMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 原版像素字。scale：一个字图像素在屏幕上多大（CSS 像素），字高 8 像素，画布高 9（下面多一行阴影）。
 * 字图还没到时按每个字 6 像素占着位置，到了不跳太多。
 */
export function McText({ text, color = '#ffffff', obfuscate = false, scale = 2, className }: {
  text: string
  /** '#rrggbb' */
  color?: string
  obfuscate?: boolean
  scale?: number
  className?: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [font, setFont] = useState<LoadedFont | null>(loaded)
  useEffect(() => {
    if (font) return
    let live = true
    void loadFont().then(next => live && setFont(next))
    return () => {
      live = false
    }
  }, [font])
  const width = font ? textWidth(font, text) + 1 : Array.from(text).length * 6 + 1
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context || !font) return
    const unit = scale * (window.devicePixelRatio || 1)
    element.width = Math.round(width * unit)
    element.height = Math.round(9 * unit)
    context.imageSmoothingEnabled = false
    const main = tinted(font, color)
    const shadow = tinted(font, shadowOf(color))
    const chars = Array.from(text)
    const draw = () => {
      context.clearRect(0, 0, element.width, element.height)
      let x = 0
      for (const ch of chars) {
        const glyph = font.glyphs.get(ch)
        const shown = obfuscate ? obfuscated(font, ch, Math.random) : glyph
        if (shown) {
          context.drawImage(shadow, shown.sx, shown.sy, 8, 8, (x + 1) * unit, unit, 8 * unit, 8 * unit)
          context.drawImage(main, shown.sx, shown.sy, 8, 8, x * unit, 0, 8 * unit, 8 * unit)
        }
        x += (glyph?.w ?? 5) + 1
      }
    }
    draw()
    if (!obfuscate || stillMotion()) return
    return join(draw)
  }, [font, text, color, obfuscate, scale, width])
  return <canvas ref={canvas} className={`mc-text${className ? ` ${className}` : ''}`} aria-hidden="true"
    style={{ width: width * scale, height: 9 * scale }} />
}
