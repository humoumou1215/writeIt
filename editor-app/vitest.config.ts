// Vitest 配置：P0 测试网（M18）——model 层纯函数 + 少量编排逻辑（fake timer）
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // Vue SFC（RefMenu.vue 等经 vite 转换；vitest 同样需要）+ define 内联常量
  plugins: [vue()],
  define: {
    __APP_VERSION__: '"test"',
    __BUILD_TIME__: '"test"',
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // model 层纯函数需要 @milkdown/kit 的解析产物（parser 相关测试文件用 jsdom pragma）
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})