// 网页的状态和控制：连上游戏站、挖、领、收实时推送（docs/V3_MAP.md §6）。
import { atom, createStore } from 'jotai'
import type { HbHongbao } from '../../../hb'
import { ApiError, GameApi } from './api'
import { landMs } from './PearlFlight'
import { play, soundOfResult } from './sound'
import type { Merge } from './live'
import { mergeCard, mergeLive, mergeState } from './live'
import type { Held, Slot } from './items'
import { isLastDig, leftoversOf, outOfPicks } from './items'
import type { DigResult, Kind, Live, LiveStep, Me, PublicGame, Shape, State } from './types'
import { setMoneyStep } from './types'
import { money } from './types'

export const store = createStore()

/** out：不在领取范围（挖到的领不了，不让进） */
export type Phase = 'starting' | 'login' | 'error' | 'ready' | 'out'
export const phaseAtom = atom<Phase>('starting')
export const problemAtom = atom('')
export const gameAtom = atom<PublicGame | null>(null)
/** 只看规则里的几样（工具条用）：gameAtom 每次推送都换，订阅它的组件每挖一格都要重画 */
export const itemsGameAtom = atom(get => !!get(gameAtom)?.rules.items)
/** 第几版的道具规则（rules.items：0 没有道具栏，1 第一版，2 第二版，docs/V3_ITEMS.md §9） */
export const itemsVersionAtom = atom(get => get(gameAtom)?.rules.items ?? 0)
/** 一合成做成几个火把（rules.craftTorches，旧局 1） */
export const craftTorchesAtom = atom(get => get(gameAtom)?.rules.craftTorches ?? 1)
export const digIntervalAtom = atom(get => get(gameAtom)?.rules.digInterval ?? 1)
export const hasGameAtom = atom(get => get(gameAtom) !== null)
export const meAtom = atom<Me | null>(null)
export const blockedAtom = atom<string | null>(null)
/** 什么时候（本机时间，毫秒）能再挖：游戏站给的 coolingMs 加上收到的时刻 */
export const readyAtAtom = atom(0)
export const hongbaoAtom = atom<HbHongbao | null>(null)
/** 看的人自己：昵称和头像（红包站 2026-11-13 起给头像，以前的没有） */
export const viewerAtom = atom<{ name: string; avatar: string | null } | null>(null)
export const uidAtom = atom<number | null>(null)
/** 自己正在挖的格子："卡号:格" */
export const pendingAtom = atom<Record<string, true>>({})
/** 刚开出来的格子（自己的展示，别人的轻闪一下） */
export const freshAtom = atom<Record<string, { mine: boolean; at: number; result?: DigResult }>>({})
/** 新长出来的卡，镜头外时在屏幕边上指过去 */
/** 刚长出来的卡，和挖出它的那颗珍珠在哪一格（入场动画从那里飞过去）。 */
export const newCardAtom = atom<{ cardId: number; at: number; from: { cardId: number; index: number } } | null>(null)
/** 请地图把镜头移到一张卡（动态、NEW 标记、自己的珍珠） */
export const focusRequestAtom = atom<{ cardId: number; at: number; dig?: boolean } | null>(null)
/** JP 指着的特殊区块（离你最近的、还开着的；MapView 算），底栏那一行说同一个 */
export const jpTargetAtom = atom<number | null>(null)
export const toastAtom = atom<{ text: string; tone: 'info' | 'good' | 'bad'; id: number } | null>(null)
export type Claiming = 'idle' | 'working' | 'filled' | 'done'
export const claimingAtom = atom<Claiming>('idle')
/** 红包站已经给他结算了：领到多少 */
export const settledAtom = atom<{ amount: string; unit: string } | null>(null)
/** 收益卡开着：他点开的（button），或者这一局对他结束了自动弹的（end） */
export const summaryOpenAtom = atom<'button' | 'end' | null>(null)

/**
 * 工具条（docs/V3_ITEMS.md §5）：拿在手上的道具（null 是镐子，点格子就是挖）、说明或确认开着的
 * 那一格，和对格子用的道具现在预览在哪（触屏第一下点、电脑上指着；再点同一处才用）。
 */
