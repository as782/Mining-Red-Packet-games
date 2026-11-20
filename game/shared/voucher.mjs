// 领取凭证（docs/V3_MAP.md §3）：游戏站在一个人领取时签，网页交给判定器，
// 判定器用公钥核对。一行字：kd3.<开放时间毫秒>.<LINUX DO ID>.<分>.<钥匙编号>.<签名>，
// 签名是 ES256（P-256，r‖s 64 字节）对前五段的签名，base64url 86 个字。

/**
 * @typedef {{ openedAt: number, id: number, points: number, kid: string }} VoucherFields
 */

/** @param {VoucherFields} fields */
export function voucherBody({ openedAt, id, points, kid }) {
  for (const [name, value] of Object.entries({ openedAt, id, points }))
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError(`凭证的 ${name} 要是不小于 0 的整数`);
  if (!/^[a-z0-9]{1,8}$/.test(kid)) throw new TypeError("钥匙编号是 1–8 个小写字母或数字");
  return `kd3.${openedAt}.${id}.${points}.${kid}`;
}

/** @param {Uint8Array} bytes */
function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * @param {VoucherFields} fields
 * @param {JsonWebKey} privateJwk 游戏站的私钥（只在 Worker 的 secret 里）
 */
export async function signVoucher(fields, privateJwk) {
  const body = voucherBody(fields);
  const { kty, crv, x, y, d } = privateJwk;
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty, crv, x, y, d },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(body)),
  );
  return `${body}.${base64url(signature)}`;
}
