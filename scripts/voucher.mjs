// 给测试签凭证：node scripts/voucher.mjs <开放时间> <LINUX DO ID> <分> [钥匙编号]
// 私钥文件由 KDDB_CLAIM_KEY 指定（JWK，不进仓库）。开放时间写毫秒或带时区的 ISO 时间；
// 测试只用 v3 上线以前的开放时间，这样的凭证对不上任何真红包。
import { readFileSync } from "node:fs";
import { signVoucher } from "../game/shared/voucher.mjs";

const [openedAtText, idText, pointsText, kid = "k1"] = process.argv.slice(2);
const file = process.env.KDDB_CLAIM_KEY;
if (!openedAtText || !idText || !pointsText || !file) {
  console.error("用法：KDDB_CLAIM_KEY=<私钥 JWK 文件> node scripts/voucher.mjs <开放时间> <ID> <分> [钥匙编号]");
  process.exit(1);
}
const openedAt = /^\d+$/.test(openedAtText) ? Number(openedAtText) : Date.parse(openedAtText);
if (!Number.isSafeInteger(openedAt) || openedAt >= Date.parse("2026-11-06T00:00:00+08:00")) {
  console.error("测试只签 v3 上线以前（2026-11-06 以前）的开放时间");
  process.exit(1);
}
const privateJwk = JSON.parse(readFileSync(file, "utf8"));
console.log(await signVoucher({ openedAt, id: Number(idText), points: Number(pointsText), kid }, privateJwk));