export type { Slot }
export const heldAtom = atom<Held | null>(null)
/** 预览在哪：哪张卡的哪一格（形状的中心、火把那个角右下的格子、宝库） */
export const aimAtom = atom<{ cardId: number; index: number } | null>(null)
/** 刚用望远镜、藏宝图看到的格子（"卡号:格"）：格子上飘一下看到的是什么 */
export const peekedAtom = atom<{ cell: string; at: number; words?: string } | null>(null)
/** 弹窗：末影箱、附魔台、宝库开出的东西 */
export type Dialog = { type: 'ender' } | { type: 'table' } | { type: 'vault'; text: string; kind: Kind | 'table' | null }
  /**
   * 工具条上点一格（docs/ITEM_UX.md）：即用类确认，被动类和镐子说明；瞄准类的引导，enter 是进入选位置前
   * （有“不再提示”和“使用”），help 是步骤条上的问号（只有“知道了”，关掉回到这一步）
   */
  | { type: 'item'; slot: Slot; mode?: 'enter' | 'help' }
  /** 卡上面区块名字旁边的问号：这个区块的说明（docs/V3_ITEMS.md §9） */
  | { type: 'region'; cardId: number }
  /** 最后一下（docs/V3_ITEMS.md §13）：挖完这一局就结束了，手里还有没用的；go 是照样挖 */
  | { type: 'last'; slots: Slot[]; go: () => void }
export const dialogAtom = atom<Dialog | null>(null)
/** 本机时间：苦力怕什么时候来（null 是不来）、急迫药水到什么时候 */
export const creeperAtAtom = atom<number | null>(null)
export const hasteUntilAtom = atom(0)
/** 本机时间：蜘蛛网让这一次多等到什么时候（游戏站给的 slowMs 是现在的冷却里蜘蛛网占的那一段） */
export const slowUntilAtom = atom(0)
/** 末影箱的说明开着（打开的时刻，0 是收起）：存进去时打开，点“知道了”收起 */
export const chestNoteAtom = atom(0)
/** 苦力怕正在画面上（顶上那一行它最优先，步骤条和通知让开） */
export const creeperShownAtom = atom(false)
/** 选位置这一步预览到的那张卡（只在它变了时重画步骤条，不跟着每次推送） */
export const aimedCardAtom = atom(get => {
  const aim = get(aimAtom)
  return aim ? get(gameAtom)?.cards.find(card => card.id === aim.cardId) ?? null : null
})

/** 放下道具（再点它、用完、Esc、右键）。 */
export function putDown() {
  store.set(heldAtom, null)
  store.set(aimAtom, null)
}

let api: GameApi | null = null
/** 连上游戏站以后的接口（在场那条连接用，presence.ts） */
export const gameApi = () => api
let stopLive: (() => void) | null = null
let autoClaimed = false
/** 结束时的弹窗每次打开网页只弹一次 */
let endShown = false

/** 收益卡的数据（打开时才要）。 */
export function loadSummary() {
  if (!api) return Promise.reject(new Error('还没连上矿洞'))
  return api.summary()
}

/** 这一局对他结束了（领到了、奖池分完或机会用完而手里没有分）：弹一次收益卡。 */
function showEnd() {
  if (endShown) return
  endShown = true
  store.set(summaryOpenAtom, 'end')
}

/** 刚开出来的格子，只留最近 3 秒的（闪一下、飘字都在这之内），不让它越攒越大。 */
const FRESH_MS = 3000
function addFresh(entries: Record<string, { mine: boolean; at: number; result?: DigResult }>) {
  store.set(freshAtom, value => {
    const now = Date.now()
    const next: typeof value = {}
    for (const [cell, entry] of Object.entries(value)) if (now - entry.at < FRESH_MS) next[cell] = entry
    return Object.assign(next, entries)
  })
}

const key = (cardId: number, index: number) => `${cardId}:${index}`

export function toast(text: string, tone: 'info' | 'good' | 'bad' = 'info') {
  store.set(toastAtom, { text, tone, id: Date.now() + Math.random() })
}

function setProblem(error: unknown) {
  store.set(problemAtom, error instanceof Error ? error.message : '矿洞出了点问题，稍后再试')
  store.set(phaseAtom, 'error')
}

