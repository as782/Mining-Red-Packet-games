import { cp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { requireAssets } from '../../scripts/minecraft-assets.mjs'

// v3：先构建线上那份（dist-v3/，scripts/site.mjs 把它放到游戏站的 /v3/ 下），
// 再构建开发包那份，放进 page/（npm run page 从这里发网页）。
requireAssets()
await build({ configFile: fileURLToPath(new URL('./vite.v3.config.ts', import.meta.url)), mode: 'site' })
await build({ configFile: fileURLToPath(new URL('./vite.v3.config.ts', import.meta.url)), mode: 'kit' })
const kit = new URL('./dist-v3-kit/', import.meta.url)
const page = new URL('../', import.meta.url)
await rm(new URL('assets/', page), { recursive: true, force: true })
await cp(new URL('assets/', kit), new URL('assets/', page), { recursive: true })
await cp(new URL('index.html', kit), new URL('index.html', page))
console.log('v3：线上的在 dist-v3/，开发包的已放进 page/index.html 和 page/assets/')

