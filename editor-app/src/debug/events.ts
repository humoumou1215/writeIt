// ============================================================
// debug/events.ts —— 事件环形缓冲 + 序号
//   事件由本模块产生并带 seq 缓存（1000 条），供：
//     长连接（ws/tauri）实时推送给订阅者
//     无长连接端（Pi 工具）用 events.since {seq} 轮询补拉
//   缓冲放前端，两种传输零额外服务端实现。
// ============================================================

export interface DebugEvent {
  seq: number
  event: string
  at: string // ISO time
  data?: unknown
}

const RING_SIZE = 1000
const ring: DebugEvent[] = []
let seq = 0

/** 由 index.ts 启动时注入：推送事件到已连接的传输层 */
type EventSink = (ev: DebugEvent) => void
let sink: EventSink | null = null
export function setEventSink(fn: EventSink | null): void {
  sink = fn
}

export function emitEvent(event: string, data?: unknown): void {
  const ev: DebugEvent = { seq: ++seq, event, at: new Date().toISOString(), data }
  ring.push(ev)
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE)
  try {
    sink?.(ev)
  } catch {
    /* sink 失败不影响业务 */
  }
}

/** 返回 seq > n 的事件切片（正序） */
export function eventsSince(n: number): DebugEvent[] {
  return ring.filter((e) => e.seq > n)
}

export function lastSeq(): number {
  return seq
}