/** 红包站上的结算情况：领到了就记下来。 */
function acceptMe(me: Awaited<ReturnType<typeof hb.me>>) {
  if (me.signedIn && me.claim) store.set(settledAtom, { amount: me.claim.amount, unit: me.claim.unit })
}

export async function start() {
  store.set(phaseAtom, 'starting')
  try {
    const { hongbao, viewer } = await hb.ready()
    if (viewer.signedIn) store.set(viewerAtom, { name: viewer.name, avatar: viewer.avatar ?? null })
    // 三方积分红包：数都是多少个最小单位，按它的最小单位写（游戏站的 rules.step 到了以后以它为准）
    setMoneyStep(hongbao.step)
    store.set(hongbaoAtom, hongbao)
    hb.on('hongbao', next => store.set(hongbaoAtom, next))
    hb.on('me', acceptMe)
    const me = await hb.me()
    acceptMe(me)
    if (!me.signedIn) {
      store.set(phaseAtom, 'login')
      return
    }
    // 不在领取范围：挖到的奖励领不了，还占奖池，先拦下（游戏站认人时也会拦）
    if (!me.open && me.why === 'not_in_scope') {
      store.set(problemAtom, '你不在这个红包的领取范围里（红包页上写着仅限哪些人领），挖到的奖励领不了，所以进不了矿洞')
      store.set(phaseAtom, 'out')
      return
    }
    api = new GameApi(hongbao.id)
    const state = await api.hello().catch(error => {
      if (error instanceof ApiError && error.status === 403) {
        store.set(problemAtom, error.message)
        store.set(phaseAtom, 'out')
        return null
      }
      throw error
    })
    if (!state) return
    store.set(uidAtom, api.uid)
    ahead.clear()
    store.set(gameAtom, null)
    acceptState(state)
    store.set(phaseAtom, 'ready')
    stopLive?.()
    // 连上（和断了重连上）时按序号补上漏的
    stopLive = api.live(onLive, () => void catchUp())
    window.setInterval(checkWrapUp, 5000)
  } catch (error) {
    setProblem(error)
  }
}

export async function signIn() {
  const result = await hb.login().catch(() => null)
  if (result?.signedIn) await start()
}

function setMe(me: Me) {
  store.set(meAtom, me)
  const now = Date.now()
  if (me.coolingMs !== undefined) store.set(readyAtAtom, now + me.coolingMs)
  if (me.creeperMs !== undefined) store.set(creeperAtAtom, me.creeperMs === null ? null : now + me.creeperMs)
  store.set(hasteUntilAtom, me.hasteMs ? now + me.hasteMs : 0)
  store.set(slowUntilAtom, me.slowMs ? now + me.slowMs : 0)
}

/** 手上加末影箱里的：领取时领到的。 */
export const totalOf = (me: Me) => me.points + (me.chest ?? 0)

/**
 * 序号接不上的推送（ahead）：先等一会儿，推送和挖的回答走两条路，晚到的那条多半马上就到；
 * 还缺就找游戏站按序号补（catchUp）。同一时间只补一次，补回来的比手上旧就不要：以前每次
 * 接不上都重读整局（几百 KB），读回来的又比手上旧、往回一退又接不上，一局下来几万次重读。
 */
const GAP_WAIT_MS = 400
const ahead = new Map<number, LiveStep>()
let gapTimer: ReturnType<typeof setTimeout> | undefined
let catching: Promise<void> | null = null

