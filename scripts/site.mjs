// 拼游戏站的发布目录 game/dist/：v2 的网页放根上（开着的红包还在用），
// v3 的网页放 v3/ 下。先各自构建：page/frontend 的 npm run build（v2）
// 和 npm run build:v3（v3，输出 page/frontend/dist-v3/）。
import { cp, mkdir, rm, stat } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const out = new URL("game/dist/", root);
const v2 = new URL("page/frontend/dist/", root);
const v3 = new URL("page/frontend/dist-v3/", root);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(v2, out, { recursive: true });
if (await stat(v3).catch(() => null)) await cp(v3, new URL("v3/", out), { recursive: true });
else console.log("还没有 v3 的构建（page/frontend/dist-v3/），只放了 v2");
console.log("游戏站发布目录：game/dist/");
