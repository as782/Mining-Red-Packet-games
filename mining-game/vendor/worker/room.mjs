// 一个红包一局（docs/V3_MAP.md §7）：地图、每人的分和机会、预算、动态。
// Durable Object 里只有一份，挖和领都在这里排队，不会两个人挖到同一格。
// 存储按键分开：game（不含卡的整局）、card:<id>、player:<uid>、log:<seq>（每一挖，
// 用来重放核对）、nonce:<nonce>（用过的 nonce）。存储接口是 Durable Object 的
// storage 那几个方法，测试里用一个 Map 顶替。

import {
  amountOf, claim, createGame, creeperBlast, dig, digBlocked, drainIdle, IDLE_EVERY_MS, idleDelayOf, idleNextAt,
  newPlayer, privatePlayer, publicCard, publicGame, publicNoise, publicTorches, rulesOf, summaryOf, topWith, totalOf, useItem,
} from "../shared/rules.mjs";
import { BOT_BASE, BOT_COUNT, pickCell } from "./bots.mjs";

/**
 * @typedef {{
 *   get(key: string): Promise<unknown>,
 *   put(entries: Record<string, unknown>): Promise<void>,
 *   list(options: { prefix: string }): Promise<Map<string, unknown>>,
 *   delete(keys: string[]): Promise<number>,
 * }} Storage
 */
/**
 * 红包信息（红包站 GET /api/hongbao/:id）里用到的几项。
 * @typedef {{
 *   id: string, status: 'active'|'ended'|'draft', paused?: boolean,
 *   params?: Record<string, unknown>, unit?: string, pool?: string,
 *   step?: string, units?: { pool: number, unclaimed: number|null },
 *   openedAt?: string, deadlineAt?: string|null,
 *   scope?: import("./scope.mjs").Scope|null,
 * }} Info
 */
/** @typedef {import("../shared/rules.mjs").Game} Game */
/** @typedef {import("../shared/rules.mjs").Player} Player */
/** @typedef {import("../shared/rules.mjs").Card} Card */
/** @typedef {import("../shared/rules.mjs").CellOut} CellOut */

/**
 * 推送第 2 版：只说变了的那一格（网页自己把它放到卡上、减掉剩下的数、看挖完没有），
 * 一条两百字节左右；第 1 版每条带整张卡（谁挖的名字每格一份），挖满的 7×7 卡一条一千五。
 * 新局另有（docs/V3_ITEMS.md §4）：torches（这张卡插过火把时，亮着的那些，颜色按现在算）、
 * burned（这一挖让岩浆吞掉的格子）、noise / noiseAt / closed / wokeBy（深暗之域的卡，publicNoise）、
 * vaults（试炼密室的宝库还能开几次）。
 * @typedef {{
 *   type: "cell", seq: number, cardId: number, index: number,
 *   cell: { kind: string, uid: number, name: string, at: number },
 *   newCard: ReturnType<typeof publicCard>|null, text: string,
 *   left: number, over: boolean, stats: Game["stats"],
 *   torches?: ReturnType<typeof publicTorches>, burned?: CellOut["burned"],
 *   noise?: number, noiseAt?: number, closed?: boolean, wokeBy?: { uid: number, name: string, amount: number, at: number },
 *   vaults?: Record<string, number>,
 * }} CellMessage
 */
/** 内存里留最近这么多条第 2 版推送，网页漏了几条时按序号补（GET /since），不用重读整局。 */
export const RECENT_LIMIT = 2000;

export class RoomError extends Error {
  constructor(/** @type {number} */ status, /** @type {string} */ message) {
    super(message);
    this.status = status;
  }
}