/** 把合好的整局放进去：别人新开的格子闪一下，新卡长出来，奖池分完了就结束。 */
function commit(merge: Merge) {
  const before = store.get(gameAtom)
  setMoneyStep(merge.game.rules.step)
  store.set(gameAtom, merge.game)
  const uid = store.get(uidAtom)
  const now = Date.now()
  const fresh: Record<string, { mine: boolean; at: number }> = {}
  for (const cell of merge.opened) if (cell.uid !== uid) fresh[key(cell.cardId, cell.index)] = { mine: false, at: now }
  if (Object.keys(fresh).length > 0) addFresh(fresh)
  // 新卡（谁挖出来的都一样）：地图上长出来，不在画面里就在边上提醒，镜头不动
  if (merge.grown) {
    const { uid: digger, ...grown } = merge.grown
    store.set(newCardAtom, { ...grown, at: now })
    // 别人挖到末影之眼：末地宝藏开了，大家都听得见（轻一些）
    const card = merge.game.cards.find(item => item.id === grown.cardId)
    if (digger !== uid && card?.kind === 'end') play('portal', { volume: 0.6, delay: landMs('eye') })
  }
  // 监守者醒了、岩浆吞了格子：大家都听得见（轻一些）
  if (before) {
    const was = new Map(before.cards.map(card => [card.id, card]))
    if (merge.game.cards.some(card => card.closed && was.get(card.id) && !was.get(card.id)!.closed)) play('warden', { volume: 0.5 })
    else if (merge.opened.some(cell => cell.uid === 0)) play('lava', { volume: 0.5 })
  }
  // 推送、补回来的让奖池分完了（刚打开时就分完的照旧只显示为什么不能挖）
  if (merge.game.over && before && !before.over) gameOver()
  if (ahead.size === 0) {
    clearTimeout(gapTimer)
    gapTimer = undefined
  } else if (gapTimer === undefined && !catching) {
    gapTimer = setTimeout(() => {
      gapTimer = undefined
      if (ahead.size > 0) void catchUp()
    }, GAP_WAIT_MS)
  }
}

/** 整局（认人、补不上时）：比手上的旧就只收自己的那份。 */
function acceptState(state: State) {
  // 不在的时候苦力怕来过（docs/V3_ITEMS.md §9）：回来时游戏站先算掉，说一声
  if (state.drained) toast(`你不在的时候苦力怕来过，炸掉了待领取的 ${money(state.drained)}`, 'bad')
  setMe(state.me)
  store.set(blockedAtom, state.blocked)
  const merge = mergeState(store.get(gameAtom), state.game, ahead)
  if (merge) commit(merge)
}

/** 按序号补上漏的（连上推送时、序号一直接不上时）；同一时间只补一次。 */
function catchUp(): Promise<void> {
  if (!api) return Promise.resolve()
  const game = store.get(gameAtom)
  catching ??= (async () => {
    try {
      const answer = game ? await api!.since(game.seq) : await api!.state()
      if ('state' in answer) acceptState(answer.state)
      else if ('messages' in answer) applyLive(answer.messages)
      else acceptState(answer)
    } catch {
      // 下次推送或重连时再补
    }
  })().finally(() => {
    catching = null
    if (ahead.size > 0 && gapTimer === undefined) gapTimer = setTimeout(() => {
      gapTimer = undefined
      if (ahead.size > 0) void catchUp()
    }, GAP_WAIT_MS)
  })
  return catching
}

/**
 * 实时推送：攒到下一帧一起放进去（几十个人一起挖时一秒几十条，一条一渲染手机跟不上）。
 * 网页在后台时动画帧不跑，另有一个定时器兜底。
 */
let liveQueue: Live[] = []
let liveFrame = 0
let liveTimer: ReturnType<typeof setTimeout> | undefined
function onLive(message: Live) {
  liveQueue.push(message)
  if (liveFrame) return
  liveFrame = requestAnimationFrame(flushLive)
  liveTimer = setTimeout(flushLive, 150)
}

function flushLive() {
  cancelAnimationFrame(liveFrame)
  clearTimeout(liveTimer)
  liveFrame = 0
  const queue = liveQueue
  liveQueue = []
  if (queue.length > 0) applyLive(queue)
}

function applyLive(messages: Live[]) {
  const game = store.get(gameAtom)
  if (game) commit(mergeLive(game, ahead, messages))
  const uid = store.get(uidAtom)
  if (messages.some(message => message.type === 'drain' && uid !== null && message.uids.includes(uid))) drainedMe()
}

/**
 * 推送说自己在不在的时候被苦力怕炸了：重新要一次自己的，说一声炸掉了多少。网页在后台时等回到前台再要
 * （要一次就算动了一下，后台里一直要会让游戏站的计时一直重来）。
 */
