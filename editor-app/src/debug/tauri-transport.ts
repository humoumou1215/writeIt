// ============================================================
// debug/tauri-transport.ts —— 桌面版：Rust 壳 TCP debug server 的中继
//   Rust 收到 CLI 请求 → emit 'debug://request' → 我们执行 → invoke
//   'debug_reply' 回传；事件经 invoke 'debug_emit' 推给 Rust 广播到连接。
// ============================================================
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { execute } from './registry'
import type { DebugReply, DebugTransport } from './transport'

interface RequestPayload {
  id: number
  cmd: string
  args?: Record<string, unknown>
}

export class TauriTransport implements DebugTransport {
  readonly kind = 'tauri' as const
  private unlisten: (() => void) | null = null

  start(): void {
    void listen<RequestPayload>('debug://request', (ev) => {
      const { id, cmd, args } = ev.payload
      void execute(cmd, args ?? {}).then((res) => {
        const reply: DebugReply = { id, ok: res.ok, data: res.data, error: res.error }
        invoke('debug_reply', {
          id: reply.id,
          ok: reply.ok,
          data: reply.data ?? null,
          error: reply.error ?? null,
        }).catch((e) => console.warn('[debug] reply 回传失败:', e))
      })
    }).then((un) => {
      this.unlisten = un
    })
  }

  stop(): void {
    this.unlisten?.()
    this.unlisten = null
  }

  pushEvent(ev: unknown): void {
    invoke('debug_emit', { event: ev }).catch((e) => console.warn('[debug] 事件推送失败:', e))
  }
}