export class MineRoom {
  /** @type {Game|null} */
  game = null;
  /** @type {Map<number, Player>} */
  players = new Map();
  loaded = false;
  /**
   * 最近的第 2 版推送，序号连着（重启以后从空的开始，补不上的就给整局）。
   * @type {CellMessage[]}
   */
  recent = [];
  /** 下一个挖的机器人（Stage 压测） */
  botNext = 0;
  /**
   * 不领的人（docs/V3_ITEMS.md §9）：手上有分的人记一个 hold:<uid>（只在开始、不再有分时写），闹钟
   * 按它找人；holders 是内存里的那一份（null 是还没读），holdNext 是每人下一次该炸的时刻（算过的才有，
   * 闹钟醒来时没到点的不用读这个人）。alarmAt：定好的闹钟（undefined 是还没问过）。
   * @type {Set<number>|null}
   */
  holders = null;
  /** @type {Map<number, number>} */
  holdNext = new Map();
  /** @type {number|null|undefined} */
  alarmAt = undefined;
  /** 要推给大家、还没交出去的（不领的人被炸以后奖池变了）；游戏站每次处理完请求取走。 @type {Record<string, unknown>[]} */
  outbox = [];

  /**
   * @param {Storage} storage
   * @param {{
   *   sign: (fields: { openedAt: number, id: number, points: number }) => Promise<string>, seed: () => string,
   *   alarm?: { get: () => Promise<number|null>, set: (at: number) => Promise<void> },
   * }} tools
   */
  constructor(storage, tools) {
    this.storage = storage;
    this.tools = tools;
  }

  async load() {
    if (this.loaded) return;
    const meta = /** @type {Omit<Game, 'cards'>|undefined} */ (await this.storage.get("game"));
    if (meta) {
      const cards = await this.storage.list({ prefix: "card:" });
      this.game = /** @type {Game} */ ({ ...meta, cards: Object.fromEntries([...cards.values()].map((card) => [/** @type {{ id: number }} */ (card).id, card])) });
    }
    this.loaded = true;
  }

  /** 第一次有人来、红包已经开放时开局；参数、预算、时间都取红包信息的。 */
  async gameFor(/** @type {Info} */ info) {
    await this.load();
    if (this.game) return this.game;
    if (info.status === "draft" || !info.openedAt || !info.pool)
      throw new RoomError(409, "红包还没开放");
    // 记账按多少个最小单位（docs/V3_ITEMS.md §11）：红包信息的 units 就是这个数；LDC 和🐟的最小单位是 0.01，
    // 就是分，和 pool 换算出来的一样（没有 units 的旧红包站照旧按 pool 换算）。三方积分红包记下最小单位，写给人看的数照它写
    const pool = info.units?.pool ?? amountOf(info.pool);
    const step = info.step && info.step !== "0.01" ? info.step : null;
    const game = createGame({
      seed: this.tools.seed(),
      rules: { ...rulesOf(info.params ?? {}, pool), ...(step ? { step } : {}) },
      pool,
      openedAt: Date.parse(info.openedAt),
      deadlineAt: info.deadlineAt ? Date.parse(info.deadlineAt) : null,
    });
    const { cards, ...meta } = game;
    /** @type {Record<string, unknown>} */
    const entries = { game: meta };
    for (const card of Object.values(cards)) entries[`card:${card.id}`] = card;
    await this.storage.put(entries);
    this.game = game;
    return game;
  }

  async playerOf(/** @type {Game} */ game, /** @type {number} */ uid, /** @type {string} */ name) {
    let player = this.players.get(uid);
    if (!player) {
      player = /** @type {Player|undefined} */ (await this.storage.get(`player:${uid}`)) ?? newPlayer(game, uid, name);
      this.players.set(uid, player);
    }
    return player;
  }

  /** nonce 只能用一次；用过的记 15 分钟（比它的有效期长）。 */
  async takeNonce(/** @type {string} */ nonce, /** @type {number} */ now) {
    const key = `nonce:${nonce}`;
    if (await this.storage.get(key)) return false;
    await this.storage.put({ [key]: now });
    const used = await this.storage.list({ prefix: "nonce:" });
    const stale = [...used].filter(([, at]) => now - Number(at) > 15 * 60 * 1000).map(([name]) => name);
    if (stale.length > 0) await this.storage.delete(stale);
    return true;
  }

