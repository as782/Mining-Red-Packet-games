import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RAIL_OPTIONS, railsOf } from "../shared/layouts.mjs";
import {
  amountOf, budgetLeft, claim, createGame, creeperBlast, crystalPercent, dig, digBlocked, formatPoints,
  averageUnits, coolingOf, MIN_INTERVAL_MS, newCard, newEndCard, newPlayer, placeFor, POOL_TARGET, privatePlayer, publicCard, publicGame,
  publicTorches, randomOf, rewardFor, rulesOf, SHIELD_CAP, shieldsOf, summaryOf, tableChoicesOf, topWith, useItem, usePick, WRAP_UP_MS,
  drainIdle, idleNextAt, IDLE_MS, IDLE_EVERY_MS, noiseNow, wardenChance, NOISE_DECAY_MS, LOOT_WORDS,
} from "../shared/rules.mjs";

const T0 = Date.parse("2026-11-06T12:00:00+08:00");
const DAY = 24 * 3600 * 1000;

/** @param {Partial<{ pool: number, params: Record<string, unknown>, seed: string, layout: boolean, special: boolean }>} [options] */
function game({ pool = 10000, params = {}, seed = "seed-a", layout = false, special = false } = {}) {
  // 绿宝石按 10 分写死（新判定器是按奖池和人数算的，见“参数”那一组）
  const rules = rulesOf({ boardSpec: "5", smallReward: 10, ...params });
  // 区块的新摆法（rules.layout: 2）单独测（“区块的新摆法”那一组）；别的测试按以前的摆法写的固定格子位置
  if (!layout) delete rules.layout;
  // 末影之眼开特殊区块、深暗之域噪音会退（rules.special: 2）单独测（“特殊区块和监守者”那一组）
  if (!special) delete rules.special;
  return createGame({ seed, rules, pool, openedAt: T0, deadlineAt: T0 + DAY });
}

/** 把第 id 张卡的牌换成给定的（没写的格子是绿宝石），方便测一格一格的结果。 */
function stack(g, id, cells) {
  const card = g.cards[id];
  card.deck = card.deck.map(() => "emerald");
  for (const [index, kind] of Object.entries(cells)) card.deck[Number(index)] = kind;
  return card;
}

let clock = T0;
const later = () => (clock += MIN_INTERVAL_MS);

/** 有道具栏的局里放进一张这种区块的卡（按卡号一张张生成，直到抽到这种）。 */
function biomeCard(g, biome) {
  for (let id = 2; id < 2000; id++) {
    const card = newCard(g, id, id, 0);
    if ((card.kind ?? "normal") !== biome) continue;
    g.cards[id] = card;
    g.slots[`${id},0`] = id;
    g.nextCardId = Math.max(g.nextCardId, id + 1);
    return card;
  }
  throw new Error(`抽不到 ${biome}`);
}

/** 把卡的牌换成给定的：固定的格子照 fixed（不给就照卡原来的），其余是绿宝石。 */
function lay(card, cells, fixed = card.fixed) {
  if (fixed) card.fixed = fixed;
  else delete card.fixed;
  card.deck = card.deck.map((_, index) => fixed?.[index] ?? "emerald");
  for (const [index, kind] of Object.entries(cells)) card.deck[Number(index)] = kind;
  return card;
}

const count = (deck, kind) => deck.filter((each) => each === kind).length;

describe("规则和金额", () => {
  it("新判定器四个参数：没填、乱填用默认，超出的收住；绿宝石按奖池和人数算", () => {
    const rules = rulesOf({}, 2000);
    assert.equal(rules.difficulty, "normal");
    assert.equal(rules.players, 20);
    assert.equal(rules.initialChances, 20);
    assert.equal(rules.eyeEvery, 3);
    assert.equal(rules.digInterval, 1);
    assert.equal(rules.boardSpec, "random");
    assert.equal(rules.compositionVariation, "slight");
    assert.equal(rules.tntPercent, 25);
    assert.equal(rules.smallReward, rewardFor(2000, 20, 20, "normal", true));
    assert.equal(rules.appleCap, rules.smallReward * 10);
    const odd = rulesOf({ level: "x", players: 9999, initialChances: 150, eyeEvery: 50, interval: 7 }, 2000);
    assert.equal(odd.difficulty, "normal");
    assert.equal(odd.players, 2000);
    assert.equal(odd.initialChances, 99);
    assert.equal(odd.eyeEvery, 20);
    assert.equal(odd.digInterval, 1);
    assert.equal(rulesOf({ eyeEvery: 0 }).eyeEvery, 0);
    assert.equal(rulesOf({ interval: "10" }).digInterval, 10);
    assert.deepEqual([rulesOf({ level: "easy" }).tntPercent, rulesOf({ level: "tough" }).tntPercent], [15, 50]);
  });
  it("绿宝石：大约八成奖池够预计人数把机会挖完；人多、机会多就少，至少 1 分", () => {
    const units = averageUnits("normal");
    assert.ok(units > 0.9 && units < 1.1, String(units));
    const reward = rewardFor(100000, 20, 20, "normal");
    const spent = reward * 20 * 20 * units;
    assert.ok(spent <= 100000 * POOL_TARGET && spent > 100000 * POOL_TARGET * 0.95, String(spent));
    assert.ok(rewardFor(100000, 40, 20, "normal") < reward);
    assert.equal(rewardFor(100, 2000, 99, "tough"), 1);
    assert.ok(averageUnits("tough") < averageUnits("easy")); // TNT 多，宝物少
  });
  it("有道具栏的局：垃圾格、道具占了绿宝石的位置，绿宝石按模拟的比例变贵", () => {
    for (const level of /** @type {const} */ (["easy", "normal", "tough"]))
      assert.ok(averageUnits(level, true) < averageUnits(level) * 0.8, level);
    assert.ok(rewardFor(100000, 20, 20, "normal", true) > rewardFor(100000, 20, 20, "normal") * 1.4);
    assert.equal(rulesOf({}, 100000).smallReward, rewardFor(100000, 20, 20, "normal", true));
    // 末影之眼多（每 2 张一颗）每次挖发出去的多一点，绿宝石便宜一点；少（每 5 张）贵一点；判定器的选项是字符串
    const many = rulesOf({ eyeEvery: "2" }, 100000);
    const few = rulesOf({ eyeEvery: "5" }, 100000);
    assert.deepEqual([many.eyeEvery, few.eyeEvery], [2, 5]);
    assert.ok(many.smallReward < rulesOf({}, 100000).smallReward && rulesOf({}, 100000).smallReward < few.smallReward);
    assert.equal(rulesOf({ eyeEvery: 7 }, 100000).smallReward, rulesOf({}, 100000).smallReward);
    assert.equal(rulesOf({ creeper: "180" }, 100000).creeper, 180);
    assert.equal(rulesOf({ creeper: "0" }, 100000).creeper, 0);
  });
  it("旧判定器的参数照旧用：difficulty、smallReward、tntPercent、appleCap（null 不限）", () => {
    const old = rulesOf({ difficulty: "hard", smallReward: 10, tntPercent: 25, appleCap: null, boardSpec: "random", compositionVariation: "slight", initialChances: 7 }, 2000);
    assert.equal(old.difficulty, "hard");
    assert.equal(old.smallReward, 10);
    assert.equal(old.appleCap, 0);
    assert.equal(old.players, undefined);
    assert.equal(rulesOf({ difficulty: "hell" }).tntPercent, 75);
    assert.equal(rulesOf({ appleCap: 50 }).appleCap, 50);
  });
  it("红包信息的金额字符串和分来回换", () => {
    assert.equal(amountOf("100.00"), 10000);
    assert.equal(amountOf("0.5"), 50);
    assert.equal(amountOf("7"), 700);
    assert.equal(formatPoints(1234), "12.34");
    assert.equal(formatPoints(5), "0.05");
    // 三方积分：数是多少个最小单位，小数位跟着最小单位（同红包站的 tools.money.format）
    assert.equal(formatPoints(2000, "1"), "2000");
    assert.equal(formatPoints(3, "0.5"), "1.5");
    assert.equal(formatPoints(3, "100"), "300");
    assert.equal(formatPoints(-7, "0.25"), "-1.75");
    assert.equal(formatPoints(1234, "0.01"), "12.34");
  });
});

describe("判定器第 12 版的价（docs/V3_ITEMS.md §24）", () => {
  const unitOf = { unit: "LDC", step: "0.01" };
  it("explain() 写的绿宝石的价和游戏站开局算的一样", async () => {
    const { explain } = await import("../../judge.js");
    for (const total of [500, 10000, 123457, 2000000])
      for (const players of [1, 7, 20, 300, 2000])
        for (const initialChances of [1, 20, 99])
          for (const level of ["easy", "normal", "tough"])
            for (const eyeEvery of ["2", "3", "5"]) {
              const params = { reward: "pool", players, initialChances, level, eyeEvery, interval: "1", smallReward: null };
              const rules = rulesOf(params, total);
              const said = explain(params, { title: "t", total, count: 1, minEach: 1, points: null, ...unitOf });
              if (said.hints?.players)
                assert.ok(
                  said.hints.players.startsWith(`每颗绿宝石 ${formatPoints(rules.smallReward)} LDC，`),
                  `${JSON.stringify(params)} ${total}: ${said.hints.players} vs ${rules.smallReward}`,
                );
              else assert.equal(rules.smallReward, 1, `${JSON.stringify(params)} ${total}`);
            }
  });

  it("自己定价时用发红包的人定的价，按奖池分时不管它", () => {
    const params = { players: 20, initialChances: 20, level: "normal", eyeEvery: "3", smallReward: 37 };
    assert.equal(rulesOf({ ...params, reward: "price" }, 10000).smallReward, 37);
    assert.equal(rulesOf({ ...params, reward: "pool" }, 10000).smallReward, rewardFor(10000, 20, 20, "normal", true, 3));
    // 旧判定器没有 reward：写了 smallReward 就照旧用
    assert.equal(rulesOf(params, 10000).smallReward, 37);
  });
});

describe("生成卡", () => {
  it("同一个种子同一副牌，换种子就不一样", () => {
    assert.deepEqual(game().cards[1].deck, game().cards[1].deck);
    assert.notDeepEqual(game().cards[1].deck, game({ seed: "seed-b" }).cards[1].deck);
  });
  it("珍珠：7×7 两颗，6×6 一到两颗（两种都会有），5×5 一颗", () => {
    const pearls = (boardSpec, seed) => game({ seed, params: { boardSpec } }).cards[1].deck.filter((kind) => kind === "pearl").length;
    const seeds = Array.from({ length: 24 }, (_, index) => `pearl-${index}`);
    for (const seed of seeds) assert.equal(pearls("7", seed), 2);
    for (const seed of seeds) assert.equal(pearls("5", seed), 1);
    const six = new Set(seeds.map((seed) => pearls("6", seed)));
    assert.deepEqual([...six].sort(), [1, 2]);
    const card = game({ params: { boardSpec: "7" } }).cards[1];
    assert.equal(card.deck.length, 49);
  });
  it("格子数对得上，5×5 一颗珍珠，TNT 按难度", () => {
    for (const [difficulty, tnt] of [["easy", 3], ["hard", 4], ["hell", 8]]) {
      const card = game({ params: { difficulty, compositionVariation: "fixed" } }).cards[1];
      assert.equal(card.deck.length, 25);
      assert.equal(card.deck.filter((kind) => kind === "pearl").length, 1);
      assert.equal(card.deck.filter((kind) => kind === "tnt").length, tnt);
    }
  });
  it("每卡随机时规格在 5–7 之间", () => {
    const sizes = new Set();
    for (let i = 0; i < 40; i++) sizes.add(game({ seed: `s${i}`, params: { boardSpec: "random" } }).cards[1].size);
    assert.deepEqual([...sizes].sort(), [5, 6, 7]);
  });
});

describe("末影珍珠长新卡", () => {
  it("在离珍珠最近的那条边外", () => {
    const g = game();
    const card = g.cards[1];
    assert.deepEqual(placeFor(g, card, 4), { x: 1, y: 0 }); // A5：右边最近
    assert.deepEqual(placeFor(g, card, 20), { x: 0, y: 1 }); // E1：左、下一样近，下先
  });
  it("一样近按右、下、左、上，正中间也是", () => {
    const g = game();
    const card = g.cards[1];
    assert.deepEqual(placeFor(g, card, 12), { x: 1, y: 0 }); // C3 正中间：右
    assert.deepEqual(placeFor(g, card, 24), { x: 1, y: 0 }); // E5：右、下一样近，右先
    assert.deepEqual(placeFor(g, card, 0), { x: -1, y: 0 }); // A1：左、上一样近，左先
  });
  it("那边有卡就换下一近的边，四边都满找最近的空位", () => {
    const g = game();
    const card = g.cards[1];
    g.slots["1,0"] = 99;
    assert.deepEqual(placeFor(g, card, 4), { x: 0, y: -1 }); // A5：右满，上次近
    Object.assign(g.slots, { "0,1": 98, "-1,0": 97, "0,-1": 96 });
    assert.deepEqual(placeFor(g, card, 4), { x: 1, y: 1 }); // 四边都满：斜角，右下先
  });
});

