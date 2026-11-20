import assert from 'node:assert/strict'
import { after, before, mock, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// 实时连接重连前换票据（v3/src/api.ts live）：游戏站的票据管 2 小时，页面开着快 2 小时又断了线（游戏站发版），
// 以前一直拿过期票据重连（2026-11-11 生产上看到）。fetch、hb.identity、WebSocket 都是假的。
let server
let api
const fetched = []
const sockets = []
let identified = true

before(async () => {
  globalThis.window = { location: { href: 'https://game.test/v3/' } }
  globalThis.__API_BASE__ = '/v3/api/'
  globalThis.hb = { identity: async () => (identified ? { identified: true, token: 'tok' } : { identified: false, reason: 'away' }) }
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname.replace('/v3/api/', '')
    fetched.push(`${init.method ?? 'GET'} ${path}`)
    const data = path === 'nonce' ? { nonce: 'n' } : { ticket: `T${fetched.length}`, uid: 7 }
    return { ok: true, status: 200, json: async () => data }
  }
  globalThis.WebSocket = class {
    constructor(url) {
      this.url = new URL(url)
      sockets.push(this)
    }
    close() {}
  }
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  api = await server.ssrLoadModule('/v3/src/api.ts')
})
after(() => server.close())

const settle = async () => {
  for (let n = 0; n < 10; n++) await new Promise(resolve => setImmediate(resolve))
}

test('实时连接：票据还新就直接连；用了快 2 小时先重新认人换一张；认人失败 5 分钟后再试', async () => {
  const game = new api.GameApi('hb1')
  game.ticket = 'T0'
  game.ticketAt = Date.now() - 60 * 60_000
  let stop = game.live(() => {}, () => {})
  await settle()
  assert.deepEqual(fetched, [])
  assert.equal(sockets.at(-1).url.searchParams.get('ticket'), 'T0')
  stop()

  // 用了 111 分钟：先 nonce、hello，拿新票据连
  game.ticketAt = Date.now() - 111 * 60_000
  stop = game.live(() => {}, () => {})
  await settle()
  assert.deepEqual(fetched, ['GET nonce', 'POST hello'])
  assert.equal(sockets.length, 2)
  assert.equal(sockets.at(-1).url.searchParams.get('ticket'), game.ticket)
  assert.notEqual(game.ticket, 'T0')
  stop()

  // 认不出（不在红包页）：不连，5 分钟后再试
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    fetched.length = 0
    identified = false
    game.ticketAt = Date.now() - 3 * 60 * 60_000
    stop = game.live(() => {}, () => {})
    await settle()
    assert.deepEqual(fetched, ['GET nonce'])
    assert.equal(sockets.length, 2)
    identified = true
    mock.timers.tick(5 * 60_000 - 1)
    await settle()
    assert.equal(sockets.length, 2)
    mock.timers.tick(1)
    await settle()
    assert.equal(sockets.length, 3)
    assert.deepEqual(fetched, ['GET nonce', 'GET nonce', 'POST hello'])
    stop()
  } finally {
    mock.timers.reset()
  }
})
