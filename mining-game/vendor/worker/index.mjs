// 矿洞夺宝的游戏站（docs/V3_MAP.md §7）：hbweb-kddb.lafi.sh。
// 根路径照旧是 v2 的网页（开着的红包还在用），v3 的网页在 /v3/，接口在 /v3/api/，
// 和网页同源。每个红包一个 Durable Object（按红包编号起名，放亚太）；指针、谁在看、表情另开一个
// （PresenceObject，docs/V3_ITEMS.md §20），挖格子的房间不受影响。
//
// 环境变量：HB_ORIGIN（红包站，本地是开发包模拟器 http://127.0.0.1:8730）、
// PAGE_ORIGIN（这个网页的来源，令牌的 aud）、JUDGE_ID、MIN_JUDGE_VERSION（只认 v3
// 起的判定器版本）、CLAIM_KID。Secrets：CLAIM_KEY（签凭证的私钥 JWK）、TICKET_KEY（票据和
// nonce 的 HMAC 密钥），BOT_KEY（只在 Stage：压测机器人的钥匙，见 bots.mjs）。

import { DurableObject } from "cloudflare:workers";
import { signVoucher } from "../shared/voucher.mjs";
import { makeNonce, makeTicket, nonceValid, readTicket, TICKET_TTL_MS, verifyIdentity } from "./auth.mjs";
import { pageFrom } from "./page.mjs";
import { BOT_BASE, BOT_DIGS_MAX, botKeyValid } from "./bots.mjs";
import { PresenceRoom, SWEEP_QUIET_MS } from "./presence.mjs";
import { LivePushes } from "./push.mjs";
import { MineRoom, RoomError } from "./room.mjs";
import { inScope, outOfScope } from "./scope.mjs";

/**
 * @typedef {{
 *   HB_ORIGIN: string, PAGE_ORIGIN: string, JUDGE_ID: string, MIN_JUDGE_VERSION: string,
 *   CLAIM_KID: string, CLAIM_KEY: string, TICKET_KEY: string, LOCAL_SEED?: string, BOT_KEY?: string,
 *   MINE: DurableObjectNamespace<MineObject>, PRESENCE: DurableObjectNamespace<PresenceObject>, ASSETS: Fetcher,
 * }} Env
 */

const HONGBAO_ID = /^[A-Za-z0-9_-]{1,64}$/;
const INFO_TTL_MS = 30_000;
/** 过了 30 秒、还不到 5 分钟的红包信息：先用着，后台去读新的（挖的人不等红包站） */
const INFO_STALE_MS = 5 * 60_000;

const json = (/** @type {unknown} */ body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/**
 * 线上网页和接口同源，用不上跨域。本地联调时网页从开发包的模拟器
 * （http://localhost:8731）发出，接口在 wrangler dev 上：只对 PAGE_ORIGIN 放开。
 * @param {Request} request @param {Env} env @param {Response} response
 */
function withCors(request, env, response) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== env.PAGE_ORIGIN || origin === new URL(request.url).origin) return response;
  const out = new Response(response.body, response);
  out.headers.set("Access-Control-Allow-Origin", origin);
  out.headers.set("Vary", "Origin");
  return out;
}

export default {
  /** @param {Request} request @param {Env} env */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/v3") return Response.redirect(`${url.origin}/v3/${url.search}`, 301);
    if (url.pathname === "/v3/") return pageFrom(await env.ASSETS.fetch(request), env.HB_ORIGIN);
    if (!url.pathname.startsWith("/v3/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS")
      return withCors(request, env, new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "600",
        },
      }));
    const hongbao = url.searchParams.get("hb") ?? "";
    if (!HONGBAO_ID.test(hongbao)) return withCors(request, env, json({ message: "没有红包编号" }, 400));
    // 两条实时连接：票据先在这里验，验不过的不进房间（Cloudflare 的建议，省一次房间请求）
    if (url.pathname === "/v3/api/live" || url.pathname === "/v3/api/presence") {
      const who = await socketWho(request, url, env, hongbao);
      if (!who) return withCors(request, env, json({ message: "票据过期了" }, 401));
      if (request.headers.get("Upgrade") !== "websocket") return withCors(request, env, json({ message: "要用 WebSocket" }, 426));
      if (url.pathname === "/v3/api/presence") {
        const room = env.PRESENCE.get(env.PRESENCE.idFromName(hongbao), { locationHint: "apac" });
        // 只带验过的这几样进去：网页自己带的头一概不转
        return room.fetch(new Request(url, { headers: { Upgrade: "websocket", "X-Uid": String(who.uid), "X-Name": encodeURIComponent(who.name) } }));
      }
    }
    const stub = env.MINE.get(env.MINE.idFromName(hongbao), { locationHint: "apac" });
    const response = await stub.fetch(request);
    return response.status === 101 ? response : withCors(request, env, response);
  },
};

