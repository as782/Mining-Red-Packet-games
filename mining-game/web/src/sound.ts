import { atom } from 'jotai'

// 音效（docs/V3_MAP.md §6）：Minecraft 1.21.4 的原声（来源见 docs/MINECRAFT_ASSETS.md），
// 用 Web Audio 放。一进网页就在后台把全部声音文件下好（只是字节，二十几个、约 400 KB；静音时不下）；
// 浏览器要等他点过一下才让出声，所以第一次点按时才建 AudioContext，这时把下好的全部解码，解出来的留着。
// 以前用到哪个才下载、解码哪个，又是晚了 0.4 秒就不放，每种声音的第一次常常没响。右上角能静音，记在本机。

export type Sound =
  | 'dig' | 'emerald' | 'diamond' | 'apple' | 'totem' | 'tnt' | 'crystal' | 'shield' | 'block'
  | 'spyglass' | 'throw' | 'teleport' | 'eye' | 'portal' | 'claim' | 'click'
  // 有道具栏的局（docs/V3_ITEMS.md）
  | 'fuse' | 'chest' | 'enchant' | 'lava' | 'warden' | 'vault' | 'pop'

/** 每种动作用哪几个文件（随机挑一个）、多响、音高上下浮动多少（像游戏里一样不完全一样）。 */
const SOUNDS: Record<Sound, { files: string[]; volume: number; pitch?: number }> = {
  dig: { files: ['dig/stone1', 'dig/stone2', 'dig/stone3', 'dig/stone4'], volume: 0.45, pitch: 0.1 },
  emerald: { files: ['random/orb'], volume: 0.4, pitch: 0.15 },
  diamond: { files: ['random/levelup'], volume: 0.45 },
  apple: { files: ['random/eat1', 'random/eat2', 'random/eat3'], volume: 0.5, pitch: 0.1 },
  totem: { files: ['item/armor/equip_iron1', 'item/armor/equip_iron2'], volume: 0.55 },
  tnt: { files: ['random/explode1', 'random/explode2'], volume: 0.4, pitch: 0.1 },
  crystal: { files: ['random/explode2'], volume: 0.55 },
  shield: { files: ['item/armor/equip_generic1', 'item/armor/equip_generic2'], volume: 0.6 },
  block: { files: ['item/shield/block1', 'item/shield/block2'], volume: 0.6 },
  spyglass: { files: ['item/spyglass/use'], volume: 0.6 },
  throw: { files: ['random/bow'], volume: 0.4, pitch: 0.1 },
  teleport: { files: ['mob/endermen/portal', 'mob/endermen/portal2'], volume: 0.4 },
  eye: { files: ['entity/endereye/endereye_launch1'], volume: 0.5 },
  portal: { files: ['block/end_portal/endportal'], volume: 0.3 },
  claim: { files: ['ui/toast/challenge_complete'], volume: 0.35 },
  click: { files: ['random/click'], volume: 0.3 },
  fuse: { files: ['random/fuse'], volume: 0.6 },
  chest: { files: ['random/chestopen'], volume: 0.45 },
  enchant: { files: ['block/enchantment_table/enchant1'], volume: 0.5 },
  lava: { files: ['liquid/lavapop'], volume: 0.4, pitch: 0.15 },
  warden: { files: ['mob/warden/emerge'], volume: 0.45 },
  vault: { files: ['block/vault/open_shutter'], volume: 0.5 },
  pop: { files: ['random/pop'], volume: 0.4, pitch: 0.2 },
}

/** 全部声音文件（几种动作共用的只下一次）。 */
const FILES = [...new Set(Object.values(SOUNDS).flatMap(spec => spec.files))]
/** 解码慢了就不放了：晚一大截再响，对不上画面。 */
const LATE_MS = 400
const MUTED_KEY = 'kddb:v3:muted'

