import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromBase64url, makeNonce, makeTicket, nonceValid, NONCE_TTL_MS, readTicket, toBase64url, verifyIdentity } from "../worker/auth.mjs";
import { MineRoom } from "../worker/room.mjs";
import { signVoucher } from "../shared/voucher.mjs";
import { pageFrom, SDK_URL, withSdkFrom } from "../worker/page.mjs";
import { inScope, outOfScope } from "../worker/scope.mjs";
import { LivePushes, PUSH_EVERY_MS } from "../worker/push.mjs";
import { EMOTE_GAP_MS, FLUSH_MS, FOLLOW_MAX, PresenceRoom, SLOT_PX, STALE_MS, SWEEP_MS, SWEEP_QUIET_MS } from "../worker/presence.mjs";
import { readFileSync } from "node:fs";
import { BOT_BASE, botKeyValid } from "../worker/bots.mjs";
import { newCard } from "../shared/rules.mjs";

const SITE = "http://127.0.0.1:8730";
const PAGE = "http://127.0.0.1:8787";
const NOW = Date.parse("2026-11-06T12:00:00+08:00");
const encoder = new TextEncoder();

/** 一把只在测试里的钥匙，冒充红包站签令牌、游戏站签凭证。 */
async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    pair,
    publicJwk: { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "t1" },
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
}
const site = await keyPair();
const fetcher = /** @type {typeof fetch} */ (async () => new Response(JSON.stringify({ keys: [site.publicJwk] })));

async function token(/** @type {Record<string, unknown>} */ overrides = {}) {
  const header = toBase64url(encoder.encode(JSON.stringify({ alg: "ES256", kid: "t1", typ: "JWT" })));
  const claims = {
    iss: SITE, aud: PAGE, sub: "10001", username: "xiaoming", hongbao: "hb1",
    judge: "test", judgeVersion: 3, nonce: "n", iat: NOW / 1000, exp: NOW / 1000 + 600,
    ...overrides,
  };
  const body = toBase64url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, site.pair.privateKey, encoder.encode(`${header}.${body}`));
  return `${header}.${body}.${toBase64url(new Uint8Array(signature))}`;
}

const expect = { site: SITE, page: PAGE, judgeId: "test", minJudgeVersion: 3, hongbao: "hb1", now: NOW, fetcher };

describe("认人", () => {
  it("红包站签的、给这个网页、这个判定器和红包的令牌认得", async () => {
    const identity = await verifyIdentity(await token(), expect);
    assert.equal(identity?.sub, "10001");
  });
  it("别的来源、签发方、判定器、旧版本、别的红包、过期、改过的都不认", async () => {
    for (const overrides of [{ aud: "https://evil.example" }, { iss: `${SITE}/judge` }, { judge: "other" }, { judgeVersion: 2 }, { hongbao: "hb2" }, { exp: NOW / 1000 - 31 }]) {
      assert.equal(await verifyIdentity(await token(overrides), expect), null, JSON.stringify(overrides));
    }
    const good = await token();
    const [h, b, s] = good.split(".");
    const forged = toBase64url(encoder.encode(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(fromBase64url(b))), sub: "1" })));
    assert.equal(await verifyIdentity(`${h}.${forged}.${s}`, expect), null);
  });
  it("判定器编号可以是逗号隔开的几个：其中一个就认，空的不算", async () => {
    assert.equal((await verifyIdentity(await token(), { ...expect, judgeId: "other, test" }))?.sub, "10001");
    assert.equal(await verifyIdentity(await token(), { ...expect, judgeId: "other," }), null);
    assert.equal(await verifyIdentity(await token({ judge: "" }), { ...expect, judgeId: "test," }), null);
  });
  it("nonce 是这里发的才认，两分钟后过期，换个红包不认", async () => {
    const nonce = await makeNonce("k", "hb1", NOW);
    assert.match(nonce, /^[A-Za-z0-9_.~-]{8,128}$/);
    assert.equal(await nonceValid("k", "hb1", nonce, NOW + 1000), true);
    assert.equal(await nonceValid("k", "hb2", nonce, NOW + 1000), false);
    assert.equal(await nonceValid("k", "hb1", nonce, NOW + NONCE_TTL_MS + 1), false);
    assert.equal(await nonceValid("other", "hb1", nonce, NOW), false);
  });
  it("票据：同一个红包、没过期、没改过才认", async () => {
    const ticket = await makeTicket("k", { uid: 10001, name: "xiaoming", hongbao: "hb1", exp: NOW + 1000 });
    assert.equal((await readTicket("k", ticket, "hb1", NOW))?.uid, 10001);
    assert.equal(await readTicket("k", ticket, "hb2", NOW), null);
    assert.equal(await readTicket("k", ticket, "hb1", NOW + 1000), null);
    assert.equal(await readTicket("k", `${ticket}x`, "hb1", NOW), null);
  });
});

/** Durable Object 的 storage，放在一个 Map 里。 */
function memory() {
  const map = new Map();
  return {
    map,
    get: async (/** @type {string} */ key) => structuredClone(map.get(key)),
    put: async (/** @type {Record<string, unknown>} */ entries) => {
      for (const [key, value] of Object.entries(entries)) map.set(key, structuredClone(value));
    },
    list: async ({ prefix }) => new Map([...map].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])),
    delete: async (/** @type {string[]} */ keys) => keys.filter((key) => map.delete(key)).length,
  };
}

const claimKey = await keyPair();
const tools = {
  seed: () => "room-seed",
  sign: (/** @type {{ openedAt: number, id: number, points: number }} */ fields) => signVoucher({ ...fields, kid: "k1" }, claimKey.privateJwk),
};
/** @type {import("../worker/room.mjs").Info} */
const info = {
  id: "hb1", status: "active", paused: false,
  params: { boardSpec: "5", smallReward: 10, initialChances: 3 },
  unit: "LDC", pool: "100.00",
  openedAt: new Date(NOW - 3600_000).toISOString(),
  deadlineAt: new Date(NOW + 86400_000).toISOString(),
};

