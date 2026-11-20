// 表情（docs/V3_ITEMS.md §20）：8 个预设的，不能打字。前 5 个是自己画的 12×12 像素图，后 3 个是原版像素字。
// 号码就是数组里的位置，游戏站只认 0–7（game/worker/presence.mjs EMOTE_COUNT），顺序不能改，只能往后加。

export interface Emote {
  /** 读屏和提示里的名字 */
  label: string
  /** 像素图：每行 12 个字，'.' 是透明，别的字按 PALETTE 上色 */
  grid?: string[]
  /** 像素字（原版字体只有英文和数字） */
  text?: string
  color?: string
}

export const PALETTE: Record<string, string> = {
  O: '#3b2410', Y: '#ffd23f', K: '#1b1b1b', B: '#4fc3f7', R: '#c62828', P: '#ff7aa8', W: '#ffffff',
  r: '#f2433a', s: '#1b1b1b', L: '#b9e769', D: '#2e7d32',
}

const TOP = ['...OOOOOO...', '..OYYYYYYO..', '.OYYYYYYYYO.']
const BOTTOM = ['..OYYYYYYO..', '...OOOOOO...']

export const EMOTES: Emote[] = [
  {
    label: '笑哭',
    grid: [...TOP, 'OYYKYYYYKYYO', 'OYKYKYYKYKYO', 'OBYYYYYYYYBO', 'OBKKKKKKKKBO', 'OBKRRRRRRKBO', 'OYYKRRRRKYYO', '.OYYKKKKYYO.', ...BOTTOM],
  },
  {
    label: '墨镜',
    grid: [...TOP, 'OYYYYYYYYYYO', 'OKKKKKKKKKKO', 'OYKWKYYKWKYO', 'OYYKYYYYKYYO', 'OYYYYYYYYYYO', 'OYYYYYYYKYYO', '.OYKKKKKYYO.', ...BOTTOM],
  },
  {
    label: '略略略',
    grid: [...TOP, 'OYYYYYYYYYYO', 'OYKKKYYYKYYO', 'OYYYYYYYKYYO', 'OYYYYYYYYYYO', 'OYYKKKKKKYYO', 'OYYYYPPPYYYO', '.OYYYPPPYYO.', '..OYYYPYYO..', '...OOOOOO...'],
  },
  {
    label: '大哭',
    grid: [...TOP, 'OYYYYYYYYYYO', 'OYKKKYYKKKYO', 'OYBYYYYYYBYO', 'OYBYYYYYYBYO', 'OYBYKKKKYBYO', 'OYBKYYYYKBYO', '.OBYYYYYYBO.', ...BOTTOM],
  },
  {
    label: '吃瓜',
    grid: ['............', '............', '............', 'OOOOOOOOOOOO', 'OrrrrrrrrrrO', 'OrsrrrsrrsrO', '.OrrrrrrrrO.', '.OrrsrrsrrO.', '..OrrrrrrO..', '..OLLLLLLO..', '...ODDDDO...', '....OOOO....'],
  },
  { label: '666', text: '666', color: '#ffaa00' },
  { label: 'GG', text: 'GG', color: '#55ff55' },
  { label: '问号', text: '???', color: '#ff5555' },
]

/** 像素图画成 SVG 的路径：每种颜色一条，一行里连着的同色格子并成一段。 */
export function pathsOf(grid: string[]): { color: string; d: string }[] {
  const byColor = new Map<string, string[]>()
  grid.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const pixel = row[x]
      let end = x + 1
      while (end < row.length && row[end] === pixel) end += 1
      if (pixel !== '.' && PALETTE[pixel]) {
        const parts = byColor.get(pixel) ?? []
        parts.push(`M${x} ${y}h${end - x}v1h-${end - x}z`)
        byColor.set(pixel, parts)
      }
      x = end
    }
  })
  return [...byColor].map(([pixel, parts]) => ({ color: PALETTE[pixel], d: parts.join('') }))
}

/** 每个人一个颜色（指针、名字、在看的小圆点）：按 uid 转色相，同一个人一直一样。 */
export function colorOf(uid: number) {
  return `hsl(${Math.round((uid * 137.508) % 360)} 78% 62%)`
}

/** 名字的第一个字（小圆点上写的）。 */
export function initialOf(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}