function readMuted() {
  try {
    return localStorage.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
}

export const mutedAtom = atom(readMuted())

let muted = readMuted()
let context: AudioContext | null = null
const bytes = new Map<string, Promise<ArrayBuffer | null>>()
const buffers = new Map<string, Promise<AudioBuffer | null>>()

export function setMuted(next: boolean) {
  muted = next
  try {
    localStorage.setItem(MUTED_KEY, next ? '1' : '0')
  } catch {
    // 记不住就只管这一次
  }
  if (!next) prefetch()
}

const urlOf = (file: string) => new URL(`assets/minecraft/1.21.4/sounds/${file}.mp3`, document.baseURI).href

/** 下载一个文件的字节（低优先级，不和地图、图标抢）；没下到下次再试。 */
function fetchBytes(file: string) {
  let data = bytes.get(file)
  if (!data) {
    data = fetch(urlOf(file), { priority: 'low' } as RequestInit)
      .then(response => response.ok ? response.arrayBuffer() : null)
      .catch(() => null)
      .then(result => {
        if (!result) bytes.delete(file)
        return result
      })
    bytes.set(file, data)
  }
  return data
}

/** 全部下好；已经能出声（点过一下）就顺手解码。静音时不下，打开声音时再来一遍。 */
function prefetch() {
  if (muted) return
  for (const file of FILES) void (context ? load(file) : fetchBytes(file))
}

/** 解码（要有 AudioContext）；解出来的留着，没解出来下次再试。字节解一次就用掉了，所以每个文件只解一次。 */
function load(file: string) {
  let buffer = buffers.get(file)
  if (!buffer) {
    const audio = context
    if (!audio) return Promise.resolve(null)
    buffer = fetchBytes(file)
      .then(data => data ? audio.decodeAudioData(data) : null)
      .catch(() => null)
      .then(result => {
        if (!result) {
          buffers.delete(file)
          bytes.delete(file)
        }
        return result
      })
    buffers.set(file, buffer)
  }
  return buffer
}

/** 第一次点按、按键时建好（并恢复）AudioContext，把下好的声音全部解码。 */
function unlock() {
  if (!context) {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Context) return
    context = new Context()
    prefetch()
  }
  if (context.state === 'suspended') void context.resume()
}

export function installSound() {
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true })
  window.addEventListener('keydown', unlock, { capture: true })
  prefetch()
}

/** 放一个音效；静音、还没点过、网页在后台时什么都不做。delay 是过多少毫秒再放。 */
export function play(sound: Sound, { volume = 1, delay = 0 }: { volume?: number; delay?: number } = {}) {
  if (muted || !context || document.hidden) return
  const spec = SOUNDS[sound]
  const file = spec.files[Math.floor(Math.random() * spec.files.length)]
  const asked = performance.now()
  void load(file).then(buffer => {
    const audio = context
    if (!buffer || !audio || muted) return
    const wait = delay - (performance.now() - asked)
    if (wait < -LATE_MS) return
    const source = audio.createBufferSource()
    source.buffer = buffer
    if (spec.pitch) source.playbackRate.value = 1 + (Math.random() * 2 - 1) * spec.pitch
    const gain = audio.createGain()
    gain.gain.value = spec.volume * volume
    source.connect(gain).connect(audio.destination)
    source.start(audio.currentTime + Math.max(0, wait) / 1000)
  })
}

/** 挖到什么就放什么（自己挖的）。盾牌挡住、重复的盾牌和望远镜转成小奖时换个声音。 */
export function soundOfResult(result: { kind: string; amount: number; blocked: boolean }): Sound | null {
  if (result.blocked) return 'block'
  switch (result.kind) {
    case 'emerald': return 'emerald'
    case 'diamond': return 'diamond'
    case 'apple': return 'apple'
    case 'totem': return 'totem'
    case 'tnt': return 'tnt'
    case 'crystal': return 'crystal'
    case 'shield': return result.amount > 0 ? 'emerald' : 'shield'
    case 'spyglass': return result.amount > 0 ? 'emerald' : 'spyglass'
    case 'debris': return 'diamond'
    case 'minecart': return result.amount > 0 ? 'emerald' : 'chest'
    case 'coal': case 'stick': case 'map': case 'potion': case 'key': case 'ender': return 'pop'
    case 'cobweb': case 'spawner': return 'block'
    // 珍珠和眼的声音跟着飞行动画放（起飞、落地）
    default: return null
  }
}
