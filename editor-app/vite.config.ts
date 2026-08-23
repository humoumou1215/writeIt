import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import devRepo from './vite-plugins/dev-repo'
// 诊断包：注入应用版本与构建时间（__APP_VERSION__ / __BUILD_TIME__，编译期内联）
import { readFileSync } from 'node:fs'
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Tauri 要求固定 dev 端口（与 tauri.conf.json 的 devUrl 一致）
const PORT = 5173

export default defineConfig({
  plugins: [vue(), devRepo()],
  clearScreen: false,
  // 诊断包：应用版本 + 构建时间（编译期内联）
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // 导出 PDF 的内置中文字体（.otf，Vite 默认 asset 列表不含 otf）
  assetsInclude: ['**/*.otf'],
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