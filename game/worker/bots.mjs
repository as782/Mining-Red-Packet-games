// Stage 压测用的机器人（2026-11-07 用户：“有没有超大地图我试试压力”）：只有设了 BOT_KEY 的
// 环境（只在 Stage）有这个接口，生产没有这把钥匙，接口当作不存在。机器人照常走挖一格的规则
// （机会、间隔、预算都算），名字是“机器人 N”，用户编号从 BOT_BASE 起，和 LINUX DO 的编号分开。

/** @typedef {import("../shared/rules.mjs").Game} Game */

export const BOT_BASE = 900_000_000;
/** 轮着用这么多个机器人：每个两次挖掘至少隔 1 秒，一秒挖几百格也轮得开。 */
export const BOT_COUNT = 2000;
/** 一次请求最多挖几格。 */
export const BOT_DIGS_MAX = 500;

/** 挑一格：没挖完的卡里随便一张，上面没开的格子里随便一格（固定的格子挖不了，不挑）；都挖完了是 null。 */
export function pickCell(/** @type {Game} */ game, random = Math.random) {
  const open = Object.values(game.cards).filter((card) => !card.finished);
  if (open.length === 0) return null;
  const card = open[Math.floor(random() * open.length)];
  const covered = card.opened.flatMap((cell, index) => (cell === null && card.fixed?.[index] === undefined ? [index] : []));
  return { cardId: card.id, index: covered[Math.floor(random() * covered.length)] };
}

const encoder = new TextEncoder();

/** 请求带的钥匙对不对（没设钥匙的环境一律不对）。 */
export function botKeyValid(/** @type {string|null} */ given, /** @type {string|undefined} */ want) {
  if (!given || !want) return false;
  const a = encoder.encode(given);
  const b = encoder.encode(want);
  return a.length === b.length && /** @type {SubtleCrypto & { timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean }} */ (crypto.subtle).timingSafeEqual(a, b);
}
