// 电脑上的鼠标指针（docs/V3_ITEMS.md §5）：左上一个像素箭头，箭头尖就是点到的位置，右下挂着
// 拿着的道具的小图标；冷却时镐子变灰，附魔镐带紫光。浏览器的指针图不能缩放，所以在这里按原版
// 16 像素贴图画一张 32 像素的，放进 CSS 变量（--cur-*）。画不出来就用默认指针。
// 别人的指针（Peers.tsx，docs/V3_ITEMS.md §20）用同样的道具小图标：描好黑边的放在 --tool-*，手机上也画。

const BASE = 'assets/minecraft/1.21.4/'
export const ARROW = [
  'X..........', 'XX.........', 'XWX........', 'XWWX.......', 'XWWWX......', 'XWWWWX.....', 'XWWWWWX....', 'XWWWWWWX...',
  'XWWWWWWWX..', 'XWWWWWXXXX.', 'XWWXWWX....', 'XWX.XWWX...', 'XX..XWWX...', 'X....XWWX..', '.....XWWX..', '......XX...',
]

type Mode = 'plain' | 'gray' | 'ench'
const CURSORS: Record<string, [string, Mode]> = {
  pick: ['textures/item/iron_pickaxe.png', 'plain'],
  cool: ['textures/item/iron_pickaxe.png', 'gray'],
  ench: ['textures/item/iron_pickaxe.png', 'ench'],
  spyglass: ['textures/item/spyglass.png', 'plain'],
  torch: ['textures/block/torch.png', 'plain'],
  key: ['textures/item/trial_key.png', 'plain'],
}

/** 道具的小图标（16 像素）：冷却时变灰，附魔镐带紫光。 */
function iconOf(image: HTMLImageElement, mode: Mode) {
  const icon = document.createElement('canvas')
  icon.width = 16
  icon.height = 16
  const ic = icon.getContext('2d')
  if (!ic) return null
  ic.imageSmoothingEnabled = false
  ic.drawImage(image, 0, 0, 16, 16)
  if (mode === 'gray') {
    const data = ic.getImageData(0, 0, 16, 16)
    for (let at = 0; at < data.data.length; at += 4) {
      const value = (data.data[at] * 0.3 + data.data[at + 1] * 0.59 + data.data[at + 2] * 0.11) * 0.75
      data.data[at] = data.data[at + 1] = data.data[at + 2] = value
    }
    ic.putImageData(data, 0, 0)
  }
  if (mode === 'ench') {
    ic.globalCompositeOperation = 'source-atop'
    ic.fillStyle = 'rgba(170, 90, 255, 0.45)'
    ic.fillRect(0, 0, 16, 16)
  }
  return icon
}

/** 描一圈黑边的图标（18 像素）：压在箭头尾巴上、别人的卡上也分得清。 */
function outlinedOf(icon: HTMLCanvasElement) {
  const outline = document.createElement('canvas')
  outline.width = 16
  outline.height = 16
  const oc = outline.getContext('2d')
  if (!oc) return null
  oc.drawImage(icon, 0, 0)
  oc.globalCompositeOperation = 'source-in'
  oc.fillStyle = '#000'
  oc.fillRect(0, 0, 16, 16)
  const out = document.createElement('canvas')
  out.width = 18
  out.height = 18
  const context = out.getContext('2d')
  if (!context) return null
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) context.drawImage(outline, 1 + dx, 1 + dy)
  context.drawImage(icon, 1, 1)
  return out
}

/** 电脑上的指针：左上箭头，右下挂着描了边的图标。 */
function draw(outlined: HTMLCanvasElement) {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const context = canvas.getContext('2d')
  if (!context) return null
  context.imageSmoothingEnabled = false
  context.drawImage(outlined, 12, 13)
  ARROW.forEach((row, y) => [...row].forEach((pixel, x) => {
    if (pixel === '.') return
    context.fillStyle = pixel === 'X' ? '#000' : '#fff'
    context.fillRect(x, y, 1, 1)
  }))
  return canvas.toDataURL()
}

let made = false
/** 画一次所有指针和道具小图标；指针只在有鼠标的设备上换。 */
export function makeCursors() {
  if (made) return
  made = true
  const mouse = !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
  for (const [name, [path, mode]] of Object.entries(CURSORS)) {
    const image = new Image()
    image.onload = () => {
      try {
        const icon = iconOf(image, mode)
        const outlined = icon && outlinedOf(icon)
        if (!outlined) return
        document.documentElement.style.setProperty(`--tool-${name}`, `url("${outlined.toDataURL()}")`)
        const url = mouse ? draw(outlined) : null
        if (url) document.documentElement.style.setProperty(`--cur-${name}`, `url("${url}") 0 0, default`)
      } catch {
        // 画不出来就用默认指针
      }
    }
    image.src = new URL(BASE + path, document.baseURI).href
  }
}