describe("挖", () => {
  it("绿宝石、钻石加分，机会少一次，大家看得见这一格", () => {
    const g = game();
    stack(g, 1, { 1: "diamond" });
    const p = newPlayer(g, 10001, "小明");
    const first = dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.equal(first.ok && first.result.amount, 10);
    const second = dig(g, p, { cardId: 1, index: 1, now: later() });
    assert.equal(second.ok && second.result.amount, 50);
    assert.equal(p.points, 60);
    assert.equal(p.chances, 18); // 默认 20 次
    assert.equal(g.used, 60);
    assert.equal(budgetLeft(g), 9940);
    const card = publicCard(g.cards[1]);
    assert.equal(card.cells[1]?.kind, "diamond");
    assert.equal(card.cells[2], null);
    assert.equal(card.left.diamond, g.cards[1].composition.diamond - 1);
  });
  it("奖励按预算封顶，预算分完游戏结束，大家领取", () => {
    const g = game({ pool: 30 });
    stack(g, 1, { 0: "diamond" });
    const p = newPlayer(g, 10001, "小明");
    const out = dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.ok(out.ok);
    assert.equal(out.result.amount, 30);
    assert.match(out.result.text, /奖池只剩这么多/);
    assert.equal(g.over, true);
    assert.equal(out.claimNow, true);
    assert.equal(digBlocked(g, p, later()), "奖池已经分完，游戏结束了，请领取");
    // 手里没有分的人不叫他领（领了只会记一笔“领取 0.00”）
    assert.equal(digBlocked(g, newPlayer(g, 10002, "小红"), later()), "奖池已经分完，游戏结束了");
  });
  it("TNT 按比例向下取整扣，扣掉的回到预算；盾牌挡一次", () => {
    const g = game({ params: { tntPercent: 25 } });
    stack(g, 1, { 3: "tnt", 4: "shield", 5: "tnt" });
    const p = newPlayer(g, 10001, "小明");
    for (const index of [0, 1, 2]) dig(g, p, { cardId: 1, index, now: later() });
    assert.equal(p.points, 30);
    const boom = dig(g, p, { cardId: 1, index: 3, now: later() });
    assert.equal(boom.ok && boom.result.amount, -7);
    assert.equal(p.points, 23);
    assert.equal(g.used, 23);
    dig(g, p, { cardId: 1, index: 4, now: later() });
    assert.equal(p.shield, true);
    const saved = dig(g, p, { cardId: 1, index: 5, now: later() });
    assert.ok(saved.ok && saved.result.blocked);
    assert.equal(p.points, 23);
    assert.equal(p.shield, false);
  });
  it("双铁镐加 3 次机会；以前开的局（没有道具栏）重复的盾牌转成小奖", () => {
    const g = game();
    delete g.rules.items;
    stack(g, 1, { 0: "totem", 1: "shield", 2: "shield" });
    const p = newPlayer(g, 10001, "小明");
    dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.equal(p.chances, 22); // 20 - 1 + 3
    dig(g, p, { cardId: 1, index: 1, now: later() });
    const twice = dig(g, p, { cardId: 1, index: 2, now: later() });
    assert.equal(twice.ok && twice.result.amount, 10);
  });
  it("金苹果：没分时送小奖，有分时翻倍，有上限就加到上限", () => {
    const g = game({ params: { appleCap: 25 } });
    stack(g, 1, { 0: "apple", 3: "apple" });
    const p = newPlayer(g, 10001, "小明");
    const gift = dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.equal(gift.ok && gift.result.amount, 10);
    dig(g, p, { cardId: 1, index: 1, now: later() });
    dig(g, p, { cardId: 1, index: 2, now: later() });
    const capped = dig(g, p, { cardId: 1, index: 3, now: later() });
    assert.equal(capped.ok && capped.result.amount, 25);
    assert.match(capped.ok ? capped.result.text : "", /最多加 0\.25/);
  });
  it("末影之眼：每第 3 张普通卡一颗；挖到它在隔一圈的空位开出 3×3 的末地宝藏，宝藏卡不算张数", () => {
    const eyes = (g) => Object.values(g.cards).map((card) => card.deck.filter((kind) => kind === "eye").length);
    const g = game();
    const p = newPlayer(g, 10001, "小明");
    p.chances = 50;
    // 一张一张长：第 1 张挖珍珠长出第 2 张，第 2 张挖珍珠长出第 3 张
    stack(g, 1, { 0: "pearl" });
    dig(g, p, { cardId: 1, index: 0, now: later() });
    stack(g, 2, { 0: "pearl" });
    const third = dig(g, p, { cardId: 2, index: 0, now: later() });
    assert.ok(third.ok && third.newCard);
    assert.deepEqual(eyes(g), [0, 0, 1]);
    // 挖第 3 张上的眼
    const card = g.cards[3];
    const at = card.deck.indexOf("eye");
    const out = dig(g, p, { cardId: 3, index: at, now: later() });
    assert.ok(out.ok && out.newCard);
    assert.equal(out.newCard.kind, "end");
    assert.equal(out.newCard.size, 3);
    assert.equal(out.result.amount, 0);
    assert.match(out.feed.text, /末地宝藏开了/);
    assert.ok(Math.max(Math.abs(out.newCard.x - card.x), Math.abs(out.newCard.y - card.y)) >= 2);
    // 新局的宝藏卡随机配：末影水晶 1–2、双铁镐 1–2、金苹果 0–1、钻石 3–5，其余绿宝石
    const count = (kind) => out.newCard.deck.filter((item) => item === kind).length;
    assert.equal(out.newCard.deck.length, 9);
    for (const [kind, [low, high]] of Object.entries({ crystal: [1, 2], totem: [1, 2], apple: [0, 1], diamond: [3, 5] }))
      assert.ok(count(kind) >= low && count(kind) <= high, `${kind} ${count(kind)}`);
    assert.equal(count("emerald"), 9 - count("crystal") - count("totem") - count("diamond") - count("apple"));
    assert.equal(publicCard(out.newCard).kind, "end");
    // 宝藏卡不算张数：再长的第 4 张没有眼，第 6 张有
    const free = [0, 1, 2, 3, 4].filter((index) => index !== at).slice(0, 3);
    stack(g, 3, Object.fromEntries(free.map((index) => [index, "pearl"])));
    for (const index of free) assert.ok(dig(g, p, { cardId: 3, index, now: later() }).ok);
    const normal = Object.values(g.cards).filter((other) => other.kind !== "end").map((other) => other.composition.eye === 1);
    assert.deepEqual(normal, [false, false, true, false, false, true]);
    // 宝藏卡上照常挖
    const safe = out.newCard.deck.findIndex((kind) => kind === "emerald" || kind === "diamond");
    const dug = dig(g, p, { cardId: out.newCard.id, index: safe, now: later() });
    assert.ok(dug.ok && dug.result.amount > 0);
  });
  it("宝藏卡的配比：新局在范围里随机（两头都会出现），钻石多过绿宝石，以前开的局照旧 4 绿宝石、3 钻石、1 金苹果、1 水晶", () => {
    /** @type {Record<string, Set<number>>} */
    const seen = {};
    let diamonds = 0;
    let emeralds = 0;
    for (let n = 0; n < 200; n++) {
      const g = game({ seed: `end-${n}` });
      assert.equal(g.rules.endMix, 2);
      const card = newEndCard(g, 99, 5, 5);
      for (const kind of ["crystal", "totem", "diamond", "apple", "emerald"]) (seen[kind] ??= new Set()).add(card.composition[kind]);
      diamonds += card.composition.diamond;
      emeralds += card.composition.emerald;
      assert.equal(card.deck.length, 9);
      assert.equal(card.composition.tnt + card.composition.pearl + card.composition.eye + card.composition.shield + card.composition.spyglass, 0);
    }
    assert.deepEqual([...seen.crystal].sort(), [1, 2]);
    assert.deepEqual([...seen.totem].sort(), [1, 2]);
    assert.deepEqual([...seen.diamond].sort(), [3, 4, 5]);
    assert.deepEqual([...seen.apple].sort(), [0, 1]);
    assert.deepEqual([...seen.emerald].sort(), [0, 1, 2, 3, 4]);
    // 平均每张约 4 颗钻石、1.5 颗绿宝石：约 21 份小奖
    assert.ok(diamonds / 200 > 3.7 && emeralds / 200 < 2);
    const old = game();
    delete old.rules.endMix;
    assert.deepEqual([...newEndCard(old, 99, 5, 5).deck].sort(), ["apple", "crystal", "diamond", "diamond", "diamond", "emerald", "emerald", "emerald", "emerald"]);
  });
  it("末影之眼可以关掉：参数 0 就没有眼", () => {
    const g = game({ params: { eyeEvery: 0 } });
    const p = newPlayer(g, 10001, "小明");
    p.chances = 50;
    for (let id = 1; id <= 4; id++) {
      stack(g, id, { 0: "pearl" });
      dig(g, p, { cardId: id, index: 0, now: later() });
    }
    assert.ok(Object.values(g.cards).every((card) => !card.deck.includes("eye")));
  });
  it("末影珍珠长出新卡，之后两张都能挖", () => {
    const g = game();
    stack(g, 1, { 4: "pearl" });
    const p = newPlayer(g, 10001, "小明");
    const out = dig(g, p, { cardId: 1, index: 4, now: later() });
    assert.ok(out.ok && out.newCard);
    assert.deepEqual([out.newCard.x, out.newCard.y], [1, 0]);
    assert.equal(out.feed.newCardId, 2);
    assert.ok(dig(g, p, { cardId: 1, index: 0, now: later() }).ok);
    assert.ok(dig(g, p, { cardId: 2, index: 0, now: later() }).ok);
    assert.equal(publicGame(g).cards.length, 2);
  });
  it("以前开的局：望远镜挖到就随机看一格，一直有效，被挖开才消失", () => {
    const g = game();
    delete g.rules.items;
    stack(g, 1, { 0: "spyglass" });
    const p = newPlayer(g, 10001, "小明");
    dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.equal(p.peeks.length, 1);
    const seen = p.peeks[0];
    assert.equal(seen.kind, g.cards[1].deck[seen.index]);
    const other = newPlayer(g, 10002, "小红");
    dig(g, other, { cardId: 1, index: seen.index === 1 ? 2 : 1, now: later() });
    dig(g, p, { cardId: 1, index: seen.index === 3 ? 4 : 3, now: later() });
    assert.equal(p.peeks.length, 1);
    dig(g, p, { cardId: 1, index: seen.index, now: later() });
    assert.equal(p.peeks.length, 0);
  });
  it("挖开的格、挖完的卡、没有的卡和格都不行，也不扣机会", () => {
    const g = game();
    const p = newPlayer(g, 10001, "小明");
    dig(g, p, { cardId: 1, index: 0, now: later() });
    for (const [cardId, index, message] of [
      [1, 0, "这一格已经被挖开了，换一格"],
      [9, 0, "没有这张卡"],
      [1, 25, "没有这一格"],
      [1, -1, "没有这一格"],
    ]) {
      const out = dig(g, p, { cardId, index, now: later() });
      assert.deepEqual(out, { ok: false, message });
    }
    assert.equal(p.chances, 19);
    g.cards[1].finished = true;
    assert.deepEqual(dig(g, p, { cardId: 1, index: 3, now: later() }), { ok: false, message: "这张卡已经挖完了" });
  });
  it("一张卡挖完就变成挖完的", () => {
    const g = game({ params: { initialChances: 20 } });
    const p = newPlayer(g, 10001, "小明");
    const card = stack(g, 1, {});
    p.chances = 30;
    for (let index = 0; index < 25; index++) dig(g, p, { cardId: 1, index, now: later() });
    assert.equal(card.finished, true);
    assert.equal(publicCard(card).finished, true);
  });
});

