// 在场（docs/V3_ITEMS.md §20）：别人的指针、谁在看哪张卡、表情气泡。
// 每个红包另开一个房间（index.mjs 的 PresenceObject），和挖格子的房间分开：这边忙不过来最多指针卡一下，
// 挖格子不受影响。只在内存里，不写存储；每条连接是谁、在看哪张放在连接上（serializeAttachment），房间睡醒
// 还在。这里是纯逻辑，测试直接用；房间只管收发、心跳和睡醒后把人找回来。
//
// 网页说的（一条一个 JSON，太长、太多的不理）：
//   {"w":[卡号, 格位 x, 格位 y, 缩放级, 左, 上, 右, 下]} 在看哪张卡、屏幕上看得到哪些格位（镜头起飞时就报落点，
//   最多 0.4 秒一次；以前的网页只有前 4 个，按缩放级估一个范围）；{"w":null} 不在看（页面到了后台）
//   {"p":[x, y, 道具]} 指针在地图上的位置（世界坐标取整；只有电脑上、鼠标动了才发，最多 5 次/秒）和手上拿的
//   道具（画在指针上，号码见网页 v3/src/Peers.tsx 的 TOOLS，0 是镐子，可以不带）；{"p":null} 收起
//   {"e":表情号} 扔一个表情（每人 2 秒最多一个）
//   "ping" 心跳：平台自动回 "pong"，不叫醒房间（PresenceObject 的 setWebSocketAutoResponse）
// 房间发的（攒 100 毫秒一批，每人一份）：
//   "hi": 你的座位号（刚连上那一批）
//   "w": [[座位号, uid, 名字, 卡号 | null], …] 谁换了在看的卡（刚连上那一批是所有在看的人）；null 是不看了、走了
//   "p": [[座位号, x, y, 道具?] | [座位号], …] 动了的指针（道具是 0 时不带），只有座位号的是收起了
//   "P": 同上，是你看得见的全部指针（你换了卡以后那一批）：手上的换成这一份
//   "e": [[座位号, 表情号], …]
//   "s": 1 | 0 有没有别人的屏幕和你的重叠（变了才说；网页默认有）：没有时网页不发指针，反正没人看得见
// 指针只发给屏幕上看得到它的人（全图那一级不收，人数牌够了）；表情发给屏幕上看得到扔的人那张卡的人，全图那一级也收
// （人数牌跳一下）。同一个人（两个标签页）的指针和表情不回给自己。

/** 一张卡占的格位（和网页 v3/src/camera.ts 的 SLOT_PX 一样，测试里核对）：指针在哪张卡上按它算。 */
export const SLOT_PX = 408;
/** 攒多久发一批。 */
export const FLUSH_MS = 100;
/** 每人两个表情至少隔多久（网页按 2.5 秒，留点余量）。 */
export const EMOTE_GAP_MS = 2000;
/** 有几个表情（网页 v3/src/emotes.ts）。 */
export const EMOTE_COUNT = 8;
/** 多久没有心跳、没说话算走了（网页 25 秒一次心跳）。 */
export const STALE_MS = 90_000;
/** 有人说话时，最多多久顺手查一次走了的人（不用闹钟）。 */
export const SWEEP_MS = 60_000;
/**
 * 没人说话时，闹钟多久叫醒房间查一次。叫醒一次房间要醒十几秒：以前每分钟一次，开着页面没人动的房间一小时
 * 醒一刻钟（2026-11-14 量的，夜里大半的时长费是这个）。网页在后台满一分钟会自己断开，这里只兜底断网没说再见的。
 */
export const SWEEP_QUIET_MS = 10 * 60_000;
/**
 * 每人最多跟着几个指针（网页也只画这么多）：换卡时挑离他那张卡最近的，之后谁走了、出了范围再补上。
 * 100 个人挤在一张卡上时，每人收的从每秒 9 KB 降到 2 KB 以内，房间要拼的也少。
 */
export const FOLLOW_MAX = 20;
/** 以前的网页没报屏幕范围：按缩放级估（按格位，横竖斜都算），全图那一级不收。 */
const RANGE = [-1, 2, 1];
/** 每条连接每秒能说几句（正常的 6 句左右），最多攒几句；一直超的断开。 */
const RATE = 15;
const BURST = 30;
const DROPS_MAX = 300;
const COORD_MAX = 10_000;
/** 指针上的道具号码最大到几（网页现在用到 4） */
const TOOL_MAX = 15;