/**
 * 实时连接是谁：票据里的人。Stage 上压测的机器人（带 BOT_KEY，只连 presence）是“机器人 N”。
 * @param {Request} request @param {URL} url @param {Env} env @param {string} hongbao
 * @returns {Promise<{ uid: number, name: string }|null>}
 */
async function socketWho(request, url, env, hongbao) {
  if (url.pathname === "/v3/api/presence" && botKeyValid(request.headers.get("X-Bot-Key"), env.BOT_KEY)) {
    const n = Math.floor(Number(url.searchParams.get("bot")));
    return Number.isSafeInteger(n) && n >= 0 && n < 100_000 ? { uid: BOT_BASE + n, name: `机器人 ${n}` } : null;
  }
  return readTicket(env.TICKET_KEY, url.searchParams.get("ticket") ?? "", hongbao, Date.now());
}

export class MineObject extends DurableObject {
  /** @type {{ info: import("./room.mjs").Info, at: number }|null} */
  infoKept = null;
  /** @type {Promise<import("./room.mjs").Info>|null} 正在读的红包信息（同时来的请求共用这一次） */
  infoLoading = null;
  /** 推给开着的网页的，攒 100 毫秒发一次 */
  pushes = new LivePushes((out) => this.sendLive(out));

  /** @param {DurableObjectState} ctx @param {Env} env */
  constructor(ctx, env) {
    super(ctx, env);
    /** @type {Env} */
    this.env = env;
    this.room = new MineRoom(/** @type {import("./room.mjs").Storage} */ (/** @type {unknown} */ (ctx.storage)), {
      // LOCAL_SEED 只在本地联调里有（wrangler.jsonc 的 env.local），线上每局随机
      seed: () => env.LOCAL_SEED || [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      sign: async (fields) => signVoucher({ ...fields, kid: env.CLAIM_KID }, JSON.parse(env.CLAIM_KEY)),
      // 不领的人的闹钟（docs/V3_ITEMS.md §9）：每个红包一个
      alarm: { get: () => ctx.storage.getAlarm(), set: (at) => ctx.storage.setAlarm(at) },
    });
  }

  /** 这个对象是哪个红包的（闹钟醒来时要读红包信息）：第一次知道时存下。 */
  hongbaoKept = "";

  async keepHongbao(/** @type {string} */ hongbao) {
    if (!hongbao || this.hongbaoKept === hongbao) return;
    if ((await this.ctx.storage.get("hongbao")) !== hongbao) await this.ctx.storage.put("hongbao", hongbao);
    this.hongbaoKept = hongbao;
  }

  /** 闹钟：把到点的不领的人该炸的算掉，奖池变了推给大家（room.alarm 自己定下一次）。 */
  async alarm() {
    const hongbao = /** @type {string|undefined} */ (await this.ctx.storage.get("hongbao"));
    if (!hongbao) return;
    try {
      const out = await this.room.alarm(await this.info(hongbao), Date.now());
      if (out.drained.length > 0) this.pushes.push({ type: "drain", uids: out.drained, left: out.left, over: out.over });
    } catch (error) {
      // 红包站读不到：5 分钟后再来
      console.error("mine_alarm", { error: String(error) });
      await this.ctx.storage.setAlarm(Date.now() + 5 * 60_000);
    }
  }

  /** @param {Request} request */
  async fetch(request) {
    const hongbao = new URL(request.url).searchParams.get("hb") ?? "";
    const response = await this.handle(request);
    // 不领的人回来时被炸了：奖池变了，推给大家
    for (const message of this.room.takeOutbox()) this.pushes.push(message);
    if (response.status < 400 && hongbao && !this.hongbaoKept) await this.keepHongbao(hongbao).catch(() => {});
    return response;
  }

  /**
   * 红包信息：30 秒内用上次的；30 秒到 5 分钟先用上次的、后台读新的；再旧的等读完。
   * 同时要的共用一次读（以前每 30 秒那一下，正在挖的人都要等红包站、各读一遍）。
   */
  async info(/** @type {string} */ hongbao) {
    const kept = this.infoKept;
    const age = kept ? Date.now() - kept.at : Infinity;
    if (kept && age < INFO_TTL_MS) return kept.info;
    const loading = (this.infoLoading ??= this.loadInfo(hongbao).finally(() => {
      this.infoLoading = null;
    }));
    if (kept && age < INFO_STALE_MS) {
      this.ctx.waitUntil(loading.catch(() => {}));
      return kept.info;
    }
    return loading;
  }

  /** 读一次红包信息；读不到用上次的；从没读到过就请他稍后再试。 */
  async loadInfo(/** @type {string} */ hongbao) {
    const now = Date.now();
    try {
      const response = await fetch(`${this.env.HB_ORIGIN}/api/hongbao/${encodeURIComponent(hongbao)}`);
      if (response.ok) {
        this.infoKept = { info: await response.json(), at: now };
        return this.infoKept.info;
      }
      if (response.status === 404 && !this.infoKept) throw new RoomError(404, "没有这个红包");
    } catch (error) {
      if (error instanceof RoomError) throw error;
    }
    if (this.infoKept) return this.infoKept.info;
    throw new RoomError(503, "红包站暂时读不到，稍后再试");
  }

  /** 票据里的人；没有或过期就是 null。 */
  async ticketOf(/** @type {string|null} */ text, /** @type {string} */ hongbao) {
    if (!text) return null;
    return readTicket(this.env.TICKET_KEY, text.replace(/^Ticket /, ""), hongbao, Date.now());
  }

  /** @param {Request} request */
  async handle(request) {
    const url = new URL(request.url);
    const hongbao = url.searchParams.get("hb") ?? "";
    const route = `${request.method} ${url.pathname.slice("/v3/api".length)}`;
    try {
      if (route === "GET /nonce")
        return json({ nonce: await makeNonce(this.env.TICKET_KEY, hongbao, Date.now()) });

      if (route === "POST /hello") {
        const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
        const now = Date.now();
        const identity = await verifyIdentity(token, {
          site: this.env.HB_ORIGIN,
          page: this.env.PAGE_ORIGIN,
          judgeId: this.env.JUDGE_ID,
          minJudgeVersion: Number(this.env.MIN_JUDGE_VERSION),
          hongbao,
          now,
        });
        if (!identity) return json({ message: "认不出你，请重新打开矿洞夺宝" }, 401);
        if (!identity.nonce || !(await nonceValid(this.env.TICKET_KEY, hongbao, identity.nonce, now)) || !(await this.room.takeNonce(identity.nonce, now)))
          return json({ message: "这次认人过期了，请重新打开矿洞夺宝" }, 401);
        const uid = Number(identity.sub);
        const name = identity.username;
        const info = await this.info(hongbao);
        // 不在领取范围的人不给票据：挖到的分领不了，还占奖池（网页也会先看 hb.me() 拦下）
        if (!inScope(info.scope, { username: identity.username, level: identity.level }))
          return json({ message: outOfScope(/** @type {import("./scope.mjs").Scope} */ (info.scope)), out: true }, 403);
        const ticket = await makeTicket(this.env.TICKET_KEY, { uid, name, hongbao, exp: now + TICKET_TTL_MS });
        return json({ ticket, uid, ...(await this.room.state(info, uid, name, now)) });
      }

      if (route === "GET /live") {
        const who = await this.ticketOf(url.searchParams.get("ticket"), hongbao);
        if (!who) return json({ message: "票据过期了" }, 401);
        if (request.headers.get("Upgrade") !== "websocket") return json({ message: "要用 WebSocket" }, 426);
        const pair = new WebSocketPair();
        // v=2 的网页收第 2 版推送（只有变了的那一格），别的照旧收整张卡
        this.ctx.acceptWebSocket(pair[1], url.searchParams.get("v") === "2" ? [String(who.uid), "v2"] : [String(who.uid)]);
        return new Response(null, { status: 101, webSocket: pair[0] });
      }

      // Stage 压测：机器人挖 count 格（只有设了 BOT_KEY 的环境有）
      if (route === "POST /bots") {
        if (!botKeyValid(request.headers.get("X-Bot-Key"), this.env.BOT_KEY)) return json({ message: "没有这个接口" }, 404);
        const body = /** @type {{ count?: unknown }} */ (await request.json().catch(() => ({})));
        const count = Math.min(BOT_DIGS_MAX, Math.max(1, Math.floor(Number(body.count)) || 1));
        const { pushes, ...out } = await this.room.botDigs(await this.info(hongbao), count, Date.now());
        for (const [broadcast, cell] of pushes) this.pushes.push(broadcast, cell);
        return json(out);
      }

      const who = await this.ticketOf(request.headers.get("Authorization"), hongbao);
      if (!who) return json({ message: "票据过期了，请重新打开矿洞夺宝" }, 401);
      const info = await this.info(hongbao);

      if (route === "GET /state") return json(await this.room.state(info, who.uid, who.name, Date.now()));

      if (route === "GET /summary") return json(await this.room.summary(info, who.uid, who.name));

      // 漏了几条推送：按序号补（内存里没有了就给整局）
      if (route === "GET /since") {
        const seq = Number(url.searchParams.get("seq"));
        if (!Number.isSafeInteger(seq) || seq < 0) return json({ message: "序号不对" }, 400);
        return json(await this.room.since(info, who.uid, who.name, seq, Date.now()));
      }

      if (route === "POST /dig") {
        const body = /** @type {{ cardId?: unknown, index?: unknown, v?: unknown }} */ (await request.json().catch(() => ({})));
        const cardId = Number(body.cardId);
        const index = Number(body.index);
        if (!Number.isSafeInteger(cardId) || !Number.isSafeInteger(index)) return json({ message: "格子不对" }, 400);
        const { answer, broadcast, cell } = await this.room.dig(info, who.uid, who.name, { cardId, index }, Date.now(), { compact: body.v === 2 });
        if (broadcast) this.pushes.push(broadcast, cell);
        return json(answer);
      }

      // 用道具（新局的道具栏，docs/V3_ITEMS.md §4）：{ item, cardId?, index?, choice? }。附魔镐挖开的
      // 格子、火把和宝库改了的卡推给大家，别的只改自己的
      if (route === "POST /use") {
        const body = /** @type {{ item?: unknown, cardId?: unknown, index?: unknown, choice?: unknown }} */ (await request.json().catch(() => ({})));
        const number = (/** @type {unknown} */ value) => (value == null ? undefined : Number(value));
        const cardId = number(body.cardId);
        const index = number(body.index);
        if (typeof body.item !== "string" || [cardId, index].some((value) => value !== undefined && !Number.isSafeInteger(value))
          || (body.choice != null && typeof body.choice !== "string"))
          return json({ message: "道具或格子不对" }, 400);
        const { answer, pushes } = await this.room.use(info, who.uid, who.name, {
          item: body.item, cardId, index, ...(typeof body.choice === "string" ? { choice: body.choice } : {}),
        }, Date.now());
        for (const [v1, v2] of pushes) this.pushes.push(v1, v2);
        return json(answer);
      }

      // 苦力怕：网页倒数到点时发，游戏站核对时间再扣（docs/V3_ITEMS.md §3）
      if (route === "POST /creeper") return json(await this.room.creeper(info, who.uid, who.name, Date.now()));

      if (route === "POST /claim") {
        const { answer, broadcast } = await this.room.claim(info, who.uid, who.name, Date.now());
        if (broadcast) this.pushes.push(broadcast);
        return json(answer);
      }

      return json({ message: "没有这个接口" }, 404);
    } catch (error) {
      if (error instanceof RoomError) return json({ message: error.message }, error.status);
      console.error("mine_error", { route, error: String(error) });
      return json({ message: "游戏站出了点问题，稍后再试" }, 500);
    }
  }

  /**
   * 攒下的推送发给所有开着的网页：带 v2 标记的收一个数组（一次 send），别的一条一条收第 1 版。
   * @param {{ v1: Record<string, unknown>[], v2: Record<string, unknown>[] }} out
   */
  sendLive(out) {
    /** @type {string|undefined} */
    let batch;
    /** @type {string[]|undefined} */
    let singles;
    for (const socket of this.ctx.getWebSockets()) {
      try {
        if (this.ctx.getTags(socket).includes("v2")) socket.send((batch ??= JSON.stringify(out.v2)));
        else for (const text of (singles ??= out.v1.map((message) => JSON.stringify(message)))) socket.send(text);
      } catch {
        // 已经断了，网页会重连、补上漏的
      }
    }
  }

  /** 网页只听不说：它说什么都不理，心跳由浏览器和平台管。 */
  async webSocketMessage() {}

  async webSocketClose(/** @type {WebSocket} */ socket, /** @type {number} */ code) {
    try {
      socket.close(code, "bye");
    } catch {
      // 已经关了
    }
  }
}

/**
 * 在场的房间（docs/V3_ITEMS.md §20）：别人的指针、谁在看哪张卡、表情。逻辑在 presence.mjs；这里收发、
 * 睡醒时把连接上存的座位找回来、查心跳没了的人（有人说话时顺手查，最多一分钟一次；没人说话时闹钟十分钟一次）。
 * 网页的心跳 "ping" 由平台自动回 "pong"，不叫醒房间；没人说话时房间睡着，不收时长费。
 */
export class PresenceObject extends DurableObject {
  /** @param {DurableObjectState} ctx @param {Env} env */
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.room = new PresenceRoom({ save: (conn, seat) => /** @type {WebSocket} */ (/** @type {unknown} */ (conn)).serializeAttachment(seat) });
    for (const socket of ctx.getWebSockets()) {
      const seat = socket.deserializeAttachment();
      if (seat) this.room.restore(socket, seat);
    }
  }

