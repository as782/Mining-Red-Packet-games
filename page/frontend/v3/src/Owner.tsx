import { useAtomValue } from 'jotai'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { colorOf, initialOf } from './emotes'
import { DIFFICULTY_NAMES, ownerTitle, ownerWords, ruleRows } from './ownerRules'
import { gameAtom, hongbaoAtom } from './state'

// 这一局是谁的矿洞、他定了什么规矩（docs/V3_ITEMS.md §21）：第一次进这个红包弹一次（开挖），“怎么玩”最上面
// 一直有一份，收益卡上写着是谁的矿洞、什么难度。名字和头像是红包站给网页的（hb.ready() 的 hongbao.sender）。

/** 名字的颜色（没有头像时的圆底）：按名字算，同一个名字一直一样。 */
function nameHue(name: string) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 100_000
  return colorOf(hash)
}

/** 头像：红包站给的图；没有、加载不出来时是带名字首字的圆。 */
export function Avatar({ name, src, size }: { name: string; src: string | null | undefined; size: number }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  const style = { width: size, height: size, fontSize: Math.round(size * 0.45) }
  return src && !broken
    ? <img className="avatar" src={src} alt="" width={size} height={size} style={style} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    : <span className="avatar is-letter" style={{ ...style, background: nameHue(name) }} aria-hidden="true">{initialOf(name)}</span>
}

/** 发红包的人（红包站还没给名字时是 null）。 */
function useSender() {
  const sender = useAtomValue(hongbaoAtom)?.sender
  return sender?.name ? { name: sender.name, avatar: sender.avatar ?? null } : null
}

/** 规矩那几行：谁的矿洞、难度，下面一样一行。 */
export function OwnerRules() {
  const game = useAtomValue(gameAtom)
  const unit = useAtomValue(hongbaoAtom)?.unit ?? 'LDC'
  const sender = useSender()
  if (!game) return null
  const name = sender?.name ?? null
  return <div className="owner">
    <div className="owner-head">
      {sender ? <Avatar name={sender.name} src={sender.avatar} size={40} /> : null}
      <div className="owner-names">
        <strong>{ownerTitle(name)}</strong>
        <span>{ownerWords(name)}</span>
      </div>
    </div>
    <dl className="owner-rows">
      {ruleRows(game.rules, game.pool, unit).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
    </dl>
  </div>
}

/** 第一次进这个红包：先看规矩，点“开挖”收起（之后在“怎么玩”里还有）。 */
export function OwnerCard({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="rules-backdrop" onClick={onClose}>
    <motion.section className="rules owner-card" role="dialog" aria-modal="true" aria-label="这一局的规矩" onClick={event => event.stopPropagation()}
      initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}>
      <OwnerRules />
      <button type="button" className="owner-go" onClick={onClose} autoFocus>开挖</button>
    </motion.section>
  </div>
}

/** 收益卡上的一行：谁的矿洞、什么难度（截图分享时也看得出规矩是谁定的）。 */
export function OwnerTag() {
  const game = useAtomValue(gameAtom)
  const sender = useSender()
  if (!game) return null
  const name = sender?.name ?? null
  return <p className="owner-tag">
    {sender ? <Avatar name={sender.name} src={sender.avatar} size={22} /> : null}
    <span>{ownerTitle(name)}</span>
    <b className={`owner-level is-${game.rules.difficulty}`}>难度：{DIFFICULTY_NAMES[game.rules.difficulty] ?? '普通'}</b>
  </p>
}

/** 每个红包只弹一次规矩卡：记在这台设备上。 */
export const ownerSeenKey = (hongbao: string) => `kddb:v3:owner:${hongbao}`
