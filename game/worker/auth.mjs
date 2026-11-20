// 认人（docs/V3_MAP.md §4，开发包 AGENTS.md“后端认人和读红包”）：
// 1. 网页先要一个一次性的 nonce（GET /v3/api/nonce）；
// 2. 带着它调 hb.identity({ nonce }) 拿红包站签的令牌（ES256 JWT，10 分钟）；
// 3. POST /v3/api/hello 交令牌：验签、iss、aud、判定器、红包、nonce，nonce 用掉作废，
//    换一张游戏站自己的票据（HMAC，2 小时），之后挖、领、实时推送都用票据。
// 只用 WebCrypto，不装 npm 包。

const encoder = new TextEncoder();

/** @param {Uint8Array} bytes */
export function toBase64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** @param {string} text */
export function fromBase64url(text) {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** @param {string} secret */
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** HMAC 签一段文字，返回 base64url。 */
async function mac(/** @type {string} */ secret, /** @type {string} */ text) {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(text));
  return toBase64url(new Uint8Array(signature));
}

/** 比两个签名，不因为提前不一样就早停。 */
function same(/** @type {string} */ a, /** @type {string} */ b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** nonce 两分钟内有效；用没用过由这个红包的游戏记着。 */
export const NONCE_TTL_MS = 2 * 60 * 1000;
/** 票据两小时，过期网页再走一遍 hello。 */
export const TICKET_TTL_MS = 2 * 60 * 60 * 1000;

/** 一次性的 nonce：随机数 + 时间 + 签名，字符都在 hb.identity 允许的范围里。 */
export async function makeNonce(/** @type {string} */ secret, /** @type {string} */ hongbao, /** @type {number} */ now) {
  const random = toBase64url(crypto.getRandomValues(new Uint8Array(12)));
  const body = `${random}.${now}`;
  return `${body}.${(await mac(secret, `nonce:${hongbao}:${body}`)).slice(0, 22)}`;
}

/** nonce 是不是这里发的、这个红包的、还没过期；用没用过另外查。 */
export async function nonceValid(/** @type {string} */ secret, /** @type {string} */ hongbao, /** @type {string} */ nonce, /** @type {number} */ now) {
  const parts = /^([A-Za-z0-9_-]{16})\.(\d{1,15})\.([A-Za-z0-9_-]{22})$/.exec(nonce);
  if (!parts) return false;
  const at = Number(parts[2]);
  if (now - at > NONCE_TTL_MS || at - now > 30_000) return false;
  return same(parts[3], (await mac(secret, `nonce:${hongbao}:${parts[1]}.${parts[2]}`)).slice(0, 22));
}

/**
 * @typedef {{ uid: number, name: string, hongbao: string, exp: number }} Ticket
 */

/** 游戏站自己的票据：谁、哪个红包、到什么时候。 */
export async function makeTicket(/** @type {string} */ secret, /** @type {Ticket} */ ticket) {
  const body = toBase64url(encoder.encode(JSON.stringify(ticket)));
  return `${body}.${await mac(secret, `ticket:${body}`)}`;
}

/** @returns {Promise<Ticket|null>} */
export async function readTicket(/** @type {string} */ secret, /** @type {string} */ text, /** @type {string} */ hongbao, /** @type {number} */ now) {
  const [body, signature, extra] = text.split(".");
  if (!body || !signature || extra !== undefined) return null;
  if (!same(signature, await mac(secret, `ticket:${body}`))) return null;
  try {
    const ticket = /** @type {Ticket} */ (JSON.parse(new TextDecoder().decode(fromBase64url(body))));
    return ticket.hongbao === hongbao && ticket.exp > now ? ticket : null;
  } catch {
    return null;
  }
}

/**
 * 红包站的公钥（JWKS），按地址缓存 10 分钟；读不到时用上次的。
 * @type {Map<string, { keys: JsonWebKey[], at: number }>}
 */
const jwksCache = new Map();

/** @param {string} site @param {typeof fetch} fetcher @param {number} now */
async function siteKeys(site, fetcher, now) {
  const kept = jwksCache.get(site);
  if (kept && now - kept.at < 10 * 60 * 1000) return kept.keys;
  try {
    const response = await fetcher(`${site}/api/page-identity/keys`);
    if (!response.ok) return kept?.keys ?? [];
    const { keys } = /** @type {{ keys: JsonWebKey[] }} */ (await response.json());
    jwksCache.set(site, { keys, at: now });
    return keys;
  } catch {
    return kept?.keys ?? [];
  }
}

/**
 * @typedef {{
 *   sub: string, username: string, name?: string, level?: number|null, hongbao: string,
 *   judge?: string, judgeVersion?: number, nonce?: string, exp: number, iat: number,
 * }} Identity
 */

/**
 * 验网页的令牌。不对就是 null（不说哪里不对，网页只要知道重新认人）。judgeId 可以是
 * 逗号隔开的几个（Stage 上同一份代码可能由几个测试账号各发一份）。
 * @param {string} token
 * @param {{
 *   site: string, page: string, judgeId: string, minJudgeVersion: number,
 *   hongbao: string, now: number, fetcher?: typeof fetch,
 * }} expect
 * @returns {Promise<Identity|null>}
 */
export async function verifyIdentity(token, { site, page, judgeId, minJudgeVersion, hongbao, now, fetcher = fetch }) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    if (header.alg !== "ES256") return null;
    const jwk = (await siteKeys(site, fetcher, now)).find((key) => /** @type {{ kid?: string }} */ (key).kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromBase64url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    const claims = /** @type {Identity & { iss: string, aud: string | string[], nbf?: number }} */ (
      JSON.parse(new TextDecoder().decode(fromBase64url(parts[1])))
    );
    const seconds = now / 1000;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== site || !audiences.includes(page)) return null;
    if (!(claims.exp + 30 > seconds) || (claims.nbf !== undefined && claims.nbf - 30 > seconds)) return null;
    const judges = judgeId.split(",").map((id) => id.trim()).filter(Boolean);
    if (claims.hongbao !== hongbao || !judges.includes(claims.judge)) return null;
    if (!(Number(claims.judgeVersion) >= minJudgeVersion)) return null;
    if (!/^\d{1,15}$/.test(String(claims.sub))) return null;
    return claims;
  } catch {
    return null;
  }
}
