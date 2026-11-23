// 本地账户版：把原版 hb SDK 换成我们自己的账户后端。
// 原版页面只用到这几个方法，这里保持同样的形状，让 page/frontend/v3 的源码不用大改。
// 身份来自同源的账户会话（HttpOnly Cookie），不再需要 hb.lafi.sh 的红包页。

export interface HbHongbao {
  id: string
  title: string
  url: string
  code: boolean
  status: 'draft' | 'active' | 'ended'
  endedByCode: boolean
  unit: string
  step: string
  points: { name: string; unit: string; host: string } | null
  shares: { total: number; claimed: number; remaining: number } | null
  pool: string | null
  unclaimed: string | null
  deadlineAt: string | null
  judged: number | null
  sender: { name: string; avatar: string | null }
  params: Record<string, unknown>
}

export interface HbMe {
  signedIn: boolean
  name?: string
  avatar?: string | null
  open?: boolean
  why?: 'not_open' | 'ended' | 'paused' | 'already_claimed' | 'not_in_scope'
  cooldownUntil?: number | null
  claim?: { amount: string; unit: string; payment: 'paid' | 'paying' | 'failed' | 'none' } | null
  registered?: boolean
  pending?: string | null
  settled?: boolean
  [key: string]: unknown
}

export interface HbIdentityFailure {
  identified: false
  reason: 'login' | 'denied' | 'away' | 'busy' | 'unavailable' | 'error'
  message?: string
}

export interface HbIdentitySuccess {
  identified: true
  token: string
  user: { id: string; username: string; name?: string; level: number | null }
}

export type HbSubmitResult =
  | { judged: true; claimed: boolean; amount: string; unit: string; reply?: string; pending: string; settled: boolean }
  | { judged: false; reason: string; message?: string; seconds?: number }

type Listener = (value: never) => void

const listeners = new Map<string, Set<Listener>>()
let clockOffset = 0
let hongbao: HbHongbao | null = null
let me: HbMe | null = null

/** 当前这一局：从地址栏的 ?round= 读，账户版一页一局。 */
function roundParam() {
  return new URL(location.href).searchParams.get('round') ?? ''
}

/** 所有请求都带上 round，服务端据此知道是哪一局。 */
function withRound(path: string) {
  const round = roundParam()
  if (!round) return path
  return `${path}${path.includes('?') ? '&' : '?'}round=${encodeURIComponent(round)}`
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(withRound(path), { credentials: 'same-origin', cache: 'no-store', ...init })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw Object.assign(new Error((data as { message?: string }).message ?? '请求失败'), {
      status: response.status,
      data,
    })
  }
  return data as T
}

function tell(kind: string, value: unknown) {
  for (const listener of listeners.get(kind) ?? []) {
    try {
      ;(listener as unknown as (value: unknown) => void)(value)
    } catch {
      // 一个监听器出错不影响别的
    }
  }
}

/** 轮询账户会话：页面里的“待领取”“奖池还剩”靠它刷新。 */
let pollTimer: number | undefined
function startPolling() {
  if (pollTimer !== undefined) return
  pollTimer = window.setInterval(async () => {
    try {
      const data = await getJson<{ me: HbMe; hongbao: HbHongbao }>('/api/hb/me')
      if (JSON.stringify(data.me) !== JSON.stringify(me)) {
        me = data.me
        tell('me', me)
      }
      if (data.hongbao && JSON.stringify(data.hongbao) !== JSON.stringify(hongbao)) {
        hongbao = data.hongbao
        tell('hongbao', hongbao)
      }
    } catch {
      // 掉线时下次再来
    }
  }, 2000)
}

export const hb = {
  now: () => Date.now() + clockOffset,

  async ready(): Promise<{ hongbao: HbHongbao; viewer: { signedIn: true; name: string; avatar: string | null }; theme: string }> {
    const data = await getJson<{
      hongbao: HbHongbao
      viewer: { signedIn: true; name: string; avatar: string | null }
      me: HbMe
      clock: number
      round?: { id: string }
    }>('/api/hb/ready')
    clockOffset = data.clock ?? 0
    hongbao = data.hongbao
    me = data.me
    // 地址栏没带 round 时（从大厅直接进），把服务端认的这一局写进地址，后续请求和刷新都跟着它
    if (!roundParam() && data.round?.id) {
      const url = new URL(location.href)
      url.searchParams.set('round', data.round.id)
      history.replaceState(null, '', url)
    }
    startPolling()
    return { hongbao: data.hongbao, viewer: data.viewer, theme: 'dark' }
  },

  on(kind: string, listener: (value: never) => void) {
    const set = listeners.get(kind) ?? new Set<Listener>()
    set.add(listener)
    listeners.set(kind, set)
    return () => set.delete(listener)
  },

  async me(): Promise<HbMe> {
    const data = await getJson<{ me: HbMe; hongbao: HbHongbao }>('/api/hb/me')
    me = data.me
    if (data.hongbao) hongbao = data.hongbao
    return me
  },

  async login() {
    // 账户版在进入游戏前已经登录过；这里只要回报当前状态。
    const data = await getJson<{ me: HbMe }>('/api/hb/me')
    return { signedIn: Boolean(data.me.signedIn) }
  },

  async identity({ nonce }: { nonce?: string } = {}): Promise<HbIdentitySuccess | HbIdentityFailure> {
    const query = nonce ? `?nonce=${encodeURIComponent(nonce)}` : ''
    try {
      const data = await getJson<{ token: string; user: HbIdentitySuccess['user'] }>(`/api/hb/identity${query}`)
      return { identified: true, token: data.token, user: data.user }
    } catch (error) {
      const status = (error as { status?: number }).status
      return {
        identified: false,
        reason: status === 401 ? 'login' : 'error',
        message: error instanceof Error ? error.message : undefined,
      }
    }
  },

  /** 领取：账户版由游戏服务直接入账，不需要再交凭证给判定器。 */
  async submit(input: string): Promise<HbSubmitResult> {
    const data = await getJson<{
      claimed: boolean
      amount: string
      unit: string
      reply?: string
      pending: string
      settled: boolean
    }>('/api/hb/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input }),
    })
    return {
      judged: true,
      claimed: data.claimed,
      amount: data.amount,
      unit: data.unit,
      ...(data.reply ? { reply: data.reply } : {}),
      pending: data.pending,
      settled: data.settled,
    }
  },

  async fill(_text: string) {
    return { filled: false as const, reason: 'no_input' as const }
  },

  async view() {
    return null
  },

  async myView() {
    return null
  },

  async mine() {
    return { items: [], nextCursor: null }
  },
}

export type Hb = typeof hb