describe("一局", () => {
  it("第一次来就开局：一张卡、预算是奖池、参数照红包信息", async () => {
    const room = new MineRoom(memory(), tools);
    const { game, me } = await room.state(info, 10001, "xiaoming", NOW);
    assert.equal(game.cards.length, 1);
    assert.equal(game.pool, 10000);
    assert.equal(game.left, 10000);
    assert.equal(me.chances, 3);
  });
  it("三方积分红包（docs/V3_ITEMS.md §11）：预算按红包信息的 units（多少个最小单位），说的数按最小单位写", async () => {
    const points = { ...info, unit: "星星", pool: "2000", step: "1", units: { pool: 2000, unclaimed: 2000 } };
    const room = new MineRoom(memory(), tools);
    const { game } = await room.state(points, 10001, "xiaoming", NOW);
    assert.equal(game.pool, 2000);
    assert.equal(game.rules.step, "1");
    const { answer } = await room.dig(points, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    assert.equal(answer.ok, true);
    if (answer.result.amount > 0) assert.match(answer.result.text, new RegExp(`\\+${answer.result.amount}(?!\\.)`));
    // LDC 红包照旧：没有 step
    const plain = await new MineRoom(memory(), tools).state(info, 10001, "xiaoming", NOW);
    assert.equal(plain.game.rules.step, undefined);
  });
  it("挖一格：存下牌面、人和这一挖，推给大家的不带别人的私事", async () => {
    const storage = memory();
    const room = new MineRoom(storage, tools);
    const { answer, broadcast } = await room.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    assert.equal(answer.ok, true);
    assert.equal(broadcast?.type, "dig");
    assert.equal(broadcast?.seq, 1);
    assert.ok(storage.map.has("player:10001"));
    assert.deepEqual(storage.map.get("log:000000001"), { uid: 10001, cardId: 1, index: 0, at: NOW });
    assert.ok(!JSON.stringify(broadcast).includes("peeks"));
    assert.ok(!JSON.stringify(broadcast).includes("deck"));
  });
  it("用望远镜：存下自己的，不推送、不进动态；没用成时带上那张卡", async () => {
    const storage = memory();
    const room = new MineRoom(storage, tools);
    await room.state(info, 10001, "xiaoming", NOW);
    const player = await room.playerOf(/** @type {any} */ (room.game), 10001, "xiaoming");
    player.spyglasses = 1;
    const seq = room.game?.seq;
    const { answer, pushes } = await room.use(info, 10001, "xiaoming", { item: "spyglass", cardId: 1, index: 4 }, NOW);
    assert.equal(answer.ok, true);
    assert.deepEqual(pushes, []);
    assert.equal(/** @type {any} */ (answer.me).spyglasses, 0);
    assert.equal(/** @type {any} */ (answer.me).peeks.length, 1);
    assert.equal(/** @type {any} */ (storage.map.get("player:10001")).peeks.length, 1);
    assert.equal(room.game?.seq, seq);
    assert.equal(room.recent.length, 0);
    const { answer: again } = await room.use(info, 10001, "xiaoming", { item: "spyglass", cardId: 1, index: 5 }, NOW);
    assert.equal(again.ok, false);
    assert.equal(again.message, "你手里没有望远镜");
    assert.equal(/** @type {any} */ (again.card).id, 1);
  });
  it("重启以后从存储读回整局和每个人", async () => {
    const storage = memory();
    const first = new MineRoom(storage, tools);
    await first.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    const again = new MineRoom(storage, tools);
    const { game, me } = await again.state(info, 10001, "xiaoming", NOW + 2000);
    assert.equal(game.seq, 1);
    assert.equal(me.digs, 1);
    assert.equal(me.chances, 2);
    assert.notEqual(game.cards[0].cells[0], null);
  });
  it("机会用完要领；领取给一张凭证，再要还是同一张，之后不能挖", async () => {
    const room = new MineRoom(memory(), tools);
    const game = await room.gameFor(info);
    game.cards[1].deck = game.cards[1].deck.map(() => "emerald");
    let last;
    for (const [index, t] of [[0, 0], [1, 2000], [2, 4000]]) last = await room.dig(info, 10001, "xiaoming", { cardId: 1, index }, NOW + t);
    assert.equal(last?.answer.claimNow, true);
    const one = await room.claim(info, 10001, "xiaoming");
    const two = await room.claim(info, 10001, "xiaoming");
    assert.equal(one.answer.voucher, two.answer.voucher);
    assert.equal(one.broadcast?.type, "claim");
    assert.equal(two.broadcast, null);
    assert.match(String(one.answer.voucher), new RegExp(`^kd3\\.${Date.parse(info.openedAt ?? "")}\\.10001\\.${one.answer.points}\\.k1\\.`));
    const after = await room.dig(info, 10001, "xiaoming", { cardId: 1, index: 3 }, NOW + 6000);
    assert.equal(after.answer.message, "你已经领取了，这一局不能再挖了");
  });
  it("红包结束了不能挖；没领的不能再领", async () => {
    const room = new MineRoom(memory(), tools);
    await room.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    const ended = { ...info, status: /** @type {const} */ ("ended") };
    assert.equal((await room.dig(ended, 10001, "xiaoming", { cardId: 1, index: 1 }, NOW + 2000)).answer.message, "红包已经结束了");
    assert.equal((await room.claim(ended, 10001, "xiaoming")).answer.message, "红包已经结束了，没领的奖励作废");
  });
  it("手里没有分不签凭证（不然红包里多一笔“领取 0.00”）", async () => {
    const room = new MineRoom(memory(), tools);
    const game = await room.gameFor(info);
    game.cards[1].deck = game.cards[1].deck.map(() => "tnt");
    await room.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    const out = await room.claim(info, 10001, "xiaoming");
    assert.equal(out.answer.ok, false);
    assert.equal(out.answer.message, "手里还没有奖励，不用领取");
    assert.equal(out.broadcast, null);
  });
  it("收益卡：自己的逐格记录和全场前几名；记录以前开的局第一次要时从领过的人里算", async () => {
    const storage = memory();
    const room = new MineRoom(storage, tools);
    const game = await room.gameFor(info);
    game.cards[1].deck = game.cards[1].deck.map((_, index) => (index === 2 ? "diamond" : "emerald"));
    await room.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    await room.dig(info, 10002, "xiaohong", { cardId: 1, index: 2 }, NOW);
    await room.claim(info, 10001, "xiaoming");
    await room.claim(info, 10002, "xiaohong");
    const summary = await room.summary(info, 10001, "xiaoming");
    assert.deepEqual(summary.me.trail, [{ k: "emerald", a: 10, p: 10 }]);
    assert.deepEqual(summary.top.map((entry) => [entry.name, entry.points]), [["xiaohong", 50], ["xiaoming", 10]]);
    // 记录以前开的局：整局里没有 top
    const meta = /** @type {Record<string, unknown>} */ (storage.map.get("game"));
    delete meta.top;
    const again = new MineRoom(storage, tools);
    const rebuilt = await again.summary(info, 10003, "xiaogang");
    assert.deepEqual(rebuilt.top.map((entry) => entry.uid), [10002, 10001]);
    assert.ok(Array.isArray(/** @type {{ top?: unknown }} */ (storage.map.get("game")).top));
  });
  it("第 2 版推送只有变了的那一格；网页要第 2 版时回答里的 update 也是", async () => {
    const room = new MineRoom(memory(), tools);
    const game = await room.gameFor(info);
    game.cards[1].deck = game.cards[1].deck.map(() => "emerald");
    const old = await room.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    assert.equal(old.answer.update, old.broadcast);
    const out = await room.dig(info, 10002, "xiaohong", { cardId: 1, index: 1 }, NOW, { compact: true });
    assert.deepEqual(out.cell, {
      type: "cell", seq: 2, cardId: 1, index: 1,
      cell: { kind: "emerald", uid: 10002, name: "xiaohong", at: NOW },
      newCard: null, text: "挖到了绿宝石", left: 10000 - 20, over: false,
      stats: { digs: 2, players: 2, claimed: 0, claimedPoints: 0 },
    });
    assert.equal(out.answer.update, out.cell);
    assert.equal(out.answer.blocked, null);
    // 第 1 版带整张卡，第 2 版小得多
    assert.ok(JSON.stringify(out.cell).length < JSON.stringify(out.broadcast).length);
    // 之后的挖不改已经推过的那条（统计是当时的）
    await room.dig(info, 10003, "xiaogang", { cardId: 1, index: 2 }, NOW);
    assert.equal(out.cell?.stats.digs, 2);
  });
  it("漏了几条：按序号补；内存里没有了（重启）给整局", async () => {
    const storage = memory();
    const room = new MineRoom(storage, tools);
    for (const [uid, index] of [[10001, 0], [10002, 1], [10003, 2]]) await room.dig(info, uid, `p${uid}`, { cardId: 1, index }, NOW);
    assert.deepEqual(await room.since(info, 10001, "p10001", 3, NOW), { messages: [] });
    const some = await room.since(info, 10001, "p10001", 1, NOW);
    assert.deepEqual("messages" in some && some.messages.map((message) => [message.seq, message.index]), [[2, 1], [3, 2]]);
    const again = new MineRoom(storage, tools);
    const whole = await again.since(info, 10001, "p10001", 1, NOW);
    assert.ok("state" in whole && whole.state.game.seq === 3);
    // 重启以后挖的能补；重启以前的给整局
    await again.dig(info, 10004, "p10004", { cardId: 1, index: 3 }, NOW);
    const after = await again.since(info, 10001, "p10001", 3, NOW);
    assert.deepEqual("messages" in after && after.messages.map((message) => message.seq), [4]);
    assert.ok("state" in (await again.since(info, 10001, "p10001", 2, NOW)));
  });
  it("没挖成：回答里带那张卡现在的样子和为什么不能再挖", async () => {
    const room = new MineRoom(memory(), tools);
    await room.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    const taken = await room.dig(info, 10002, "xiaohong", { cardId: 1, index: 0 }, NOW);
    assert.equal(taken.answer.ok, false);
    assert.equal(taken.answer.message, "这一格已经被挖开了，换一格");
    assert.equal(/** @type {{ cells: unknown[] }} */ (taken.answer.card).cells[0] !== null, true);
    assert.equal(taken.answer.blocked, null);
    assert.equal(taken.cell, null);
    const ended = await room.dig({ ...info, status: "ended" }, 10002, "xiaohong", { cardId: 1, index: 1 }, NOW);
    assert.equal(ended.answer.blocked, "红包已经结束了");
  });
  it("nonce 只能用一次", async () => {
    const room = new MineRoom(memory(), tools);
    assert.equal(await room.takeNonce("abc", NOW), true);
    assert.equal(await room.takeNonce("abc", NOW + 1), false);
  });
});

describe("道具和区块（docs/V3_ITEMS.md §4）", () => {
  /** 一局，第 1 张卡全是绿宝石（cells 里给的除外）；返回房间、存储、整局和小明。 */
  async function room(/** @type {Record<number, string>} */ cells = {}) {
    const storage = memory();
    const one = new MineRoom(storage, tools);
    const game = await one.gameFor(info);
    game.cards[1].deck = game.cards[1].deck.map((_, index) => /** @type {any} */ (cells[index] ?? "emerald"));
    const me = await one.playerOf(game, 10001, "xiaoming");
    return { one, storage, game, me };
  }
  /** 放进一张这种区块的卡，牌全换成绿宝石（固定的格子照旧）。新局（rules.special: 2）珍珠不长下界、深暗之域，直接点名要。 */
  function biome(/** @type {any} */ game, /** @type {string} */ kind) {
    for (let id = 2; ; id++) {
      const card = newCard(game, id, id, 0, /** @type {any} */ (id > 400 ? kind : null));
      if (card.kind !== kind) continue;
      card.deck = card.deck.map((each, index) => (card.fixed?.[index] ? each : "emerald"));
      game.cards[id] = card;
      game.slots[`${id},0`] = id;
      return card;
    }
  }

  it("附魔镐：每挖开一格推一条，序号连着；回答带 updates；每一挖都记下", async () => {
    const { one, storage, game, me } = await room({ 13: "tnt" });
    await one.dig(info, 10002, "xiaohong", { cardId: 1, index: 11 }, NOW);
    me.items.pick.x = 1;
    const { answer, pushes } = await one.use(info, 10001, "xiaoming", { item: "pick-x", cardId: 1, index: 12 }, NOW + 2000);
    assert.equal(answer.ok, true);
    const updates = /** @type {any[]} */ (answer.updates);
    assert.deepEqual(updates.map((cell) => [cell.seq, cell.index, cell.cell.kind, cell.cell.uid]), [[2, 7, "emerald", 10001], [3, 12, "emerald", 10001], [4, 13, "tnt", 10001], [5, 17, "emerald", 10001]]);
    assert.deepEqual(updates.map((cell) => cell.stats.digs), [2, 3, 4, 5]);
    assert.deepEqual(/** @type {any[]} */ (answer.results).map((result) => result.index), [7, 12, 13, 17]);
    assert.match(String(answer.text), /十字附魔镐挖开了 4 格，跳过 1 格/);
    assert.equal(answer.claimNow, false);
    assert.equal(/** @type {any} */ (answer.me).chances, 3);
    assert.equal(/** @type {any} */ (answer.me).items.pick.x, 0);
    assert.equal(pushes.length, 4);
    pushes.forEach(([v1, v2], k) => {
      assert.equal(v1.type, "dig");
      assert.equal(v1.seq, updates[k].seq);
      assert.equal(v2, updates[k]);
    });
    assert.deepEqual(storage.map.get("log:000000002"), { uid: 10001, cardId: 1, index: 7, at: NOW + 2000, via: "pick-x" });
    assert.equal(/** @type {any} */ (storage.map.get("player:10001")).items.pick.x, 0);
    assert.equal(/** @type {any} */ (storage.map.get("game")).seq, 5);
    const missed = await one.since(info, 10002, "xiaohong", 1, NOW + 3000);
    assert.deepEqual("messages" in missed && missed.messages.map((message) => message.seq), [2, 3, 4, 5]);
    // 间隔没到：不挖，回那张卡
    me.items.pick.h = 1;
    const early = await one.use(info, 10001, "xiaoming", { item: "pick-h", cardId: 1, index: 3 }, NOW + 2500);
    assert.equal(early.answer.ok, false);
    assert.equal(/** @type {any} */ (early.answer.card).id, 1);
    assert.deepEqual(early.pushes, []);
  });

  it("火把、宝库：改了的卡推一条 card（没有序号，带预算）；插过火把的卡之后的第 2 版推送带 torches", async () => {
    const { one, storage, game, me } = await room({ 0: "tnt" });
    me.items.torch = 1;
    await one.dig(info, 10003, "xiaogang", { cardId: 1, index: 6 }, NOW);
    const seq = game.seq;
    const left = game.pool - game.used;
    const torch = await one.use(info, 10001, "xiaoming", { item: "torch", cardId: 1, index: 6 }, NOW);
    assert.equal(torch.answer.ok, true);
    assert.deepEqual(/** @type {any} */ (torch.answer.card).torches, [{ at: 6, level: 1, name: "xiaoming", v: 2 }]);
    assert.deepEqual(torch.pushes, [[{ type: "card", card: torch.answer.card, left, over: false }, null]]);
    assert.equal(game.seq, seq);
    assert.equal(one.recent.length, 1);
    assert.equal(/** @type {any} */ (storage.map.get("card:1")).torches.length, 1);
    const boom = await one.dig(info, 10002, "xiaohong", { cardId: 1, index: 0 }, NOW, { compact: true });
    // 第 2 版：挖开了颜色也不变
    assert.deepEqual(boom.cell?.torches, [{ at: 6, level: 1, name: "xiaoming", v: 2 }]);
    const trial = biome(game, "trial");
    // 没插过火把的卡的推送没有这一项
    const plain = await one.dig(info, 10002, "xiaohong", { cardId: trial.id, index: trial.deck.findIndex((_, index) => !trial.fixed?.[index]) }, NOW + 2000, { compact: true });
    assert.equal(plain.answer.ok, true);
    assert.equal(plain.cell && "torches" in plain.cell, false);
    me.items.key = 1;
    // 宝库在哪两格看摆法（新局 5 种摆法，layouts.mjs）
    const [first, second] = Object.keys(trial.vaults ?? {}).map(Number);
    const vault = await one.use(info, 10001, "xiaoming", { item: "key", cardId: trial.id, index: first }, NOW);
    assert.equal(vault.answer.ok, true);
    assert.deepEqual(/** @type {any} */ (vault.answer.card).vaults, { [first]: 3, [second]: 4 });
    assert.ok(["small", "diamond", "table", "shield"].includes(/** @type {any} */ (vault.answer.reward).kind));
    assert.equal(vault.pushes[0][0].type, "card");
    assert.deepEqual(/** @type {any} */ (storage.map.get(`card:${trial.id}`)).vaults, { [first]: 3, [second]: 4 });
    assert.deepEqual(/** @type {any} */ (vault.answer.me).vaultsOpened, [`${trial.id}:${first}`]);
    assert.equal(/** @type {any} */ (storage.map.get("game")).used, game.used);
  });

  it("岩浆、深暗之域：第 2 版推送带 burned、noise、closed", async () => {
    const { one, game } = await room();
    const nether = biome(game, "nether");
    const lava = Number(Object.keys(nether.fixed)[0]);
    const far = [...Array(36).keys()].filter((index) => !nether.fixed[index] && Math.abs(index % 6 - lava % 6) + Math.abs(Math.floor(index / 6) - Math.floor(lava / 6)) > 3);
    let last;
    for (const [k, index] of far.slice(0, 3).entries()) last = await one.dig(info, 10010 + k, `p${k}`, { cardId: nether.id, index }, NOW, { compact: true });
    assert.equal(last?.cell?.burned?.length, 1);
    const burned = /** @type {any} */ (last?.cell?.burned)[0];
    assert.deepEqual(/** @type {any} */ (last?.answer.update).burned, last?.cell?.burned);
    assert.deepEqual(publicBurn(last?.broadcast, burned.index), { kind: burned.kind, uid: 0, name: "", at: NOW, burn: 1 });
    // 2026-11-12 前的局：噪音就是挖了几格，到 wardenAt 醒
    const deep = biome(game, "deep");
    delete deep.noise;
    delete deep.noiseAt;
    deep.wardenAt = 2;
    const quiet = await one.dig(info, 10020, "a", { cardId: deep.id, index: 0 }, NOW, { compact: true });
    assert.deepEqual([quiet.cell?.noise, quiet.cell?.closed, quiet.cell?.noiseAt], [1, false, undefined]);
    const loud = await one.dig(info, 10021, "b", { cardId: deep.id, index: 1 }, NOW, { compact: true });
    assert.deepEqual([loud.cell?.noise, loud.cell?.closed, loud.cell?.wokeBy?.name], [2, true, "b"]);
    assert.match(String(loud.cell?.text), /吵醒了监守者/);
    const shut = await one.dig(info, 10022, "c", { cardId: deep.id, index: 2 }, NOW, { compact: true });
    assert.equal(shut.answer.message, "监守者醒了，这张卡已经关闭，不能再挖");
    // 新局：噪音会退，推送带挖的那一刻的 noise 和 noiseAt，网页接着往下退
    const loudish = biome(game, "deep");
    const first = await one.dig(info, 10023, "d", { cardId: loudish.id, index: 0 }, NOW, { compact: true });
    assert.deepEqual([first.cell?.noise, first.cell?.noiseAt, first.cell?.closed], [1, NOW, false]);
    const later = await one.dig(info, 10024, "e", { cardId: loudish.id, index: 1 }, NOW + 7500, { compact: true });
    assert.deepEqual([later.cell?.noise, later.cell?.noiseAt], [1.5, NOW + 7500]);
  });

  it("末影箱：领的是手上加箱子，凭证上的分也是；箱子改了预算要存", async () => {
    const { one, storage, me } = await room();
    await one.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    await one.dig(info, 10001, "xiaoming", { cardId: 1, index: 1 }, NOW + 2000);
    me.items.ender = 1;
    const { answer, pushes } = await one.use(info, 10001, "xiaoming", { item: "ender" }, NOW + 3000);
    assert.deepEqual([answer.ok, answer.stored, answer.destroyed, pushes.length], [true, 10, 10, 0]);
    assert.equal(/** @type {any} */ (storage.map.get("game")).used, 10);
    assert.deepEqual([/** @type {any} */ (answer.me).points, /** @type {any} */ (answer.me).chest], [0, 10]);
    await one.dig(info, 10001, "xiaoming", { cardId: 1, index: 2 }, NOW + 4000);
    const claimed = await one.claim(info, 10001, "xiaoming", NOW + 5000);
    assert.equal(claimed.answer.points, 20);
    assert.match(String(claimed.answer.voucher), /^kd3\.\d+\.10001\.20\.k1\./);
    assert.equal(claimed.broadcast?.points, 20);
    // 只有箱子里有分也能领
    const other = await room();
    const q = await other.one.playerOf(other.game, 10003, "xiaogang");
    q.chest = 5;
    assert.equal((await other.one.claim(info, 10003, "xiaogang", NOW)).answer.points, 5);
  });

  it("苦力怕：网页打开时重新计时；到点前不扣，到点扣手上的 20% 回到预算；补推送不算打开", async () => {
    const { one, storage } = await room();
    await one.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    const opened = await one.state(info, 10001, "xiaoming", NOW + 1000);
    assert.equal(opened.me.creeperMs, 60_000);
    await one.since(info, 10001, "xiaoming", 0, NOW + 30_000);
    const early = await one.creeper(info, 10001, "xiaoming", NOW + 1000 + 67_000);
    assert.deepEqual([early.ok, early.lost, early.message], [false, 0, "苦力怕还没到时候"]);
    const boom = await one.creeper(info, 10001, "xiaoming", NOW + 1000 + 68_000);
    assert.deepEqual([boom.ok, boom.lost, /** @type {any} */ (boom.me).points, /** @type {any} */ (boom.me).creeperMs], [true, 2, 8, 60_000]);
    assert.equal(/** @type {any} */ (storage.map.get("player:10001")).points, 8);
    assert.equal(/** @type {any} */ (storage.map.get("game")).used, 8);
    const ended = await one.creeper({ ...info, status: "ended" }, 10001, "xiaoming", NOW + 999_000);
    assert.equal(ended.message, "红包已经结束了");
  });

  it("红包暂停时苦力怕不来：creeperMs 是 null，炸不了，暂停期间问一次就重新计时；恢复以后从那时起算", async () => {
    const { one } = await room();
    await one.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    const paused = { ...info, paused: true };
    const seen = await one.state(paused, 10001, "xiaoming", NOW + 50_000);
    assert.equal(seen.me.creeperMs, null);
    const blast = await one.creeper(paused, 10001, "xiaoming", NOW + 200_000);
    assert.deepEqual([blast.ok, blast.message, /** @type {any} */ (blast.me).creeperMs], [false, "红包暂停了，稍后再试", null]);
    // 恢复以后：从暂停期间最后问的那一刻（NOW + 200 秒）重新算，不会马上炸
    const back = await one.creeper(info, 10001, "xiaoming", NOW + 201_000);
    assert.deepEqual([back.ok, back.message], [false, "苦力怕还没到时候"]);
    assert.equal(/** @type {any} */ (back.me).creeperMs, 59_000);
  });

  it("推送和回答：试炼密室的格子推送带着宝库还能开几次；用道具的回答带着奖池还剩多少", async () => {
    const { one, game, me } = await room();
    const trial = biome(game, "trial");
    const cell = trial.deck.findIndex((_, index) => !trial.fixed?.[index]);
    const dug = await one.dig(info, 10001, "xiaoming", { cardId: trial.id, index: cell }, NOW, { compact: true });
    assert.deepEqual(/** @type {any} */ (dug.cell).vaults, Object.fromEntries(Object.keys(trial.vaults ?? {}).map((index) => [index, 4])));
    me.items.ender = 1;
    const stored = await one.use(info, 10001, "xiaoming", { item: "ender" }, NOW + 2000);
    assert.equal(stored.answer.ok, true);
    assert.equal(stored.answer.left, game.pool - game.used);
  });

  it("没有这种道具、乱给的形状：不改东西", async () => {
    const { one, storage } = await room();
    const out = await one.use(info, 10001, "xiaoming", { item: "sword" }, NOW);
    assert.deepEqual([out.answer.ok, out.answer.message, out.pushes.length, storage.map.has("player:10001")], [false, "没有这种道具", 0, false]);
    const table = await one.use(info, 10001, "xiaoming", { item: "table", choice: "h" }, NOW);
    assert.equal(table.answer.message, "你手里没有附魔台");
  });
});

/** 第 1 版推送里整张卡上的第 index 格。 */
function publicBurn(/** @type {any} */ broadcast, /** @type {number} */ index) {
  return broadcast.card.cells[index];
}

describe("不领的人（docs/V3_ITEMS.md §9）", () => {
  /** 记下定的闹钟 */
  function alarmTools() {
    /** @type {number[]} */
    const set = [];
    let at = /** @type {number|null} */ (null);
    return { set, tools: { ...tools, alarm: { get: async () => at, set: async (/** @type {number} */ value) => { at = value; set.push(value); } } } };
  }

  it("手上有分记进 hold:、定 5 分钟后的闹钟；闹钟把到点的炸掉、存下、推一条 drain，再定下一次；领了删掉", async () => {
    const storage = memory();
    const { set, tools: withAlarm } = alarmTools();
    const one = new MineRoom(storage, withAlarm);
    const game = await one.gameFor(info);
    game.cards[1].deck = game.cards[1].deck.map(() => /** @type {any} */ ("emerald"));
    const first = await one.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    assert.equal(first.answer.ok, true);
    assert.equal(storage.map.get("hold:10001"), 1);
    assert.deepEqual(set, [NOW + 300_000]);
    // 别人挖：手上没分前不记；挖到了记，闹钟已经有了不再定
    await one.dig(info, 10002, "xiaohong", { cardId: 1, index: 1 }, NOW + 60_000);
    assert.equal(storage.map.get("hold:10002"), 1);
    assert.deepEqual(set, [NOW + 300_000]);
    // 重启以后（内存没了）闹钟照样找得到人
    const again = new MineRoom(storage, withAlarm);
    const out = await again.alarm(info, NOW + 300_000);
    assert.deepEqual(out.drained, [10001]);
    assert.equal(/** @type {any} */ (storage.map.get("player:10001")).points, 8);
    assert.equal(/** @type {any} */ (storage.map.get("game")).used, 18);
    assert.equal(out.left, 10000 - 18);
    assert.equal(set.at(-1), NOW + 360_000);
    // 回来的时候先把离开时该炸的算掉
    const back = await again.state(info, 10002, "xiaohong", NOW + 60_000 + 300_000 + 120_000);
    // 10 → 8 → 7 → 6（三次：6 分钟、7 分钟、8 分钟）
    assert.equal(back.drained, 2 + 1 + 1);
    assert.equal(/** @type {any} */ (back.me).points, 6);
    assert.deepEqual(again.takeOutbox(), [{ type: "drain", uids: [10002], left: 10000 - 8 - 6, over: false }]);
    const claimed = await again.claim(info, 10002, "xiaohong", NOW + 500_000);
    assert.equal(claimed.answer.ok, true);
    assert.equal(storage.map.has("hold:10002"), false);
    // 炸到 0：不再记，也不再定闹钟
    const end = await again.alarm(info, NOW + 300_000 + 3600_000);
    assert.deepEqual(end.drained, [10001]);
    assert.equal(/** @type {any} */ (storage.map.get("player:10001")).points, 0);
    assert.equal(storage.map.has("hold:10001"), false);
    const count = set.length;
    assert.deepEqual((await again.alarm(info, NOW + 9_000_000)).drained, []);
    assert.equal(set.length, count);
  });

  it("红包暂停时闹钟不炸，5 分钟后再看；结束了不再定", async () => {
    const storage = memory();
    const { set, tools: withAlarm } = alarmTools();
    const one = new MineRoom(storage, withAlarm);
    const game = await one.gameFor(info);
    game.cards[1].deck = game.cards[1].deck.map(() => /** @type {any} */ ("emerald"));
    await one.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    assert.deepEqual((await one.alarm({ ...info, paused: true }, NOW + 400_000)).drained, []);
    assert.equal(set.at(-1), NOW + 700_000);
    const count = set.length;
    assert.deepEqual((await one.alarm({ ...info, status: "ended" }, NOW + 800_000)).drained, []);
    assert.equal(set.length, count);
    assert.equal(/** @type {any} */ (storage.map.get("player:10001")).points, 10);
  });
});

describe("Stage 压测机器人", () => {
  it("照规则挖：轮着换机器人，每格都有推送，地图会长；没设钥匙的环境不认", async () => {
    const room = new MineRoom(memory(), tools);
    const big = { ...info, params: { boardSpec: "5", smallReward: 1, initialChances: 2 } };
    let n = 0;
    const random = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    const out = await room.botDigs(big, 200, NOW, random);
    assert.equal(out.dug, 200);
    assert.equal(out.seq, 200);
    assert.equal(out.pushes.length, 200);
    assert.ok(out.cards > 3, `cards ${out.cards}`);
    const diggers = new Set(out.pushes.map(([, cell]) => cell.cell.uid));
    assert.ok(diggers.size >= 100 && [...diggers].every((uid) => uid >= BOT_BASE));
    assert.match(out.pushes[0][1].cell.name, /^机器人 \d+$/);
    assert.equal(botKeyValid("k", undefined), false);
    assert.equal(botKeyValid(null, "k"), false);
  });
});

describe("推送攒一攒再发", () => {
  it("100 毫秒里的几条一次发出：第 2 版一个数组，第 1 版一条条；没有第 2 版的两边一样；发完再来的另起一批", () => {
    /** @type {{ v1: Record<string, unknown>[], v2: Record<string, unknown>[] }[]} */
    const sent = [];
    /** @type {{ run: () => void, ms: number }[]} */
    const timers = [];
    let cancelled = 0;
    const pushes = new LivePushes((out) => sent.push(out), (run, ms) => timers.push({ run, ms }), () => { cancelled += 1; });
    pushes.push({ type: "dig", seq: 1 }, { type: "cell", seq: 1 });
    pushes.push({ type: "dig", seq: 2 }, { type: "cell", seq: 2 });
    pushes.push({ type: "claim", name: "p" });
    assert.equal(sent.length, 0);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, PUSH_EVERY_MS);
    timers[0].run();
    assert.deepEqual(sent, [{
      v1: [{ type: "dig", seq: 1 }, { type: "dig", seq: 2 }, { type: "claim", name: "p" }],
      v2: [{ type: "cell", seq: 1 }, { type: "cell", seq: 2 }, { type: "claim", name: "p" }],
    }]);
    assert.equal(cancelled, 0);
    pushes.push({ type: "dig", seq: 3 }, { type: "cell", seq: 3 });
    assert.equal(timers.length, 2);
    pushes.flush();
    assert.equal(cancelled, 1);
    assert.deepEqual(sent[1].v2, [{ type: "cell", seq: 3 }]);
    pushes.flush();
    assert.equal(sent.length, 2);
  });
});

