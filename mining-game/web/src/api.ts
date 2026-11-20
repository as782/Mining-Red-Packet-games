import { liveMessages } from './live'
import type { DigResult, Live, LiveStep, Me, Peek, PublicCard, Shape, State, Summary } from './types'

declare const __API_BASE__: string

/** 游戏站的接口：线上同源 /v3/api/，开发包里是本机的 wrangler dev。 */
const BASE = new URL(__API_BASE__, window.location.href)

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** 游戏站的票据管 2 小时（game/worker/auth.mjs TICKET_TTL_MS）：用了这么久的，实时连接重连前先换一张。 */
const TICKET_FRESH_MS = 110 * 60_000
/** 重连前认人失败，过这么久再试（不频繁去问红包站）。 */
const REHELLO_MS = 5 * 60_000

/**
 * 认人（docs/V3_MAP.md §4）：要一个 nonce → hb.identity → /hello 换游戏站的票据。
 * 之后的请求都带票据；票据过期（401）时再走一遍，不会再问他。
 */
export class GameApi {
  ticket: string | null = null
  /** 这张票据什么时候拿到的（本机时间） */
  ticketAt = 0
  uid: number | null = null

  constructor(readonly hongbao: string) {}

  url(path: string) {
    const url = new URL(path, BASE)
    url.searchParams.set('hb', this.hongbao)
    return url
  }

  /** 正在认人的那一次：两条连接一起要换票据时共用（不问两次红包站） */
  private helloing: Promise<State> | null = null

  hello(): Promise<State> {
    this.helloing ??= this.helloOnce().finally(() => {
      this.helloing = null
    })
    return this.helloing
  }

  private async helloOnce(): Promise<State> {
    const { nonce } = await this.raw<{ nonce: string }>('GET', 'nonce')
    const identity = await hb.identity({ nonce })
    if (!identity.identified) throw new ApiError(401, identity.message ?? identityWords[identity.reason] ?? '身份确认失败，稍后再试')
    const answer = await this.raw<State & { ticket: string; uid: number }>('POST', 'hello', undefined, `Bearer ${identity.token}`)
    this.ticket = answer.ticket
    this.ticketAt = Date.now()
    this.uid = answer.uid
    return answer
  }