describe("道具栏（新局）", () => {
  it("新局开道具栏，以前开的局没有；新来的人盾牌、望远镜都是 0", () => {
    const g = game();
    assert.equal(g.rules.items, 2);
    const p = newPlayer(g, 10001, "小明");
    assert.deepEqual([p.shields, p.spyglasses, p.shield], [0, 0, false]);
    assert.deepEqual([privatePlayer(p).shields, privatePlayer(p).spyglasses], [0, 0]);
    const old = game();
    delete old.rules.items;
    const q = newPlayer(old, 10002, "小红");
    assert.equal("shields" in q, false);
    assert.equal("shields" in privatePlayer(q), false);
  });
  it("盾牌最多带 3 面，再挖到转成小奖；TNT 和末影水晶各用掉一面", () => {
    const g = game({ params: { tntPercent: 50 } });
    stack(g, 1, { 1: "shield", 2: "shield", 3: "shield", 4: "shield", 5: "tnt", 6: "crystal" });
    const p = newPlayer(g, 10001, "小明");
    dig(g, p, { cardId: 1, index: 0, now: later() });
    for (const index of [1, 2, 3]) {
      const out = dig(g, p, { cardId: 1, index, now: later() });
      assert.ok(out.ok && out.result.amount === 0);
      assert.match(out.result.text, new RegExp(`获得盾牌（${index}/${SHIELD_CAP}）`));
    }
    assert.deepEqual([p.shields, p.shield], [3, true]);
    const full = dig(g, p, { cardId: 1, index: 4, now: later() });
    assert.ok(full.ok && full.result.amount === 10);
    assert.match(full.result.text, /盾牌带满了/);
    assert.match(full.feed.text, /盾牌带满了/);
    assert.equal(p.shields, 3);
    const tnt = dig(g, p, { cardId: 1, index: 5, now: later() });
    assert.ok(tnt.ok && tnt.result.blocked);
    assert.match(tnt.result.text, /用掉一面，还有 2 面/);
    const crystal = dig(g, p, { cardId: 1, index: 6, now: later() });
    assert.ok(crystal.ok && crystal.result.blocked);
    assert.deepEqual([p.shields, shieldsOf(p), p.shield, p.points], [1, 1, true, 20]);
  });
  it("望远镜挖到先收着；用的时候挑一格看，只有自己看得见，不花机会、不用等间隔", () => {
    const g = game({ params: { interval: 10 } });
    stack(g, 1, { 0: "spyglass", 1: "spyglass", 7: "diamond" });
    const p = newPlayer(g, 10001, "小明");
    const first = dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.ok(first.ok);
    assert.match(first.result.text, /获得望远镜/);
    assert.match(first.feed.text, /捡到了一个望远镜/);
    assert.deepEqual([p.spyglasses, p.peeks.length], [1, 0]);
    // 刚挖完，间隔 10 秒还没到：照样能用
    const chances = p.chances;
    const used = useItem(g, p, { item: "spyglass", cardId: 1, index: 7, now: clock + 1 });
    assert.ok(used.ok);
    assert.deepEqual(used.peek, { cardId: 1, index: 7, kind: "diamond" });
    assert.match(used.text, /B3：钻石/);
    assert.deepEqual([p.spyglasses, p.chances, p.peeks.length], [0, chances, 1]);
    // 没有了就不能用
    assert.deepEqual(useItem(g, p, { item: "spyglass", cardId: 1, index: 8, now: clock + 2 }), { ok: false, message: "你手里没有望远镜" });
    clock += 10_000;
    dig(g, p, { cardId: 1, index: 1, now: clock });
    assert.equal(p.spyglasses, 1);
    // 挖开的格、自己看过的格、没有的卡和格、没有的道具都不行，也不扣望远镜
    assert.match(useItem(g, p, { item: "spyglass", cardId: 1, index: 0, now: clock }).message, /已经被挖开/);
    assert.match(useItem(g, p, { item: "spyglass", cardId: 1, index: 7, now: clock }).message, /已经看过了/);
    assert.match(useItem(g, p, { item: "spyglass", cardId: 9, index: 0, now: clock }).message, /没有这张卡/);
    assert.match(useItem(g, p, { item: "spyglass", cardId: 1, index: 99, now: clock }).message, /没有这一格/);
    assert.match(useItem(g, p, { item: "bow", cardId: 1, index: 3, now: clock }).message, /没有这种道具/);
    assert.equal(p.spyglasses, 1);
    // 别人看不到；看到的格子被挖开就消失
    assert.deepEqual(newPlayer(g, 10002, "小红").peeks, []);
    clock += 10_000;
    dig(g, p, { cardId: 1, index: 7, now: clock });
    assert.equal(p.peeks.length, 0);
  });
  it("领了、机会用完时不能用；以前开的局没有道具栏", () => {
    const g = game();
    const p = newPlayer(g, 10001, "小明");
    p.spyglasses = 2;
    p.chances = 0;
    assert.match(useItem(g, p, { item: "spyglass", cardId: 1, index: 3, now: later() }).message, /能挖的都用完了/);
    p.chances = 5;
    claim(g, p);
    assert.match(useItem(g, p, { item: "spyglass", cardId: 1, index: 3, now: later() }).message, /已经领取了/);
    const old = game();
    delete old.rules.items;
    assert.match(useItem(old, newPlayer(old, 10002, "小红"), { item: "spyglass", cardId: 1, index: 3, now: later() }).message, /没有道具栏/);
  });
});

describe("末影水晶", () => {
  it("扣 TNT 的两倍比例，向下取整，最多扣光；盾牌照样挡一次", () => {
    assert.deepEqual(["easy", "normal", "tough"].map((level) => crystalPercent(rulesOf({ level }))), [30, 50, 100]);
    const g = game({ params: { tntPercent: 25 } });
    stack(g, 1, { 2: "crystal", 3: "shield", 4: "crystal" });
    const p = newPlayer(g, 10001, "小明");
    for (const index of [0, 1]) dig(g, p, { cardId: 1, index, now: later() });
    assert.equal(p.points, 20);
    const boom = dig(g, p, { cardId: 1, index: 2, now: later() });
    assert.ok(boom.ok);
    assert.equal(boom.result.amount, -10); // 20 × 50%
    assert.match(boom.result.text, /末影水晶爆炸！奖励 -0\.10（双倍，50%/);
    assert.match(boom.feed.text, /末影水晶/);
    assert.equal(g.used, 10);
    dig(g, p, { cardId: 1, index: 3, now: later() });
    const blocked = dig(g, p, { cardId: 1, index: 4, now: later() });
    assert.ok(blocked.ok && blocked.result.blocked);
    assert.equal(blocked.result.amount, 0);
    assert.equal(p.shield, false);
    const tough = game({ params: { level: "tough" } });
    stack(tough, 1, { 1: "crystal" });
    const q = newPlayer(tough, 10002, "小红");
    dig(tough, q, { cardId: 1, index: 0, now: later() });
    dig(tough, q, { cardId: 1, index: 1, now: later() });
    assert.equal(q.points, 0); // 困难：一下扣光
  });
});

describe("收益卡", () => {
  it("逐格记下挖到什么、加减多少、挖完手里多少；数出最大一笔、炸了几次、挡了几次", () => {
    const g = game({ params: { tntPercent: 50 } });
    stack(g, 1, { 1: "diamond", 2: "tnt", 3: "shield", 4: "tnt", 5: "totem" });
    const p = newPlayer(g, 10001, "小明");
    for (const index of [0, 1, 2, 3, 4, 5]) assert.ok(dig(g, p, { cardId: 1, index, now: later() }).ok);
    assert.deepEqual(p.trail, [
      { k: "emerald", a: 10, p: 10 }, { k: "diamond", a: 50, p: 60 }, { k: "tnt", a: -30, p: 30 },
      { k: "shield", a: 0, p: 30 }, { k: "tnt", a: 0, p: 30, b: 1 }, { k: "totem", a: 0, p: 30 },
    ]);
    const summary = summaryOf(g, p);
    assert.deepEqual({ best: summary.me.best, tnt: summary.me.tnt, blocked: summary.me.blocked, lost: summary.me.lost, digs: summary.me.digs },
      { best: 50, tnt: 1, blocked: 1, lost: 30, digs: 6 });
    assert.deepEqual(summary.top, []);
    // 记录以前就来过的人没有 trail：收益卡说没有记录
    const old = newPlayer(g, 10002, "小红");
    delete old.trail;
    old.digs = 3;
    assert.ok(dig(g, old, { cardId: 1, index: 6, now: later() }).ok);
    assert.equal(summaryOf(g, old).me.trail, null);
  });
  it("前几名：领了才算，0 分不算，分一样先领的在前，最多 5 个", () => {
    let top = [];
    const people = [[1, 30], [2, 50], [3, 0], [4, 30], [5, 10], [6, 70], [7, 20]];
    for (const [uid, points] of people) top = topWith(top, { uid, name: `u${uid}`, points });
    assert.deepEqual(top.map((entry) => entry.uid), [6, 2, 1, 4, 7]);
    const g = game();
    stack(g, 1, {});
    const p = newPlayer(g, 10001, "小明");
    dig(g, p, { cardId: 1, index: 0, now: later() });
    claim(g, p);
    assert.deepEqual(g.top, [{ uid: 10001, name: "小明", points: 10 }]);
  });
  it("手里没有分：机会用完、奖池分完都不自动领", () => {
    const g = game({ params: { initialChances: 1, tntPercent: 100 } });
    stack(g, 1, { 0: "tnt" });
    const p = newPlayer(g, 10001, "小明");
    const out = dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.ok(out.ok);
    assert.equal(out.claimNow, false);
    assert.equal(digBlocked(g, p, later()), "能挖的都用完了");
  });
});

describe("什么时候不能挖", () => {
  it("挖掘间隔：参数拉长以后要等够；还要等几秒说出来，也给本人", () => {
    const g = game({ params: { interval: 10 } });
    const p = newPlayer(g, 10001, "小明");
    const now = later();
    assert.ok(dig(g, p, { cardId: 1, index: 0, now }).ok);
    assert.equal(coolingOf(g, p, now + 4000), 6000);
    assert.equal(digBlocked(g, p, now + 4000), "还要等 6 秒才能再挖");
    assert.equal(dig(g, p, { cardId: 1, index: 1, now: now + 9999 }).ok, false);
    assert.equal(privatePlayer(p, g, now + 4000).coolingMs, 6000);
    assert.ok(dig(g, p, { cardId: 1, index: 1, now: now + 10000 }).ok);
    clock = now + 10000;
  });
  it("挖得太快、机会用完、领过了、快截止了", () => {
    const g = game({ params: { initialChances: 1 } });
    stack(g, 1, {});
    const p = newPlayer(g, 10001, "小明");
    const now = later();
    const out = dig(g, p, { cardId: 1, index: 0, now });
    assert.ok(out.ok && out.claimNow);
    const fresh = newPlayer(g, 10002, "小红");
    fresh.lastDigAt = now;
    assert.equal(digBlocked(g, fresh, now + MIN_INTERVAL_MS - 1), "挖得太快了，稍等一下");
    assert.equal(digBlocked(g, fresh, now + MIN_INTERVAL_MS - 1, { cooling: false }), null);
    assert.equal(digBlocked(g, p, now + 5000), "能挖的都用完了，请领取");
    claim(g, p);
    assert.equal(digBlocked(g, p, now + 5000), "你已经领取了，这一局不能再挖了");
    const late = newPlayer(g, 10003, "小刚");
    assert.equal(digBlocked(g, late, T0 + DAY - WRAP_UP_MS), "快截止了，已经停止挖掘");
    late.points = 10;
    assert.equal(digBlocked(g, late, T0 + DAY - WRAP_UP_MS), "快截止了，已经停止挖掘，请领取");
    assert.equal(digBlocked(g, late, T0 + DAY - WRAP_UP_MS - 1), null);
  });
});

describe("领取", () => {
  it("分定下来，再领一次还是一样，统计只算一次", () => {
    const g = game();
    const p = newPlayer(g, 10001, "小明");
    dig(g, p, { cardId: 1, index: 0, now: later() });
    const first = claim(g, p);
    assert.equal(claim(g, p), first);
    assert.deepEqual(g.stats, { digs: 1, players: 1, claimed: 1, claimedPoints: first });
    assert.equal(privatePlayer(p).status, "claimed");
  });
});

describe("给大家看的", () => {
  it("没挖开的牌不出去", () => {
    const g = game();
    const shown = JSON.stringify(publicGame(g));
    assert.ok(!shown.includes("deck"));
    assert.ok(!shown.includes("seed"));
    assert.deepEqual(publicCard(g.cards[1]).cells, Array(25).fill(null));
  });
});

