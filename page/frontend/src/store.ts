import { atom, createStore } from 'jotai'
import type { HbAnnouncement, HbHongbao, HbMe, HbSubmitResult } from '../../hb'
import { readPrivate, readPublic } from './game'
import type { PrivateGame, PublicGame } from './game'
import { createPresentationController } from './presentation'
import type { PresentationSnapshot } from './presentation'

export const store = createStore()
export const connectionAtom = atom<'connecting' | 'ready' | 'error'>('connecting')
export const connectionErrorAtom = atom('')
export const publicAtom = atom<PublicGame | null>(null)
export const privateAtom = atom<PrivateGame | null>(null)
export const hongbaoAtom = atom<HbHongbao | null>(null)
export const meAtom = atom<HbMe | null>(null)
export const pendingActionAtom = atom<string | null>(null)
export const unconfirmedInputAtom = atom<string | null>(null)
export const checkingResultAtom = atom(false)
export const announcementsAtom = atom<HbAnnouncement[]>([])
export const toastAtom = atom<{ text: string; tone: 'info' | 'success' | 'error'; id: number } | null>(null)
type SettlementReason = 'exhausted' | 'collected' | 'hongbao-ended' | 'unknown'
interface Settlement { amount: string; unit: string; reason: SettlementReason; digs: number | null }
export const settlementAtom = atom<Settlement | null>(null)
export const nowAtom = atom(Date.now())
export const presentationAtom = atom<PresentationSnapshot>({ game: null, own: null, me: null, transitionFrom: null, effect: null, phase: 'idle', busy: false, queued: 0 })
let reducedMotion = false
const makePresentation = () => createPresentationController({ onChange: snapshot => store.set(presentationAtom, snapshot) })
let presentation = makePresentation()
let connectionGeneration = 0
let refreshRevision = 0
let settlementPresented = false
let collectionConfirmed = false
let subscriptions: (() => void)[] = []
let clockTimer: ReturnType<typeof setInterval> | undefined

export function setPresentationReducedMotion(value: boolean) {
  reducedMotion = value
  presentation.setReducedMotion(value)
}

function toast(text: string, tone: 'info' | 'success' | 'error' = 'info') {
  store.set(toastAtom, { text: text.replaceAll('这场红包', '这个红包').replaceAll('本场', '这个红包').replaceAll('收手', '领取奖励'), tone, id: Date.now() })
}

const isCollection = (input?: string) => input === 'cashout' || input === '收手'
const reasonPriority: Record<SettlementReason, number> = { unknown: 0, 'hongbao-ended': 1, exhausted: 2, collected: 3 }

function showSettlement(amount: string, unit: string, freshOwn: PrivateGame | null, confirmedInput?: string, open = false) {
  if (isCollection(confirmedInput)) collectionConfirmed = true
  const current = store.get(settlementAtom)
  // A later packet may explain an open result, but cannot revive a result that
  // the player already dismissed, including one opened before submit returned.
  if (!current && (!open || settlementPresented)) return
  const reason: SettlementReason = collectionConfirmed ? 'collected'
    : freshOwn?.status === 'settled' && freshOwn.chances === 0 ? 'exhausted'
      : store.get(hongbaoAtom)?.status === 'ended' ? 'hongbao-ended' : 'unknown'
  settlementPresented = true
  const keepAmount = current && amount === '0.00' && current.amount !== '0.00'
  store.set(settlementAtom, {
    amount: keepAmount ? current.amount : amount,
    unit: keepAmount ? current.unit : unit,
    reason: current && reasonPriority[current.reason] > reasonPriority[reason] ? current.reason : reason,
    digs: freshOwn ? Math.max(freshOwn.digs, current?.digs ?? 0) : current?.digs ?? null,
  })
}

function currentOwn(own: PrivateGame | null) {
  const previous = store.get(privateAtom)
  if (!own || !previous || own.actorKey !== previous.actorKey) return true
  if (own.digs < previous.digs) return false
  return !(own.digs === previous.digs && previous.status === 'settled' && own.status !== 'settled')
}