  private async raw<T>(method: 'GET' | 'POST', path: string, body?: unknown, authorization?: string): Promise<T> {
    let response: Response
    try {
      response = await fetch(this.url(path), {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(authorization ? { authorization } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiError(0, '连不上矿洞，检查一下网络')
    }
    const data = await response.json().catch(() => ({})) as T & { message?: string }
    if (!response.ok) throw new ApiError(response.status, data.message ?? '矿洞出了点问题，稍后再试')
    return data
  }

  /** 带票据的请求；票据过期就重新认人再来一次。 */
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.ticket) await this.hello()
    try {
      return await this.raw<T>(method, path, body, `Ticket ${this.ticket}`)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error
      await this.hello()
      return this.raw<T>(method, path, body, `Ticket ${this.ticket}`)
    }
  }

  state() {
    return this.call<State>('GET', 'state')
  }

  /** 收益卡：自己的逐格记录和数，全场前几名。 */
  summary() {
    return this.call<Summary>('GET', 'summary')
  }

  /**
   * 挖一格（v: 2：回答里的 update 是第 2 版，只有这一格）。没挖成时带着那张卡现在的样子；
   * blocked 是挖完以后为什么不能再挖（能挖时 null，不算间隔）。
   */
  dig(cardId: number, index: number) {
    return this.call<
      | { ok: true; result: DigResult; me: Me; claimNow: boolean; update: LiveStep; blocked?: string | null }
      | { ok: false; message: string; me: Me; card?: PublicCard; blocked?: string | null }
    >('POST', 'dig', { cardId, index, v: 2 })
  }

  /**
   * 用道具（docs/V3_ITEMS.md §4）。附魔镐挖开的格子在 updates 里（一格一条，第 2 版）、每格的结果
   * 在 results 里；望远镜、藏宝图看到的在 peek 里；火把、宝库变了的那张卡在 card 里。没用成时
   * 带着那张卡现在的样子。
   */
  use(body: { item: string; cardId?: number; index?: number; choice?: Shape }) {
    return this.call<
      | {
        ok: true; me: Me; blocked?: string | null; text?: string; claimNow?: boolean; left?: number
        updates?: LiveStep[]; results?: DigResult[]; peek?: Peek; card?: PublicCard
        reward?: { kind: 'small' | 'diamond' | 'table' | 'shield'; amount: number }
      }
      | { ok: false; message: string; me: Me; card?: PublicCard; blocked?: string | null }
    >('POST', 'use', body)
  }

  /** 苦力怕倒数完了：游戏站核对时间，扣掉手上的 20%（lost 是扣了多少）。 */
  creeper() {
    return this.call<{ ok: true; me: Me; lost: number; left?: number } | { ok: false; message: string; me: Me }>('POST', 'creeper', {})
  }

  /** 手上到第 seq 条，后面漏了：游戏站给漏的那几条，或者（太多、刚重启）给整局。 */
  since(seq: number) {
    return this.call<{ messages: LiveStep[] } | { state: State }>('GET', `since?seq=${seq}`)
  }

  claim() {
    return this.call<
      | { ok: true; voucher: string; points: number; me: Me }
      | { ok: false; message: string; me: Me }
    >('POST', 'claim')
  }

  /**
   * 实时推送：断了就退避重连，连上时 onOpen（网页借机按序号补上断开时漏的）。票据快过期了（页面开着
   * 快 2 小时，比如游戏站发版时连接断了）先重新认人换一张：以前拿着过期票据每 30 秒重连一次，一直 401，
   * 要等自己挖一下才好（2026-11-11 生产上看到 3 个人这样）。认人失败（不在红包页、没登录）5 分钟后再试。
   */
  live(onMessage: (message: Live) => void, onOpen: () => void) {
    return this.socket('live', { v: '2' }, text => {
      for (const message of liveMessages(text)) onMessage(message)
    }, onOpen).close
  }

  /**
   * 在场（docs/V3_ITEMS.md §20）：指针、谁在看、表情走另一个房间，和挖格子的推送分开。25 秒一次心跳
   * （游戏站的平台自动回，不叫醒房间），90 秒没有心跳的算走了。send 在没连上时返回 false。
   */
  presence(onText: (text: string) => void, onOpen: () => void, onClose: () => void) {
    return this.socket('presence', {}, text => {
      if (text !== 'pong') onText(text)
    }, onOpen, onClose, HEARTBEAT_MS)
  }

  /** 一条实时连接：断了退避重连；票据旧了先换；可以带心跳。 */
  private socket(path: string, params: Record<string, string>, onText: (text: string) => void, onOpen: () => void, onClose?: () => void, heartbeat = 0) {
    let socket: WebSocket | null = null
    let closed = false
    let delay = 1000
    let timer: ReturnType<typeof setTimeout> | undefined
    let beat: ReturnType<typeof setInterval> | undefined
    const retry = (after = delay) => {
      timer = setTimeout(() => void open(), after)
      delay = Math.min(delay * 2, 30_000)
    }
    const open = async () => {
      if (closed) return
      if (!this.ticket || Date.now() - this.ticketAt > TICKET_FRESH_MS) {
        try {
          await this.hello()
        } catch {
          retry(REHELLO_MS)
          return
        }
        if (closed) return
      }
      const ticket = this.ticket
      if (!ticket) return retry(REHELLO_MS)
      const url = this.url(path)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('ticket', ticket)
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
      const current = new WebSocket(url)
      socket = current
      current.onopen = () => {
        delay = 1000
        if (heartbeat) beat = setInterval(() => current.send('ping'), heartbeat)
        onOpen()
      }
      current.onmessage = event => onText(String(event.data))
      current.onclose = () => {
        clearInterval(beat)
        if (socket === current) socket = null
        onClose?.()
        if (!closed) retry()
      }
    }
    void open()
    return {
      send: (text: string) => {
        if (socket?.readyState !== 1) return false
        socket.send(text)
        return true
      },
      close: () => {
        closed = true
        clearTimeout(timer)
        clearInterval(beat)
        socket?.close()
      },
    }
  }
}

/** 在场那条连接的心跳。 */
const HEARTBEAT_MS = 25_000

const identityWords: Record<string, string> = {
  login: '登录以后才能挖',
  denied: '需要允许矿洞夺宝确认你的身份，才能记录奖励',
  away: '回到红包页再试一次',
  busy: '红包页正忙，稍后再试',
  unavailable: '暂时无法确认身份，稍后再试',
  error: '身份确认失败，稍后再试',
}