describe("新局的格子和区块（docs/V3_ITEMS.md §1、§2）", () => {
  it("苦力怕参数：没填按 60 秒，0 不开，最多 600，开着时至少是挖掘间隔的两倍", () => {
    assert.equal(rulesOf({}).creeper, 60);
    assert.equal(rulesOf({}).layout, 2);
    assert.equal(rulesOf({ creeper: "x" }).creeper, 60);
    assert.equal(rulesOf({ creeper: 0 }).creeper, 0);
    assert.equal(rulesOf({ creeper: 45 }).creeper, 45);
    assert.equal(rulesOf({ creeper: 9999 }).creeper, 600);
    assert.equal(rulesOf({ creeper: 5, interval: "10" }).creeper, 20);
    assert.equal(rulesOf({ interval: "30" }).creeper, 60);
  });

  it("普通卡：按规格加煤炭、木棍、藏宝图，30% 有钥匙，望远镜少一些；急迫药水只在挖掘间隔 3 秒以上的局", () => {
    let keys = 0;
    /** @type {Record<string, Set<number>>} */
    const maps = {};
    for (let n = 0; n < 60; n++)
      for (const size of [5, 6, 7]) {
        const card = game({ seed: `normal-${n}`, params: { boardSpec: String(size) } }).cards[1];
        const { composition } = card;
        assert.equal(card.kind, undefined);
        assert.equal(card.fixed, undefined);
        assert.equal(card.deck.length, size * size);
        assert.equal(Object.values(composition).reduce((sum, each) => sum + each, 0), size * size);
        assert.deepEqual([composition.coal, composition.stick], [{ 5: 2, 6: 3, 7: 4 }[size], { 5: 2, 6: 3, 7: 4 }[size]]);
        assert.equal(composition.spyglass, size === 5 ? 1 : 2);
        assert.equal(composition.potion, 0);
        (maps[size] ??= new Set()).add(composition.map);
        keys += composition.key;
        for (const kind of ["coal", "stick", "map", "key", "spyglass", "emerald"]) assert.equal(count(card.deck, kind), composition[kind], kind);
      }
    assert.deepEqual([[...maps[5]].sort(), [...maps[6]].sort(), [...maps[7]]], [[0, 1], [0, 1], [1]]);
    assert.ok(keys > 180 * 0.18 && keys < 180 * 0.42, String(keys));
    const potions = new Set();
    for (let n = 0; n < 30; n++) potions.add(game({ seed: `potion-${n}`, params: { boardSpec: "6", interval: "3" } }).cards[1].composition.potion);
    assert.deepEqual([...potions].sort(), [0, 1]);
    // 困难的 5×5 放不下时少放道具，不会出现负数
    for (let n = 0; n < 30; n++) {
      const card = game({ seed: `hell-${n}`, params: { difficulty: "hell" } }).cards[1];
      assert.equal(card.deck.length, 25);
      assert.ok(Object.values(card.composition).every((each) => each >= 0));
    }
  });

  it("长出来的卡按种子抽区块（第一张总是普通卡）；每种区块的规格、固定格子和配比", () => {
    const g = game({ params: { eyeEvery: 0 } });
    /** @type {Record<string, number>} */
    const seen = {};
    for (let id = 2; id < 1002; id++) {
      const card = newCard(g, id, id, 0);
      const kind = card.kind ?? "normal";
      seen[kind] = (seen[kind] ?? 0) + 1;
      const fixed = Object.entries(card.fixed ?? {});
      for (const [index, what] of fixed) assert.equal(card.deck[Number(index)], what);
      const dug = card.deck.filter((_, index) => !card.fixed?.[index]);
      for (const [what, number] of Object.entries(card.composition)) assert.equal(count(dug, what), number, `${kind} ${what}`);
      assert.equal(dug.length, card.size * card.size - fixed.length);
      const c = card.composition;
      if (kind === "trial") {
        assert.equal(card.size, 7);
        assert.deepEqual(card.fixed, { 0: "deco", 6: "deco", 24: "deco", 42: "deco", 48: "deco", 22: "vault", 26: "vault" });
        assert.deepEqual(card.vaults, { 22: 4, 26: 4 });
        assert.deepEqual([c.diamond, c.apple, c.totem, c.tnt, c.pearl, c.shield, c.key, c.coal, c.stick, c.spyglass, c.emerald], [5, 1, 2, 6, 1, 2, 2, 2, 2, 1, 18]);
      } else if (kind === "mine") {
        assert.equal(card.size, 6);
        assert.deepEqual(card.fixed, { 13: "deco", 14: "deco", 15: "deco", 16: "deco" });
        assert.deepEqual([c.cobweb, c.spawner, c.minecart, c.coal, c.stick, c.tnt, c.diamond, c.pearl, c.totem, c.shield, c.emerald], [3, 1, 2, 4, 4, 4, 2, 1, 1, 1, 9]);
      } else if (kind === "nether") {
        assert.equal(card.size, 6);
        assert.equal(fixed.length, 2);
        assert.ok(fixed.every(([, what]) => what === "lava"));
        assert.deepEqual([c.debris, c.diamond, c.tnt, c.apple, c.pearl, c.totem, c.shield, c.emerald], [1, 4, 6, 1, 1, 2, 2, 17]);
      } else if (kind === "deep") {
        assert.equal(card.size, 7);
        assert.equal(card.fixed, undefined);
        assert.ok(card.wardenAt >= 23 && card.wardenAt <= 36, String(card.wardenAt));
        assert.deepEqual([c.diamond, c.apple, c.totem, c.tnt, c.pearl, c.shield, c.spyglass, c.emerald], [8, 2, 2, 8, 2, 2, 1, 24]);
        const shown = publicCard(card);
        assert.deepEqual([shown.noise, shown.closed], [0, false]);
        assert.ok(!JSON.stringify(shown).includes("wardenAt"));
      } else {
        assert.equal(kind, "normal");
        assert.ok(c.coal > 0);
      }
    }
    // 普通 55%、试炼密室 12%、废弃矿井 12%、下界 11%、深暗之域 10%
    for (const [kind, share] of Object.entries({ normal: 0.55, trial: 0.12, mine: 0.12, nether: 0.11, deep: 0.1 }))
      assert.ok(Math.abs(seen[kind] / 1000 - share) < 0.05, `${kind} ${seen[kind]}`);
    for (let n = 0; n < 20; n++) assert.equal(game({ seed: `first-${n}` }).cards[1].kind, undefined);
  });

  it("末影之眼：区块卡也算张数，藏在区块卡里时占一颗绿宝石的位置；末地宝藏 60% 有末影箱", () => {
    const g = game({ params: { eyeEvery: 1 } });
    const kinds = new Set();
    for (let id = 2; id < 200; id++) {
      const card = newCard(g, id, id, 0);
      kinds.add(card.kind ?? "normal");
      assert.equal(card.composition.eye, 1);
      assert.equal(count(card.deck, "eye"), 1);
    }
    assert.equal(kinds.size, 5);
    let enders = 0;
    for (let n = 0; n < 300; n++) {
      const end = newEndCard(game({ seed: `ender-${n}` }), 9, 5, 5);
      assert.equal(end.deck.length, 9);
      assert.deepEqual(end.torches, []);
      enders += end.composition.ender;
    }
    assert.ok(enders > 300 * 0.5 && enders < 300 * 0.7, String(enders));
  });

  it("固定的格子（装饰、宝库、岩浆）挖不了、不花机会，也不算进挖完；位置大家都看得见", () => {
    const g = game();
    const card = lay(biomeCard(g, "trial"), {});
    const p = newPlayer(g, 10001, "小明");
    p.chances = 99;
    for (const [index, message] of [[0, /装饰/], [24, /装饰/], [22, /宝库/]]) {
      const out = dig(g, p, { cardId: card.id, index, now: later() });
      assert.equal(out.ok, false);
      assert.match(out.message, message);
    }
    assert.equal(p.chances, 99);
    const shown = publicCard(card);
    assert.deepEqual(shown.fixed, card.fixed);
    assert.deepEqual(shown.vaults, { 22: 4, 26: 4 });
    assert.equal(shown.kind, "trial");
    for (let index = 0; index < 49; index++) if (!card.fixed[index]) assert.ok(dig(g, p, { cardId: card.id, index, now: later() }).ok);
    assert.equal(card.finished, true);
    const nether = lay(biomeCard(g, "nether"), {}, { 3: "lava" });
    assert.match(dig(g, p, { cardId: nether.id, index: 3, now: later() }).message, /岩浆/);
  });
});