  /**
   * 整局和自己的。网页打开（hello、GET /state）时苦力怕重新计时（touch；只记在内存里，不为它
   * 写存储）；漏了推送补整局时不算（since 传 touch: false）。
   */
  async state(/** @type {Info} */ info, /** @type {number} */ uid, /** @type {string} */ name, /** @type {number} */ now, { touch = true } = {}) {
    const game = await this.gameFor(info);
    const player = await this.playerOf(game, uid, name);
    const drained = await this.settle(info, game, player, now);
    if (touch && game.rules.items) player.activeAt = now;
    return {
      game: publicGame(game), me: this.me(info, game, player, now), blocked: this.blocked(info, game, player, now),
      ...(drained > 0 ? { drained } : {}),
    };
  }

  /**
   * 不领的人回来了（或者来看一眼）：先把离开时该炸的几次算掉、存下，再做别的；红包结束、暂停时不算。
   * 炸掉的回到奖池，推一条 drain 给大家改奖池还剩多少。返回炸掉的分。
   */
  async settle(/** @type {Info} */ info, /** @type {Game} */ game, /** @type {Player} */ player, /** @type {number} */ now) {
    if (info.status !== "active" || info.paused) return 0;
    const lost = drainIdle(game, player, now);
    if (lost > 0) {
      const { cards: _cards, ...meta } = game;
      await this.save(game, player, { game: meta, [`player:${player.uid}`]: player }, now);
      this.outbox.push({ type: "drain", uids: [player.uid], left: game.pool - game.used, over: game.over });
    }
    return lost;
  }

  /** 存一个人（和同一次要存的别的）：手上有分的第 2 版局记进 hold:，不再有分时删掉，并确保有闹钟。 */
  async save(/** @type {Game} */ game, /** @type {Player} */ player, /** @type {Record<string, unknown>} */ entries, /** @type {number} */ now) {
    if ((game.rules.items ?? 0) < 2) {
      await this.storage.put(entries);
      return;
    }
    const holders = await this.holderSet();
    const key = `hold:${player.uid}`;
    const holding = player.status === "playing" && player.points > 0;
    if (holding && !holders.has(player.uid)) {
      entries[key] = 1;
      holders.add(player.uid);
    }
    await this.storage.put(entries);
    if (!holding && holders.has(player.uid)) {
      holders.delete(player.uid);
      this.holdNext.delete(player.uid);
      await this.storage.delete([key]);
    }
    if (!holding) return;
    const next = idleNextAt(game, player, now);
    if (next === null) this.holdNext.delete(player.uid);
    else this.holdNext.set(player.uid, next);
    await this.wake(game, now);
  }

  /** hold: 的那些人（第一次要时读一遍）。 */
  async holderSet() {
    if (this.holders) return this.holders;
    const keys = await this.storage.list({ prefix: "hold:" });
    this.holders = new Set([...keys.keys()].map((key) => Number(key.slice(5))));
    return this.holders;
  }

  /** 有人手上有分时确保有闹钟：没有定好的，就定在最早可能该炸的时候（现在加 5 分钟）。 */
  async wake(/** @type {Game} */ game, /** @type {number} */ now) {
    const alarm = this.tools.alarm;
    if (!alarm) return;
    if (this.alarmAt === undefined) this.alarmAt = await alarm.get();
    if (this.alarmAt !== null && this.alarmAt !== undefined && this.alarmAt >= now - IDLE_EVERY_MS) return;
    this.alarmAt = now + idleDelayOf(game.rules);
    await alarm.set(this.alarmAt);
  }

