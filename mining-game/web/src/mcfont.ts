// 原版的像素字和乱码（§k）：字形是 1.21.4 客户端里的 font/ascii.png（docs/MINECRAFT_ASSETS.md），
// 哪一格是哪个字照 font/include/default.json。乱码的规矩照原版：每一帧把每个字换成随机一个
// 同样宽的字（这一串不会忽长忽短），带原版的深色阴影（颜色的四分之一，往右下错 1 像素），不模糊。
// 这里是纯函数（网页和测试共用），画在 McText.tsx。

/** ascii.png 一行 16 格、每格 8×8；\u0000 是空格子。 */
export const MC_CHARS = [
  '\u0000'.repeat(16),
  '\u0000'.repeat(16),
  ' !"#$%&\'()*+,-./',
  '0123456789:;<=>?',
  '@ABCDEFGHIJKLMNO',
  'PQRSTUVWXYZ[\\]^_',
  '`abcdefghijklmno',
  'pqrstuvwxyz{|}~\u0000',
  '\u0000'.repeat(16),
  '\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000£\u0000\u0000ƒ',
  '\u0000\u0000\u0000\u0000\u0000\u0000ªº\u0000\u0000¬\u0000\u0000\u0000«»',
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐',
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧',
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀',
  '\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000∅∈\u0000',
  '≡±≥≤⌠⌡÷≈°∙\u0000√ⁿ²■\u0000',
]

/** 一个字在图上的哪一格（sx、sy 像素）、多宽（最右边有颜色的那一列 + 1；空格算 3）。 */
export interface Glyph { sx: number; sy: number; w: number }
export interface McFont { glyphs: Map<string, Glyph>; byWidth: Map<number, Glyph[]> }

/** 从字图量出每个字的宽度。alpha(x, y)：图上那一点的不透明度（0 是透明）。 */
export function measureFont(alpha: (x: number, y: number) => number): McFont {
  const glyphs = new Map<string, Glyph>()
  MC_CHARS.forEach((row, r) => Array.from(row).forEach((ch, col) => {
    if (ch === '\u0000') return
    let w = 0
    for (let px = 7; px >= 0 && !w; px--) {
      for (let py = 0; py < 8; py++) {
        if (alpha(col * 8 + px, r * 8 + py) > 0) {
          w = px + 1
          break
        }
      }
    }
    glyphs.set(ch, { sx: col * 8, sy: r * 8, w: ch === ' ' ? 3 : w })
  }))
  const byWidth = new Map<number, Glyph[]>()
  for (const [ch, glyph] of glyphs) {
    if (ch === ' ' || glyph.w === 0) continue
    const same = byWidth.get(glyph.w) ?? []
    same.push(glyph)
    byWidth.set(glyph.w, same)
  }
  return { glyphs, byWidth }
}

/** 字图里没有的字按这么宽（像素）。 */
const MISSING = 5

/** 一串字画出来多宽（字图的像素，不算阴影那 1 像素）：每个字宽度加 1 的字距。 */
export const textWidth = (font: McFont, text: string) =>
  Array.from(text).reduce((sum, ch) => sum + (font.glyphs.get(ch)?.w ?? MISSING) + 1, 0)

/** 乱码这一帧画哪个字形：同样宽的随便一个（空格、图里没有的照旧）。 */
export function obfuscated(font: McFont, ch: string, random: () => number): Glyph | null {
  const glyph = font.glyphs.get(ch)
  if (!glyph || ch === ' ') return glyph ?? null
  const same = font.byWidth.get(glyph.w)
  return same?.length ? same[Math.floor(random() * same.length)] ?? glyph : glyph
}

/** 原版的阴影色：每个通道除以 4 取整。'#ffaa00' → '#3f2a00'。 */
export const shadowOf = (hex: string) =>
  `#${[1, 3, 5].map(at => Math.floor(Number.parseInt(hex.slice(at, at + 2), 16) / 4).toString(16).padStart(2, '0')).join('')}`
