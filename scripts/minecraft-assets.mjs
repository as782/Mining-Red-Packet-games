// Minecraft 原版素材（贴图、模型、背包渲染图、音效）是 Mojang 的，不放进仓库（docs/MINECRAFT_ASSETS.md）。
// 仓库里只有清单：manifest.json（客户端 JAR 里的文件）、inventory/provenance.json（Minecraft Wiki 的背包渲染图）、
// sounds/provenance.json（音效）。这个脚本照清单从官方地址取回来，核对大小和散列，放回网页用的位置：
//
//   npm run assets                 缺的、不对的取回来，已经对的不动
//   npm run assets -- --check      只核对，缺了或不对就报出来、退出码 1
//   npm run assets -- --out <目录>  放到别的目录（不写网页的目录）
//
// 要 Node 18 以上。音效要 ffmpeg（OGG 只转成 MP3）；附魔金苹果的静态图要 ImageMagick 或 ffmpeg（取 GIF 第一帧）。
// 这两种是转出来的，编码器版本不同字节就不同，所以只核对来源文件的散列。

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
/** 清单所在、网页用的目录。 */
export const ASSETS = join(ROOT, "page/frontend/public/assets/minecraft/1.21.4");
/** 开发包的模拟器直接用的构建（page/assets/，build-v3.mjs 拼出来的）里也有一份。 */
const KIT_COPY = join(ROOT, "page/assets/minecraft/1.21.4");
const AGENT = "kddb-assets/1.0";

const read = (/** @type {string} */ path) => JSON.parse(readFileSync(join(ASSETS, path), "utf8"));
const digest = (/** @type {string} */ kind, /** @type {Uint8Array} */ data) => createHash(kind).update(data).digest("hex");

/**
 * 清单里的每个文件：放在哪、怎么核对。exact 是原样的字节（JAR 里提取的、Wiki 下载的），按 sha256 核对；
 * 转出来的（音效、GIF 第一帧）只看在不在。
 * @returns {{ path: string, sha256: string, exact: boolean }[]}
 */
export function listed() {
  const jar = read("manifest.json").files.map((/** @type {any} */ file) => ({ path: file.path, sha256: file.sha256, exact: true }));
  const wiki = read("inventory/provenance.json").files.map((/** @type {any} */ file) => ({ path: file.path, sha256: file.sha256, exact: !file.derivation }));
  const sounds = read("sounds/provenance.json").files.map((/** @type {any} */ file) => ({ path: file.path, sha256: file.sha256, exact: false }));
  return [...jar, ...wiki, ...sounds];
}

/** 缺的、不对的（相对 dir）。 */
export function missingIn(/** @type {string} */ dir = ASSETS) {
  return listed().filter((file) => {
    const at = join(dir, file.path);
    if (!existsSync(at)) return true;
    return file.exact && digest("sha256", readFileSync(at)) !== file.sha256;
  });
}

/** 构建前调用：素材不齐就停下，说怎么补。 */
export function requireAssets() {
  const missing = missingIn();
  if (missing.length === 0) return;
  console.error(`Minecraft 素材缺 ${missing.length} 个（比如 ${missing[0].path}），先在仓库根目录跑一次：npm run assets`);
  process.exit(1);
}