function acceptMe(me: HbMe, freshOwn: PrivateGame | null = null, confirmedInput?: string) {
  const previous = store.get(meAtom)
  if (previous?.signedIn && me.signedIn && previous.name === me.name && previous.settled && !me.settled) return false
  store.set(meAtom, me)
  if (me.signedIn && me.settled) {
    showSettlement(me.claim?.amount ?? '0.00', me.claim?.unit ?? store.get(hongbaoAtom)?.unit ?? 'LDC', freshOwn, confirmedInput,
      !!previous?.signedIn && previous.name === me.name && !previous.settled)
  }
  return true
}

export async function refreshOwn(confirmedInput?: string) {
  const generation = connectionGeneration
  const revision = ++refreshRevision
  if (isCollection(confirmedInput)) collectionConfirmed = true
  const currentPresentation = presentation
  const [me, own, view] = await Promise.all([window.hb.me(), window.hb.myView(), window.hb.view()])
  if (generation !== connectionGeneration || revision !== refreshRevision) return null
  const incomingOwn = readPrivate(own?.data)
  const ownIsCurrent = currentOwn(incomingOwn)
  const freshOwn = ownIsCurrent ? incomingOwn : null
  if (!acceptMe(me, freshOwn, confirmedInput)) return null
  if (ownIsCurrent) store.set(privateAtom, incomingOwn)
  store.set(publicAtom, readPublic(view?.data))
  store.set(nowAtom, window.hb.now())
  currentPresentation.receive({ game: store.get(publicAtom), own: store.get(privateAtom), me })
  return freshOwn
}

export async function connect() {
  const generation = ++connectionGeneration
  subscriptions.forEach(stop => stop())
  subscriptions = []
  clearInterval(clockTimer)
  presentation.dispose()
  presentation = makePresentation()
  presentation.setReducedMotion(reducedMotion)
  store.set(presentationAtom, presentation.getSnapshot())
  store.set(meAtom, null)
  store.set(privateAtom, null)
  store.set(settlementAtom, null)
  settlementPresented = false
  collectionConfirmed = false
  store.set(pendingActionAtom, null)
  store.set(checkingResultAtom, false)
  store.set(connectionAtom, 'connecting')
  store.set(connectionErrorAtom, '')
  try {
    if (!window.hb) throw new Error('没有接上红包页。请从红包站打开游戏，或使用本地试玩入口。')
    const ready = await window.hb.ready()
    if (generation !== connectionGeneration) return
    store.set(hongbaoAtom, ready.hongbao)
    subscriptions = [
      window.hb.on('view', view => { if (generation !== connectionGeneration) return; const game = readPublic(view?.data); store.set(publicAtom, game); presentation.receive({ game }) }),
      window.hb.on('myView', view => { if (generation !== connectionGeneration) return; const own = readPrivate(view?.data); if (!currentOwn(own)) return; store.set(privateAtom, own); presentation.receive({ own }) }),
      window.hb.on('me', me => {
        if (generation !== connectionGeneration) return
        if (!acceptMe(me)) return
        presentation.receive({ me })
        // A me-only packet has no board revision. Read the coherent SDK bundle
        // before presenting money changed in another tab or a platform close.
        if (!store.get(pendingActionAtom)) void refreshOwn().catch(() => undefined)
      }),
      window.hb.on('hongbao', hongbao => {
        if (generation !== connectionGeneration) return
        store.set(hongbaoAtom, hongbao)
        const me = store.get(meAtom)
        if (me?.signedIn && me.settled) showSettlement(me.claim?.amount ?? '0.00', me.claim?.unit ?? hongbao.unit, null)
      }),
      window.hb.on('announce', line => { if (generation === connectionGeneration) store.set(announcementsAtom, lines => [line, ...lines.filter(other => other.n !== line.n)].slice(0, 10)) }),
    ]
    await refreshOwn()
    if (generation !== connectionGeneration) return
    if (!store.get(publicAtom)) throw new Error('当前红包没有矿洞卡片数据，请确认使用了配套判定器。')
    store.set(connectionAtom, 'ready')
    clockTimer = setInterval(() => store.set(nowAtom, window.hb.now()), 200)
  } catch (error) {
    if (generation !== connectionGeneration) return
    store.set(connectionAtom, 'error')
    store.set(connectionErrorAtom, error instanceof Error ? error.message : '暂时无法连接红包页，请稍后重试。')
  }
}

