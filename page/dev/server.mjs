// Project-owned local multiplayer host. The official kit runtime and SDK stay unchanged.
import { copyFile, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GUEST, startPage } from "../../cli/lib/page.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pageFolder = join(root, "page");
const sdkPath = join(root, "cli/page/sdk-v1.js");
const DAY = 86_400_000;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const json = (response, value, status = 200) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  }).end(JSON.stringify(value));
};

async function bodyOf(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 16_384) throw new Error("请求内容过长");
  }
  return JSON.parse(body || "{}");
}

function listen(server, port) {
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", done);
  });
}

async function stopServer(server) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}

/** Run the real official workerd judge behind a polling, multi-tab SDK host. */
export async function startLocalHarness({ port = 8740 } = {}) {
  const source = JSON.parse(await readFile(join(root, "simulate.json"), "utf8"));
  await stat(join(pageFolder, "index.html"));
  const people = [...new Set([
    ...(source.submissions ?? []).map((item) => item.who),
    "小明", "小红", "小刚",
  ])].filter((name) => typeof name === "string" && name !== GUEST);
  const now = Date.now();
  const submissions = (source.submissions?.length ? source.submissions : people.map((who) => ({ who, input: "cashout" })))
    .map((item, index) => ({ ...item, at: new Date(now + index * 1000).toISOString() }));
  for (const who of people) {
    if (!submissions.some((item) => item.who === who)) {
      submissions.push({ who, input: "cashout", at: new Date(now + submissions.length * 1000).toISOString() });
    }
  }
  const simulation = {
    ...source,
    now: new Date(now).toISOString(),
    hongbao: {
      ...source.hongbao,
      openedAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + Math.max(DAY, (submissions.length + 1) * 1000)).toISOString(),
    },
    submissions,
  };
  const tempRoot = await mkdtemp(join(tmpdir(), "hbdemo-multiplayer-"));
  // Miniflare installs synchronous signal handlers which call process.exit(130/143).
  // Its handler kills workerd; this exit fallback removes our temp root even when
  // that handler exits before our asynchronous close() has completed.
  const cleanupOnExit = () => { try { rmSync(tempRoot, { recursive: true, force: true }); } catch {} };
  process.once("exit", cleanupOnExit);
  let internal;
  let hostServer;
  let appServer;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await Promise.all([stopServer(hostServer), stopServer(appServer)]);
      await internal?.close();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
      process.removeListener("exit", cleanupOnExit);
    }
  };

  try {
    await copyFile(join(root, "judge.js"), join(tempRoot, "judge.js"));
    await symlink(pageFolder, join(tempRoot, "page"), "dir");
    await writeFile(join(tempRoot, "simulate.json"), JSON.stringify(simulation, null, 2));
    internal = await startPage({ root: tempRoot, port: 0, print: () => {} });
    // openGame's moving clock starts immediately before startPage returns.
    // Reset reuses simulation.now, so its wall-clock anchor is renewed below.
    let epochWall = Date.now();
    let generation = 1;
    let mutationTail = Promise.resolve();
    const serverNow = () => now + (Date.now() - epochWall);
    const serialized = (action) => {
      const running = mutationTail.then(action);
      mutationTail = running.catch(() => {});
      return running;
    };
    const proxy = async (path, body) => {
      const response = await fetch(`${internal.hostUrl}${path}`, body === undefined ? {} : {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "本地判定失败");
      return value;
    };
    const hostUrl = `http://127.0.0.1:${port}`;
    const appUrl = `http://127.0.0.1:${port + 1}`;
    const hostTemplate = await readFile(new URL("./host.html", import.meta.url), "utf8");
    const sdk = await readFile(sdkPath);
    const config = JSON.stringify({ hostUrl, appUrl, people: [...people, GUEST], guest: GUEST }).replaceAll("<", "\\u003c");

    hostServer = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, hostUrl);
        if (request.method === "GET" && url.pathname === "/") {
          response.writeHead(200, { "content-type": types[".html"], "cache-control": "no-store" })
            .end(hostTemplate.replace("__CONFIG__", config));
          return;
        }
        if (request.method === "GET" && url.pathname === "/sdk/v1.js") {
          response.writeHead(200, { "content-type": types[".js"], "cache-control": "no-store" }).end(sdk);
          return;
        }
        if (request.method === "GET" && url.pathname === "/api/snapshot") {
          const who = url.searchParams.get("who") ?? people[0];
          if (![...people, GUEST].includes(who)) return json(response, { error: "未知模拟玩家" }, 400);
          const snapshot = await serialized(async () => {
            const encoded = encodeURIComponent(who);
            const [state, own] = await Promise.all([
              proxy("/api/state"),
              proxy(`/api/me?who=${encoded}`),
            ]);
            return { ...state, own, now: serverNow(), generation };
          });
          return json(response, snapshot);
        }
        if (request.method === "GET" && ["/api/state", "/api/me", "/api/mine"].includes(url.pathname)) {
          return json(response, await serialized(() => proxy(url.pathname + url.search)));
        }
        if (request.method === "POST" && url.pathname === "/api/submit") {
          const body = await bodyOf(request);
          if (!people.includes(body.who) && body.who !== GUEST) return json(response, { error: "未知模拟玩家" }, 400);
          if (typeof body.input !== "string") return json(response, { error: "input 要是字符串" }, 400);
          const answer = await serialized(async () => ({
            ...await proxy("/api/submit", body), now: serverNow(), generation,
          }));
          return json(response, answer);
        }
        if (request.method === "POST" && url.pathname === "/api/reset") {
          const answer = await serialized(async () => {
            const reset = await proxy("/api/reset", {});
            epochWall = Date.now();
            generation += 1;
            return { ...reset, now: serverNow(), generation };
          });
          return json(response, answer);
        }
        json(response, { error: "找不到本地接口" }, 404);
      } catch (error) {
        json(response, { error: error instanceof Error ? error.message : String(error) }, 500);
      }
    });

    appServer = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, appUrl).pathname);
        if (request.method !== "GET" || !(pathname === "/" || pathname === "/index.html" || pathname.startsWith("/assets/"))) {
          response.writeHead(404).end("找不到构建文件；开发源码不对页面开放");
          return;
        }
        const file = resolve(pageFolder, `.${pathname === "/" ? "/index.html" : pathname}`);
        if (!file.startsWith(pageFolder + sep)) return response.writeHead(403).end();
        let body = await readFile(file);
        if (extname(file) === ".html") {
          body = body.toString("utf8").replaceAll("https://hb.lafi.sh/sdk/v1.js", `${hostUrl}/sdk/v1.js`);
        }
        response.writeHead(200, {
          "content-type": types[extname(file)] ?? "application/octet-stream",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        }).end(body);
      } catch (error) {
        response.writeHead(error?.code === "ENOENT" ? 404 : 500).end("本地构建文件不可用");
      }
    });

    await listen(hostServer, port);
    await listen(appServer, port + 1);
    return { hostUrl, appUrl, people, close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let port = 8740;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--help") {
      console.log("node page/dev/server.mjs [--port 8740]\n启动真实判定器的本地多人模拟；不发真实红包，不付款。修改 judge.js 后需要重启。");
      process.exit(0);
    }
    if (args[index] !== "--port") throw new Error(`未知参数：${args[index]}`);
    port = Number(args[++index]);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65534) throw new Error("--port 需要是 1–65534 的端口号");
  let stopping = false;
  let starting;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await (await starting).close(); }
    finally { process.exit(0); }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  starting = startLocalHarness({ port });
  const harness = await starting;
  if (stopping) await stop();
  else {
    console.log(`本地多人模拟（无真实付款）：${harness.hostUrl}`);
    console.log(`小明：${harness.hostUrl}/?who=${encodeURIComponent("小明")}`);
    console.log(`小红：${harness.hostUrl}/?who=${encodeURIComponent("小红")}`);
    console.log("两页共享真实 workerd 判定器；修改网页后刷新，修改判定器或模拟参数后重启。Ctrl+C 关闭并清理临时文件。");
  }
}
