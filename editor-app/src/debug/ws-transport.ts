// ============================================================
// debug/ws-transport.ts —— dev 模式：反向连 vite 中继（/__debug/client）
//   页面在 A 机 vite 加载（B 机也行，只要连得上 vite），WS 连回同一
//   host 的 /__debug/client；中继把 Agent 的请求转发过来，我们执行后
//   回传。指数退避重连（热更新/刷新后自动恢复 attach）。
// ============================================================
import { execute } from './registry'
import type { DebugReply, DebugTransport } from './transport'
import { state } from '../state/store'

const WS_PATH = '/__debug/client'
const MAX_RETRY_MS = 10_000

export class WsTransport implements DebugTransport {
  readonly kind = 'ws' as const
  private ws: WebSocket | null = null
  private stopped = false
  private retryMs = 500

  start(): void {
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.ws?.close()
    this.ws = null
  }

  pushEvent(ev: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'event', payload: ev })
    }
  }

  private connect(): void {
    if (this.stopped) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    try {
      const ws = new WebSocket(`${proto}://${location.host}${WS_PATH}`)
      this.ws = ws
      ws.onopen = () => {
        this.retryMs = 500
        this.send({
          type: 'attach',
          ua: navigator.userAgent,
          url: location.href,
          backend: state.fsName,
          // 设备可读名：URL ?deviceLabel= 或 localStorage writeit.deviceLabel 可覆盖；
          // 默认 平台 + 视口（多设备排队时一眼可辨）
          deviceLabel: this.deviceLabel(),
        })
      }
      ws.onmessage = (ev) => {
        void this.handleMessage(ev.data)
      }
      ws.onclose = () => {
        if (this.stopped) return
        this.ws = null
        setTimeout(() => this.connect(), this.retryMs + Math.random() * 300)
        this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS)
      }
      ws.onerror = () => {
        ws.close()
      }
    } catch {
      setTimeout(() => this.connect(), this.retryMs)
    }
  }

  private async handleMessage(raw: unknown): Promise<void> {
    let frame: { id?: number; cmd?: string; args?: Record<string, unknown>; aid?: string }
    try {
      frame = typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof frame)
    } catch {
      return
    }
    if (typeof frame.id !== 'number' || typeof frame.cmd !== 'string') return
    const res = await execute(frame.cmd, frame.args ?? {})
    const reply: DebugReply = { id: frame.id, ok: res.ok, data: res.data, error: res.error }
    this.send({ type: 'reply', payload: reply, aid: frame.aid })
  }

  private deviceLabel(): string {
    try {
      const fromParam = new URLSearchParams(location.search).get('deviceLabel')
      if (fromParam) return `📺 ${fromParam}`
      const fromLs = localStorage.getItem('writeit.deviceLabel')
      if (fromLs) return `📺 ${fromLs}`
    } catch {
      /* ignore */
    }
    return `📺 ${navigator.platform} ${innerWidth}x${innerHeight}`
  }

  private send(obj: unknown): void {
    try {
      this.ws?.send(JSON.stringify(obj))
    } catch {
      /* ignore */
    }
  }
}