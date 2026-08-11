import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Tauri 要求固定 dev 端口（与 tauri.conf.json 的 devUrl 一致）
const PORT = 5173

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    // 允许局域网设备访问（tauri 的 devUrl 用 localhost 不受影响）
    host: true,
    port: PORT,
    strictPort: true,
    watch: {
      // 忽略 src-tauri，避免 Rust 侧改动触发前端热更新
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    chunkSizeWarningLimit: 1600,
  },
})