describe("领取范围", () => {
  it("没有范围谁都行；等级在里面或者是指定的人（名字不分大小写）才行；等级不知道的只看名字", () => {
    assert.equal(inScope(null, { username: "a", level: 0 }), true);
    assert.equal(inScope(undefined, { username: "a" }), true);
    const scope = { levels: [1], users: [{ username: "XiaoMing" }] };
    assert.equal(inScope(scope, { username: "a", level: 1 }), true);
    assert.equal(inScope(scope, { username: "a", level: 3 }), false);
    assert.equal(inScope(scope, { username: "xiaoming", level: 3 }), true);
    assert.equal(inScope(scope, { username: "a", level: null }), false);
  });
  it("不让进时的话和红包页上的“仅限”一样写", () => {
    assert.equal(outOfScope({ levels: [1] }), "这个红包仅限 Lv1，你不在里面：挖到的奖励领不了，所以进不了矿洞");
    assert.match(outOfScope({ levels: [2, 3, 4] }), /仅限 Lv2 及以上，/);
    assert.match(outOfScope({ levels: [0, 1, 3], users: [{ username: "a" }, { username: "b" }] }), /仅限 Lv0–1、Lv3 或指定的 2 人，/);
    assert.match(outOfScope({ users: [{ username: "a" }] }), /仅限指定的 1 人，/);
  });
});