describe("新局的道具（docs/V3_ITEMS.md §3）", () => {
  it("第 2 版：煤炭、木棍各一个就合成 4 个火把（照原版），多的攒着不封顶，两样不会同时有", () => {
    const g = game();
    assert.equal(g.rules.craftTorches, 4);
    stack(g, 1, { 0: "coal", 1: "coal", 2: "coal", 3: "stick", 4: "stick", 5: "stick", 6: "stick", 7: "stick" });
    const p = newPlayer(g, 10001, "小明");
    const texts = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => {
      const out = dig(g, p, { cardId: 1, index, now: later() });
      assert.ok(out.ok && out.result.amount === 0);
      return [out.result.text, out.feed.text, p.coal, p.stick, p.items.torch];
    });
    assert.deepEqual(texts[2], ["获得煤炭（3 个），再有木棍就能做成火把", "挖到了煤炭", 3, 0, 0]);
    assert.deepEqual(texts[3], ["获得木棍，和煤炭做成了 4 个火把", "挖到了木棍，做成了 4 个火把", 2, 0, 4]);
    assert.deepEqual(texts[5].slice(2), [0, 0, 12]);
    assert.deepEqual(texts[7], ["获得木棍（2 个），再有煤炭就能做成火把", "挖到了木棍", 0, 2, 12]);
    assert.equal(privatePlayer(p, g, clock).stick, 2);
  });

  it("2026-11-13 以前开的第 2 版局（没有 craftTorches）一合成还是一个火把", () => {
    const g = game();
    delete g.rules.craftTorches;
    stack(g, 1, { 0: "coal", 1: "stick" });
    const p = newPlayer(g, 10001, "小明");
    dig(g, p, { cardId: 1, index: 0, now: later() });
    const out = dig(g, p, { cardId: 1, index: 1, now: later() });
    assert.deepEqual([out.result.text, out.feed.text, p.items.torch], ["获得木棍，和煤炭做成了一个火把", "挖到了木棍，做成了一个火把", 1]);
  });

  it("第 1 版：煤炭、木棍各攒 2 格，满了再挖到不算；两样都满自动做成一个火把，两样清零", () => {
    const g = game();
    g.rules.items = 1;
    stack(g, 1, { 0: "coal", 1: "coal", 2: "coal", 3: "stick", 4: "stick" });
    const p = newPlayer(g, 10001, "小明");
    const texts = [0, 1, 2, 3].map((index) => {
      const out = dig(g, p, { cardId: 1, index, now: later() });
      assert.ok(out.ok && out.result.amount === 0);
      return out.result.text;
    });
    assert.match(texts[0], /煤炭（1\/2）/);
    assert.match(texts[2], /已经够了/);
    assert.deepEqual([p.coal, p.stick, p.items.torch], [2, 1, 0]);
    const made = dig(g, p, { cardId: 1, index: 4, now: later() });
    assert.ok(made.ok);
    assert.match(made.result.text, /做成一个火把/);
    assert.match(made.feed.text, /做成了一个火把/);
    assert.deepEqual([p.coal, p.stick, p.items.torch], [0, 0, 1]);
    assert.equal(privatePlayer(p, g, clock).items.torch, 1);
  });

  it("刷怪笼：之后 3 次挖掘每次扣手上的 5%（向下取整，盾牌挡不住，回到预算）；中毒时再挖到重新算 3 次", () => {
    const g = game();
    stack(g, 1, { 3: "spawner", 8: "spawner" });
    const p = newPlayer(g, 10001, "小明");
    p.shields = 3;
    p.shield = true;
    for (const index of [0, 1, 2]) dig(g, p, { cardId: 1, index, now: later() });
    const spawner = dig(g, p, { cardId: 1, index: 3, now: later() });
    assert.ok(spawner.ok);
    assert.match(spawner.result.text, /中毒/);
    assert.deepEqual([p.poison, p.points], [3, 30]);
    const first = dig(g, p, { cardId: 1, index: 4, now: later() });
    assert.ok(first.ok);
    assert.equal(first.result.poison, 1); // 30 的 5% 是 1.5，向下取整
    assert.match(first.result.text, /中毒扣掉 0\.01（5%），还要扣 2 次/);
    assert.deepEqual([p.points, p.poison, p.shields, g.used], [39, 2, 3, 39]);
    dig(g, p, { cardId: 1, index: 5, now: later() }); // 39 → 38 → 48
    const last = dig(g, p, { cardId: 1, index: 6, now: later() }); // 48 → 46 → 56
    assert.ok(last.ok);
    assert.match(last.result.text, /毒解了/);
    assert.deepEqual([p.points, p.poison], [56, 0]);
    dig(g, p, { cardId: 1, index: 7, now: later() }); // 没中毒：不扣
    assert.equal(p.points, 66);
    p.poison = 1;
    const again = dig(g, p, { cardId: 1, index: 8, now: later() });
    assert.ok(again.ok && again.result.poison === 3);
    assert.equal(p.poison, 3);
    assert.deepEqual(p.trail.filter((step) => step.k === "poison").map((step) => step.a), [-1, -1, -2, -3]);
  });

  it("第 2 版：蜘蛛网让下一次挖多等 10 秒", () => {
    const g = game();
    stack(g, 1, { 1: "cobweb" });
    const p = newPlayer(g, 10001, "小明");
    const t = clock + 60_000;
    assert.ok(dig(g, p, { cardId: 1, index: 0, now: t }).ok);
    assert.match(dig(g, p, { cardId: 1, index: 1, now: t + 1000 }).result.text, /多等 10 秒/);
    assert.equal(privatePlayer(p, g, t + 1000).coolingMs, 11_000);
    assert.equal(dig(g, p, { cardId: 1, index: 2, now: t + 11_999 }).ok, false);
    assert.ok(dig(g, p, { cardId: 1, index: 2, now: t + 12_000 }).ok);
  });

  it("第 1 版：蜘蛛网：下一次挖要多等 5 秒，网页拿到的等待里说得出蜘蛛网占多少；挖过一次就没了", () => {
    const g = game({ params: { interval: "3" } });
    g.rules.items = 1;
    stack(g, 1, { 1: "cobweb" });
    const p = newPlayer(g, 10001, "小明");
    const t = clock + 60_000;
    assert.ok(dig(g, p, { cardId: 1, index: 0, now: t }).ok);
    const web = dig(g, p, { cardId: 1, index: 1, now: t + 3000 });
    assert.ok(web.ok);
    assert.match(web.result.text, /蜘蛛网！下一次挖要多等 5 秒/);
    assert.equal(digBlocked(g, p, t + 6000), "被蜘蛛网缠住了，还要等 5 秒才能再挖");
    const me = privatePlayer(p, g, t + 6000);
    assert.deepEqual([me.coolingMs, me.slowMs], [5000, 5000]);
    const near = privatePlayer(p, g, t + 10_000);
    assert.deepEqual([near.coolingMs, near.slowMs], [1000, 1000]);
    assert.equal(dig(g, p, { cardId: 1, index: 2, now: t + 10_999 }).ok, false);
    assert.ok(dig(g, p, { cardId: 1, index: 2, now: t + 11_000 }).ok);
    assert.deepEqual([p.slow, privatePlayer(p, g, t + 12_000).coolingMs], [0, 2000]);
    clock = t + 20_000;
  });

  it("箱子矿车：50% 2–4 份小奖，25% 一个火把，25% 一张藏宝图（种子定）；远古残骸 10 份小奖", () => {
    const g = game();
    const outcome = (index) => {
      const int = randomOf(g.seed, `minecart:1:${index}`);
      const roll = int(0, 99);
      return roll < 50 ? `small${int(2, 4)}` : roll < 75 ? "torch" : "map";
    };
    const picks = {};
    for (let index = 0; index < 25; index++) picks[outcome(index).replace(/\d/, "")] ??= index;
    assert.deepEqual(Object.keys(picks).sort(), ["map", "small", "torch"]);
    stack(g, 1, { [picks.small]: "minecart", [picks.torch]: "minecart", [picks.map]: "minecart", 24: "debris" });
    const p = newPlayer(g, 10001, "小明");
    const small = dig(g, p, { cardId: 1, index: picks.small, now: later() });
    assert.ok(small.ok);
    const times = Number(outcome(picks.small).slice(5));
    assert.equal(small.result.amount, 10 * times);
    assert.match(small.result.text, new RegExp(`箱子矿车里有 ${times} 份小奖`));
    dig(g, p, { cardId: 1, index: picks.torch, now: later() });
    dig(g, p, { cardId: 1, index: picks.map, now: later() });
    assert.deepEqual([p.items.torch, p.items.map], [1, 1]);
    const debris = dig(g, p, { cardId: 1, index: 24, now: later() });
    assert.ok(debris.ok && debris.result.amount === 100);
    assert.match(debris.feed.text, /远古残骸/);
  });

  it("末影箱：手上的一半存进箱子、一半毁掉回到预算；TNT 扣不到箱子，金苹果只翻手上的；领取时一起算", () => {
    const g = game({ params: { smallReward: 7, tntPercent: 50 } });
    stack(g, 1, { 0: "diamond", 3: "ender", 4: "tnt", 5: "apple", 7: "apple", 8: "tnt" });
    const p = newPlayer(g, 10001, "小明");
    for (const index of [0, 1, 2, 3]) dig(g, p, { cardId: 1, index, now: later() });
    assert.deepEqual([p.points, g.used, p.items.ender], [49, 49, 1]);
    const used = useItem(g, p, { item: "ender", now: later() });
    assert.ok(used.ok);
    assert.deepEqual([used.stored, used.destroyed], [24, 25]);
    assert.match(used.text, /存进末影箱 0\.24，0\.25 退回奖池/);
    assert.deepEqual([p.points, p.chest, g.used, p.items.ender], [0, 24, 24, 0]);
    assert.deepEqual(p.trail.at(-1), { k: "ender", a: -25, p: 24 });
    assert.match(useItem(g, p, { item: "ender", now: later() }).message, /没有末影箱/);
    dig(g, p, { cardId: 1, index: 4, now: later() }); // TNT：手上 0
    assert.deepEqual([p.points, p.chest], [0, 24]);
    dig(g, p, { cardId: 1, index: 5, now: later() }); // 金苹果：手上 0 送一份小奖
    dig(g, p, { cardId: 1, index: 6, now: later() });
    dig(g, p, { cardId: 1, index: 7, now: later() }); // 金苹果：翻手上的 14
    assert.deepEqual([p.points, p.chest], [28, 24]);
    dig(g, p, { cardId: 1, index: 8, now: later() }); // TNT 50%：只扣手上
    assert.deepEqual([p.points, p.chest], [14, 24]);
    assert.equal(claim(g, p, clock), 38);
    assert.equal(g.stats.claimedPoints, 38);
    assert.deepEqual(g.top, [{ uid: 10001, name: "小明", points: 38 }]);
    const summary = summaryOf(g, p);
    assert.deepEqual([summary.me.points, summary.me.chest, summary.me.lost], [38, 24, 25 + 14]);
    // 手上没有分时不用存
    const q = newPlayer(g, 10002, "小红");
    q.items.ender = 1;
    assert.match(useItem(g, q, { item: "ender", now: later() }).message, /手上还没有分/);
  });

  it("末影箱里有分、手上没有也能领；机会用完时手上没分但箱子里有，照样叫他领", () => {
    const g = game({ params: { initialChances: 1 } });
    stack(g, 1, { 0: "tnt" });
    const p = newPlayer(g, 10001, "小明");
    p.chest = 30;
    const out = dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.ok(out.ok && out.claimNow);
    assert.equal(digBlocked(g, p, later()), "能挖的都用完了，请领取");
  });

  it("急迫药水：10 秒里挖掘间隔变成 1 秒，过了就照旧", () => {
    const g = game({ params: { interval: "10" } });
    stack(g, 1, { 0: "potion" });
    const p = newPlayer(g, 10001, "小明");
    const t = clock + 60_000;
    assert.ok(dig(g, p, { cardId: 1, index: 0, now: t }).ok);
    assert.equal(p.items.potion, 1);
    const drunk = useItem(g, p, { item: "potion", now: t + 500 });
    assert.ok(drunk.ok && drunk.hasteMs === 10_000);
    assert.equal(privatePlayer(p, g, t + 500).hasteMs, 10_000);
    assert.equal(privatePlayer(p, g, t + 500).coolingMs, 500);
    for (let k = 1; k <= 9; k++) assert.ok(dig(g, p, { cardId: 1, index: k, now: t + 500 + k * 1000 }).ok, String(k));
    assert.equal(digBlocked(g, p, t + 10_000), "挖得太快了，稍等一下");
    // 药水 t + 10500 到期；上一挖在 t + 9500，之后照旧隔 10 秒
    assert.equal(digBlocked(g, p, t + 10_500), "还要等 9 秒才能再挖");
    assert.equal(privatePlayer(p, g, t + 10_500).hasteMs, 0);
    assert.ok(dig(g, p, { cardId: 1, index: 10, now: t + 19_500 }).ok);
    clock = t + 30_000;
  });

  it("藏宝图：按价值的倒数抽种类，再挑一格这种、自己还不知道的，只有自己看得见", () => {
    const g = game();
    stack(g, 1, { 0: "map", 3: "diamond", 4: "apple", 10: "tnt" });
    const p = newPlayer(g, 10001, "小明");
    dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.equal(p.items.map, 1);
    const found = useItem(g, p, { item: "map", now: later() });
    assert.ok(found.ok);
    assert.ok(["emerald", "apple", "diamond"].includes(found.kind));
    assert.equal(g.cards[1].deck[found.index], found.kind);
    assert.deepEqual(found.peek, { cardId: 1, index: found.index, kind: found.kind });
    assert.deepEqual(p.peeks, [found.peek]);
    assert.match(found.text, /藏宝图找到了第 1 张卡的/);
    assert.deepEqual([p.items.map, p.maps], [0, 1]);
    assert.match(useItem(g, p, { item: "map", now: later() }).message, /没有藏宝图/);
    // 很多人各用一张：绿宝石最多，钻石最少，都有
    const kinds = { emerald: 0, apple: 0, diamond: 0 };
    for (let uid = 1; uid <= 600; uid++) {
      const q = newPlayer(g, uid, `p${uid}`);
      q.items.map = 1;
      kinds[useItem(g, q, { item: "map", now: later() }).kind] += 1;
    }
    assert.ok(kinds.emerald > kinds.apple && kinds.apple > kinds.diamond && kinds.diamond > 0, JSON.stringify(kinds));
    // 知道了的不再找；都知道了就没有能找的
    const only = game();
    only.cards[1].deck = only.cards[1].deck.map((_, index) => (index === 1 ? "apple" : "tnt"));
    const r = newPlayer(only, 10002, "小红");
    r.items.map = 2;
    assert.equal(useItem(only, r, { item: "map", now: later() }).index, 1);
    assert.match(useItem(only, r, { item: "map", now: later() }).message, /没有能找的宝物/);
    assert.equal(r.items.map, 1);
  });

  it("试炼钥匙开宝库：每个宝库一共 4 次、每人一次；开出三份小奖、钻石、附魔台或盾牌（满了换小奖），种子定", () => {
    const g = game();
    const card = lay(biomeCard(g, "trial"), {});
    const roll = (uid) => randomOf(g.seed, `vault:${card.id}:22:${uid}`)(0, 99);
    const kindOf = (uid) => (roll(uid) < 45 ? "small" : roll(uid) < 70 ? "diamond" : roll(uid) < 90 ? "table" : "shield");
    const players = Array.from({ length: 5 }, (_, k) => {
      const q = newPlayer(g, 20001 + k, `p${k}`);
      q.items.key = 2;
      return q;
    });
    const [a] = players;
    const opened = useItem(g, a, { item: "key", cardId: card.id, index: 22, now: later() });
    assert.ok(opened.ok);
    assert.equal(opened.reward.kind, kindOf(a.uid));
    assert.equal(opened.card, card);
    assert.match(opened.text, /这个宝库还能开 3 次/);
    assert.deepEqual([card.vaults[22], a.items.key, a.vaultsOpened], [3, 1, [`${card.id}:22`]]);
    assert.deepEqual(privatePlayer(a, g, clock).vaultsOpened, [`${card.id}:22`]);
    assert.match(useItem(g, a, { item: "key", cardId: card.id, index: 22, now: later() }).message, /你已经开过了/);
    assert.ok(useItem(g, a, { item: "key", cardId: card.id, index: 26, now: later() }).ok);
    for (const q of players.slice(1, 4)) assert.ok(useItem(g, q, { item: "key", cardId: card.id, index: 22, now: later() }).ok);
    assert.equal(card.vaults[22], 0);
    assert.match(useItem(g, players[4], { item: "key", cardId: card.id, index: 22, now: later() }).message, /开完了/);
    assert.match(useItem(g, players[4], { item: "key", cardId: card.id, index: 23, now: later() }).message, /不是宝库/);
    assert.equal(players[4].items.key, 2);
    assert.match(useItem(g, newPlayer(g, 30000, "x"), { item: "key", cardId: card.id, index: 26, now: later() }).message, /没有试炼钥匙/);
    // 四种开法各找一个人
    const wanted = { small: 30, diamond: 50, table: 0, shield: 0 };
    for (const kind of Object.keys(wanted)) {
      let uid = 40000;
      while (kindOf(uid) !== kind) uid += 1;
      card.vaults[22] = 4;
      const q = newPlayer(g, uid, "q");
      q.items.key = 1;
      const out = useItem(g, q, { item: "key", cardId: card.id, index: 22, now: later() });
      assert.ok(out.ok);
      assert.deepEqual(out.reward, { kind, amount: wanted[kind] });
      assert.equal(q.points, wanted[kind]);
      if (kind === "table") assert.equal(q.items.table, 1);
      if (kind === "shield") {
        assert.equal(q.shields, 1);
        // 盾牌满了换一份小奖
        const full = newPlayer(g, uid, "q");
        full.items.key = 1;
        full.shields = SHIELD_CAP;
        card.vaults[22] = 4;
        assert.deepEqual(useItem(g, full, { item: "key", cardId: card.id, index: 22, now: later() }).reward, { kind: "shield", amount: 10 });
      }
    }
  });

  it("附魔台：两种形状由种子定（每人第几个），换不了；挑一种得到 2 次，没给的那种不行", () => {
    const g = game();
    const p = newPlayer(g, 10001, "小明");
    assert.equal(privatePlayer(p, g, clock).tableChoices, null);
    p.items.table = 2;
    const choices = privatePlayer(p, g, clock).tableChoices;
    assert.equal(choices.length, 2);
    assert.deepEqual(choices, tableChoicesOf(g, p));
    assert.deepEqual(tableChoicesOf(g, p), choices);
    const missing = ["h", "v", "x"].find((shape) => !choices.includes(shape));
    assert.match(useItem(g, p, { item: "table", choice: missing, now: later() }).message, /只能挑附魔台给出的两种/);
    assert.match(useItem(g, p, { item: "table", now: later() }).message, /只能挑/);
    const made = useItem(g, p, { item: "table", choice: choices[1], now: later() });
    assert.ok(made.ok && made.pick === choices[1]);
    assert.equal(p.items.pick[choices[1]], 2);
    assert.deepEqual([p.items.table, p.tables], [1, 1]);
    // 第二个附魔台按第 2 个算
    const next = randomOf(g.seed, `table:10001:1`)(0, 2);
    assert.deepEqual(privatePlayer(p, g, clock).tableChoices, ["h", "v", "x"].filter((_, at) => at !== next));
    const excluded = new Set();
    for (let uid = 1; uid < 60; uid++) {
      const q = newPlayer(g, uid, "q");
      excluded.add(["h", "v", "x"].find((shape) => !tableChoicesOf(g, q).includes(shape)));
    }
    assert.equal(excluded.size, 3);
  });

  it("第 2 版火把：插在挖开的格子上，照 3×3；颜色数 9 格里所有危险（挖开的也算）、插下就定，一直亮着", () => {
    const g = game();
    // 5×5：0 1 2 3 4 / 5 6 7 8 9 / ...
    const card = stack(g, 1, { 0: "tnt", 1: "tnt", 2: "spawner", 5: "crystal", 7: "tnt", 10: "tnt", 24: "tnt" });
    const p = newPlayer(g, 10001, "小明");
    p.items.torch = 5;
    p.shields = 3;
    p.shield = true;
    assert.match(useItem(g, p, { item: "torch", cardId: 1, index: 6, now: later() }).message, /只能插在挖开的格子上/);
    dig(g, p, { cardId: 1, index: 6, now: later() });
    const red = useItem(g, p, { item: "torch", cardId: 1, index: 6, now: later() }); // 0、1、2、5、7、10（11、12 没有）：6 个
    assert.ok(red.ok);
    assert.match(red.text, /红色：周围 9 格里有 5 个以上危险/);
    assert.match(useItem(g, p, { item: "torch", cardId: 1, index: 6, now: later() }).message, /已经插了火把/);
    dig(g, p, { cardId: 1, index: 0, now: later() }); // 挖开一个 TNT（盾牌挡住）
    dig(g, p, { cardId: 1, index: 18, now: later() });
    assert.ok(useItem(g, p, { item: "torch", cardId: 1, index: 0, now: later() }).ok); // 角上：0、1、5、6 → 3 个
    assert.ok(useItem(g, p, { item: "torch", cardId: 1, index: 18, now: later() }).ok); // 12、13、14、17、18、19、22、23、24 → 1 个
    assert.deepEqual(publicTorches(card).map((torch) => [torch.at, torch.level]), [[6, 3], [0, 2], [18, 1]]);
    for (const index of [1, 2, 5, 7, 10, 11, 12]) dig(g, p, { cardId: 1, index, now: later() });
    assert.deepEqual(publicTorches(card).map((torch) => [torch.at, torch.level]), [[6, 3], [0, 2], [18, 1]]); // 挖开了也不变、不灭
    assert.match(useItem(g, p, { item: "torch", cardId: 1, index: 1, now: later() }).message, /周围的格子都挖开了/);
    assert.equal(p.items.torch, 2);
    const lava = biomeCard(g, "nether");
    const at = Number(Object.keys(lava.fixed)[0]);
    assert.match(useItem(g, p, { item: "torch", cardId: lava.id, index: at, now: later() }).message, /只能插在挖开的格子上/);
  });

  it("第 1 版火把：插在卡内部四格相交的地方，一个角一个；颜色按没挖开的危险数，挖开就变，四格都挖开就灭", () => {
    const g = game();
    g.rules.items = 1;
    const card = stack(g, 1, { 0: "tnt", 1: "tnt", 5: "spawner", 6: "crystal", 12: "tnt" });
    const p = newPlayer(g, 10001, "小明");
    p.items.torch = 4;
    p.shields = 3;
    for (const index of [3, 10, 25]) assert.match(useItem(g, p, { item: "torch", cardId: 1, index, now: later() }).message, /四格相交|没有这一格/);
    assert.match(useItem(g, p, { item: "torch", cardId: 9, index: 6, now: later() }).message, /没有这张卡/);
    const red = useItem(g, p, { item: "torch", cardId: 1, index: 6, now: later() });
    assert.ok(red.ok);
    assert.equal(red.card, card);
    assert.match(red.text, /红色：这四格里有 3–4 个危险/);
    assert.match(useItem(g, p, { item: "torch", cardId: 1, index: 6, now: later() }).message, /已经插了火把/);
    assert.ok(useItem(g, p, { item: "torch", cardId: 1, index: 18, now: later() }).ok); // 12、13、17、18：一个 TNT
    assert.ok(useItem(g, p, { item: "torch", cardId: 1, index: 24, now: later() }).ok); // 没有危险
    assert.equal(p.items.torch, 1);
    assert.deepEqual(publicTorches(card), [{ at: 6, level: 2, name: "小明" }, { at: 18, level: 1, name: "小明" }, { at: 24, level: 0, name: "小明" }]);
    assert.deepEqual(publicCard(card).torches, publicTorches(card));
    for (const index of [0, 1]) dig(g, p, { cardId: 1, index, now: later() });
    assert.equal(torchAt(card, 6).level, 1);
    dig(g, p, { cardId: 1, index: 5, now: later() });
    assert.equal(torchAt(card, 6).level, 1);
    dig(g, p, { cardId: 1, index: 6, now: later() });
    assert.equal(torchAt(card, 6), undefined); // 四格都挖开：灭了
    assert.equal(card.torches.length, 3);
    assert.match(useItem(g, p, { item: "torch", cardId: 1, index: 6, now: later() }).message, /已经插了火把/);
    for (const index of [2, 7]) dig(g, p, { cardId: 1, index, now: later() });
    assert.match(useItem(g, p, { item: "torch", cardId: 1, index: 7, now: later() }).message, /插火把没有用/);
  });

  it("附魔镐：从上到下、从左到右挖开形状里没挖开的格子，每格照常算；不花机会，花它自己的次数，要等间隔，中毒只扣一次", () => {
    const g = game({ params: { interval: "3", tntPercent: 50 } });
    stack(g, 1, { 7: "pearl", 13: "tnt", 17: "tnt" });
    const p = newPlayer(g, 10001, "小明");
    const t = clock + 60_000;
    assert.ok(dig(g, p, { cardId: 1, index: 11, now: t }).ok);
    p.items.pick.x = 1;
    p.shields = 1;
    p.shield = true;
    p.poison = 2;
    assert.match(useItem(g, p, { item: "pick-x", cardId: 1, index: 12, now: t + 1000 }).message, /还要等 2 秒/);
    const seq = g.seq;
    const out = useItem(g, p, { item: "pick-x", cardId: 1, index: 12, now: t + 3000 });
    assert.ok(out.ok && "cells" in out);
    assert.deepEqual(out.cells.map((cell) => cell.result.index), [7, 12, 13, 17]);
    assert.deepEqual(out.cells.map((cell) => cell.feed.seq), [seq + 1, seq + 2, seq + 3, seq + 4]);
    assert.equal(out.skipped, 1);
    assert.match(out.text, /十字附魔镐挖开了 4 格，跳过 1 格/);
    assert.ok(out.cells[0].newCard); // 珍珠照样长卡
    assert.equal(Object.keys(g.cards).length, 2);
    assert.ok(out.cells[2].result.blocked); // 盾牌挡住第一个 TNT
    assert.equal(out.cells[3].result.amount, -10); // 第二个 TNT 扣一半
    assert.equal(out.cells[0].result.poison, 0); // 中毒只扣一次（手上 10 的 5% 是 0）
    assert.equal(p.poison, 1);
    assert.deepEqual([p.chances, p.items.pick.x, p.lastDigAt, p.digs, p.points], [19, 0, t + 3000, 5, 10]);
    assert.deepEqual(out.cells.map((cell) => cell.stats.digs), [2, 3, 4, 5]);
    assert.match(useItem(g, p, { item: "pick-x", cardId: 1, index: 12, now: t + 9000 }).message, /没有十字附魔镐/);
    // 出界的不算；框里都挖过就不行
    p.items.pick.h = 2;
    p.items.pick.v = 1;
    const edge = useItem(g, p, { item: "pick-h", cardId: 1, index: 0, now: t + 9000 });
    assert.ok(edge.ok && "cells" in edge);
    assert.deepEqual([edge.cells.map((cell) => cell.result.index), edge.skipped], [[0, 1], 0]);
    assert.match(useItem(g, p, { item: "pick-v", cardId: 1, index: 12, now: t + 12_000 }).message, /框里没有能挖的格子/);
    assert.equal(p.items.pick.v, 1);
    assert.match(useItem(g, p, { item: "pick-q", cardId: 1, index: 12, now: t + 12_000 }).message, /没有这种道具/);
    // 固定的格子跳过：试炼密室正中是装饰
    const trial = lay(biomeCard(g, "trial"), {});
    const deco = usePick(g, p, { shape: "h", cardId: trial.id, index: 24, now: t + 12_000 });
    assert.ok(deco.ok);
    assert.deepEqual([deco.cells.map((cell) => cell.result.index), deco.skipped], [[23, 25], 1]);
    clock = t + 30_000;
  });

  it("自动领取：镐子的机会和附魔镐都用完才领；只剩附魔镐时镐子挖不了，说清楚；附魔台也算还能挖", () => {
    const g = game({ params: { initialChances: 1 } });
    stack(g, 1, {});
    const p = newPlayer(g, 10001, "小明");
    p.items.pick.h = 1;
    const first = dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.ok(first.ok);
    assert.equal(first.claimNow, false);
    assert.equal(digBlocked(g, p, later()), null);
    assert.equal(dig(g, p, { cardId: 1, index: 5, now: later() }).message, "镐子用完了，可以用附魔镐接着挖");
    const last = useItem(g, p, { item: "pick-h", cardId: 1, index: 11, now: later() });
    assert.ok(last.ok && last.claimNow);
    assert.equal(digBlocked(g, p, later()), "能挖的都用完了，请领取");
    assert.match(useItem(g, p, { item: "potion", now: later() }).message, /能挖的都用完了/);
    const q = newPlayer(g, 10002, "小红");
    q.chances = 0;
    q.items.table = 1;
    assert.equal(digBlocked(g, q, later()), null);
    assert.equal(dig(g, q, { cardId: 1, index: 20, now: later() }).message, "镐子用完了，打开附魔台换一把附魔镐接着挖");
  });

  it("下界：每挖 3 格岩浆往旁边流一格，被吞的格子翻开给大家看，之后挖不了；远古残骸吞不掉", () => {
    const g = game();
    const card = lay(biomeCard(g, "nether"), { 1: "debris", 6: "diamond" }, { 0: "lava" });
    const p = newPlayer(g, 10001, "小明");
    p.chances = 99;
    for (const index of [35, 34]) assert.deepEqual(dig(g, p, { cardId: card.id, index, now: later() }).burned, []);
    const third = dig(g, p, { cardId: card.id, index: 33, now: later() });
    assert.ok(third.ok);
    // 岩浆旁边只有 1（远古残骸）和 6
    assert.deepEqual(third.burned, [{ index: 6, kind: "diamond" }]);
    assert.deepEqual(third.result.burned, third.burned);
    assert.match(third.feed.text, /岩浆流过来，吞掉了一格钻石/);
    const shown = publicCard(card);
    assert.deepEqual(shown.cells[6], { kind: "diamond", uid: 0, name: "", at: clock, burn: 1 });
    assert.equal(shown.left.diamond, card.composition.diamond - 1);
    assert.equal(g.used, 30); // 吞掉的钻石不付钱，钱还在红包里
    assert.match(dig(g, p, { cardId: card.id, index: 6, now: later() }).message, /被岩浆吞掉了/);
    // 一直挖到挖完：远古残骸一直没被吞，被吞的都挨着岩浆
    for (let index = 35; index >= 0 && !card.finished; index--) {
      if (card.opened[index] !== null || card.fixed[index]) continue;
      assert.ok(dig(g, p, { cardId: card.id, index, now: later() }).ok);
    }
    assert.equal(card.finished, true);
    assert.notEqual(card.opened[1]?.burn, 1);
    const burned = card.opened.flatMap((cell, index) => (cell?.burn ? [index] : []));
    assert.ok(burned.length >= 2 && burned.length <= Math.floor((36 - 1 - burned.length) / 3), String(burned));
  });

  it("深暗之域：噪音每挖一格加一，到了不公开的数唤醒监守者：挖响的人手上扣一半（盾牌挡不住、末影箱不算），卡关闭", () => {
    const g = game();
    const card = lay(biomeCard(g, "deep"), {});
    card.wardenAt = 3;
    const p = newPlayer(g, 10001, "小明");
    p.shields = 2;
    p.shield = true;
    p.chest = 7;
    p.items.torch = 1;
    dig(g, p, { cardId: card.id, index: 20, now: later() });
    assert.ok(useItem(g, p, { item: "torch", cardId: card.id, index: 20, now: later() }).ok);
    dig(g, p, { cardId: card.id, index: 21, now: later() });
    assert.deepEqual([publicCard(card).noise, publicCard(card).closed], [2, false]);
    const loud = dig(g, p, { cardId: card.id, index: 22, now: later() });
    assert.ok(loud.ok);
    assert.equal(loud.result.warden, 15);
    assert.match(loud.result.text, /监守者被你吵醒了！它抢走了你待领取的一半（-0\.15）$/);
    assert.match(loud.feed.text, /吵醒了监守者，待领取的被抢走一半（-0\.15）$/);
    assert.deepEqual([p.points, p.chest, p.shields, g.used, card.closed, card.finished], [15, 7, 2, 15, true, true]);
    assert.deepEqual(p.trail.at(-1), { k: "warden", a: -15, p: 22 });
    assert.match(dig(g, p, { cardId: card.id, index: 23, now: later() }).message, /监守者醒了，这张卡已经关闭/);
    const shown = publicCard(card);
    assert.deepEqual([shown.noise, shown.closed, shown.finished, shown.torches], [3, true, true, []]);
    assert.deepEqual(shown.wokeBy, { uid: 10001, name: "小明", amount: 15, at: loud.feed.at });
  });

  it("以前开的局：盾牌挡一次就用掉（新局才叠）", () => {
    const g = game();
    delete g.rules.items;
    lay(g.cards[1], { 0: "shield", 1: "tnt", 2: "tnt" });
    const p = newPlayer(g, 10001, "小明");
    p.chances = 9;
    assert.ok(dig(g, p, { cardId: 1, index: 0, now: later() }).ok);
    assert.equal(p.shield, true);
    assert.equal(dig(g, p, { cardId: 1, index: 1, now: later() }).result.blocked, true);
    assert.equal(p.shield, false);
    assert.equal(dig(g, p, { cardId: 1, index: 2, now: later() }).result.blocked, false);
  });

  it("监守者关了的卡：望远镜也不能看（看了也挖不了）", () => {
    const g = game();
    const deep = lay(biomeCard(g, "deep"), {});
    deep.closed = true;
    const p = newPlayer(g, 10001, "小明");
    p.spyglasses = 1;
    assert.match(useItem(g, p, { item: "spyglass", cardId: deep.id, index: 3, now: later() }).message, /已经关闭/);
    assert.equal(p.spyglasses, 1);
  });

  it("地图不会长不动：岩浆不吞末影珍珠和末影之眼；还能挖的卡上一颗珍珠都不剩时，在刚挖的卡旁边长一张新卡", () => {
    const g = game();
    lay(g.cards[1], {});
    const nether = lay(biomeCard(g, "nether"), { 1: "pearl", 6: "eye" }, { 0: "lava" });
    const p = newPlayer(g, 10001, "小明");
    p.chances = 99;
    for (const index of [35, 34]) assert.deepEqual(dig(g, p, { cardId: nether.id, index, now: later() }).burned, []);
    const third = dig(g, p, { cardId: nether.id, index: 33, now: later() });
    // 岩浆旁边只有珍珠（1）和末影之眼（6）：都不吞；岩浆从别处冒出来（这一次不流就泄露了旁边是什么）
    assert.deepEqual([nether.opened[1], nether.opened[6]], [null, null]);
    assert.equal(third.burned.length, 1);
    assert.ok(![1, 6].includes(third.burned[0].index), String(third.burned[0].index));

    const h = game();
    lay(h.cards[1], {});
    const deep = lay(biomeCard(h, "deep"), { 5: "pearl" });
    deep.wardenAt = 1;
    const q = newPlayer(h, 10001, "小明");
    const before = Object.keys(h.cards).length;
    const loud = dig(h, q, { cardId: deep.id, index: 0, now: later() });
    assert.ok(loud.ok && deep.closed);
    // 卡关了，珍珠跟着关在里面：矿洞里没有能挖的珍珠了，旁边长出一张新卡（有珍珠）
    assert.ok(loud.newCard);
    assert.equal(loud.result.newCardId, loud.newCard.id);
    assert.equal(Object.keys(h.cards).length, before + 1);
    assert.ok(loud.newCard.deck.includes("pearl"));
    assert.match(loud.feed.text, /矿洞里没有末影珍珠了，旁边长出一张新卡/);
    // 新卡上有珍珠了：再挖别的不会再长
    const next = dig(h, q, { cardId: 1, index: 0, now: later() });
    assert.equal(next.newCard, null);
  });

  it("苦力怕：手上有分时按最后一次动的时刻倒数；到点（加 10 秒倒数、留 2 秒余量）才炸掉手上的 20%，回到预算", () => {
    const g = game();
    stack(g, 1, {});
    const p = newPlayer(g, 10001, "小明");
    const t = clock + 60_000;
    assert.equal(privatePlayer(p, g, t).creeperMs, null); // 手上没分
    assert.ok(dig(g, p, { cardId: 1, index: 0, now: t }).ok);
    assert.equal(p.activeAt, t);
    assert.equal(privatePlayer(p, g, t + 1000).creeperMs, 59_000);
    assert.equal(privatePlayer(p, g, t + 99_000).creeperMs, 0);
    assert.deepEqual(creeperBlast(g, p, t + 67_999), { ok: false, message: "苦力怕还没到时候" });
    p.chest = 100;
    const boom = creeperBlast(g, p, t + 68_000);
    assert.ok(boom.ok);
    assert.equal(boom.lost, 2);
    assert.match(boom.text, /苦力怕爆炸了！待领取的奖励 -0\.02（20%）/);
    assert.deepEqual([p.points, p.chest, g.used, p.activeAt], [8, 100, 8, t + 68_000]);
    assert.deepEqual(p.trail.at(-1), { k: "creeper", a: -2, p: 108 });
    assert.equal(privatePlayer(p, g, t + 68_000).creeperMs, 60_000);
    // 用道具重新计时
    p.spyglasses = 1;
    assert.ok(useItem(g, p, { item: "spyglass", cardId: 1, index: 5, now: t + 100_000 }).ok);
    assert.equal(p.activeAt, t + 100_000);
    assert.equal(creeperBlast(g, p, t + 160_000).ok, false);
    // 不开、领了时没有
    const off = game({ params: { creeper: 0 } });
    const q = newPlayer(off, 10002, "小红");
    q.points = 10;
    assert.equal(privatePlayer(q, off, t).creeperMs, null);
    assert.equal(creeperBlast(off, q, t + 999_000).message, "这一局没有苦力怕");
    claim(g, p, t + 200_000);
    assert.equal(privatePlayer(p, g, t + 300_000).creeperMs, null);
    assert.match(creeperBlast(g, p, t + 300_000).message, /已经领取了/);
    clock = t + 400_000;
  });

  it("只给本人看的：新局多出道具和各种状态", () => {
    const g = game();
    const me = privatePlayer(newPlayer(g, 10001, "小明"), g, clock);
    assert.deepEqual(Object.keys(me).sort(), [
      "chances", "chest", "coal", "coolingMs", "creeperMs", "digs", "hasteMs", "items", "lastResult", "peeks", "points",
      "poison", "shield", "shields", "slowMs", "spyglasses", "status", "stick", "tableChoices", "vaultsOpened",
    ]);
    assert.deepEqual(me.items, { torch: 0, map: 0, potion: 0, ender: 0, table: 0, key: 0, pick: { h: 0, v: 0, x: 0 } });
    assert.deepEqual([me.hasteMs, me.slowMs, me.tableChoices, me.creeperMs, me.vaultsOpened], [0, 0, null, null, []]);
  });
});

