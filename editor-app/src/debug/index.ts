// ============================================================
// debug/index.ts —— 调试通道装配（模块加载即有副作用，幂等）
//   · 装 console 环形缓冲（console.tail 数据源）
//   · 注册全部命令（commands.ts 副作用）
//   · 选传输：Tauri → tauri-transport；dev 浏览器 → ws-transport（vite 中继）
//   · 业务事件桥：toast / tab 生命周期 / log.error 轮询 → events.ts
//   main.ts 在 app 挂载后 import 本模块（业务模块绝不反向 import debug/*）。
// ============================================================
import { watch } from 'vue'
import { installConsoleRing } from './console-ring'
import './commands' // 副作用：注册命令
import { setEventSink, emitEvent } from './events'
import { WsTransport } from './ws-transport'
import { TauriTransport } from './tauri-transport'
import type { DebugTransport } from './transport'
import { state } from '../state/store'
import { logEntries } from '../diagnostics/logger'

installConsoleRing()

function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

let transport: DebugTransport | null = null
if (isTauriEnv()) {
  transport = new TauriTransport()
} else if (import.meta.env.DEV) {
  transport = new WsTransport()
}
if (transport) {
  setEventSink((ev) => {
    try {
      transport?.pushEvent(ev)
    } catch {
      /* ignore */
    }
  })
  transport.start()
}

// ---------- 业务事件桥 ----------

// toast（state.toasts 是数组，watch 长度增量取新条）
let toastSeen = 0
watch(
  () => state.toasts.length,
  (n) => {
    while (toastSeen < n) {
      const t = state.toasts[toastSeen++]
      emitEvent('toast', { text: t?.text, type: t?.type })
    }
  }
)

// 标签生命周期（opened / closed / activated）
let tabCountSeen = 0
let lastActiveTab: string | null = null
watch(
  () => [state.tabs.length, state.activeTabId, state.tabs.map((t) => `${t.id}:${t.path}`).join(',')],
  ([len, active, joined]) => {
    void joined
    if (tabCountSeen === 0) {
      tabCountSeen = len ?? 0
    }
    if (len !== tabCountSeen) {
      if (len > tabCountSeen) emitEvent('tab.opened', { count: len })
      else emitEvent('tab.closed', { count: len })
      tabCountSeen = len ?? 0
    }
    if (active !== lastActiveTab && active != null) {
      emitEvent('tab.activated', { tabId: active })
    }
    lastActiveTab = active
  }
)

// log 轮询（logEntries 非响应式，轻量 1s 轮询，只上报 error/warn）
let logSeen = 0
setInterval(() => {
  while (logSeen < logEntries.length) {
    const e = logEntries[logSeen++]
    if (e.level === 'error' || e.level === 'warn') {
      emitEvent(`log.${e.level}`, { msg: e.msg, area: e.area, t: e.t })
    }
  }
}, 1000)

// 导出 __writeitDebug 挂载信息（CLI/Agent 判断后端用）
;(window as unknown as Record<string, unknown>).__writeitDebug = {
  transport: transport?.kind ?? 'none',
  commands: ['app.info', 'tabs.list', 'doc.markdown', 'doc.selection', 'refs.registry', 'refs.broken', 'dom.snapshot', 'editor.probe', 'perf.monitor', 'git.status', 'logs.tail', 'console.tail', 'events.since', 'screenshot', 'mockfs.state', 'action.run', 'docstore.inspect', 'exec'],
}

export { transport }