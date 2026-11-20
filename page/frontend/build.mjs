import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { requireAssets } from '../../scripts/minecraft-assets.mjs'

// v2：只构建 dist/（游戏站根路径上的网页，开着的 v2 红包还在用）。
// page/ 现在是 v3 的（判定器 v3 的网页，见 build-v3.mjs）。
requireAssets()
await build()
console.log(`v2 静态发布目录：${fileURLToPath(new URL('./dist/', import.meta.url))}`)
