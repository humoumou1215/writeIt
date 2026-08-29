import { createApp } from 'vue'
import App from './App.vue'

// 诊断日志（D1）：副作用安装 —— 最先接管 console + 全局异常捕获
// （模块图求值最早期执行，先于任何业务代码的运行时调用）
import './diagnostics/logger'

// crepe 各功能样式（离线打包，不依赖 CDN）
import '@milkdown/crepe/theme/common/style.css'
// 应用外壳基础样式
import './style.css'

// 调试通道（Agent 调试）：Tauri 桌面版 / dev 浏览器中继；无副作用之外不阻塞启动
import './debug'

createApp(App).mount('#app')
