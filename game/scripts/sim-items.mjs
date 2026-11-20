// 平衡模拟（docs/V3_ITEMS.md §7）：用真的规则（shared/rules.mjs）跑整局，看道具、垃圾格、区块
// 加进来以后，每次机会平均发出去几份小奖，奖池按预计人数能发出去多少，人和人差多少。
//
//   node game/scripts/sim-items.mjs [局数=40]
//
// 模拟的人：轮流挖，挑一张没挖完的卡随便一格（偏向最近长出来的卡），道具拿到就用（末影箱等手上
// 攒到 8 份小奖再用），机会和附魔镐都用完自动领取，不提前收手——rewardFor 也是这样假设的。
import { budgetLeft, claim, createGame, dig, newPlayer, rulesOf, totalOf, useItem } from "../shared/rules.mjs";

const RUNS = Number(process.argv[2] ?? 40);
/**
 * 每挖一下（轮到下一个人）过去多久。深暗之域的噪音会退（rules.special: 2，§16），时间走得太快噪音永远起不来；
 * 3 秒一下大约是十几二十个人一起挖时一张卡上的节奏。STEP_MS=60000 是 2026-11-11 以前的算法。
 */
const STEP_MS = Number(process.env.STEP_MS ?? 3000);

/** 一条小随机流（模拟的人怎么挑格子），和游戏的种子分开。 */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** 能挖的格子（没开、不是固定格、卡没关）。 */
const open = (card, index) => card.opened[index] === null && !card.fixed?.[index] && !card.closed;

/**
 * 跑一局。budget：按预计人数算奖池（看真的发出去多少）；不给时奖池给得很大、绿宝石固定 100 分，
 * 量“每次机会平均几份小奖”。
 */
