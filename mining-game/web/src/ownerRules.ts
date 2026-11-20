// 这一局的规矩是谁定的（docs/V3_ITEMS.md §21，2026-11-13 用户：进来就看到是谁发的红包、定了什么规矩，数据透明，
// 冤有头债有主）。只写玩的人在乎的几样，用发红包表单里同样的词（难度、末影之眼、苦力怕），一样一行：
// 规矩里没有的（以前开的局）就不写。纯函数，网页和测试共用。
import { crystalPercent } from './eye'
import type { Rules } from './types'
import { money } from './types'

export interface RuleRow { label: string; value: string }

/** 难度的名字：和发红包表单一样（简单、普通、困难）；hard、hell 是以前的判定器才有的。 */
export const DIFFICULTY_NAMES: Record<Rules['difficulty'], string> = { easy: '简单', normal: '普通', tough: '困难', hard: '困难', hell: '地狱' }

/** 扣多少：一半、扣光好懂，别的写百分之几。 */
const takes = (percent: number) => (percent >= 100 ? '全部扣光' : percent === 50 ? '扣掉一半' : `扣掉 ${percent}%`)

/** 多久：整分钟写分钟。 */
const span = (seconds: number) => (seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`)

/** 这一局的规矩，一样一行。 */
export function ruleRows(rules: Rules, pool: number, unit: string): RuleRow[] {
  const rows: RuleRow[] = []
  const eye = rules.eyeEvery
  rows.push({
    label: '难度',
    value: `${DIFFICULTY_NAMES[rules.difficulty] ?? '普通'}：踩中 TNT，待领取的${takes(rules.tntPercent)}${eye ? `；挖到末影水晶${takes(crystalPercent(rules))}` : ''}`,
  })
  const interval = rules.digInterval ?? 1
  rows.push({ label: '镐子', value: `每人能挖 ${rules.initialChances} 下${interval > 1 ? `，两下之间要隔 ${interval} 秒` : ''}` })
  // 苦力怕只有道具版的局有；0 是发红包的人关了
  if (rules.items) rows.push({ label: '苦力怕', value: rules.creeper === 0 ? '这一局没有' : `手上有待领取的、${span(rules.creeper ?? 60)}不挖，会来炸掉 20%` })
  if (eye !== undefined) rows.push({ label: '末影之眼', value: eye ? `每 ${eye} 张卡藏一颗` : '这一局没有' })
  rows.push({ label: '奖池', value: `${money(pool)} ${unit}，绿宝石每颗 ${money(rules.smallReward)}` })
  return rows
}

/** 谁的矿洞：有名字写“小明的矿洞”，红包站还没给名字时写“这一局的矿洞”。 */
export const ownerTitle = (name: string | null) => (name ? `${name}的矿洞` : '这一局的矿洞')
/** 规矩是谁定的。 */
export const ownerWords = (name: string | null) => `这一局的规矩是${name ?? '发红包的人'}定的`
