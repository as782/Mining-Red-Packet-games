// 实时推送攒一攒再发（docs/V3_MAP.md §7）：人多时一秒挖几十格，一格一条推给每个开着的
// 网页，网页几乎每帧都在重画，游戏站一秒要发几万次。攒 100 毫秒发一次：第 2 版的网页收
// 一个数组（这段时间的几条，按序号），每个网页一秒最多 10 条；第 1 版的网页（旧的，
// 只认一条一个）照旧一条一条收，只是晚一点。自己挖的结果走请求的回答，不受影响。

export const PUSH_EVERY_MS = 100;

export class LivePushes {
  /** @type {{ v1: Record<string, unknown>, v2: Record<string, unknown> }[]} */
  pending = [];
  /** @type {unknown} */
  timer = null;

  /**
   * @param {(out: { v1: Record<string, unknown>[], v2: Record<string, unknown>[] }) => void} send 发给开着的网页
   * @param {(run: () => void, ms: number) => unknown} [later]
   * @param {(timer: unknown) => void} [cancel]
   */
  constructor(send, later = (run, ms) => setTimeout(run, ms), cancel = (timer) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timer))) {
    this.send = send;
    this.later = later;
    this.cancel = cancel;
  }

  /** 记下一条：v1 给旧网页，v2 给带 v=2 连的（没有第 2 版的就两边一样）。 */
  push(/** @type {Record<string, unknown>} */ v1, /** @type {Record<string, unknown>|null} */ v2 = null) {
    this.pending.push({ v1, v2: v2 ?? v1 });
    this.timer ??= this.later(() => {
      this.timer = null;
      this.flush();
    }, PUSH_EVERY_MS);
  }

  /** 把攒着的发出去。 */
  flush() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    this.send({ v1: batch.map((item) => item.v1), v2: batch.map((item) => item.v2) });
  }
}
