import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// 账户版网页：原版 v3 的 React 页面，接口同源（/api/hb/* 和 /v3/api/*）。
export default defineConfig({
  root: '.',
  base: '/game/',
  publicDir: 'public',
  define: {
    __API_BASE__: JSON.stringify('/v3/api/'),
  },
  build: {
    outDir: '../public/game',
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
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
