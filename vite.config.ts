import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

// user-api (FastAPI) の接続先。既定はホスト上の 6629。
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:6629'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  server: {
    // Flutter の dev server(53333) と衝突しないポート
    port: 53334,
    strictPort: true,
    proxy: {
      // ブラウザからは同一オリジンの /api/... を叩き、Vite が user-api へ転送する。
      // これにより CORS が発生しない（バックエンド無改変）。
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
