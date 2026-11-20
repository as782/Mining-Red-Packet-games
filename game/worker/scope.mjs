// 领取范围（红包信息的 scope，红包站从 2026-11-07 起给；没有这一项就是谁都能领）：
// 不在范围里的人挖到的分交上去也领不了，还白白占了奖池（2026-11-07 生产上一个只给
// Lv1 的红包，74 个人把奖池挖完，只有 1 个是 Lv1）。游戏站认人时就不给他票据。
// 和红包站的 publicScopeAllows 一样：信任等级在 levels 里，或者是指定的人（按名字，不分大小写）。

/** @typedef {{ levels?: number[], users?: { username: string }[] }} Scope */

/**
 * @param {Scope|null|undefined} scope
 * @param {{ username: string, level?: number|null }} who
 */
export function inScope(scope, who) {
  if (!scope) return true;
  if (scope.levels && typeof who.level === "number" && scope.levels.includes(who.level)) return true;
  const name = who.username.toLowerCase();
  return (scope.users ?? []).some((user) => user.username.toLowerCase() === name);
}

/** 信任等级写成字：连着的放一起，到 Lv4 的说“及以上”：Lv2 及以上、Lv0–2、Lv1、Lv1、Lv3。 */
function levelsText(/** @type {number[]} */ levels) {
  /** @type {[number, number][]} */
  const runs = [];
  for (const level of [...new Set(levels)].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && level === last[1] + 1) last[1] = level;
    else runs.push([level, level]);
  }
  if (runs.length === 1 && runs[0][0] !== runs[0][1] && runs[0][1] === 4) return `Lv${runs[0][0]} 及以上`;
  return runs.map(([low, high]) => (low === high ? `Lv${low}` : `Lv${low}–${high}`)).join("、");
}

/** 不让进时说的话，范围和红包页上的“仅限 …”一样写。 */
export function outOfScope(/** @type {Scope} */ scope) {
  const count = scope.users?.length ?? 0;
  const levels = scope.levels?.length ? levelsText(scope.levels) : "";
  // 以字母、数字结尾时空一格：Lv1 或指定的、Lv2 及以上或指定的
  const joined = /[A-Za-z0-9]$/.test(levels) ? `${levels} 或指定的` : `${levels}或指定的`;
  const range = scope.levels?.length && count > 0 ? `仅限 ${joined} ${count} 人`
    : scope.levels?.length ? `仅限 ${levelsText(scope.levels)}` : `仅限指定的 ${count} 人`;
  return `这个红包${range}，你不在里面：挖到的奖励领不了，所以进不了矿洞`;
}
