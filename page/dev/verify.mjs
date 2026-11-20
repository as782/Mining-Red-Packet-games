// Black-box checks of the real local workerd judge, using the same API as the wrapper.
// Run AFTER starting server.mjs. This script deliberately resets the shared simulation.
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://127.0.0.1:8740";
const A = "小明";
const B = "小红";
let assertions = 0;
const checked = (condition, message) => {
  assert.ok(condition, message);
  assertions += 1;
};
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
};
async function api(path, body) {
  const response = await fetch(`${base}${path}`, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const answer = await response.json();
  assert.equal(response.status, 200, answer.error ?? path);
  return answer;
}
const reset = () => api("/api/reset", {});
const snapshot = (who) => api(`/api/snapshot?who=${encodeURIComponent(who)}`);
const submit = (who, input) => api("/api/submit", { who, input });
const data = (value) => value.view.data;
const privateData = (value) => value.own?.myView?.data;
const chances = (value) => privateData(value)?.chances ?? data(value).rules.initialChances;
const command = (value, index = data(value).cells.findIndex((cell) => cell.kind === null)) => `dig ${data(value).cardId} ${index + 1}`;

console.log(`验证 ${base} 的本地模拟；会多次重新开始，清除当前模拟进度，不涉及真实付款。`);

await reset();
let a = await snapshot(A);
let b = await snapshot(B);
equal(data(a), data(b), "两名玩家最初共享同一公开牌面");
const initialCellCount = data(a).cells.length;
checked([25, 36, 49].includes(initialCellCount), "共享卡片使用受支持的规格");
if (data(a).version === 2) {
  equal(data(a).size ** 2, initialCellCount, "公开尺寸与格子数量一致");
  equal(data(a).composition.pearl, 1, "新版每卡恰好一个末影珍珠");
}
checked(data(a).rules.initialChances >= 3, "验证 A→B→A 需要至少 3 次初始机会");
checked(data(a).rules.waitSeconds > 0, "验证等待规则需要正数 waitSeconds");
checked(Number.isSafeInteger(a.now), "模拟时钟使用整数毫秒");

const raceCommand = command(a);
const race = await Promise.all([submit(A, raceCommand), submit(B, raceCommand)]);
a = await snapshot(A);
b = await snapshot(B);
equal(data(a).stats.digs, 1, "并发争抢同一格只允许一次成功挖掘");
equal(data(a), data(b), "争抢后两名玩家读取相同公共牌面");
equal((privateData(a)?.digs ?? 0) + (privateData(b)?.digs ?? 0), 1, "争抢失败的人不消耗挖掘次数");
checked(race.every((answer) => answer.result.judged), "冲突由判定器拒绝，平台判定本身成功");

await reset();
a = await snapshot(A);
const firstCommand = command(a);
await submit(A, firstCommand);
a = await snapshot(A);
const firstMove = data(a).lastMove;
const firstChances = chances(a);
checked(Math.abs(firstMove.at - a.now) < 1500, "包装时钟与真实判定时间保持一致");
const duplicate = await submit(A, firstCommand);
const afterDuplicate = await snapshot(A);
equal(data(afterDuplicate).stats.digs, 1, "同一格重复提交或旧卡指令不增加成功次数");
equal(chances(afterDuplicate), firstChances, "重复或旧卡指令不扣机会");
equal(data(afterDuplicate).lastMove, firstMove, "拒绝指令不改变接棒记录");
checked(duplicate.result.judged && !duplicate.result.settled, "重复操作不会结算玩家");

// Use a new, still-covered cell so this rejection specifically exercises the wait rule.
await submit(A, command(afterDuplicate));
const waiting = await snapshot(A);
equal(data(waiting).stats.digs, 1, "同一玩家立即挖另一格会被等待规则拒绝");
equal(chances(waiting), firstChances, "等待未满不扣机会");
await submit(B, command(waiting));
b = await snapshot(B);
equal(data(b).stats.digs, 2, "另一位玩家可以立即接棒");
await submit(A, command(b));
a = await snapshot(A);
equal(data(a).stats.digs, 3, "A→B→A 无需等待 10 秒");
const ownActor = privateData(a)?.actorKey;
equal(data(a).lastMove.actorKey, ownActor, "私有自己的标识可与公开最后操作者匹配");

await submit(A, "cashout");
a = await snapshot(A);
checked(a.own.settled !== null, "刚挖完也可以立即收手结算");
equal(a.own.pending, "0.00", "结算后待结算余额归零");
equal(privateData(a).status, "settled", "私人游戏状态展示已结算");
equal(data(a).lastMove.actorKey, ownActor, "收手不改变最后挖掘者");
const afterExit = await submit(A, command(a));
equal(afterExit.result.reason, "already_claimed", "结算玩家不能重新参加");

// Probe each initial coordinate after a reset. No private board or seed is read.
// Reset reproduces setup's sealed-seed layout. Find both a pearl and the spyglass.
let foundSpyglass = false;
let foundPearl = false;
for (let index = 0; index < initialCellCount; index += 1) {
  await reset();
  a = await snapshot(A);
  const oldCardId = data(a).cardId;
  await submit(A, command(a, index));
  a = await snapshot(A);
  if (privateData(a)?.lastResult?.kind === "pearl" && !foundPearl) {
    checked(data(a).cardId !== oldCardId, "末影珍珠立即进入下一张卡");
    const stale = await submit(B, `dig ${oldCardId} ${index + 1}`);
    b = await snapshot(B);
    checked(stale.result.judged, "旧卡指令由判定器处理并拒绝");
    equal(data(b).stats.digs, 1, "换卡后旧卡指令不增加成功次数");
    equal(chances(b), data(b).rules.initialChances, "旧卡指令不扣另一位玩家的机会");
    foundPearl = true;
  }
  if (privateData(a)?.lastResult?.kind === "spyglass" && !foundSpyglass) {
    b = await snapshot(B);
    const peeks = privateData(a).peeks;
    checked(peeks.length > 0, "望远镜给操作者私有情报");
    for (const peek of peeks) {
      equal(data(a).cells[peek.index].kind, null, "望远镜查看的格子仍未公开揭示");
    }
    equal(b.own.myView, null, "未参加的另一位玩家拿不到望远镜私有数据");
    checked(!Object.hasOwn(data(b), "peeks"), "公共 view 不包含私有情报列表");
    equal(data(a), data(b), "私人情报不改变不同玩家收到的公开内容");
    foundSpyglass = true;
  }
  if (foundSpyglass && foundPearl) break;
}
checked(foundSpyglass, `初始牌面的 ${initialCellCount} 格包含可触发的望远镜`);
checked(foundPearl, "初始牌面包含可触发的末影珍珠");

await reset();
console.log(`本地多人 HTTP 验证通过：${assertions} 项；共享模拟已重置，可开始浏览器试玩。`);
