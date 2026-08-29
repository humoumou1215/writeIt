// ============================================================
// debug/console-ring.ts —— 独立于诊断 logger 的 console 环形缓冲
//   诊断 logger 刻意不记 console.log（防噪声）；调试通道的 console.tail
//   需要全量（含 log），故单独拦截。幂等安装（单例标记）。
// ============================================================

export interface ConsoleEntry {
  t: number
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  args: unknown[]
}

const RING_SIZE = 500
const ring: ConsoleEntry[] = []
let installed = false

function push(level: ConsoleEntry['level'], args: unknown[]): void {
  ring.push({ t: Date.now(), level, args: args.map((a) => {
    // 大字符串截断，防环膨胀
    if (typeof a === 'string' && a.length > 400) return `${a.slice(0, 400)}…(${a.length} 字)`
    return a
  })})
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE)
}

export function installConsoleRing(): void {
  if (installed) return
  installed = true
  const c = console as unknown as Record<string, (...a: unknown[]) => void>
  const wrap =
    (level: ConsoleEntry['level']) =>
    (...args: unknown[]) => {
      try {
        push(level, args)
      } catch {
        /* ignore */
      }
      // 尽量保留原 console 行为（color/instanceof 等）；对象原样交给原方法
      const orig = (c[level] ?? c.log) as (...a: unknown[]) => void
      try {
        return orig.apply(console, args)
      } catch {
        return undefined
      }
    }
  c.log = wrap('log')
  c.info = wrap('info')
  c.warn = wrap('warn')
  c.error = wrap('error')
  c.debug = wrap('debug')
}

export function consoleTail(n: number): ConsoleEntry[] {
  const count = Math.min(Math.max(1, Math.floor(n) || 50), RING_SIZE)
  return ring.slice(-count)
}