function play({ seed, items, players, chances = 20, level = "normal", interval = "1", budget, quit = false }) {
  const params = { players, initialChances: chances, level, interval, eyeEvery: Number(process.env.EYE_EVERY ?? 3), creeper: 0 };
  const pool = budget ?? 1e12;
  const rules = rulesOf(params, pool);
  if (!items) delete rules.items;
  // OLD_SPECIAL=1：按 2026-11-12 以前的局算（珍珠什么区块都长、末影之眼只开末地、监守者到数就醒），和新的比
  if (process.env.OLD_SPECIAL) delete rules.special;
  // NO_LOOT=1：按 2026-11-13 以前的局算（挖到珍珠、眼不给道具，箱子矿车没有附魔台，§19），和新的比
  if (process.env.NO_LOOT) delete rules.loot;
  if (budget === undefined) {
    rules.smallReward = 100;
    rules.appleCap = 1000;
  }
  const game = createGame({ seed: `sim-${seed}`, rules, pool, openedAt: 0, deadlineAt: null });
  const random = rng(seed * 7919 + 1);
  const people = Array.from({ length: players }, (_, k) => Object.assign(newPlayer(game, k + 1, `p${k}`), { goal: 4 + Math.floor(random() * 37) }));
  let now = 1_000_000;
  const stats = { digs: 0, extra: 0, items: {}, biomes: {}, stalled: false };
  const cardList = () => Object.values(game.cards).filter((card) => !card.finished && !card.closed);
  const pickCell = () => {
    const cards = cardList();
    if (cards.length === 0) return null;
    // 偏向最近长出来的卡（大家往新卡跑）
    const card = random() < 0.6 ? cards[cards.length - 1 - Math.floor(random() * Math.min(3, cards.length))] : cards[Math.floor(random() * cards.length)];
    const cells = card.deck.map((_, index) => index).filter((index) => open(card, index));
    return cells.length ? { card, index: cells[Math.floor(random() * cells.length)] } : null;
  };
  const use = (player, item, at = {}) => {
    const out = useItem(game, player, { item, ...at, now });
    if (out.ok) stats.items[item] = (stats.items[item] ?? 0) + 1;
    return out;
  };
  const useItems = (player) => {
    const owned = player.items;
    if (!owned) return;
    if (owned.table > 0) for (const choice of ["h", "v", "x"]) if (use(player, "table", { choice }).ok) break;
    if (owned.potion > 0) use(player, "potion");
    if (owned.map > 0) use(player, "map");
    if (owned.ender > 0 && player.points >= rules.smallReward * 8) use(player, "ender");
    if ((player.spyglasses ?? 0) > 0) {
      const at = pickCell();
      if (at) use(player, "spyglass", { cardId: at.card.id, index: at.index });
    }
    if (owned.torch > 0) {
      const card = cardList().find((item) => item.size > 1);
      if (card) {
        const at = (1 + Math.floor(random() * (card.size - 1))) * card.size + 1 + Math.floor(random() * (card.size - 1));
        use(player, "torch", { cardId: card.id, index: at });
      }
    }
    if (owned.key > 0) {
      const vault = Object.values(game.cards).flatMap((card) => Object.entries(card.vaults ?? {})
        .filter(([index, left]) => left > 0 && !(player.vaultsOpened ?? []).includes(`${card.id}:${index}`)).map(([index]) => ({ card, index: Number(index) })))[0];
      if (vault) use(player, "key", { cardId: vault.card.id, index: vault.index });
    }
  };
  const canDig = (player) => player.chances > 0 || ["h", "v", "x"].some((shape) => (player.items?.pick[shape] ?? 0) > 0);
  let rounds = 0;
  while (!game.over && rounds < 2000) {
    rounds += 1;
    let moved = false;
    for (const player of people) {
      if (player.status !== "playing" || game.over) continue;
      now += STEP_MS;
      if (items) useItems(player);
      const shape = ["h", "v", "x"].find((key) => (player.items?.pick[key] ?? 0) > 0);
      const at = pickCell();
      if (!at) {
        stats.stalled = true;
        break;
      }
      let out;
      if (shape) {
        out = use(player, `pick-${shape}`, { cardId: at.card.id, index: at.index });
        if (out.ok) stats.extra += (out.results?.length ?? 1);
      } else if (player.chances > 0) {
        out = dig(game, player, { cardId: at.card.id, index: at.index, now });
        if (out.ok) stats.digs += 1;
      }
      if (out?.ok) moved = true;
      if (!canDig(player) && !(player.items?.table > 0)) claim(game, player, now);
      // 见好就收：每人心里有个数（4–40 份小奖之间），手上加箱子里的攒到了就领
      else if (quit && totalOf(player) >= player.goal * rules.smallReward) claim(game, player, now);
    }
    if (!moved) break;
  }
  for (const player of people) if (player.status === "playing") claim(game, player, now);
  for (const card of Object.values(game.cards)) stats.biomes[card.kind ?? "normal"] = (stats.biomes[card.kind ?? "normal"] ?? 0) + 1;
  const totals = people.map(totalOf).sort((a, b) => a - b);
  return { game, people, totals, stats, rules, left: budgetLeft(game) };
}

// node game/scripts/sim-items.mjs 60 stall：地图长不动的局有多少（卡都挖完了，还有人能挖）
if (process.argv[3] === "stall") {
  for (const [players, chances] of [[20, 20], [50, 20], [200, 10]]) {
    for (const items of [false, true]) {
      let stalled = 0, burned = 0, closed = 0;
      for (let seed = 1; seed <= RUNS; seed++) {
        const { stats, game } = play({ seed, items, players, chances, budget: 10000, quit: true });
        if (stats.stalled) stalled += 1;
        for (const card of Object.values(game.cards)) card.deck.forEach((kind, index) => {
          if (kind !== "pearl") return;
          if (card.opened[index]?.burn) burned += 1;
          else if (card.closed && card.opened[index] === null) closed += 1;
        });
      }
      console.log(`${players} 人 ${chances} 次 ${items ? "新" : "旧"}：地图长不动 ${stalled}/${RUNS} 局；珍珠被岩浆吞 ${burned}，被监守者关掉 ${closed}`);
    }
  }
  process.exit(0);
}

const median = (list) => list[Math.floor(list.length / 2)];
const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;

