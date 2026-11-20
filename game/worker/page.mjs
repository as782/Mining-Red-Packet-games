// v3 的网页（/v3/）从红包站加载附带网页 SDK。SDK 只和加载它的那个站说话，
// 所以 Stage 的游戏站要从 Stage 的红包站加载：构建里写的是线上地址，
// 发给浏览器以前换成这个环境的 HB_ORIGIN（线上不变）。

export const SDK_URL = "https://hb.lafi.sh/sdk/v1.js";

/** @param {string} html @param {string} hbOrigin */
export function withSdkFrom(html, hbOrigin) {
  return html.replaceAll(`src="${SDK_URL}"`, `src="${hbOrigin}/sdk/v1.js"`);
}

/**
 * 静态资源给的 /v3/ 换掉 SDK 地址；304、出错和别的类型原样给。
 * @param {Response} response @param {string} hbOrigin
 */
export async function pageFrom(response, hbOrigin) {
  if (response.status !== 200 || !(response.headers.get("content-type") ?? "").startsWith("text/html")) return response;
  if (new URL(SDK_URL).origin === hbOrigin) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  return new Response(withSdkFrom(await response.text(), hbOrigin), { status: 200, headers });
}