describe("不领的人（第 2 版，docs/V3_ITEMS.md §9）", () => {
  it("苦力怕每次至少扣 0.01（第 1 版 4 分以下扣 0）", () => {
    const g = game();
    const p = newPlayer(g, 10001, "小明");
    const t = clock + 1000;
    p.points = 4;
    g.used = 4;
    p.activeAt = t;
    const boom = creeperBlast(g, p, t + 68_000);
    assert.deepEqual([boom.ok, boom.lost, p.points, g.used], [true, 1, 3, 3]);
    g.rules.items = 1;
    p.activeAt = t + 68_000;
    assert.equal(creeperBlast(g, p, t + 136_000).lost, 0);
  });

  it("5 分钟没动起每 60 秒炸一次（20%，至少 0.01），到点的几次一起算，怎么分着算结果都一样；动一下重来", () => {
    const make = () => {
      const g = game();
      const p = newPlayer(g, 10001, "小明");
      p.points = 1000;
      g.used = 1000;
      p.activeAt = clock;
      return { g, p };
    };
    const t = clock;
    const { g, p } = make();
    assert.equal(idleNextAt(g, p, t), t + IDLE_MS);
    assert.equal(drainIdle(g, p, t + IDLE_MS - 1), 0);
    assert.equal(drainIdle(g, p, t + IDLE_MS), 200);
    assert.equal(drainIdle(g, p, t + IDLE_MS + IDLE_EVERY_MS - 1), 0);
    assert.equal(idleNextAt(g, p, t + IDLE_MS), t + IDLE_MS + IDLE_EVERY_MS);
    assert.equal(drainIdle(g, p, t + IDLE_MS + 2 * IDLE_EVERY_MS), 160 + 128);
    assert.deepEqual([p.points, g.used], [512, 512]);
    assert.deepEqual(p.trail.slice(-2), [{ k: "creeper", a: -200, p: 800 }, { k: "creeper", a: -288, p: 512 }]);
    // 一次算到同一时刻：一样
    const other = make();
    assert.equal(drainIdle(other.g, other.p, t + IDLE_MS + 2 * IDLE_EVERY_MS), 488);
    // 一直没人来：扣到 0 为止（最后几次各 0.01）
    drainIdle(g, p, t + IDLE_MS + 60 * IDLE_EVERY_MS);
    assert.deepEqual([p.points, g.used, idleNextAt(g, p, t + 3600_000)], [0, 0, null]);
    // 动一下（activeAt 变了）重新算 5 分钟
    const back = make();
    drainIdle(back.g, back.p, t + IDLE_MS);
    back.p.activeAt = t + IDLE_MS + 1000;
    assert.equal(drainIdle(back.g, back.p, t + IDLE_MS + 2000), 0);
    assert.equal(idleNextAt(back.g, back.p, t + IDLE_MS + 2000), t + 2 * IDLE_MS + 1000);
  });

  it("不炸的：苦力怕关着、第 1 版、领了、手上没分、机会用完、快截止；苦力怕参数比 5 分钟长时等它先来", () => {
    const t = clock;
    const holder = (/** @type {Record<string, unknown>} */ params = {}) => {
      const g = game({ params });
      const p = newPlayer(g, 10001, "小明");
      p.points = 100;
      g.used = 100;
      p.activeAt = t;
      return { g, p };
    };
    const late = t + 3600_000;
    const off = holder({ creeper: 0 });
    assert.equal(drainIdle(off.g, off.p, late), 0);
    const old = holder();
    old.g.rules.items = 1;
    assert.equal(drainIdle(old.g, old.p, late), 0);
    const claimed = holder();
    claim(claimed.g, claimed.p, t);
    assert.equal(drainIdle(claimed.g, claimed.p, late), 0);
    const empty = holder();
    empty.p.chances = 0;
    assert.equal(drainIdle(empty.g, empty.p, late), 0);
    const wrap = holder();
    assert.equal(drainIdle(wrap.g, wrap.p, T0 + DAY - WRAP_UP_MS), 0);
    const slow = holder({ creeper: 600 });
    assert.equal(idleNextAt(slow.g, slow.p, t), t + 610_000);
  });
});