  /** 只从上面的 Worker 进来（验过票据，带着 X-Uid、X-Name）。 */
  async fetch(/** @type {Request} */ request) {
    if (request.headers.get("Upgrade") !== "websocket") return json({ message: "要用 WebSocket" }, 426);
    const uid = Number(request.headers.get("X-Uid"));
    const name = decodeURIComponent(request.headers.get("X-Name") ?? "");
    if (!Number.isSafeInteger(uid) || !name) return json({ message: "不认识你" }, 400);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    this.room.join(pair[1], { uid, name }, Date.now());
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_QUIET_MS);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(/** @type {WebSocket} */ socket, /** @type {string|ArrayBuffer} */ message) {
    const now = Date.now();
    this.room.message(socket, typeof message === "string" ? message : "", now);
    this.room.sweepSometimes(now, this.lastAlive);
  }

  /** 平台最后一次替这条连接自动回心跳的时刻（没有是 0）。 */
  lastAlive = (/** @type {import("./presence.mjs").Conn} */ conn) =>
    this.ctx.getWebSocketAutoResponseTimestamp(/** @type {WebSocket} */ (/** @type {unknown} */ (conn)))?.getTime() ?? 0;

  async webSocketClose(/** @type {WebSocket} */ socket, /** @type {number} */ code) {
    this.room.leave(socket);
    try {
      socket.close(code, "bye");
    } catch {
      // 已经关了
    }
  }

  async webSocketError(/** @type {WebSocket} */ socket) {
    this.room.leave(socket);
  }

  /** 没人说话时的兜底（十分钟一次）：心跳没了的人当作走了；还有人就再定一次。 */
  async alarm() {
    const now = Date.now();
    this.room.sweep(now, this.lastAlive);
    if (this.room.seats.size > 0) await this.ctx.storage.setAlarm(now + SWEEP_QUIET_MS);
  }
}