// node game/scripts/sim-items.mjs 60 units：只跑第 1 段（校准 ITEMS_UNITS 用），另外数一数各种区块和监守者
// 1. 每次机会平均几份小奖（奖池不封顶），旧局和新局比
console.log("== 每次机会平均几份小奖（奖池很大、每人把机会挖完）==");
for (const level of ["easy", "normal", "tough"]) {
  for (const items of [false, true]) {
    const units = [];
    const extras = [];
    for (let seed = 1; seed <= RUNS; seed++) {
      const { totals, rules, stats } = play({ seed, items, players: 20, level });
      units.push(mean(totals) / rules.smallReward / rules.initialChances);
      extras.push(stats.extra / 20);
    }
    console.log(`${level.padEnd(6)} ${items ? "新局" : "旧局"}  ${mean(units).toFixed(3)} 份/次${items ? `，附魔镐多挖 ${mean(extras).toFixed(2)} 格/人` : ""}`);
    if (items && process.argv[3] === "units") {
      const biomes = {};
      let deep = 0, woke = 0;
      for (let seed = 1; seed <= RUNS; seed++) {
        const { stats, game } = play({ seed, items, players: 20, level });
        for (const [key, count] of Object.entries(stats.biomes)) biomes[key] = (biomes[key] ?? 0) + count / RUNS;
        for (const card of Object.values(game.cards)) if (card.kind === "deep") { deep += 1; if (card.closed) woke += 1; }
      }
      console.log(`       每局的卡：${Object.entries(biomes).map(([key, value]) => `${key} ${value.toFixed(1)}`).join("，")}；深暗之域 ${deep} 张，监守者醒了 ${woke} 张`);
    }
  }
}
if (process.argv[3] === "units") process.exit(0);

// 2. 按预计人数算的奖池：真的发出去多少、多早分完、人和人差多少
console.log("\n== 奖池 100.00、按预计人数算 ==");
for (const [players, chances, interval, items] of [[5, 20, "1", false], [5, 20, "1", true], [20, 20, "1", false], [20, 20, "1", true], [20, 20, "3", true], [50, 20, "1", false], [50, 20, "1", true], [200, 10, "1", false], [200, 10, "1", true]]) {
  const shares = [];
  const spreads = [];
  const overs = [];
  const zero = [];
  const item = {};
  const biomes = {};
  for (let seed = 1; seed <= RUNS; seed++) {
    const { totals, game, stats } = play({ seed, items, players, chances, interval, budget: 10000 });
    shares.push((10000 - budgetLeft(game)) / 10000);
    spreads.push(totals.at(-1) / Math.max(1, median(totals)));
    overs.push(game.over ? 1 : 0);
    zero.push(totals.filter((total) => total <= 0).length / players);
    for (const [key, count] of Object.entries(stats.items)) item[key] = (item[key] ?? 0) + count / RUNS / players;
    for (const [key, count] of Object.entries(stats.biomes)) biomes[key] = (biomes[key] ?? 0) + count / RUNS;
  }
  console.log(`${items ? "新" : "旧"} ${String(players).padStart(3)} 人 ${chances} 次 间隔 ${interval}s：发出 ${(mean(shares) * 100).toFixed(1)}%，分完 ${(mean(overs) * 100).toFixed(0)}% 局，最多/中位 ${mean(spreads).toFixed(1)} 倍，0 分 ${(mean(zero) * 100).toFixed(0)}% 人`);
  if (!items) continue
  console.log(`      每人用道具：${Object.entries(item).map(([key, value]) => `${key} ${value.toFixed(2)}`).join("，")}`);
  console.log(`      每局的卡：${Object.entries(biomes).map(([key, value]) => `${key} ${value.toFixed(1)}`).join("，")}`);
}

// 3. 真人会见好就收：同样按预计人数算的奖池，旧局和新局发出去多少
console.log("\n== 奖池 100.00、按预计人数算、每人攒到 4–40 份小奖就领 ==");
for (const [players, chances, level] of [[20, 20, "easy"], [20, 20, "normal"], [20, 20, "tough"], [50, 20, "normal"], [200, 10, "normal"]]) {
  const row = [];
  for (const items of [false, true]) {
    const shares = [];
    const zero = [];
    for (let seed = 1; seed <= RUNS; seed++) {
      const { totals, game } = play({ seed, items, players, chances, level, budget: 10000, quit: true });
      shares.push((10000 - budgetLeft(game)) / 10000);
      zero.push(totals.filter((total) => total <= 0).length / players);
    }
    row.push(`${items ? "新" : "旧"} 发出 ${(mean(shares) * 100).toFixed(1)}%，0 分 ${(mean(zero) * 100).toFixed(0)}%`);
  }
  console.log(`${String(players).padStart(3)} 人 ${chances} 次 ${level.padEnd(6)}：${row.join("；")}`);
}
