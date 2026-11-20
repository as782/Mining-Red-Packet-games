// 新局（rules.layout: 2，docs/V3_ITEMS.md §10）区块里固定格子的摆法：废弃矿井的铁轨随机铺一条，
// 试炼密室 5 种对称摆法再随机翻，下界的两格岩浆一半挨在一起。都由种子定（int 是这张卡的 randomOf），
// 谁看都一样。以前开的局照旧（第 3 行中间 4 格铁轨、四角加正中装饰、两格岩浆随便放）。

/** @typedef {'ns'|'ew'|'ne'|'se'|'sw'|'nw'} RailShape */
/** @typedef {'n'|'e'|'s'|'w'} Side */
/** @typedef {(low: number, high: number) => number} Int */

/** @type {Record<Side, [number, number]>} */
const STEP = { n: [-1, 0], e: [0, 1], s: [1, 0], w: [0, -1] };
/** @type {Record<Side, Side>} */
const LEFT = { n: "w", w: "s", s: "e", e: "n" };
/** @type {Record<Side, Side>} */
const BACK = { n: "s", s: "n", e: "w", w: "e" };
/** @type {Side[]} */
const SIDES = ["n", "e", "s", "w"];

/**
 * 铁轨（用户 2026-11-11 在设计稿上定的）：主轨道 8 格，每格 20% 拐弯（刚拐过的下一格减半），
 * 一半的卡再有一小段 3～4 格，直的那几格 25% 断开一格（像原版废弃矿井那样断断续续）。
 */
export const RAIL_OPTIONS = { min: 8, max: 8, turn: 20, second: 50, gap: 25 };

/** 一格连着哪两边 → 形状（原版 rail 的叫法）；只连一边（尽头）是顺着那一边的直道。 */
export function railShape(/** @type {Side} */ a, /** @type {Side|null} */ b) {
  if (!b || a === b) return /** @type {RailShape} */ (a === "n" || a === "s" ? "ns" : "ew");
  const pair = [a, b].sort((x, y) => SIDES.indexOf(x) - SIDES.indexOf(y)).join("");
  return /** @type {RailShape} */ ({ ns: "ns", ew: "ew", ne: "ne", es: "se", sw: "sw", nw: "nw" })[pair];
}

/**
 * 走一条：从卡边上一格（不在角上）往里走，第一步一定往里；只在正对着卡边时穿出去（够长了才行），
 * 不沿着卡边铺；不贴着自己走（每格只连前后两格，形状不会认错）；走不动就停。
 * @returns {{ r: number, c: number, from: Side, to: Side|null }[]}
 */
function walk(/** @type {Int} */ int, /** @type {number} */ size, /** @type {number} */ length, /** @type {Set<number>} */ blocked,
  /** @type {number} */ turn, /** @type {(n: number) => boolean} */ canExit) {
  const side = SIDES[int(0, 3)];
  const along = int(1, size - 2);
  let r = side === "n" ? 0 : side === "s" ? size - 1 : along;
  let c = side === "w" ? 0 : side === "e" ? size - 1 : along;
  if (blocked.has(r * size + c)) return [];
  let heading = BACK[side];
  /** @type {{ r: number, c: number, from: Side, to: Side|null }[]} */
  const cells = [{ r, c, from: side, to: null }];
  const mine = new Set([r * size + c]);
  const inside = (/** @type {number} */ rr, /** @type {number} */ cc) => rr >= 0 && rr < size && cc >= 0 && cc < size;
  const border = (/** @type {number} */ rr, /** @type {number} */ cc) => rr === 0 || cc === 0 || rr === size - 1 || cc === size - 1;
  const free = (/** @type {number} */ rr, /** @type {number} */ cc) => {
    if (mine.has(rr * size + cc) || blocked.has(rr * size + cc)) return false;
    for (const [dr, dc] of Object.values(STEP)) {
      const nr = rr + dr, nc = cc + dc;
      if (!inside(nr, nc) || (nr === r && nc === c)) continue;
      if (mine.has(nr * size + nc) || blocked.has(nr * size + nc)) return false;
    }
    return true;
  };
  let turned = false;
  while (cells.length < length) {
    const wantTurn = int(0, 99) < (turned ? turn / 2 : turn);
    const first = int(0, 1) ? LEFT[heading] : BACK[LEFT[heading]];
    const other = BACK[first];
    /** @type {Side[]} */
    const choices = cells.length === 1 || border(r, c) ? [heading] : wantTurn ? [first, other, heading] : [heading, first, other];
    /** @type {{ exit: Side } | { dir: Side, nr: number, nc: number } | null} */
    let next = null;
    for (const dir of choices) {
      const [dr, dc] = STEP[dir];
      const nr = r + dr, nc = c + dc;
      if (!inside(nr, nc)) {
        if (dir === heading && canExit(cells.length)) { next = { exit: dir }; break; }
        continue;
      }
      if (border(nr, nc) && (inside(nr + dr, nc + dc) || !canExit(cells.length + 1))) continue;
      if (free(nr, nc)) { next = { dir, nr, nc }; break; }
    }
    if (!next) break;
    if ("exit" in next) {
      cells[cells.length - 1].to = next.exit;
      return cells;
    }
    cells[cells.length - 1].to = next.dir;
    turned = next.dir !== heading;
    heading = next.dir;
    r = next.nr;
    c = next.nc;
    mine.add(r * size + c);
    cells.push({ r, c, from: BACK[heading], to: null });
  }
  const last = cells[cells.length - 1];
  const [dr, dc] = STEP[heading];
  if (!inside(last.r + dr, last.c + dc)) last.to = heading;
  return cells;
}