/**
 * @typedef {{ x0: number, y0: number, x1: number, y1: number }} View 屏幕上看得到的格位（含两头）
 * @typedef {{ c: number, x: number, y: number, l: 0|1|2, v?: View }} Here 在看的卡、它的格位、缩放级、屏幕范围
 * @typedef {{ sid: string, uid: number, name: string, here: Here|null, joined: number, seen?: boolean }} Seat
 *   一个座位（存在连接上）；seen 是上次告诉他的“有没有别人看得见你”（没说过是有）
 * @typedef {{ send(text: string): void, close(code?: number, reason?: string): void }} Conn
 * @typedef {{ x: number, y: number }} Slot
 * @typedef {[number, number, number]} Point 世界坐标和手上的道具
 */

const slotOf = (/** @type {Point} */ [x, y]) => ({ x: Math.round(x / SLOT_PX), y: Math.round(y / SLOT_PX) });
const isInt = (/** @type {unknown} */ value, /** @type {number} */ max) => Number.isSafeInteger(value) && Math.abs(/** @type {number} */ (value)) <= max;

/** @param {unknown} value @returns {Here|null|undefined} undefined 是看不懂 */
function hereOf(value) {
  if (value === null) return null;
  if (!Array.isArray(value) || (value.length !== 4 && value.length !== 8)) return undefined;
  const [c, x, y, l, x0, y0, x1, y1] = value;
  if (!isInt(c, 1_000_000) || c < 0 || !isInt(x, COORD_MAX) || !isInt(y, COORD_MAX) || (l !== 0 && l !== 1 && l !== 2)) return undefined;
  if (value.length === 4) return { c, x, y, l };
  if (![x0, y0, x1, y1].every((edge) => isInt(edge, COORD_MAX)) || x0 > x1 || y0 > y1) return undefined;
  return { c, x, y, l, v: { x0, y0, x1, y1 } };
}

/** 屏幕上看得到的格位：网页报的；以前的网页按缩放级估；不在看是 null。 */
function viewOf(/** @type {Here|null} */ here) {
  if (!here) return null;
  if (here.v) return here.v;
  const range = RANGE[here.l];
  return range < 0 ? null : { x0: here.x - range, y0: here.y - range, x1: here.x + range, y1: here.y + range };
}

/** 收指针的范围：全图那一级不收。 */
const pointerView = (/** @type {Here|null} */ here) => (here && here.l !== 0 ? viewOf(here) : null);
const inView = (/** @type {View|null} */ view, /** @type {Slot|null} */ slot) => !!view && !!slot && slot.x >= view.x0 && slot.x <= view.x1 && slot.y >= view.y0 && slot.y <= view.y1;
const overlap = (/** @type {View} */ a, /** @type {View} */ b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** @param {unknown} value @returns {Point|null|undefined} */
function pointOf(value) {
  if (value === null) return null;
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) return undefined;
  const [x, y, tool = 0] = value;
  if (!isInt(tool, TOOL_MAX) || tool < 0) return undefined;
  return isInt(x, COORD_MAX * SLOT_PX) && isInt(y, COORD_MAX * SLOT_PX) ? [x, y, tool] : undefined;
}

/** 发出去的一行：道具是 0（镐子）时不带。 */
const rowOf = (/** @type {string} */ sid, /** @type {Point} */ [x, y, tool]) => (tool ? [sid, x, y, tool] : [sid, x, y]);

/** 座位号：6 个字母数字，一个红包里撞上的机会可以不管。 */
function newSid() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => "abcdefghijklmnopqrstuvwxyz0123456789"[byte % 36]).join("");
}