let drainWaiting = false
function drainedMe() {
  if (document.visibilityState !== 'visible') {
    if (drainWaiting) return
    drainWaiting = true
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      document.removeEventListener('visibilitychange', onVisible)
      drainWaiting = false
      drainedMe()
    }
    document.addEventListener('visibilitychange', onVisible)
    return
  }
  const before = store.get(meAtom)?.points ?? 0
  void api?.state().then(state => {
    acceptState(state)
    const lost = before - state.me.points
    if (lost > 0 && !state.drained) toast(`你不在的时候苦力怕来过，炸掉了待领取的 ${money(lost)}`, 'bad')
  }, () => {})
}

/** 奖池分完：手里有分的自动领；没有分的只说游戏结束了，不领（领了也是 0）。 */
function gameOver() {
  const me = store.get(meAtom)
  if (!me || me.status !== 'playing') return
  if (totalOf(me) > 0) {
    store.set(blockedAtom, '奖池已经分完，游戏结束了，请领取')
    void claim(true)
    return
  }
  store.set(blockedAtom, '奖池已经分完，游戏结束了')
  if (me.digs > 0) showEnd()
}

/**
 * 最后一下之前问一句（docs/V3_ITEMS.md §13）：这一下挖完这一局就挖不动了，手里还有钥匙、望远镜、火把、藏宝图
 * 没用，就先弹“最后一下了”，选“这就是最后一舞”才挖。问了返回 true。
 */
function askLast(me: Me, by: 'pickaxe' | Shape, go: () => void) {
  if (!isLastDig(me, by)) return false
  const slots = leftoversOf(me)
  if (slots.length === 0) return false
  store.set(dialogAtom, { type: 'last', slots, go })
  return true
}

/**
 * 挖一格。上一格还在挖（回答没到）时不发：两次至少隔 1 秒，发了也是被拒。间隔拉长了
 * （3 秒以上）没到时间就说还要等几秒；间隔 1 秒时差一点点就到点，镐子先挥着，到点再发。
 */
export async function dig(cardId: number, index: number, sure = false) {
  const cell = key(cardId, index)
  if (!api) return
  const pending = store.get(pendingAtom)
  if (pending[cell]) return
  const blocked = store.get(blockedAtom)
  if (blocked) {
    toast(blocked)
    return
  }
  if (Object.keys(pending).length > 0) {
    toast('上一格还在挖，稍等一下')
    return
  }
  const me = store.get(meAtom)
  if (me && me.chances <= 0) {
    toast('镐子用完了，还能用附魔镐')
    return
  }
  if (me && !sure && askLast(me, 'pickaxe', () => void dig(cardId, index, true))) return
  const wait = store.get(readyAtAtom) - Date.now()
  // 间隔拉长的局、被蜘蛛网缠着时：说还要等多久（间隔 1 秒的局平时悄悄等那一下）
  if (wait > 0 && ((store.get(gameAtom)?.rules.digInterval ?? 1) > 1 || store.get(slowUntilAtom) > 0)) {
    toast(`还要等 ${Math.ceil(wait / 1000)} 秒才能再挖`)
    return
  }
  store.set(pendingAtom, value => ({ ...value, [cell]: true }))
  try {
    if (wait > 0) await new Promise(resolve => window.setTimeout(resolve, wait))
    play('dig')
    const answer = await api.dig(cardId, index)
    setMe(answer.me)
    if (answer.blocked !== undefined) store.set(blockedAtom, answer.blocked)
    if (!answer.ok) {
      toast(answer.message)
      // 格子被别人先挖了之类：只把这张卡换成游戏站上现在的样子，不重读整局
      const game = store.get(gameAtom)
      if (answer.card && game) commit(mergeCard(game, answer.card))
      return
    }
    // 先接上攒着的推送，再放自己这次的：格子马上翻开，序号接不上也不等
    flushLive()
    applyLive([answer.update])
    addFresh({ [cell]: { mine: true, at: Date.now(), result: answer.result } })
    const sound = soundOfResult(answer.result)
    if (sound) play(sound)
    if (answer.result.kind === 'pearl' && answer.result.newCardId !== null) {
      play('throw', { delay: 250 })
      play('teleport', { delay: landMs('pearl') })
    }
    if (answer.result.kind === 'eye' && answer.result.newCardId !== null) {
      play('eye', { delay: 250 })
      play('portal', { delay: landMs('eye') })
    }
    if (answer.claimNow) window.setTimeout(() => void claim(true), 1200)
    // 机会用完、手里没有分：这一局对他结束了
    else if (outOfPicks(answer.me) && totalOf(answer.me) <= 0) window.setTimeout(showEnd, 1200)
  } catch (error) {
    toast(error instanceof ApiError ? error.message : '没挖成，稍后再试', 'bad')
  } finally {
    store.set(pendingAtom, value => {
      const next = { ...value }
      delete next[cell]
      return next
    })
  }
}