describe("v3 的网页从这个环境的红包站加载 SDK", () => {
  const html = `<head><script src="${SDK_URL}"></script></head>`;
  const page = (body, type = "text/html; charset=utf-8", status = 200) =>
    new Response(status === 304 ? null : body, { status, headers: { "content-type": type, "content-length": String(body.length), etag: '"a"' } });

  it("Stage 换成 Stage 的地址，长度和 ETag 不再带着", async () => {
    const out = await pageFrom(page(html), "https://staging.hb.lafi.sh");
    assert.equal(await out.text(), '<head><script src="https://staging.hb.lafi.sh/sdk/v1.js"></script></head>');
    assert.equal(out.headers.get("content-length"), null);
    assert.equal(out.headers.get("etag"), null);
  });

  it("线上原样给；304 和别的类型也原样给", async () => {
    const same = page(html);
    assert.equal(await pageFrom(same, "https://hb.lafi.sh"), same);
    const notModified = page("", "text/html", 304);
    assert.equal(await pageFrom(notModified, "https://staging.hb.lafi.sh"), notModified);
    const script = page("x", "text/javascript");
    assert.equal(await pageFrom(script, "https://staging.hb.lafi.sh"), script);
    assert.equal(withSdkFrom(html, "http://127.0.0.1:8730"), '<head><script src="http://127.0.0.1:8730/sdk/v1.js"></script></head>');
  });
});