/** 一张矿井卡的铁轨：{ 格: 形状 }。走不出来（几乎不会）就照旧铺中间一行。 */
export function railsOf(/** @type {Int} */ int, /** @type {number} */ size, options = RAIL_OPTIONS) {
  const { min, max, turn, second, gap } = options;
  for (let attempt = 0; attempt < 12; attempt++) {
    const main = walk(int, size, int(min, max), new Set(), turn, (n) => n >= min);
    if (main.length < min) continue;
    const tracks = [main];
    if (int(0, 99) < second) {
      // 第二段离主轨道至少隔一格
      /** @type {Set<number>} */
      const blocked = new Set();
      for (const cell of main) for (const [dr, dc] of [[0, 0], ...Object.values(STEP)]) blocked.add((cell.r + dr) * size + cell.c + dc);
      const extra = walk(int, size, int(3, 4), blocked, turn, (n) => n >= 3);
      if (extra.length >= 3) tracks.push(extra);
    }
    /** @type {Record<string, RailShape>} */
    const rails = {};
    for (const track of tracks) {
      let skipped = false;
      track.forEach((cell, at) => {
        const shape = railShape(cell.from, cell.to);
        if (gap && !skipped && at > 0 && at < track.length - 1 && (shape === "ns" || shape === "ew") && int(0, 99) < gap) {
          skipped = true;
          return;
        }
        skipped = false;
        rails[cell.r * size + cell.c] = shape;
      });
    }
    return rails;
  }
  const row = Math.floor(size / 2) - 1;
  /** @type {Record<string, RailShape>} */
  const rails = {};
  for (let c = 1; c < size - 1; c++) rails[row * size + c] = "ew";
  return rails;
}

/** 试炼密室（7×7）的 5 种对称摆法：装饰和 2 个宝库的 [行, 列]。 */
export const TRIAL_LAYOUTS = /** @type {const} */ ([
  { name: "四角", deco: [[0, 0], [0, 6], [6, 0], [6, 6], [3, 3]], vault: [[3, 1], [3, 5]] },
  { name: "十字", deco: [[0, 3], [3, 0], [3, 6], [6, 3], [3, 3]], vault: [[1, 1], [5, 5]] },
  { name: "四根柱子", deco: [[1, 1], [1, 5], [5, 1], [5, 5], [3, 3]], vault: [[0, 3], [6, 3]] },
  { name: "祭坛", deco: [[2, 3], [4, 3], [3, 3], [0, 0], [6, 6]], vault: [[3, 2], [3, 4]] },
  { name: "回廊", deco: [[2, 2], [2, 4], [4, 2], [4, 4]], vault: [[3, 0], [3, 6]] },
]);

/** 试炼密室：挑一种摆法，再随机不翻、左右翻、上下翻或沿对角线翻。 */
export function trialLayout(/** @type {Int} */ int) {
  const layout = TRIAL_LAYOUTS[int(0, TRIAL_LAYOUTS.length - 1)];
  const flip = int(0, 3);
  const place = (/** @type {readonly [number, number]} */ [r, c]) => (flip === 1 ? [r, 6 - c] : flip === 2 ? [6 - r, c] : flip === 3 ? [c, r] : [r, c]);
  return {
    deco: layout.deco.map((at) => { const [r, c] = place(at); return r * 7 + c; }),
    vaults: layout.vault.map((at) => { const [r, c] = place(at); return r * 7 + c; }),
  };
}

/** 下界（6×6）的两格岩浆：一半挨在一起成一小池（上下左右），一半随便放。 */
export function lavaOf(/** @type {Int} */ int) {
  const first = int(0, 35);
  if (int(0, 1)) {
    const r = Math.floor(first / 6), c = first % 6;
    const near = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([rr, cc]) => rr >= 0 && rr < 6 && cc >= 0 && cc < 6);
    const [rr, cc] = near[int(0, near.length - 1)];
    return [first, rr * 6 + cc];
  }
  let second = int(0, 34);
  if (second >= first) second += 1;
  return [first, second];
}