/**
 * 用道具（docs/V3_ITEMS.md §4）：望远镜、火把、附魔镐、钥匙点格子；藏宝图、药水、末影箱确认了就用；
 * 附魔台带上挑的形状。不花镐子的机会。用完（或者手里没有了）放下；没用成照旧拿着，换一处再点。
 */
let using = false
export async function applyItem(item: string, body: { cardId?: number; index?: number; choice?: Shape } = {}, sure = false) {
  if (!api || using) return false
  const blocked = store.get(blockedAtom)
  if (blocked) {
    toast(blocked)
    putDown()
    return false
  }
  const digs = item.startsWith('pick-')
  const me = store.get(meAtom)
  if (digs && me && !sure && askLast(me, item.slice(5) as Shape, () => void applyItem(item, body, true))) return false
  const wait = store.get(readyAtAtom) - Date.now()
  if (digs && wait > 0 && ((store.get(gameAtom)?.rules.digInterval ?? 1) > 1 || store.get(slowUntilAtom) > 0)) {
    toast(`还要等 ${Math.ceil(wait / 1000)} 秒才能再挖`)
    return false
  }
  using = true
  const cell = body.cardId !== undefined && body.index !== undefined ? key(body.cardId, body.index) : null
  if (digs && cell) store.set(pendingAtom, value => ({ ...value, [cell]: true }))
  try {
    if (digs && wait > 0) await new Promise(resolve => window.setTimeout(resolve, wait))
    if (digs) play('dig')
    const answer = await api.use({ item, ...body })
    setMe(answer.me)
    if (answer.blocked !== undefined) store.set(blockedAtom, answer.blocked)
    if (!answer.ok) {
      toast(answer.message)
      const game = store.get(gameAtom)
      if (answer.card && game) commit(mergeCard(game, answer.card))
      return false
    }
    putDown()
    // 附魔镐挖开的格子：一格一条，先接上攒着的推送再放
    if (answer.updates?.length) {
      flushLive()
      applyLive(answer.updates)
      const now = Date.now()
      const fresh: Record<string, { mine: boolean; at: number; result?: DigResult }> = {}
      for (const result of answer.results ?? []) fresh[key(result.cardId, result.index)] = { mine: true, at: now, result }
      addFresh(fresh)
      const worst = (answer.results ?? []).map(soundOfResult).find(sound => sound === 'tnt' || sound === 'crystal' || sound === 'block')
      const best = (answer.results ?? []).map(soundOfResult).find(Boolean)
      const sound = worst ?? best
      if (sound) play(sound)
    }
    const game = store.get(gameAtom)
    if (answer.card && game) commit(mergeCard(game, answer.card))
    if (item === 'spyglass') play('spyglass')
    else if (item === 'ender') play('chest')
    else if (item === 'table') play('enchant')
    else if (item === 'key') play('vault')
    else if (item === 'torch' || item === 'potion' || item === 'map') play('click')
    if (answer.peek) {
      store.set(peekedAtom, { cell: key(answer.peek.cardId, answer.peek.index), at: Date.now() })
      // 藏宝图：镜头飞到那一格
      if (item === 'map') store.set(focusRequestAtom, { cardId: answer.peek.cardId, at: Date.now(), dig: true })
    }
    if (item === 'ender') store.set(chestNoteAtom, Date.now())
    if (item === 'key') {
      const reward = answer.reward?.kind
      store.set(dialogAtom, { type: 'vault', text: answer.text ?? '宝库开了', kind: reward === 'small' ? 'emerald' : reward ?? null })
    }
    else if (answer.text && !answer.updates?.length && item !== 'spyglass' && item !== 'map' && item !== 'ender') toast(answer.text, 'good')
    // 最后再改奖池还剩多少（附魔镐每格的推送里是那一格当时的数）
    setLeft(answer.left)
    if (answer.claimNow) window.setTimeout(() => void claim(true), 1200)
    else if (digs && outOfPicks(answer.me) && totalOf(answer.me) <= 0) window.setTimeout(showEnd, 1200)
    return true
  } catch (error) {
    toast(error instanceof ApiError ? error.message : '没用成，稍后再试', 'bad')
    return false
  } finally {
    using = false
    if (digs && cell) store.set(pendingAtom, value => {
      const next = { ...value }
      delete next[cell]
      return next
    })
  }
}