export class PresenceRoom {
  /** @type {Map<Conn, Seat>} */
  seats = new Map();
  /** @type {Map<string, Conn>} */
  bySid = new Map();
  /** @type {Map<string, Point>} 指针（只在内存里，房间睡过就没了，动一下又有） */
  pointers = new Map();
  /** @type {Map<Conn, number>} 最后一次说话（心跳由平台回，另外问） */
  lastSeen = new Map();
  /** @type {Map<Conn, { tokens: number, at: number, drops: number }>} */
  budget = new Map();
  /** @type {Map<number, number>} uid → 上一个表情的时刻 */
  lastEmote = new Map();
  /** 上次查走了的人的时刻（房间睡过就从 0 算，醒来第一句话就查一次） */
  sweptAt = 0;
  /** @type {Map<Conn, Set<string>>} 每人跟着的那些指针（最多 FOLLOW_MAX 个） */
  follows = new Map();

  // —— 这一批 ——
  /** @type {Set<string>} 换了在看的卡的座位 */
  watched = new Set();
  /** @type {Map<string, Seat>} 这一批里走了的（发 null 要用名字） */
  left = new Map();
  /** @type {Map<string, Slot|null>} 动了的指针：座位号 → 这一批动之前在哪一格 */
  moved = new Map();
  /** @type {{ sid: string, uid: number, n: number, at: Slot }[]} */
  emotes = [];
  /** @type {Set<Conn>} 换了卡的人：这一批给他看得见的全部指针 */
  fresh = new Set();
  /** @type {Set<Conn>} 刚连上的人：这一批给他座位号和所有在看的人 */
  hello = new Set();
  /** 有人换了屏幕范围、来了、走了：这一批重新算谁被别人看得见 */
  viewsChanged = false;
  /** @type {unknown} */
  timer = null;

  /**
   * @param {{
   *   save?: (conn: Conn, seat: Seat) => void,
   *   later?: (run: () => void, ms: number) => unknown,
   *   sid?: () => string,
   * }} [tools]
   */
  constructor({ save = () => {}, later = (run, ms) => setTimeout(run, ms), sid = newSid } = {}) {
    this.save = save;
    this.later = later;
    this.newSid = sid;
  }

  /** 房间睡醒：把连接上存的座位找回来（指针没存，下次动一下就有）。 */
  restore(/** @type {Conn} */ conn, /** @type {Seat} */ seat) {
    this.seats.set(conn, seat);
    this.bySid.set(seat.sid, conn);
  }

  /** 新连上一个人：下一批给他座位号和现在谁在看哪张。 */
  join(/** @type {Conn} */ conn, /** @type {{ uid: number, name: string }} */ who, /** @type {number} */ now) {
    let sid = this.newSid();
    while (this.bySid.has(sid)) sid = this.newSid();
    /** @type {Seat} */
    const seat = { sid, uid: who.uid, name: who.name, here: null, joined: now };
    this.restore(conn, seat);
    this.save(conn, seat);
    this.lastSeen.set(conn, now);
    this.hello.add(conn);
    this.viewsChanged = true;
    this.schedule();
    return seat;
  }

  /** 走了（关了页面、断了、心跳没了）。 */
  leave(/** @type {Conn} */ conn) {
    const seat = this.seats.get(conn);
    if (!seat) return;
    this.seats.delete(conn);
    this.bySid.delete(seat.sid);
    this.lastSeen.delete(conn);
    this.budget.delete(conn);
    this.follows.delete(conn);
    this.hello.delete(conn);
    this.fresh.delete(conn);
    this.dropPointer(seat.sid);
    this.viewsChanged = true;
    if (seat.here || this.watched.has(seat.sid)) {
      this.left.set(seat.sid, { ...seat, here: null });
      this.watched.add(seat.sid);
    }
    this.schedule();
  }

