// ============================================================
// debug/transport.ts —— 传输层抽象
//   只定义「请求-响应-事件推送」的契约；具体实现 ws / tauri。
// ============================================================

export interface DebugRequest {
  id: number
  cmd: string
  args: Record<string, unknown>
}

export interface DebugReply {
  id: number
  ok: boolean
  data?: unknown
  error?: string
}

export interface DebugTransport {
  readonly kind: 'ws' | 'tauri'
  start(): void
  /** 事件推送（events.ts 经 sink 调用） */
  pushEvent(ev: unknown): void
}