import { createApp } from 'vue'
import App from './App.vue'

// crepe 各功能样式（离线打包，不依赖 CDN）
import '@milkdown/crepe/theme/common/style.css'
// 应用外壳基础样式
import './style.css'

createApp(App).mount('#app')