async function download(/** @type {string} */ url) {
  const response = await fetch(url, { headers: { "User-Agent": AGENT } });
  if (!response.ok) throw new Error(`${url}：${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function expect(/** @type {string} */ what, /** @type {string} */ got, /** @type {string} */ want) {
  if (got !== want) throw new Error(`${what} 对不上：拿到 ${got}，清单记的是 ${want}`);
}

/**
 * Wiki 的图要原始字节：它的 CDN 缓存里的是压过的（Cloudflare Polish，像素一样、字节不同），
 * 带一个只用一次的参数绕过缓存才拿到原图。
 */
const uncached = (/** @type {string} */ url) => `${url}${url.includes("?") ? "&" : "?"}kddb=${Date.now()}${Math.random().toString(36).slice(2)}`;

/**
 * Wiki 上的一张图，要清单记的那一版：Wiki 上的图会被人换新，现在的不是那一版就按 SHA-1 去它的历史版本里找。
 * @param {{ path: string, title: string, url: string, sha1: string }} file
 */
async function fromWiki(file) {
  const now = await download(uncached(file.url));
  if (digest("sha1", now) === file.sha1) return now;
  const api = new URL("https://minecraft.wiki/api.php");
  api.search = new URLSearchParams({ action: "query", format: "json", prop: "imageinfo", iiprop: "sha1|url", iilimit: "max", titles: file.title }).toString();
  const pages = JSON.parse(new TextDecoder().decode(await download(api.href))).query?.pages ?? {};
  const old = Object.values(pages).flatMap((/** @type {any} */ page) => page.imageinfo ?? []).find((/** @type {any} */ info) => info.sha1 === file.sha1);
  if (!old) throw new Error(`${file.path}：Wiki 上 ${file.title} 找不到清单记的那一版（SHA-1 ${file.sha1}）`);
  const data = await download(uncached(old.url));
  expect(file.path, digest("sha1", data), file.sha1);
  return data;
}

/**
 * 读 ZIP（JAR）里指定的几个文件：从末尾的目录找到每个文件，存储的原样取、压缩的解压。认 ZIP64。
 * @param {Uint8Array} bytes @param {Set<string>} names
 */
function unzip(bytes, names) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("不是 ZIP");
  let count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 0xffff || offset === 0xffffffff) {
    const locator = end - 20;
    if (view.getUint32(locator, true) !== 0x07064b50) throw new Error("ZIP64 目录找不到");
    const record = Number(view.getBigUint64(locator + 8, true));
    count = Number(view.getBigUint64(record + 32, true));
    offset = Number(view.getBigUint64(record + 48, true));
  }
  const decoder = new TextDecoder();
  /** @type {Map<string, Uint8Array>} */
  const found = new Map();
  for (let index = 0; index < count; index++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("ZIP 目录坏了");
    const method = view.getUint16(offset + 10, true);
    let size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    let local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (names.has(name)) {
      // 大小、位置写不下 32 位时在 ZIP64 的附加字段里（按顺序：原大小、压缩后大小、位置）
      if (size === 0xffffffff || local === 0xffffffff) {
        let at = offset + 46 + nameLength;
        const stop = at + extraLength;
        while (at < stop) {
          const id = view.getUint16(at, true);
          const length = view.getUint16(at + 2, true);
          if (id === 0x0001) {
            let field = at + 4;
            if (view.getUint32(offset + 24, true) === 0xffffffff) field += 8;
            if (size === 0xffffffff) { size = Number(view.getBigUint64(field, true)); field += 8; }
            if (local === 0xffffffff) local = Number(view.getBigUint64(field, true));
          }
          at += 4 + length;
        }
      }
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) found.set(name, data);
      else if (method === 8) found.set(name, new Uint8Array(inflateRawSync(data)));
      else throw new Error(`${name}：不认识的压缩方式 ${method}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return found;
}

/** 转格式用的外部工具（ffmpeg、magick），找不到就说要装什么。 */
function run(/** @type {string} */ tool, /** @type {string[]} */ args) {
  try {
    execFileSync(tool, args, { stdio: ["ignore", "ignore", "pipe"] });
    return true;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return false;
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const outAt = args.indexOf("--out");
  const out = outAt >= 0 ? args[outAt + 1] : ASSETS;
  if (outAt >= 0 && !out) throw new Error("--out 后面要跟目录");

  const todo = missingIn(out);
  if (check) {
    for (const file of todo) console.error(`缺或不对：${file.path}`);
    console.log(todo.length === 0 ? `Minecraft 素材 ${listed().length} 个都在` : `缺或不对 ${todo.length} 个，跑 npm run assets 补`);
    process.exit(todo.length === 0 ? 0 : 1);
  }
  const wanted = new Set(todo.map((file) => file.path));
  const write = (/** @type {string} */ path, /** @type {Uint8Array} */ data) => {
    for (const dir of out === ASSETS && existsSync(dirname(KIT_COPY)) ? [ASSETS, KIT_COPY] : [out]) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), data);
    }
  };
  const work = mkdtempSync(join(tmpdir(), "kddb-assets-"));
  let done = 0;
  try {
    // 1. 客户端 JAR 里原样提取的（缺一个才下载，约 28 MB）
    const manifest = read("manifest.json");
    const fromJar = manifest.files.filter((/** @type {any} */ file) => wanted.has(file.path));
    if (fromJar.length > 0) {
      console.log(`下载 Minecraft ${manifest.minecraftJavaVersion} 客户端（${(manifest.clientBytes / 1e6).toFixed(1)} MB，官方地址）…`);
      const jar = await download(manifest.clientUrl);
      expect("客户端大小", String(jar.length), String(manifest.clientBytes));
      expect("客户端 SHA-1", digest("sha1", jar), manifest.clientSha1);
      const entries = unzip(jar, new Set(fromJar.map((/** @type {any} */ file) => file.source)));
      for (const file of fromJar) {
        const data = entries.get(file.source);
        if (!data) throw new Error(`客户端里没有 ${file.source}`);
        expect(file.path, digest("sha256", data), file.sha256);
        write(file.path, data);
        done += 1;
      }
    }

    // 2. Minecraft Wiki 的背包渲染图（原样）；附魔金苹果的静态图是 GIF 的第一帧
    const wiki = read("inventory/provenance.json").files;
    for (const file of wiki.filter((/** @type {any} */ file) => wanted.has(file.path) && file.url)) {
      write(file.path, await fromWiki(file));
      done += 1;
    }
    for (const file of wiki.filter((/** @type {any} */ file) => wanted.has(file.path) && file.derivation)) {
      const source = wiki.find((/** @type {any} */ item) => item.path === file.source);
      const gif = join(work, "source.gif");
      const png = join(work, "frame.png");
      const data = await fromWiki(source);
      writeFileSync(gif, data);
      const made = run("magick", [`${gif}[0]`, "-coalesce", "+repage", "-define", "png:color-type=6", png]) || run("ffmpeg", ["-y", "-loglevel", "error", "-i", gif, "-frames:v", "1", "-pix_fmt", "rgba", png]);
      if (!made) throw new Error(`${file.path} 要 ImageMagick 或 ffmpeg 取 GIF 第一帧`);
      write(file.path, readFileSync(png));
      done += 1;
    }

    // 3. 音效：按资源索引下载 OGG，核对后只转成 MP3（不剪、不混、不改音量）
    const sounds = read("sounds/provenance.json");
    const soundTodo = sounds.files.filter((/** @type {any} */ file) => wanted.has(file.path));
    if (soundTodo.length > 0) {
      const indexBytes = await download(sounds.assetIndexUrl);
      expect("资源索引 SHA-1", digest("sha1", indexBytes), sounds.assetIndexSha1);
      const objects = JSON.parse(new TextDecoder().decode(indexBytes)).objects;
      for (const file of soundTodo) {
        const hash = objects[file.source]?.hash;
        expect(`${file.source} 在索引里的散列`, hash, file.sourceSha1);
        const data = await download(`https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`);
        expect(file.source, digest("sha1", data), file.sourceSha1);
        const ogg = join(work, "source.ogg");
        const mp3 = join(work, "sound.mp3");
        writeFileSync(ogg, data);
        if (!run("ffmpeg", ["-y", "-loglevel", "error", "-i", ogg, "-map_metadata", "-1", "-codec:a", "libmp3lame", "-b:a", file.bitrate, mp3]))
          throw new Error("音效要 ffmpeg 把 OGG 转成 MP3");
        write(file.path, readFileSync(mp3));
        done += 1;
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(done === 0 ? `Minecraft 素材 ${listed().length} 个都在，没动` : `取回 ${done} 个，放在 ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