export function disconnect() {
  connectionGeneration++
  subscriptions.forEach(stop => stop())
  subscriptions = []
  clearInterval(clockTimer)
  presentation.dispose()
}

const reasons: Record<string, string> = {
  denied: '尚未允许游戏代你提交。再次操作时可在红包页授权。',
  login: '请先在红包页登录后参与。',
  busy: '上一次操作正在处理中，请稍等。',
  human_check: '请先在红包页完成人机验证。',
  not_in_scope: '你不在这个红包的领取范围内，可以继续围观。',
  already_claimed: '你已结算，可以继续围观这个红包。',
  not_open: '红包尚未开放，请稍后再来。',
  ended: '这个红包已经结束。',
  paused: '红包暂时暂停，请稍后查看。',
  judge_failed: '本次没有完成判定，请刷新确认后再操作。',
  try_later: '现在参与人数较多，请稍后再试。',
  unconfirmed: '提交结果尚未确认，正在查询你的记录。请勿重复挖掘。',
  away: '请回到这个红包页后再操作。',
  not_code: '当前红包不支持矿洞游戏。',
}

async function reconcileUnconfirmed(input: string) {
  const generation = connectionGeneration
  const mine = await window.hb.mine()
  if (generation !== connectionGeneration) return null
  const latest = mine?.items[0]
  await refreshOwn(latest?.input === input && latest.settled !== false ? input : undefined)
  return latest?.input === input ? latest.reply : null
}

export async function confirmSubmission() {
  const input = store.get(unconfirmedInputAtom)
  if (!input || store.get(checkingResultAtom)) return
  const generation = connectionGeneration
  store.set(checkingResultAtom, true)
  try {
    const reply = await reconcileUnconfirmed(input)
    if (generation !== connectionGeneration) return
    store.set(unconfirmedInputAtom, null)
    toast(reply ? `已刷新最近记录：${reply}` : '已同步牌面和本人记录，可以继续操作。')
  } catch {
    if (generation !== connectionGeneration) return
    toast('还没能确认上次操作，请恢复连接后点击“重新确认状态”。', 'error')
  } finally {
    if (generation === connectionGeneration) store.set(checkingResultAtom, false)
  }
}

export async function submit(input: string) {
  if (store.get(pendingActionAtom) !== null || store.get(unconfirmedInputAtom) !== null || store.get(connectionAtom) !== 'ready') return
  if (!presentation.begin(input)) return
  const generation = connectionGeneration
  const currentPresentation = presentation
  store.set(pendingActionAtom, input)
  try {
    const result: HbSubmitResult = await window.hb.submit(input)
    if (generation !== connectionGeneration) return
    if (!result.judged) {
      const text = result.reason === 'cooldown' ? `红包页提交冷却中，还需 ${result.seconds ?? '?'} 秒。` : result.message || reasons[result.reason] || '本次操作未完成，请稍后重试。'
      toast(text, result.reason === 'unconfirmed' ? 'info' : 'error')
      if (result.reason === 'unconfirmed') {
        store.set(unconfirmedInputAtom, input)
        await confirmSubmission()
      } else await refreshOwn()
      return
    }
    const freshOwn = await refreshOwn(result.settled ? input : undefined)
    if (generation !== connectionGeneration) return
    const own = store.get(privateAtom)
    const successfulDig = input.startsWith('dig ') && own?.lastResult && `${own.lastResult.cardId} ${own.lastResult.index + 1}` === input.slice(4)
    if (!successfulDig && !result.settled) toast(result.reply || '结果已更新。', 'info')
    if (result.settled) {
      const me = store.get(meAtom)
      const amount = result.claimed ? result.amount : me?.signedIn ? me.claim?.amount ?? '0.00' : '0.00'
      showSettlement(amount, store.get(hongbaoAtom)?.unit ?? 'LDC', freshOwn, input, true)
    }
  } catch {
    if (generation !== connectionGeneration) return
    store.set(unconfirmedInputAtom, input)
    toast('连接中断，结果可能已经生效。正在查询本人记录。', 'error')
    await confirmSubmission()
  } finally {
    currentPresentation.complete(input)
    if (generation === connectionGeneration) store.set(pendingActionAtom, null)
  }
}
