import { defineConfig } from 'vite'

// 矿洞夺宝 v3 的网页（docs/V3_MAP.md §6）。两份构建：
// site：放到游戏站的 /v3/ 下，接口同源 /v3/api/；
// kit：给开发包的模拟器（npm run page，从 page/ 发出），接口在本机 wrangler dev 上。
export default defineConfig(({ mode }) => {
  const kit = mode === 'kit'
  return {
    root: 'v3',
    base: kit ? './' : '/v3/',
    publicDir: '../public',
    define: {
      __API_BASE__: JSON.stringify(kit ? 'http://127.0.0.1:8787/v3/api/' : '/v3/api/'),
    },
    build: {
      outDir: kit ? '../dist-v3-kit' : '../dist-v3',
      emptyOutDir: true,
      assetsDir: 'assets',
      target: 'es2022',
      sourcemap: false,
      rollupOptions: {
        onwarn(warning, warn) {
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return
          warn(warning)
        },
      },
    },
  }
})