  /**
   * 闹钟（每个红包一个，只在有人手上有分时定，最多一分钟醒一次）：把到点的不领的人该炸的几次算掉、
   * 存下，推一条 drain；再按最早的下一次定闹钟。红包结束了就不再定；暂停时 5 分钟后再看。
   * @returns {Promise<{ drained: number[], left: number, over: boolean }>}
   */
  async alarm(/** @type {Info} */ info, /** @type {number} */ now) {
    this.alarmAt = null;
    await this.load();
    const game = this.game;
    if (!game || info.status !== "active") return { drained: [], left: 0, over: true };
    const set = async (/** @type {number} */ at) => {
      this.alarmAt = Math.max(at, now + IDLE_EVERY_MS);
      await this.tools.alarm?.set(this.alarmAt);
    };
    if (info.paused) {
      await set(now + 5 * IDLE_EVERY_MS);
      return { drained: [], left: game.pool - game.used, over: game.over };
    }
    const holders = await this.holderSet();
    /** @type {number[]} */
    const drained = [];
    /** @type {Record<string, unknown>} */
    const entries = {};
    /** @type {string[]} */
    const gone = [];
    let next = Infinity;
    for (const uid of [...holders]) {
      const known = this.holdNext.get(uid);
      if (known !== undefined && known > now) {
        next = Math.min(next, known);
        continue;
      }
      const player = this.players.get(uid) ?? /** @type {Player|undefined} */ (await this.storage.get(`player:${uid}`));
      if (!player) {
        gone.push(`hold:${uid}`);
        holders.delete(uid);
        continue;
      }
      this.players.set(uid, player);
      if (drainIdle(game, player, now) > 0) {
        drained.push(uid);
        entries[`player:${uid}`] = player;
      }
      const at = player.status === "playing" && player.points > 0 ? idleNextAt(game, player, now) : null;
      if (at === null) {
        gone.push(`hold:${uid}`);
        holders.delete(uid);
        this.holdNext.delete(uid);
      } else {
        this.holdNext.set(uid, at);
        next = Math.min(next, at);
      }
    }
    if (drained.length > 0) {
      const { cards: _cards, ...meta } = game;
      entries.game = meta;
      await this.storage.put(entries);
    }
    if (gone.length > 0) await this.storage.delete(gone);
    if (next !== Infinity) await set(next);
    return { drained, left: game.pool - game.used, over: game.over };
  }