/** 奖池还剩多少：末影箱毁掉的、中毒和苦力怕扣的回到奖池，游戏站不推送，从回答里改。 */
function setLeft(left: number | undefined) {
  const game = store.get(gameAtom)
  if (left !== undefined && game && game.left !== left) store.set(gameAtom, { ...game, left })
}

/** 苦力怕倒数完了：游戏站核对时间，炸掉手上的 20%。 */
export async function creeperBoom() {
  if (!api) return null
  try {
    const answer = await api.creeper()
    setMe(answer.me)
    if (answer.ok) setLeft(answer.left)
    return answer.ok ? answer.lost : null
  } catch {
    return null
  }
}

/**
 * 领取：游戏站签凭证，网页交给判定器（hb.submit）。交不上就填进指令框，
 * 他自己点提交。auto 是机会用完、预算分完、快截止时自动领的。
 */
export async function claim(auto = false) {
  if (!api || store.get(claimingAtom) === 'working' || store.get(settledAtom)) return
  const me = store.get(meAtom)
  // 手里没有分不领：交上去只会在红包里记一笔“领取 0.00”
  if (me && me.status === 'playing' && totalOf(me) <= 0) {
    if (!auto) toast('手里还没有奖励，不用领取')
    return
  }
  if (auto) {
    if (autoClaimed) return
    autoClaimed = true
  }
  store.set(claimingAtom, 'working')
  try {
    const answer = await api.claim()
    setMe(answer.me)
    if (!answer.ok) {
      toast(answer.message, 'bad')
      store.set(claimingAtom, 'idle')
      return
    }
    const result = await hb.submit(answer.voucher)
    if (result.judged && result.claimed) {
      store.set(settledAtom, { amount: result.amount, unit: result.unit })
      store.set(claimingAtom, 'done')
      play('claim')
      showEnd()
      return
    }
    if (result.judged) {
      toast(result.reply ?? '没领到', 'bad')
      store.set(claimingAtom, 'idle')
      return
    }
    // 没交上（没允许、正忙、冷却……）：填进指令框，让他自己点
    const filled = await hb.fill(answer.voucher).catch(() => ({ filled: false as const }))
    store.set(claimingAtom, filled.filled ? 'filled' : 'idle')
    toast(filled.filled ? `领取凭证（${money(answer.points)}）已填进指令框，点「提交」领取` : (result.message ?? '没交上，再点一次「领取」'), filled.filled ? 'info' : 'bad')
  } catch (error) {
    toast(error instanceof Error ? error.message : '没领成，再试一次', 'bad')
    store.set(claimingAtom, 'idle')
  }
}

/** 截止前 2 分钟停止挖掘：开着网页的人自动领。 */
function checkWrapUp() {
  const game = store.get(gameAtom)
  const me = store.get(meAtom)
  if (!game || !me || me.status !== 'playing' || game.wrapUpAt === null) return
  if (hb.now() >= game.wrapUpAt) {
    if (!store.get(blockedAtom)) store.set(blockedAtom, totalOf(me) > 0 ? '快截止了，已经停止挖掘，请领取' : '快截止了，已经停止挖掘')
    if (totalOf(me) > 0) void claim(true)
  }
}

export function stop() {
  stopLive?.()
  stopLive = null
  clearTimeout(gapTimer)
  gapTimer = undefined
}