describe("以前开的局（没有 rules.items）", () => {
  it("牌和以前一模一样，没有新格子、区块、火把，人也没有道具", () => {
    const rules = rulesOf({ boardSpec: "random", smallReward: 10 });
    delete rules.items;
    delete rules.creeper;
    const g = createGame({ seed: "seed-a", rules, pool: 10000, openedAt: T0, deadlineAt: null });
    // 2026-11-10 发布的版本（HEAD）算出来的
    assert.equal(g.cards[1].deck.join(","), "emerald,tnt,emerald,tnt,emerald,apple,emerald,shield,tnt,tnt,tnt,totem,diamond,totem,emerald,emerald,tnt,diamond,tnt,apple,emerald,diamond,tnt,emerald,spyglass,emerald,emerald,spyglass,totem,pearl,diamond,tnt,shield,shield,emerald,diamond,totem,totem,emerald,emerald,spyglass,emerald,emerald,diamond,emerald,spyglass,emerald,pearl,diamond");
    assert.equal(newEndCard(g, 9, 3, 3).deck.join(","), "diamond,diamond,totem,totem,apple,diamond,diamond,emerald,crystal");
    const old = ["emerald", "diamond", "apple", "totem", "tnt", "pearl", "shield", "spyglass", "eye", "crystal"];
    for (let id = 2; id < 80; id++) {
      const card = newCard(g, id, id, 0);
      assert.deepEqual([card.kind, card.fixed, card.torches], [undefined, undefined, undefined]);
      assert.ok(card.deck.every((kind) => old.includes(kind)));
      assert.deepEqual(Object.keys(card.composition), old);
    }
    const p = newPlayer(g, 10001, "小明");
    assert.equal("items" in p, false);
    const me = privatePlayer(p, g, T0);
    for (const key of ["items", "coal", "chest", "creeperMs", "tableChoices"]) assert.equal(key in me, false, key);
    assert.equal("chest" in summaryOf(g, p).me, false);
    assert.equal("torches" in publicCard(g.cards[1]), false);
    assert.match(useItem(g, p, { item: "pick-x", cardId: 1, index: 12, now: T0 }).message, /没有道具栏/);
    assert.equal(creeperBlast(g, p, T0).ok, false);
  });
});

describe("区块的新摆法（rules.layout: 2，docs/V3_ITEMS.md §10）", () => {
  /** 一格连着哪几边 */
  const SIDES = { ns: ["n", "s"], ew: ["e", "w"], ne: ["n", "e"], se: ["s", "e"], sw: ["s", "w"], nw: ["n", "w"] };
  const STEP = { n: [-1, 0], e: [0, 1], s: [1, 0], w: [0, -1] };
  const BACK = { n: "s", s: "n", e: "w", w: "e" };

  it("铁轨连得起来：挨着的两格互相连着，卡边上的只朝外穿出去，不在卡边拐弯；会拐弯、会断开一格、有的卡有第二段", () => {
    let turns = 0, gaps = 0, seconds = 0;
    const counts = new Set();
    for (let n = 0; n < 800; n++) {
      const rails = railsOf(randomOf(`rails-${n}`, "card:7"), 6, RAIL_OPTIONS);
      const at = new Map(Object.entries(rails).map(([index, shape]) => [Number(index), shape]));
      counts.add(at.size);
      for (const [index, shape] of at) {
        const r = Math.floor(index / 6), c = index % 6;
        for (const side of SIDES[shape]) {
          const [dr, dc] = STEP[side];
          const nr = r + dr, nc = c + dc;
          const inside = nr >= 0 && nr < 6 && nc >= 0 && nc < 6;
          const next = inside ? at.get(nr * 6 + nc) : undefined;
          // 连着的那边：卡外、断开的空格（只在直道两头），或者一格也连回来的铁轨
          if (next) assert.ok(SIDES[next].includes(BACK[side]), `${n}: ${index} ${shape} → ${next}`);
          else if (inside) gaps += 1;
        }
        // 四周挨着的铁轨都是连着的（不贴着自己走）
        for (const [side, [dr, dc]] of Object.entries(STEP)) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < 6 && nc >= 0 && nc < 6 && at.has(nr * 6 + nc)) assert.ok(SIDES[shape].includes(side), `${n}: ${index} touches ${nr * 6 + nc}`);
        }
        const border = r === 0 || c === 0 || r === 5 || c === 5;
        if (border) assert.ok(shape === "ns" || shape === "ew", `${n}: ${index} ${shape} on the border`);
        if (r === 0 || r === 5) assert.equal(shape, "ns");
        if (c === 0 || c === 5) assert.equal(shape, "ew");
      }
      if ([...at.values()].some((shape) => shape !== "ns" && shape !== "ew")) turns += 1;
      // 两段：连通的块数
      const left = new Set(at.keys());
      let parts = 0;
      while (left.size) {
        parts += 1;
        const stack = [left.values().next().value];
        while (stack.length) {
          const index = stack.pop();
          if (!left.delete(index)) continue;
          for (const side of SIDES[at.get(index)]) {
            const [dr, dc] = STEP[side];
            const nr = Math.floor(index / 6) + dr, nc = (index % 6) + dc;
            if (nr >= 0 && nr < 6 && nc >= 0 && nc < 6 && left.has(nr * 6 + nc)) stack.push(nr * 6 + nc);
          }
        }
      }
      if (parts > 1) seconds += 1;
    }
    assert.ok(turns > 700, `turns ${turns}`);
    assert.ok(gaps > 0 && seconds > 0, `${gaps} ${seconds}`);
    assert.ok(Math.min(...counts) >= 4 && Math.max(...counts) <= 12, [...counts].join());
  });

  it("新局的矿井、试炼密室、下界按新摆法；同一个种子同一张卡每次一样；公开的卡带着铁轨的形状", () => {
    const g = game({ params: { eyeEvery: 0 }, layout: true });
    let pools = 0, nethers = 0;
    const layouts = new Set();
    for (let id = 2; id < 1002; id++) {
      const card = newCard(g, id, id, 0);
      assert.deepEqual(newCard(g, id, id, 0), card);
      const fixed = Object.entries(card.fixed ?? {});
      for (const [index, what] of fixed) assert.equal(card.deck[Number(index)], what);
      const dug = card.deck.filter((_, index) => !card.fixed?.[index]);
      assert.equal(dug.length, card.size * card.size - fixed.length);
      for (const [what, number] of Object.entries(card.composition)) assert.equal(count(dug, what), number, `${card.kind} ${what}`);
      if (card.kind === "mine") {
        assert.deepEqual(Object.keys(card.rails ?? {}).sort(), fixed.map(([index]) => index).sort());
        assert.ok(fixed.every(([, what]) => what === "deco"));
        assert.deepEqual(publicCard(card).rails, card.rails);
        assert.ok(card.composition.emerald >= 1, String(card.composition.emerald));
      } else assert.equal(card.rails, undefined);
      if (card.kind === "trial") {
        const vaults = fixed.filter(([, what]) => what === "vault").map(([index]) => index);
        assert.equal(vaults.length, 2);
        assert.deepEqual(Object.keys(card.vaults ?? {}).sort(), vaults.sort());
        layouts.add(fixed.map(([index, what]) => `${index}${what[0]}`).sort().join());
      }
      if (card.kind === "nether") {
        nethers += 1;
        const [a, b] = fixed.map(([index]) => Number(index));
        if (Math.abs(a - b) === 6 || (Math.abs(a - b) === 1 && Math.floor(a / 6) === Math.floor(b / 6))) pools += 1;
      }
    }
    assert.ok(layouts.size >= 10, String(layouts.size));
    assert.ok(pools > nethers * 0.4 && pools < nethers * 0.7, `${pools}/${nethers}`);
  });
});