  /** 攒着要推的，取走。 */
  takeOutbox() {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  /**
   * 给本人看的（privatePlayer）：红包结束、暂停时苦力怕不来（creeperMs 是 null），暂停期间他来问一次
   * 就从这一刻重新计时，恢复以后不会马上炸（审查发现：暂停时照样倒数，恢复后一秒就扣）。
   */
  me(/** @type {Info} */ info, /** @type {Game} */ game, /** @type {Player} */ player, /** @type {number} */ now) {
    const mine = privatePlayer(player, game, now);
    if (info.status === "active" && !info.paused) return mine;
    if (game.rules.items && info.paused) player.activeAt = now;
    return { ...mine, ...("creeperMs" in mine ? { creeperMs: null } : {}) };
  }

  /** 现在为什么不能挖（能挖时 null）：红包结束、暂停也算。 */
  blocked(/** @type {Info} */ info, /** @type {Game} */ game, /** @type {Player} */ player, /** @type {number} */ now) {
    if (info.status !== "active") return "红包已经结束了";
    if (info.paused) return "红包暂停了，稍后再试";
    return digBlocked(game, player, now, { cooling: false });
  }

  /**
   * 挖一格：回给挖的人的，和推给大家的（broadcast 是第 1 版，cell 是第 2 版）。
   * compact：网页认第 2 版推送（它回答里的 update 也用第 2 版）。没挖成时回答里带上
   * 那张卡现在的样子（格子被别人先挖了，网页只改这一张，不重读整局）和现在为什么不能挖。
   * @returns {Promise<{ answer: Record<string, unknown>, broadcast: Record<string, unknown>|null, cell: CellMessage|null }>}
   */
  async dig(/** @type {Info} */ info, /** @type {number} */ uid, /** @type {string} */ name, /** @type {{ cardId: number, index: number }} */ at, /** @type {number} */ now, { compact = false } = {}) {
    const game = await this.gameFor(info);
    const player = await this.playerOf(game, uid, name);
    const refused = (/** @type {string} */ message) => {
      const card = game.cards[at.cardId];
      return {
        answer: {
          ok: false, message, me: this.me(info, game, player, now), blocked: this.blocked(info, game, player, now),
          ...(card ? { card: publicCard(card) } : {}),
        },
        broadcast: null,
        cell: null,
      };
    };
    if (info.status !== "active") return refused("红包已经结束了");
    if (info.paused) return refused("红包暂停了，稍后再试");
    await this.settle(info, game, player, now);
    const out = dig(game, player, { cardId: at.cardId, index: at.index, now });
    if (!out.ok) return refused(out.message);
    const { cards, ...meta } = game;
    /** @type {Record<string, unknown>} */
    const entries = {
      game: meta,
      [`card:${at.cardId}`]: cards[at.cardId],
      [`player:${uid}`]: player,
      [`log:${String(game.seq).padStart(9, "0")}`]: { uid, cardId: at.cardId, index: at.index, at: now },
    };
    if (out.newCard) entries[`card:${out.newCard.id}`] = out.newCard;
    await this.save(game, player, entries, now);
    const { broadcast, cell } = this.publish(game, player, out, { left: game.pool - game.used, over: game.over, stats: { ...game.stats } });
    // 挖的人直接拿到这次的变化（update），不等推送
    return {
      answer: {
        ok: true, result: out.result, me: this.me(info, game, player, now), claimNow: out.claimNow,
        blocked: this.blocked(info, game, player, now), update: compact ? cell : broadcast,
      },
      broadcast,
      cell,
    };
  }

  /**
   * 挖开的一格要推的两版：第 1 版带整张卡（现在的样子），第 2 版只带这一格，记进 recent。
   * snapshot 是挖完这一格那一刻的预算、结束没有、统计（附魔镐一次挖几格，每格各是各的）。
   * @param {Game} game @param {Player} player @param {CellOut} out
   * @param {{ left: number, over: boolean, stats: Game["stats"] }} snapshot
   */
  publish(game, player, out, { left, over, stats }) {
    const { result, feed } = out;
    const card = game.cards[result.cardId];
    const newCard = out.newCard ? publicCard(out.newCard) : null;
    const broadcast = { type: "dig", seq: feed.seq, card: publicCard(card), newCard, feed, left, over, stats };
    /** @type {CellMessage} */
    const cell = {
      type: "cell",
      seq: feed.seq,
      cardId: result.cardId,
      index: result.index,
      cell: { kind: result.kind, uid: player.uid, name: player.name, at: feed.at },
      newCard,
      text: feed.text,
      left,
      over,
      stats,
      ...(card.torches && card.torches.length > 0 ? { torches: publicTorches(card) } : {}),
      ...(out.burned.length > 0 ? { burned: out.burned } : {}),
      ...publicNoise(card),
      // 宝库还能开几次：card 推送没有序号，漏了补不回来；这张卡上再挖一格就跟着改过来
      ...(card.vaults ? { vaults: { ...card.vaults } } : {}),
    };
    this.remember(cell);
    return { broadcast, cell };
  }

  /**
   * 用道具（新局的道具栏，docs/V3_ITEMS.md §3、§4）。附魔镐每挖一格推一条（第 1 版、第 2 版，
   * 序号连着），回答里的 updates 是这几条第 2 版；火把、宝库改了卡推一条 { type: "card", card }
   * （没有序号，网页直接换掉那张卡）；别的只改自己的，不推送。没用成时带上那张卡现在的样子
   * （格子刚被别人挖开），和现在为什么不能挖。
   * @returns {Promise<{ answer: Record<string, unknown>, pushes: [Record<string, unknown>, Record<string, unknown>|null][] }>}
   */
  async use(
    /** @type {Info} */ info, /** @type {number} */ uid, /** @type {string} */ name,
    /** @type {{ item: string, cardId?: number, index?: number, choice?: string }} */ at, /** @type {number} */ now,
  ) {
    const game = await this.gameFor(info);
    const player = await this.playerOf(game, uid, name);
    const refused = (/** @type {string} */ message) => {
      const card = at.cardId === undefined ? undefined : game.cards[at.cardId];
      return {
        answer: {
          ok: false, message, me: this.me(info, game, player, now), blocked: this.blocked(info, game, player, now),
          ...(card ? { card: publicCard(card) } : {}),
        },
        pushes: [],
      };
    };
    if (info.status !== "active") return refused("红包已经结束了");
    if (info.paused) return refused("红包暂停了，稍后再试");
    await this.settle(info, game, player, now);
    const out = useItem(game, player, { ...at, now });
    if (!out.ok) return refused(String(out.message));
    const { cards, ...meta } = game;
    /** @type {Record<string, unknown>} */
    const entries = { [`player:${uid}`]: player };
    /** @type {[Record<string, unknown>, Record<string, unknown>|null][]} */
    const pushes = [];
    /** @type {Record<string, unknown>} */
    let answer;
    if ("cells" in out) {
      const cells = /** @type {Extract<typeof out, { cells: unknown }>["cells"]} */ (out.cells);
      entries.game = meta;
      entries[`card:${cells[0].result.cardId}`] = cards[cells[0].result.cardId];
      /** @type {CellMessage[]} */
      const updates = [];
      for (const each of cells) {
        entries[`log:${String(each.feed.seq).padStart(9, "0")}`] = { uid, cardId: each.result.cardId, index: each.result.index, at: now, via: at.item };
        if (each.newCard) entries[`card:${each.newCard.id}`] = each.newCard;
        const { broadcast, cell } = this.publish(game, player, each, each);
        pushes.push([broadcast, cell]);
        updates.push(cell);
      }
      answer = { ok: true, item: at.item, text: out.text, results: cells.map((each) => each.result), updates, claimNow: out.claimNow };
    } else {
      const { ok: _ok, card, budget, ...rest } = out;
      answer = { ok: true, item: at.item, ...rest };
      if (budget) entries.game = meta;
      if (card) {
        entries[`card:${card.id}`] = card;
        const shown = publicCard(card);
        answer.card = shown;
        pushes.push([{ type: "card", card: shown, left: game.pool - game.used, over: game.over }, null]);
      }
    }
    await this.save(game, player, entries, now);
    // left：末影箱毁掉的、中毒扣的回到奖池，没有推送，网页从这里改奖池还剩多少
    return { answer: { ...answer, left: game.pool - game.used, me: this.me(info, game, player, now), blocked: this.blocked(info, game, player, now) }, pushes };
  }

  /**
   * 苦力怕（网页倒数到点时来）：游戏站核对时间再扣，扣掉的回到预算。只改自己的，不推送。
   * @returns {Promise<Record<string, unknown>>}
   */
  async creeper(/** @type {Info} */ info, /** @type {number} */ uid, /** @type {string} */ name, /** @type {number} */ now) {
    const game = await this.gameFor(info);
    const player = await this.playerOf(game, uid, name);
    const refused = (/** @type {string} */ message) =>
      ({ ok: false, message, lost: 0, me: this.me(info, game, player, now), blocked: this.blocked(info, game, player, now) });
    if (info.status !== "active") return refused("红包已经结束了");
    if (info.paused) return refused("红包暂停了，稍后再试");
    await this.settle(info, game, player, now);
    const out = creeperBlast(game, player, now);
    if (!out.ok) return refused(out.message);
    const { cards: _cards, ...meta } = game;
    await this.save(game, player, { game: meta, [`player:${uid}`]: player }, now);
    return { ok: true, lost: out.lost, text: out.text, left: game.pool - game.used, me: this.me(info, game, player, now), blocked: this.blocked(info, game, player, now) };
  }

  /**
   * Stage 压测（bots.mjs）：机器人挖 count 格，每格挑没挖完的卡上随便一格，轮着换机器人
   * （机会用完、间隔没到的换下一个）。挖不动了（结束、快截止、都挖完）就停。
   * @returns {Promise<{ pushes: [Record<string, unknown>, CellMessage][], dug: number, cards: number, seq: number, over: boolean }>}
   */
  async botDigs(/** @type {Info} */ info, /** @type {number} */ count, /** @type {number} */ now, random = Math.random) {
    const game = await this.gameFor(info);
    /** @type {[Record<string, unknown>, CellMessage][]} */
    const pushes = [];
    for (let i = 0; i < count && !game.over; i++) {
      const at = pickCell(game, random);
      if (!at) break;
      let dug = false;
      for (let tries = 0; tries < 20 && !dug; tries++) {
        const k = this.botNext++ % BOT_COUNT;
        const { broadcast, cell } = await this.dig(info, BOT_BASE + k, `机器人 ${k + 1}`, at, now);
        if (broadcast && cell) {
          pushes.push([broadcast, cell]);
          dug = true;
        }
      }
      if (!dug) break;
    }
    return { pushes, dug: pushes.length, cards: Object.keys(game.cards).length, seq: game.seq, over: game.over };
  }

  /** 记下一条第 2 版推送；序号接不上（不该有）就从这条重新记。 */
  remember(/** @type {CellMessage} */ message) {
    const last = this.recent.at(-1);
    if (last && last.seq + 1 !== message.seq) this.recent = [];
    this.recent.push(message);
    if (this.recent.length > RECENT_LIMIT) this.recent.splice(0, this.recent.length - RECENT_LIMIT);
  }

  /**
   * 网页手上到第 seq 条，后面漏了：内存里还有就给这几条，没有（刚重启、漏得太多）就给整局。
   * @returns {Promise<{ messages: CellMessage[] } | { state: Awaited<ReturnType<MineRoom["state"]>> }>}
   */
  async since(/** @type {Info} */ info, /** @type {number} */ uid, /** @type {string} */ name, /** @type {number} */ seq, /** @type {number} */ now) {
    const game = await this.gameFor(info);
    if (seq >= game.seq) return { messages: [] };
    const first = this.recent[0];
    if (first && seq >= 0 && first.seq <= seq + 1 && this.recent.at(-1)?.seq === game.seq)
      return { messages: this.recent.slice(seq + 1 - first.seq) };
    return { state: await this.state(info, uid, name, now, { touch: false }) };
  }

  /** 收益卡：自己的逐格记录和数，全场前几名。 */
  async summary(/** @type {Info} */ info, /** @type {number} */ uid, /** @type {string} */ name) {
    const game = await this.gameFor(info);
    const player = await this.playerOf(game, uid, name);
    await this.settle(info, game, player, Date.now());
    await this.topOf(game);
    return summaryOf(game, player);
  }

  /**
   * 前几名：新开的局一直记着；记录以前开的局第一次要时从所有领过的人里算一遍，存下来，
   * 之后每领一个人更新。
   */
  async topOf(/** @type {Game} */ game) {
    if (game.top) return game.top;
    const players = await this.storage.list({ prefix: "player:" });
    /** @type {import("../shared/rules.mjs").TopEntry[]} */
    let top = [];
    for (const value of players.values()) {
      const player = /** @type {Player} */ (value);
      const latest = this.players.get(player.uid) ?? player;
      if (latest.status === "claimed") top = topWith(top, latest);
    }
    game.top = top;
    const { cards: _cards, ...meta } = game;
    await this.storage.put({ game: meta });
    return top;
  }

  /**
   * 领取：分（手上加末影箱）定下来，签一张凭证；再要一次还是同一张。
   * @returns {Promise<{ answer: Record<string, unknown>, broadcast: Record<string, unknown>|null }>}
   */
  async claim(/** @type {Info} */ info, /** @type {number} */ uid, /** @type {string} */ name, now = Date.now()) {
    const game = await this.gameFor(info);
    const player = await this.playerOf(game, uid, name);
    if (info.status !== "active" && player.status !== "claimed")
      return { answer: { ok: false, message: "红包已经结束了，没领的奖励作废", me: this.me(info, game, player, now) }, broadcast: null };
    await this.settle(info, game, player, now);
    // 手里没有分（手上加末影箱）：不签凭证（交上去只会在红包里记一笔“领取 0.00”）
    if (player.status !== "claimed" && totalOf(player) <= 0)
      return { answer: { ok: false, message: "手里还没有奖励，不用领取", me: this.me(info, game, player, now) }, broadcast: null };
    await this.topOf(game);
    const first = player.status !== "claimed";
    // 领的是手上加末影箱
    const points = claim(game, player, now);
    // ECDSA 每次签出来不一样：第一次签的存下来，再要还是这一张
    const kept = /** @type {Player & { voucher?: string }} */ (player);
    kept.voucher ??= await this.tools.sign({ openedAt: game.openedAt, id: uid, points });
    const { voucher } = kept;
    if (first) {
      const { cards: _cards, ...meta } = game;
      await this.save(game, player, { game: meta, [`player:${uid}`]: player }, now);
    }
    return {
      answer: { ok: true, voucher, points, me: this.me(info, game, player, now) },
      broadcast: first ? { type: "claim", name: player.name, points, stats: game.stats } : null,
    };
  }
}