describe("在场：指针、谁在看、表情（docs/V3_ITEMS.md §20）", () => {
  const conn = () => {
    /** @type {{ sent: Record<string, unknown>[], closed: number|null, send(text: string): void, close(code?: number): void }} */
    const out = { sent: [], closed: null, send(text) { this.sent.push(JSON.parse(text)); }, close(code) { this.closed = code ?? null; } };
    return out;
  };
  const setup = () => {
    /** @type {(() => void)[]} */
    const timers = [];
    let n = 0;
    const saved = new Map();
    const room = new PresenceRoom({ later: (run, ms) => { assert.equal(ms, FLUSH_MS); timers.push(run); return timers.length; }, sid: () => `s${++n}`, save: (c, seat) => saved.set(c, { ...seat }) });
    const flush = () => { const run = timers.shift(); assert.ok(run, "该有一批"); run(); };
    return { room, timers, flush, saved };
  };
  const say = (/** @type {PresenceRoom} */ room, c, data, now = NOW) => room.message(c, typeof data === "string" ? data : JSON.stringify(data), now);
  const take = (c) => c.sent.splice(0);

  it("和网页的格位一样大", () => {
    const camera = readFileSync(new URL("../../page/frontend/v3/src/camera.ts", import.meta.url), "utf8");
    const px = (name) => Number(new RegExp(`export const ${name} = ([^\\n]+)`).exec(camera)?.[1].replace(/[A-Z_]+/g, (key) => String(px(key))).replace(/[^0-9+*]/g, "").split("+").reduce((sum, part) => sum + part.split("*").reduce((product, value) => product * Number(value), 1), 0));
    assert.equal(px("SLOT_PX"), SLOT_PX);
  });

  it("刚连上给座位号和谁在看哪张；换卡告诉所有人；走了说一声", () => {
    const { room, flush, saved } = setup();
    const a = conn(), b = conn();
    room.join(a, { uid: 1, name: "小明" }, NOW);
    flush();
    assert.deepEqual(take(a), [{ hi: "s1", w: [], P: [] }]);
    say(room, a, { w: [5, 0, 0, 2] });
    room.join(b, { uid: 2, name: "小红" }, NOW);
    flush();
    // 只有他一个人在看：告诉他没人看得见他（网页就先不发指针）
    assert.deepEqual(take(a), [{ w: [["s1", 1, "小明", 5]], P: [], s: 0 }]);
    assert.deepEqual(take(b), [{ hi: "s2", w: [["s1", 1, "小明", 5]], P: [] }]);
    assert.deepEqual(saved.get(a).here, { c: 5, x: 0, y: 0, l: 2 });
    // 同一张卡上缩放级变了：不用告诉别人
    say(room, a, { w: [5, 0, 0, 1] });
    flush();
    assert.deepEqual(take(b), []);
    room.leave(a);
    flush();
    assert.deepEqual(take(b), [{ w: [["s1", 1, "小明", null]] }]);
  });

  it("以前的网页没报屏幕范围：指针按缩放级估（挖卡那一级 1 格、附近 2 格、全图不收），离开范围时说收起；自己的不回给自己", () => {
    const { room, flush } = setup();
    const [a, near, far, mid, overview, twin] = [conn(), conn(), conn(), conn(), conn(), conn()];
    room.join(a, { uid: 1, name: "a" }, NOW);
    room.join(near, { uid: 2, name: "near" }, NOW);
    room.join(far, { uid: 3, name: "far" }, NOW);
    room.join(mid, { uid: 4, name: "mid" }, NOW);
    room.join(overview, { uid: 5, name: "all" }, NOW);
    room.join(twin, { uid: 1, name: "a" }, NOW);
    say(room, a, { w: [1, 0, 0, 2] });
    say(room, near, { w: [2, 1, 0, 2] });
    say(room, far, { w: [3, 2, 0, 2] });
    say(room, mid, { w: [3, 2, 0, 1] });
    say(room, overview, { w: [1, 0, 0, 0] });
    say(room, twin, { w: [1, 0, 0, 2] });
    flush();
    for (const c of [a, near, far, mid, overview, twin]) take(c);
    say(room, a, { p: [10, -20] });
    say(room, a, { p: [12, -20, 99] });
    say(room, a, { p: [12, -20, -1] });
    say(room, a, { p: [12, -20] });
    flush();
    assert.deepEqual(take(near), [{ p: [["s1", 12, -20]] }]);
    assert.deepEqual(take(mid), [{ p: [["s1", 12, -20]] }]);
    assert.deepEqual(take(far), []);
    assert.deepEqual(take(overview), []);
    assert.deepEqual(take(twin), []);
    // 指针挪到隔壁卡（格位 1, 0）：far 现在看得见了；再挪远，near 收到“收起”前的最后一下
    say(room, a, { p: [SLOT_PX, 0] });
    flush();
    assert.deepEqual(take(far), [{ p: [["s1", SLOT_PX, 0]] }]);
    assert.deepEqual(take(near), [{ p: [["s1", SLOT_PX, 0]] }]);
    take(mid);
    say(room, a, { p: [SLOT_PX * 5, 0] });
    flush();
    assert.deepEqual(take(near), [{ p: [["s1"]] }]);
    assert.deepEqual(take(far), [{ p: [["s1"]] }]);
    assert.deepEqual(take(mid), [{ p: [["s1"]] }]);
    say(room, a, { p: null });
    flush();
    assert.deepEqual(take(near), []);
    assert.deepEqual(take(mid), []);
  });

  it("每人最多跟着 20 个指针：换卡时挑最近的，有人收起了再补上", () => {
    const { room, flush } = setup();
    const viewer = conn();
    room.join(viewer, { uid: 1, name: "v" }, NOW);
    const others = Array.from({ length: FOLLOW_MAX + 5 }, () => conn());
    others.forEach((other, n) => {
      room.join(other, { uid: 100 + n, name: `p${n}` }, NOW);
      say(room, other, { w: [1, 0, 0, 2] });
    });
    flush();
    // 第 n 个离卡中心 n×5 像素
    others.forEach((other, n) => say(room, other, { p: [n * 5, 0] }, NOW + 10));
    flush();
    take(viewer);
    say(room, viewer, { w: [1, 0, 0, 2] }, NOW + 20);
    flush();
    const [first] = take(viewer);
    assert.equal(first.P.length, FOLLOW_MAX);
    assert.deepEqual(first.P.at(-1), [`s${FOLLOW_MAX + 1}`, (FOLLOW_MAX - 1) * 5, 0]);
    // 没跟着的动了：不发；跟着的收起了：说收起，空出的位置给下一个动的
    say(room, others[FOLLOW_MAX + 2], { p: [1, 1] }, NOW + 30);
    flush();
    assert.deepEqual(take(viewer), []);
    say(room, others[0], { p: null }, NOW + 40);
    say(room, others[FOLLOW_MAX + 2], { p: [2, 2] }, NOW + 40);
    flush();
    assert.deepEqual(take(viewer), [{ p: [["s2"], [`s${FOLLOW_MAX + 4}`, 2, 2]] }]);
  });

  it("指针带着手上的道具：换了道具也算动了；镐子（0）不带", () => {
    const { room, flush } = setup();
    const [a, b] = [conn(), conn()];
    room.join(a, { uid: 1, name: "a" }, NOW);
    room.join(b, { uid: 2, name: "b" }, NOW);
    say(room, a, { w: [1, 0, 0, 2] });
    say(room, b, { w: [1, 0, 0, 2] });
    flush();
    take(b);
    say(room, a, { p: [5, 5, 3] });
    flush();
    assert.deepEqual(take(b), [{ p: [["s1", 5, 5, 3]] }]);
    say(room, a, { p: [5, 5, 0] });
    flush();
    assert.deepEqual(take(b), [{ p: [["s1", 5, 5]] }]);
  });

  it("换了卡给他看得见的全部指针；不在看了、到全图、走了指针都收起", () => {
    const { room, flush } = setup();
    const [a, b] = [conn(), conn()];
    room.join(a, { uid: 1, name: "a" }, NOW);
    room.join(b, { uid: 2, name: "b" }, NOW);
    say(room, a, { w: [1, 0, 0, 2] });
    say(room, b, { w: [9, 9, 9, 2] });
    flush();
    say(room, a, { p: [5, 5] });
    flush();
    take(a);
    take(b);
    say(room, b, { w: [1, 0, 0, 2] });
    flush();
    assert.deepEqual(take(b), [{ w: [["s2", 2, "b", 1]], P: [["s1", 5, 5]], s: 1 }]);
    say(room, a, { w: null });
    flush();
    assert.deepEqual(take(b), [{ w: [["s1", 1, "a", null]], p: [["s1"]], s: 0 }]);
    // 不在看的人发来的指针不要
    say(room, a, { p: [6, 6] });
    assert.equal(room.pointers.size, 0);
    say(room, a, { w: [1, 0, 0, 2] });
    say(room, a, { p: [7, 7] });
    flush();
    take(b);
    room.leave(a);
    flush();
    assert.deepEqual(take(b), [{ w: [["s1", 1, "a", null]], p: [["s1"]], s: 0 }]);
  });

  it("网页报了屏幕范围就按它发：宽屏上露出的远一点的卡也收；全图那一级不收指针、收表情", () => {
    const { room, flush } = setup();
    const [a, wide, overview] = [conn(), conn(), conn()];
    room.join(a, { uid: 1, name: "a" }, NOW);
    room.join(wide, { uid: 2, name: "wide" }, NOW);
    room.join(overview, { uid: 3, name: "all" }, NOW);
    say(room, a, { w: [7, 2, 0, 2, 2, 0, 2, 0] });
    // 挖卡那一级、当前卡在 (0, 0)，宽屏左右各露出两张
    say(room, wide, { w: [1, 0, 0, 2, -2, 0, 2, 0] });
    say(room, overview, { w: [1, 0, 0, 0, -9, -9, 9, 9] });
    flush();
    for (const c of [a, wide, overview]) take(c);
    say(room, a, { p: [SLOT_PX * 2, 10] });
    say(room, a, { e: 2 });
    flush();
    assert.deepEqual(take(wide), [{ p: [["s1", SLOT_PX * 2, 10]], e: [["s1", 2]] }]);
    assert.deepEqual(take(overview), [{ e: [["s1", 2]] }]);
    // 出了屏幕右边：说收起
    say(room, a, { p: [SLOT_PX * 3, 10] }, NOW + 10);
    flush();
    assert.deepEqual(take(wide), [{ p: [["s1"]] }]);
    // 屏幕范围看不懂的不要
    say(room, a, { w: [7, 2, 0, 2, 3, 0, 2, 0] }, NOW + 20);
    assert.deepEqual(room.seats.get(a)?.here?.v, { x0: 2, y0: 0, x1: 2, y1: 0 });
  });

  it("有没有别人看得见你：屏幕和别人重叠了说 1，没人了说 0；全图那一级和自己的另一个标签页不算；变了才说", () => {
    const { room, flush } = setup();
    const [a, b, twin, overview] = [conn(), conn(), conn(), conn()];
    room.join(a, { uid: 1, name: "a" }, NOW);
    room.join(b, { uid: 2, name: "b" }, NOW);
    room.join(twin, { uid: 1, name: "a" }, NOW);
    room.join(overview, { uid: 3, name: "all" }, NOW);
    say(room, a, { w: [1, 0, 0, 2, -1, -1, 1, 1] });
    say(room, twin, { w: [1, 0, 0, 2, -1, -1, 1, 1] });
    say(room, overview, { w: [1, 0, 0, 0, -9, -9, 9, 9] });
    flush();
    assert.equal(take(a)[0].s, 0);
    assert.equal(take(overview)[0].s, undefined);
    say(room, b, { w: [5, 2, 0, 2, 1, 0, 3, 0] });
    flush();
    assert.equal(take(a)[0].s, 1);
    assert.equal(take(b)[0].s, undefined);
    // 换到别的卡还和他重叠：只有名单变了，不再说
    say(room, b, { w: [6, 2, 1, 2, 1, 0, 3, 1] }, NOW + 10);
    flush();
    assert.deepEqual(take(a), [{ w: [["s2", 2, "b", 6]] }]);
    say(room, b, { w: null }, NOW + 20);
    flush();
    assert.equal(take(a)[0].s, 0);
  });

  it("表情：发给看得见扔的人那张卡的人，不回给自己；每人 2 秒最多一个；不在看、号不对的不要", () => {
    const { room, flush } = setup();
    const [a, b, c] = [conn(), conn(), conn()];
    room.join(a, { uid: 1, name: "a" }, NOW);
    room.join(b, { uid: 2, name: "b" }, NOW);
    room.join(c, { uid: 3, name: "c" }, NOW);
    say(room, b, { w: [2, 1, 1, 2] });
    say(room, c, { w: [3, 5, 5, 2] });
    say(room, a, { e: 1 });
    flush();
    for (const x of [a, b, c]) take(x);
    say(room, a, { w: [1, 0, 0, 2] });
    flush();
    for (const x of [a, b, c]) take(x);
    say(room, a, { e: 3 }, NOW);
    say(room, a, { e: 4 }, NOW + EMOTE_GAP_MS - 1);
    say(room, a, { e: 99 }, NOW + EMOTE_GAP_MS);
    say(room, a, { e: "1" }, NOW + EMOTE_GAP_MS);
    flush();
    assert.deepEqual(take(b), [{ e: [["s1", 3]] }]);
    assert.deepEqual(take(c), []);
    assert.deepEqual(take(a), []);
    say(room, a, { e: 5 }, NOW + EMOTE_GAP_MS);
    flush();
    assert.deepEqual(take(b), [{ e: [["s1", 5]] }]);
  });

  it("看不懂的、太长的、心跳不理；说得太多的超出部分不理，一直超就断开", () => {
    const { room, flush, timers } = setup();
    const a = conn();
    room.join(a, { uid: 1, name: "a" }, NOW);
    flush();
    take(a);
    for (const text of ["ping", "{", "[1]", JSON.stringify({ w: [1, 0, 0, 3] }), JSON.stringify({ w: [1.5, 0, 0, 2] }), JSON.stringify({ p: [1, 2, 3] }), "x".repeat(300)]) say(room, a, text);
    assert.equal(timers.length, 0);
    assert.equal(room.seats.get(a)?.here, null);
    for (let i = 0; i < 400; i++) say(room, a, { w: [i % 2, 0, 0, 2] }, NOW + 1000);
    assert.equal(a.closed, 1008);
    assert.equal(room.seats.size, 0);
  });

  it("心跳没了 90 秒的断开，当作走了；平台自动回的心跳也算", () => {
    const { room, flush } = setup();
    const [a, b] = [conn(), conn()];
    room.join(a, { uid: 1, name: "a" }, NOW);
    room.join(b, { uid: 2, name: "b" }, NOW);
    say(room, a, { w: [1, 0, 0, 2] });
    flush();
    take(b);
    room.sweep(NOW + STALE_MS + 1, (c) => (c === b ? NOW + STALE_MS : 0));
    assert.equal(a.closed, 4000);
    assert.equal(b.closed, null);
    flush();
    assert.deepEqual(take(b), [{ w: [["s1", 1, "a", null]] }]);
  });

  it("有人说话时顺手查走了的人，最多一分钟一次；睡醒后第一句就查（没人说话时靠十分钟一次的闹钟）", () => {
    const { room } = setup();
    const [a, b] = [conn(), conn()];
    room.join(a, { uid: 1, name: "a" }, NOW);
    room.join(b, { uid: 2, name: "b" }, NOW);
    const dead = (/** @type {unknown} */ c) => (c === b ? 0 : Infinity);
    // 睡醒的房间 sweptAt 是 0：第一句话就查，b 心跳没了 90 秒，断开
    room.sweepSometimes(NOW + STALE_MS + 1, dead);
    assert.equal(b.closed, 4000);
    assert.equal(room.seats.size, 1);
    // 刚查过：一分钟内再说话不查
    const c = conn();
    room.join(c, { uid: 3, name: "c" }, NOW);
    room.sweepSometimes(NOW + STALE_MS + SWEEP_MS - 1, (x) => (x === c ? 0 : Infinity));
    assert.equal(c.closed, null);
    room.sweepSometimes(NOW + STALE_MS + 1 + SWEEP_MS, (x) => (x === c ? 0 : Infinity));
    assert.equal(c.closed, 4000);
    assert.ok(SWEEP_QUIET_MS >= 10 * SWEEP_MS);
  });

  it("房间睡醒：连接上存的座位找回来，接着用", () => {
    const { room, flush } = setup();
    const a = conn();
    room.restore(a, { sid: "old", uid: 1, name: "a", here: { c: 1, x: 0, y: 0, l: 2 }, joined: NOW });
    const b = conn();
    room.join(b, { uid: 2, name: "b" }, NOW);
    flush();
    assert.deepEqual(take(b), [{ hi: "s1", w: [["old", 1, "a", 1]], P: [] }]);
  });
});