/** 第 at 个角上亮着的火把（灭了是 undefined）。 */
function torchAt(card, at) {
  return publicTorches(card).find((torch) => torch.at === at);
}

describe("特殊区块和监守者（rules.special: 2，docs/V3_ITEMS.md §16、§17）", () => {
  it("末影珍珠长的卡只有普通、废弃矿井、试炼密室，大约 50 / 40 / 10", () => {
    const g = game({ special: true });
    const seen = { normal: 0, mine: 0, trial: 0 };
    for (let id = 2; id < 1002; id++) {
      const kind = newCard(g, id, id, 0).kind ?? "normal";
      assert.ok(kind in seen, kind);
      seen[kind] += 1;
    }
    assert.ok(Math.abs(seen.normal - 500) < 80 && Math.abs(seen.mine - 400) < 80 && Math.abs(seen.trial - 100) < 50, JSON.stringify(seen));
  });

  it("末影之眼在远处开特殊区块：末地宝藏、深暗之域、下界，大约 50 / 25 / 25；开出来的卡记着 fromEye、不藏眼、不算进“每几张一颗眼”", () => {
    const seen = { end: 0, deep: 0, nether: 0 };
    for (let n = 0; n < 200; n++) {
      const g = game({ special: true, seed: `eye-${n}`, params: { eyeEvery: 0 } });
      stack(g, 1, { 7: "eye" });
      const p = newPlayer(g, 10001, "小明");
      const out = dig(g, p, { cardId: 1, index: 7, now: later() });
      assert.ok(out.ok);
      const grown = g.cards[out.feed.newCardId];
      assert.ok(grown.kind in seen, grown.kind);
      seen[grown.kind] += 1;
      assert.equal(grown.fromEye, true);
      assert.equal(publicCard(grown).fromEye, true);
      assert.equal(grown.composition.eye ?? 0, 0);
      const name = { end: "末地宝藏", deep: "深暗之域", nether: "下界" }[grown.kind];
      assert.equal(out.result.text.includes(`远处开出了${name}`), true, out.result.text);
      assert.match(out.feed.text, new RegExp(`挖到末影之眼，${name}开了`));
    }
    assert.ok(seen.end > 70 && seen.end < 130 && seen.deep > 25 && seen.nether > 25, JSON.stringify(seen));
    // 眼开的特殊区块不算张数：第 3 张珍珠长的卡才藏眼
    const g = game({ special: true, params: { eyeEvery: 3 } });
    g.cards[2] = newCard(g, 2, 2, 0, "deep"); g.slots["2,0"] = 2;
    assert.equal(g.cards[2].composition.eye ?? 0, 0);
    const third = newCard(g, 3, 3, 0);
    assert.equal(third.composition.eye ?? 0, 0, "第 2 张珍珠卡不藏眼");
    g.cards[3] = third; g.slots["3,0"] = 3;
    assert.equal(newCard(g, 4, 4, 0).composition.eye, 1, "第 3 张珍珠卡藏眼");
  });

  it("深暗之域第 2 版：噪音谁挖都加一、没人挖时每 15 秒退一；两成五以前不会醒，越吵越容易醒，最吵约一成", () => {
    const g = game({ special: true });
    const card = newCard(g, 2, 2, 0, "deep");
    g.cards[2] = card; g.slots["2,0"] = 2;
    lay(card, {}, undefined);
    assert.deepEqual([card.noise, card.noiseAt, card.wardenAt], [0, 0, undefined]);
    const p = newPlayer(g, 10001, "小明");
    const q = newPlayer(g, 10002, "小红");
    let now = T0 + 1000;
    dig(g, p, { cardId: 2, index: 0, now });
    dig(g, q, { cardId: 2, index: 1, now: now + 100 });
    // 第二下隔了 0.1 秒，前一下的噪音退了一点点
    assert.ok(Math.abs(card.noise - 2) < 0.01, String(card.noise));
    // 30 秒没人挖：退两格
    assert.equal(noiseNow(card, g.rules, now + 100 + 2 * NOISE_DECAY_MS), 0);
    assert.ok(Math.abs(noiseNow(card, g.rules, now + 100 + NOISE_DECAY_MS) - 1) < 0.01);
    const shown = publicCard(card);
    assert.deepEqual([Math.round(shown.noise), shown.noiseAt], [2, now + 100]);
    // 机会：49 格的卡，噪音 12 以前是 0，满了 10%
    assert.equal(wardenChance(12, 49), 0);
    assert.ok(wardenChance(20, 49) > 0 && wardenChance(20, 49) < wardenChance(40, 49));
    assert.ok(Math.abs(wardenChance(49, 49) - 0.1) < 1e-9);
  });

  it("挖得快迟早吵醒监守者：吵醒的人扣一半、大家看得见是谁；慢慢挖（噪音退干净）能把整张挖完", () => {
    // 快：一秒一格，噪音一路涨
    let woke = 0, cleared = 0;
    for (let n = 0; n < 40; n++) {
      const g = game({ special: true, seed: `deep-${n}` });
      const card = newCard(g, 2, 2, 0, "deep");
      g.cards[2] = card; g.slots["2,0"] = 2;
      lay(card, {}, undefined);
      const p = newPlayer(g, 10001, "小明");
      p.chances = 99;
      let now = T0;
      for (let index = 0; index < 49 && !card.closed; index++) {
        now += 1500;
        const out = dig(g, p, { cardId: 2, index, now });
        if (card.closed) {
          woke += 1;
          assert.ok(index >= 12, `两成五以前不会醒：第 ${index + 1} 格`);
          assert.deepEqual(card.wokeBy, { uid: 10001, name: "小明", amount: out.result.warden ?? 0, at: now });
          assert.match(out.result.text, /监守者被你吵醒了！/);
          assert.match(out.feed.text, /吵醒了监守者/);
        }
      }
      if (!card.closed) cleared += 1;
    }
    assert.ok(woke > 25, `大多数被吵醒：${woke}/40`);
    // 慢：每格等 30 秒（噪音退回 0 再挖），一直在两成五以下，挖得完
    const g = game({ special: true, seed: "deep-slow" });
    const card = newCard(g, 2, 2, 0, "deep");
    g.cards[2] = card; g.slots["2,0"] = 2;
    lay(card, {}, undefined);
    const p = newPlayer(g, 10001, "小明");
    p.chances = 99;
    let now = T0;
    for (let index = 0; index < 49; index++) { now += 30_000; dig(g, p, { cardId: 2, index, now }); }
    assert.equal(card.closed, false);
    assert.equal(card.finished, true);
  });

  it("以前开的局照旧：珍珠也长深暗之域、下界；深暗之域还是先定一个数", () => {
    const g = game();
    const kinds = new Set();
    for (let id = 2; id < 400; id++) kinds.add(newCard(g, id, id, 0).kind ?? "normal");
    assert.ok(kinds.has("deep") && kinds.has("nether"));
    const deep = biomeCard(g, "deep");
    assert.equal(typeof deep.wardenAt, "number");
    assert.equal(deep.noiseAt, undefined);
  });
});

describe("开图有奖、附魔台多几个地方（rules.loot，docs/V3_ITEMS.md §19）", () => {
  const SEEDS = Array.from({ length: 40 }, (_, k) => `loot-${k}`);
  /** 新来的人挖开第 1 张卡的第 0 格（换成 kind） */
  const digOne = (kind, params = {}, seed = "seed-a", drop = false) => {
    const g = game({ seed, params });
    if (drop) delete g.rules.loot;
    stack(g, 1, { 0: kind });
    const p = newPlayer(g, 10001, "小明");
    const out = dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.ok(out.ok);
    return { g, p, out };
  };
  const held = (p, loot) => (loot === "spyglass" ? p.spyglasses ?? 0 : p.items[loot]);

  it("挖到末影珍珠：另得望远镜、藏宝图、试炼钥匙或附魔台，自己和大家都看得到", () => {
    assert.equal(game().rules.loot, 1);
    const seen = {};
    for (const seed of SEEDS) {
      const { p, out } = digOne("pearl", {}, seed);
      const { loot } = out.result;
      assert.ok(["spyglass", "map", "key", "table"].includes(loot), loot);
      assert.equal(held(p, loot), 1);
      assert.equal(out.result.text, `末影珍珠！旁边长出了一张新卡，还捡到了${LOOT_WORDS[loot]}`);
      assert.equal(out.feed.text, `末影珍珠长出了一张新卡，还捡到了${LOOT_WORDS[loot]}`);
      assert.ok(out.result.newCardId);
      seen[loot] = (seen[loot] ?? 0) + 1;
    }
    assert.deepEqual(Object.keys(seen).sort(), ["key", "map", "spyglass", "table"]);
  });

  it("挖掘间隔 ≥3 秒的局，末影珍珠也可能给急迫药水；1 秒的局不给（没用）", () => {
    const slow = SEEDS.map((seed) => digOne("pearl", { interval: "3" }, seed).out.result.loot);
    assert.ok(slow.includes("potion"));
    assert.ok(!SEEDS.map((seed) => digOne("pearl", {}, seed).out.result.loot).includes("potion"));
  });

  it("挖到末影之眼：另得附魔台或末影箱", () => {
    const seen = new Set();
    for (const seed of SEEDS) {
      const { p, out } = digOne("eye", {}, seed);
      const { loot } = out.result;
      assert.ok(loot === "table" || loot === "ender", loot);
      assert.equal(p.items[loot], 1);
      assert.match(out.result.text, new RegExp(`^末影之眼！远处开出了.+，还捡到了${LOOT_WORDS[loot]}$`));
      assert.match(out.feed.text, new RegExp(`开了！还捡到了${LOOT_WORDS[loot]}$`));
      seen.add(loot);
    }
    assert.equal(seen.size, 2);
  });

  it("箱子矿车：小奖、藏宝图、火把或附魔台", () => {
    const seen = new Set();
    for (const seed of SEEDS) {
      const { p, out } = digOne("minecart", {}, seed);
      const { loot } = out.result;
      if (loot === undefined) {
        assert.ok(out.result.amount > 0);
        seen.add("small");
        continue;
      }
      assert.ok(["map", "torch", "table"].includes(loot), loot);
      assert.equal(p.items[loot], 1);
      // stack 把别的格子都换成了绿宝石，没有珍珠时后面还接一句“长出一张新卡”
      assert.ok(out.result.text.startsWith(`箱子矿车里有${LOOT_WORDS[loot]}`), out.result.text);
      seen.add(loot);
    }
    assert.deepEqual([...seen].sort(), ["map", "small", "table", "torch"]);
  });

  it("2026-11-13 以前开的局（没有 loot）照旧：珍珠、眼不给道具，箱子矿车没有附魔台", () => {
    for (const seed of SEEDS) {
      const pearl = digOne("pearl", {}, seed, true);
      assert.equal(pearl.out.result.text, "末影珍珠！旁边长出了一张新卡");
      assert.equal(pearl.out.result.loot, undefined);
      assert.equal(digOne("eye", {}, seed, true).out.result.loot, undefined);
      const cart = digOne("minecart", {}, seed, true);
      assert.equal(cart.out.result.loot, undefined);
      assert.equal(cart.p.items.table, 0);
    }
  });
});