  /** 网页说了一句。 */
  message(/** @type {Conn} */ conn, /** @type {string} */ text, /** @type {number} */ now) {
    const seat = this.seats.get(conn);
    if (!seat) return;
    this.lastSeen.set(conn, now);
    if (!this.allow(conn, now)) return;
    if (text.length > 200 || text === "ping") return;
    /** @type {unknown} */
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof data !== "object" || data === null) return;
    const said = /** @type {Record<string, unknown>} */ (data);
    if ("w" in said) this.watch(conn, seat, hereOf(said.w));
    else if ("p" in said) this.point(seat, pointOf(said.p));
    else if ("e" in said) this.emote(seat, said.e, now);
  }

  /** 说得太多：超出的不理，一直超的断开。 */
  allow(/** @type {Conn} */ conn, /** @type {number} */ now) {
    const budget = this.budget.get(conn) ?? { tokens: BURST, at: now, drops: 0 };
    budget.tokens = Math.min(BURST, budget.tokens + ((now - budget.at) / 1000) * RATE);
    budget.at = now;
    this.budget.set(conn, budget);
    if (budget.tokens >= 1) {
      budget.tokens -= 1;
      return true;
    }
    budget.drops += 1;
    if (budget.drops > DROPS_MAX) {
      try {
        conn.close(1008, "too many");
      } catch {
        // 已经断了
      }
      this.leave(conn);
    }
    return false;
  }

  /** @param {Conn} conn @param {Seat} seat @param {Here|null|undefined} here */
  watch(conn, seat, here) {
    if (here === undefined) return;
    const before = seat.here;
    if (JSON.stringify(before) === JSON.stringify(here)) return;
    seat.here = here;
    this.save(conn, seat);
    this.viewsChanged = true;
    // 不在看了（页面到后台）、到了全图那一级：指针也收起
    if (!here || here.l === 0) this.dropPointer(seat.sid);
    if (!before || !here || before.c !== here.c) this.watched.add(seat.sid);
    this.fresh.add(conn);
    this.schedule();
  }

  /** @param {Seat} seat @param {Point|null|undefined} point */
  point(seat, point) {
    if (point === undefined) return;
    if (point === null) {
      this.dropPointer(seat.sid);
      this.schedule();
      return;
    }
    // 不在看、在全图那一级的人发来的不要（网页不会发）
    if (!seat.here || seat.here.l === 0) return;
    const before = this.pointers.get(seat.sid);
    if (before && before[0] === point[0] && before[1] === point[1] && before[2] === point[2]) return;
    if (!this.moved.has(seat.sid)) this.moved.set(seat.sid, before ? slotOf(before) : null);
    this.pointers.set(seat.sid, point);
    this.schedule();
  }

  dropPointer(/** @type {string} */ sid) {
    const before = this.pointers.get(sid);
    if (!before) return;
    if (!this.moved.has(sid)) this.moved.set(sid, slotOf(before));
    this.pointers.delete(sid);
  }

  /** @param {Seat} seat @param {unknown} n @param {number} now */
  emote(seat, n, now) {
    if (!Number.isSafeInteger(n) || /** @type {number} */ (n) < 0 || /** @type {number} */ (n) >= EMOTE_COUNT || !seat.here) return;
    if (now - (this.lastEmote.get(seat.uid) ?? -Infinity) < EMOTE_GAP_MS) return;
    this.lastEmote.set(seat.uid, now);
    this.emotes.push({ sid: seat.sid, uid: seat.uid, n: /** @type {number} */ (n), at: { x: seat.here.x, y: seat.here.y } });
    this.schedule();
  }

  /** 有人说话时顺手查：离上次查满 SWEEP_MS 才查。 */
  sweepSometimes(/** @type {number} */ now, /** @type {(conn: Conn) => number} */ lastAlive) {
    if (now - this.sweptAt >= SWEEP_MS) this.sweep(now, lastAlive);
  }

  /** 心跳没了的人：断开，当作走了。lastAlive(conn) 是平台上最后一次自动回心跳的时刻（没有是 0）。 */
  sweep(/** @type {number} */ now, /** @type {(conn: Conn) => number} */ lastAlive) {
    this.sweptAt = now;
    for (const [conn, seat] of [...this.seats]) {
      const alive = Math.max(seat.joined, this.lastSeen.get(conn) ?? 0, lastAlive(conn));
      if (now - alive <= STALE_MS) continue;
      try {
        conn.close(4000, "stale");
      } catch {
        // 已经断了
      }
      this.leave(conn);
    }
  }

  schedule() {
    this.timer ??= this.later(() => {
      this.timer = null;
      this.flush();
    }, FLUSH_MS);
  }

  /**
   * 每个在挖卡、附近两级的人：有没有别人（不是自己的另一个标签页）的屏幕和他的重叠、也收指针。没有的话他的指针
   * 谁也看不见，网页就先不发。只在有人换了范围、来了、走了时算。
   * @returns {Map<Conn, boolean>}
   */
  whoIsSeen() {
    const views = [...this.seats].flatMap(([conn, seat]) => {
      const view = pointerView(seat.here);
      return view ? [{ conn, uid: seat.uid, view }] : [];
    });
    const seen = new Map();
    for (const one of views) seen.set(one.conn, views.some((other) => other.uid !== one.uid && overlap(one.view, other.view)));
    return seen;
  }

  /** 发这一批：每人一份，只放他看得见的指针和表情。 */
  flush() {
    const wList = [...this.watched].flatMap((sid) => {
      const conn = this.bySid.get(sid);
      const seat = (conn && this.seats.get(conn)) ?? this.left.get(sid);
      return seat ? [[sid, seat.uid, seat.name, seat.here?.c ?? null]] : [];
    });
    /** @type {unknown[][]|null} */
    let roster = null;
    const uidOf = (/** @type {string} */ sid) => {
      const conn = this.bySid.get(sid);
      return (conn && this.seats.get(conn)?.uid) ?? this.left.get(sid)?.uid;
    };
    const seen = this.viewsChanged ? this.whoIsSeen() : null;
    this.viewsChanged = false;
    for (const [conn, seat] of this.seats) {
      const here = seat.here;
      const view = pointerView(here);
      const near = (/** @type {Slot|null} */ slot) => inView(view, slot);
      const emoteView = viewOf(here);
      /** @type {Record<string, unknown>} */
      const out = {};
      // 有没有别人看得见你：变了才说（没说过的当作“有”，和网页的默认一样）
      const visible = seen?.get(conn);
      if (visible !== undefined && visible !== (seat.seen ?? true)) {
        seat.seen = visible;
        this.save(conn, seat);
        out.s = visible ? 1 : 0;
      }
      if (this.hello.has(conn)) {
        out.hi = seat.sid;
        out.w = (roster ??= [...this.seats.values()].filter((other) => other.here).map((other) => [other.sid, other.uid, other.name, /** @type {Here} */ (other.here).c]));
      } else if (wList.length > 0) out.w = wList;
      if (this.fresh.has(conn) || this.hello.has(conn)) {
        // 换了卡：看得见的里面挑离他那张卡最近的 FOLLOW_MAX 个
        const all = [];
        for (const [sid, point] of this.pointers) if (uidOf(sid) !== seat.uid && near(slotOf(point))) all.push(rowOf(sid, point));
        if (here && all.length > FOLLOW_MAX) {
          const cx = here.x * SLOT_PX;
          const cy = here.y * SLOT_PX;
          const away = (/** @type {(string|number)[]} */ row) => Math.hypot(/** @type {number} */ (row[1]) - cx, /** @type {number} */ (row[2]) - cy);
          all.sort((a, b) => away(a) - away(b));
        }
        out.P = all.slice(0, FOLLOW_MAX);
        this.follows.set(conn, new Set(out.P.map((row) => /** @type {string} */ (row[0]))));
      } else {
        const follow = this.follows.get(conn) ?? new Set();
        this.follows.set(conn, follow);
        const moved = [];
        for (const sid of this.moved.keys()) {
          if (uidOf(sid) === seat.uid) continue;
          const point = this.pointers.get(sid);
          const inside = !!point && near(slotOf(point));
          if (follow.has(sid)) {
            // 跟着的：动了就发；收起了、出了范围就说收起，空出位置
            if (inside) moved.push(rowOf(sid, /** @type {Point} */ (point)));
            else {
              follow.delete(sid);
              moved.push([sid]);
            }
          } else if (inside && follow.size < FOLLOW_MAX) {
            follow.add(sid);
            moved.push(rowOf(sid, /** @type {Point} */ (point)));
          }
        }
        if (moved.length > 0) out.p = moved;
      }
      const emotes = this.emotes.filter((emote) => emote.uid !== seat.uid && inView(emoteView, emote.at)).map((emote) => [emote.sid, emote.n]);
      if (emotes.length > 0) out.e = emotes;
      if (Object.keys(out).length === 0) continue;
      try {
        conn.send(JSON.stringify(out));
      } catch {
        // 已经断了，平台会叫 webSocketClose
      }
    }
    this.watched.clear();
    this.left.clear();
    this.moved.clear();
    this.emotes = [];
    this.fresh.clear();
    this.hello.clear();
  }
}
