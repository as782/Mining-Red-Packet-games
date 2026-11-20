import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      onwarn(warning, warn) {
        // This entire artifact is a browser client; upstream RSC markers are inapplicable.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client') && /node_modules\/(?:@tanstack\/react-router|framer-motion)\//.test(warning.id ?? '')) return
        warn(warning)
      },
    },
  },
})
