import type { CSSProperties } from 'react'
import type { IconKind } from './game'

const base = './assets/minecraft/1.21.4'
const textures: Record<IconKind, string> = {
  emerald: 'textures/item/emerald.png',
  diamond: 'textures/item/diamond.png',
  apple: 'inventory/enchanted_golden_apple.png',
  totem: 'textures/item/totem_of_undying.png',
  pearl: 'textures/item/ender_pearl.png',
  eye: 'textures/item/ender_eye.png',
  crystal: 'textures/item/end_crystal.png',
  spyglass: 'textures/item/spyglass.png',
  pickaxe: 'textures/item/iron_pickaxe.png',
  tnt: 'inventory/tnt.png',
  shield: 'inventory/shield.png',
  chest: 'inventory/chest.png',
  ore: 'inventory/stone.png',
  coal: 'textures/item/coal.png',
  stick: 'textures/item/stick.png',
  map: 'inventory/map.png',
  potion: 'textures/item/potion.png',
  key: 'textures/item/trial_key.png',
  vault: 'inventory/vault.png',
  deco: 'textures/block/chiseled_tuff.png',
  lava: 'textures/block/lava_still.png',
  debris: 'inventory/ancient_debris.png',
  cobweb: 'textures/block/cobweb.png',
  spawner: 'inventory/spawner.png',
  minecart: 'textures/item/chest_minecart.png',
  ender: 'inventory/ender_chest.png',
  torch: 'textures/block/torch.png',
  'torch-green': 'inventory/copper_torch.png',
  'torch-red': 'textures/block/redstone_torch.png',
  table: 'inventory/enchanting_table.png',
  sculk: 'textures/block/sculk.png',
}

/** 急迫药水：药水瓶的液体层按急迫的颜色染（游戏里药水图标就是这样画的：液体层乘上效果的颜色）。 */
const HASTE = '#d9c043'

/** Unmodified vanilla textures/renders. Provenance: docs/MINECRAFT_ASSETS.md. */
/**
 * moving：附魔金苹果用原版的动图（1650 帧、一直循环）。动图每一帧都要重画，红包站把游戏放在毛玻璃里，
 * 网页闲着也每秒画 20 帧（2026-11-11 量过），所以默认画静态的；只有 v2 老网页的开奖大图和记录传 moving。
 */
export function ItemIcon({ kind, size = 32, className = '', moving = false }: { kind: IconKind; size?: number; className?: string; moving?: boolean }) {
  if (kind === 'totem') return <span className={`item-icon pickaxe-pair ${className}`} style={{ width: size, height: size }} aria-hidden="true"><img className="pair-back" src={`${base}/${textures.pickaxe}`} alt="" draggable={false} /><img className="pair-front" src={`${base}/${textures.pickaxe}`} alt="" draggable={false} /></span>
  if (kind === 'apple' && moving) return <picture className={`item-icon ${className}`} style={{ width: size, height: size }} aria-hidden="true"><source media="(prefers-reduced-motion: reduce)" srcSet={`${base}/${textures.apple}`} /><img src={`${base}/inventory/enchanted_golden_apple.gif`} width={size} height={size} alt="" draggable={false} /></picture>
  if (kind === 'potion') return <span className={`item-icon potion-icon ${className}`} style={{ width: size, height: size, '--tint': HASTE, '--overlay': `url("${new URL(`${base}/textures/item/potion_overlay.png`, document.baseURI).href}")` } as CSSProperties} aria-hidden="true">
    <img className="potion-liquid" src={`${base}/textures/item/potion_overlay.png`} alt="" draggable={false} />
    <span className="potion-tint" />
    <img className="potion-bottle" src={`${base}/${textures.potion}`} alt="" draggable={false} />
  </span>
  // 幽匿块：原版是 4 帧的竖条，只画第一帧（不动）
  if (kind === 'sculk') return <span className={`item-icon sculk-icon ${className}`} style={{ width: size, height: size, backgroundImage: `url(${base}/${textures.sculk})` }} aria-hidden="true" />
  // 岩浆：原版的 20 帧动画贴图，竖着一条，按帧往下走
  if (kind === 'lava') return <span className={`item-icon lava-icon ${className}`} style={{ width: size, height: size, backgroundImage: `url(${base}/${textures.lava})` }} aria-hidden="true" />
  return <img className={`item-icon ${className}`} src={`${base}/${textures[kind]}`} width={size} height={size} alt="" aria-hidden="true" draggable={false} />
}
