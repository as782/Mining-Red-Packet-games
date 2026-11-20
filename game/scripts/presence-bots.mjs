// 压一压在场的房间（docs/V3_ITEMS.md §20）：N 个机器人连 presence，都看同一张卡，指针绕圈走（5 次/秒），
// 每人十几秒扔一个表情，25 秒一次心跳。只有带对 BOT_KEY 的环境认机器人（Stage；本地联调在 wrangler.jsonc
// 的 env.local 里）。钥匙从环境变量 PRESENCE_BOT_KEY 读，不写在命令里。
//
//   PRESENCE_BOT_KEY=… node scripts/presence-bots.mjs --origin https://kddb-staging.lafi.sh --hb <红包编号> \
//     --count 100 --seconds 60 --card 0,0,0
//
// 打出每个机器人连上没有、一共发了几条、收到几批几 KB。

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, at, all) => (value.startsWith("--") ? [...pairs, [value.slice(2), all[at + 1]]] : pairs), /** @type {[string, string][]} */ ([])));
const origin = args.origin ?? "http://127.0.0.1:8787";
const hongbao = args.hb ?? "test";
const count = Number(args.count ?? 100);
const seconds = Number(args.seconds ?? 60);
const [card, sx, sy] = (args.card ?? "0,0,0").split(",").map(Number);
const key = process.env.PRESENCE_BOT_KEY;
if (!key) throw new Error("要先设 PRESENCE_BOT_KEY");

const SLOT_PX = 408;
const url = new URL("/v3/api/presence", origin);
url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
url.searchParams.set("hb", hongbao);

let open = 0;
let failed = 0;
let sent = 0;
let batches = 0;
let bytes = 0;
const timers = [];
const sockets = [];

for (let n = 0; n < count; n++) {
  const at = new URL(url);
  at.searchParams.set("bot", String(n));
  const socket = new WebSocket(at, /** @type {never} */ ({ headers: { "X-Bot-Key": key } }));
  sockets.push(socket);
  const send = (/** @type {unknown} */ data) => {
    if (socket.readyState !== 1) return;
    socket.send(typeof data === "string" ? data : JSON.stringify(data));
    sent += 1;
  };
  socket.onopen = () => {
    open += 1;
    // 屏幕范围按宽屏挖卡那一级报：左右各两张、上下各一张
    send({ w: [card, sx, sy, 2, sx - 2, sy - 1, sx + 2, sy + 1] });
    // 每个机器人绕卡上一个圈走，起点和速度不同
    const phase = (n / count) * Math.PI * 2;
    const radius = 60 + (n % 5) * 25;
    const started = Date.now();
    timers.push(setInterval(() => {
      const t = (Date.now() - started) / 1000;
      const angle = phase + t * (0.6 + (n % 7) * 0.1);
      send({ p: [Math.round(sx * SLOT_PX + Math.cos(angle) * radius), Math.round(sy * SLOT_PX + Math.sin(angle) * radius)] });
    }, 200 + (n % 3)));
    timers.push(setInterval(() => send({ e: n % 8 }), 12_000 + (n % 10) * 500));
    timers.push(setInterval(() => send("ping"), 25_000));
  };
  socket.onmessage = (event) => {
    if (event.data === "pong") return;
    batches += 1;
    bytes += String(event.data).length;
  };
  socket.onerror = () => {
    failed += 1;
  };
}

const started = Date.now();
const report = setInterval(() => {
  const elapsed = (Date.now() - started) / 1000;
  console.log(`${elapsed.toFixed(0)}s 连上 ${open}/${count}，失败 ${failed}；发了 ${sent} 条（${(sent / elapsed).toFixed(0)}/s），收到 ${batches} 批（每人 ${(batches / Math.max(1, open) / elapsed).toFixed(1)}/s），${(bytes / 1024).toFixed(0)} KB（每人 ${(bytes / 1024 / Math.max(1, open) / elapsed).toFixed(1)} KB/s）`);
}, 10_000);

setTimeout(() => {
  clearInterval(report);
  for (const timer of timers) clearInterval(timer);
  for (const socket of sockets) socket.close();
  console.log("停了");
  setTimeout(() => process.exit(0), 500);
}, seconds * 1000);
