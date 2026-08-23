// ============================================================
// 诊断日志服务（LogBus）—— D1
//  1. 环形日志缓冲：console.* 代理 + window error/unhandledrejection + 业务埋点
//  2. 环形操作轨迹：diag.event()（结构化事件，供时间轴复现）
//  3. 全局异常自动提示：toast（防抖 8s）+ 状态栏红点（hasUnviewedError）
// 幂等安装：bootDiagnostics() 只能调用一次（多次调用仅补装监听，不重复代理 console）
// 所有数据留在内存，不落盘 —— 由 ReportModal「生成诊断包」时采集打包
// ============================================================
import { settings } from '../state/settings'
import { toast } from '../state/store'

export type DiagLevel = 'debug' | 'info' | 'warn' | 'error'

export interface DiagLogEntry {
  /** epoch ms */
  t: number
  level: DiagLevel
  /** 来源域：boot / console / window / mermaid / tab / save / export / validate / diag … */
  area: string
  msg: string
  /** 附加数据（尽量小，采集时 JSON 序列化） */
  data?: unknown
}

export interface DiagTimelineEntry {
  t: number
  type: string
  /** 目标（路径 basename 或元素描述），空可省略 */
  target?: string
  /** 耗时 ms（可选） */
  ms?: number
  /** 成败（可选） */
  ok?: boolean
  /** 附加载荷（可选） */
  data?: unknown
}

/** 上下文面包屑（错误发生时附带的「刚才用户在做啥」紧凑轨迹） */
export interface DiagCrumb {
  t: number
  type: string
  /** 目标（路径/元素描述），空可省略 */
  target?: string
  /** 紧凑载荷（只放字符串/数字，随 error 数据序列化） */
  data?: unknown
}

const LOG_RING_SIZE = 2000
const TIMELINE_RING_SIZE = 1000
const CRUMB_RING_SIZE = 16

/** 环形日志（entries[t] 为最新） */
export const logEntries: DiagLogEntry[] = []
/** 环形操作轨迹 */
export const timelineEntries: DiagTimelineEntry[] = []
/** 环形面包屑：最近操作的紧凑轨迹（异常发生时随 error 数据附带，还原现场） */
export const crumbRing: DiagCrumb[] = []
/** 启动时间（epoch ms）——埋点耗时基准 */
export const bootAt = Date.now()

// ---- 遇到未查看的 error 级事件即置位（状态栏红点；点开诊断弹窗后清除） ----
let _hasUnviewedError = false
let _lastErrorToastAt = 0
/** 是否有未查看的异常（状态栏红点用） */
export function hasUnviewedError(): boolean {
  return _hasUnviewedError
}
/** 用户点开诊断弹窗 / 查看后调用，熄掉红点 */
export function markDiagViewed(): void {
  _hasUnviewedError = false
}

function pushLog(e: DiagLogEntry): void {
  // error/warn 自动附带上下文面包屑（最近 10 条操作），还原异常发生前用户在做什么
  const entry: DiagLogEntry =
    e.level === 'error' || e.level === 'warn'
      ? { ...e, data: { ...((e.data ?? {}) as object), crumbs: crumbSnapshot().slice(-10) } }
      : e
  logEntries.push(entry)
  if (logEntries.length > LOG_RING_SIZE) logEntries.splice(0, logEntries.length - LOG_RING_SIZE)
  if (e.level === 'error' || e.level === 'warn') _hasUnviewedError = true
}

function pushTimeline(e: DiagTimelineEntry): void {
  timelineEntries.push(e)
  if (timelineEntries.length > TIMELINE_RING_SIZE) timelineEntries.splice(0, timelineEntries.length - TIMELINE_RING_SIZE)
}

/** 面包屑：紧凑最近操作（异常随附现场用）；不额外占 timeline 环 */
export function pushCrumb(type: string, opts: { target?: string; data?: unknown } = {}): void {
  crumbRing.push({ t: Date.now(), type, target: opts.target, data: compact(opts.data) })
  if (crumbRing.length > CRUMB_RING_SIZE) crumbRing.splice(0, crumbRing.length - CRUMB_RING_SIZE)
}

/** 紧凑化（防循环引用 / 超大串，随 error 数据序列化） */
function compact(v: unknown): unknown {
  if (v === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(v, diagDataReplacer))
  } catch {
    return String(v)
  }
}

/** 面包屑快照（时间正序，旧→新） */
export function crumbSnapshot(): DiagCrumb[] {
  return [...crumbRing]
}

/** 业务日志：diag(level, area, msg, data?) */
export function diag(level: DiagLevel, area: string, msg: string, data?: unknown): void {
  pushLog({
    t: Date.now(),
    level,
    area,
    msg,
    data: data === undefined ? undefined : JSON.parse(JSON.stringify(data, diagDataReplacer)),
  })
}

/**
 * 操作轨迹埋点：diagEvent(type, { target, ms, ok, data })。
 * 受设置 diagTrackTimeline 控制；diag(level…) 不受影响。
 */
export function diagEvent(
  type: string,
  opts: Omit<DiagTimelineEntry, 't' | 'type'> = {}
): void {
  if (!settings.diagEnabled || !settings.diagTrackTimeline) return
  pushTimeline({ t: Date.now(), type, ...opts })
  // 同源也进面包屑（异常时还原现场）；只留紧凑字段
  pushCrumb(type, { target: opts.target, data: opts.data })
}

/** 截断脏数据（超大字符串 / 循环引用），避免日志环膨胀 */
function diagDataReplacer(_k: string, v: unknown): unknown {
  if (typeof v === 'string') {
    if (v.length > 800) return `${v.slice(0, 800)}…(${v.length} 字)`
    return v
  }
  if (v instanceof Error) return { name: v.name, message: v.message, stack: (v.stack ?? '').slice(0, 1200) }
  return v
}

let installed = false
/** 幂等安装：main.ts 最先调用。返回是否首次安装 */
export function bootDiagnostics(): boolean {
  if (installed) return false
  installed = true

  diag('info', 'boot', `诊断服务启动（版本 ${__APP_VERSION__ ?? 'dev'}）`)
  diagEvent('app:boot', { data: { buildTime: __BUILD_TIME__ } })

  // ---- console 代理：转发 + 记录 ----
  const orig = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
    log: console.log.bind(console),
  }
  const levelOf = (m: 'error' | 'warn' | 'info' | 'debug'): DiagLevel => m === 'debug' ? 'debug' : m
  const wrap = (m: 'error' | 'warn' | 'info' | 'debug') => {
    const lvl = levelOf(m)
    // eslint-disable-next-line no-console
    ;(console as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => {
      orig[m](...args)
      const msg = formatArgs(args).slice(0, 3000)
      // 代理自身重复打点会膨胀 → 内部统一经 diag()（不再走 console）
      pushLog({ t: Date.now(), level: lvl, area: 'console', msg, data: undefined })
    }
  }
  wrap('error')
  wrap('warn')
  wrap('info')
  wrap('debug')
  // 保留 console.log 原样（日志不记录普通 log，避免噪声；调试输出不受影响）
  ;(console as unknown as Record<string, unknown>).log = (...args: unknown[]) => orig.log(...args)

  // ---- 全局异常捕获（error 附完整堆栈 + 上下文面包屑） ----
  window.addEventListener('error', (ev: ErrorEvent) => {
    const err = ev.error
    const msg = `${ev.message ?? 'unknown'}${ev.filename ? ` @ ${ev.filename}:${ev.lineno}:${ev.colno}` : ''}`
    pushLog({
      t: Date.now(),
      level: 'error',
      area: 'window',
      msg,
      data:
        err instanceof Error
          ? { name: err.name, stack: (err.stack ?? '').slice(0, 4000) }
          : err !== undefined && err !== null
            ? { detail: String(err) }
            : undefined,
    })
    maybeAutoPrompt('window error')
  })
  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const r = ev.reason
    pushLog({
      t: Date.now(),
      level: 'error',
      area: 'unhandledrejection',
      msg: (r instanceof Error ? r.message : typeof r === 'string' ? r : 'Promise 被拒绝（见 data）').slice(0, 1200),
      data: r instanceof Error ? { name: r.name, stack: (r.stack ?? '').slice(0, 4000) } : r,
    })
    maybeAutoPrompt('unhandledrejection')
  })

  // ---- e2e / 调试钩子 ----
  ;(window as unknown as Record<string, unknown>).__diag = {
    get logs() { return [...logEntries] },
    get timeline() { return [...timelineEntries] },
    get crumbs() { return [...crumbRing] },
    logCount: () => logEntries.length,
    /** e2e 注入异常：触发全局 error 监听 */
    throwForTest(msg: string) {
      window.dispatchEvent(new ErrorEvent('error', { message: msg, filename: 'e2e.js', lineno: 1, colno: 1 }))
    },
  }
  return true
}

/** 全局异常 → 自动 toast（防抖 8s；受 diagAutoPrompt 控制） */
function maybeAutoPrompt(kind: string): void {
  if (!settings.diagAutoPrompt) return
  const now = Date.now()
  if (now - _lastErrorToastAt < 8000) return
  _lastErrorToastAt = now
  toast(`检测到异常（${kind}），已记录到诊断日志 — 可点 🩺 生成诊断包`, 'error')
}

/** args → 单行文本（压缩多参数，含 Error 的 message/stack） */
function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`
      if (typeof a === 'object' && a !== null) {
        try {
          const s = JSON.stringify(a, diagDataReplacer)
          return s && s.length < 1200 ? s : '[object]'
        } catch {
          return String(a)
        }
      }
      return String(a)
    })
    .join(' ')
}

/** 采集：日志文本（events.log 内容） */
export function logsToText(): string {
  const lines = logEntries.map(
    (e) => `${new Date(e.t).toISOString()} | ${e.level.toUpperCase().padEnd(5)} | ${e.area} | ${e.msg}${e.data !== undefined ? ` | data=${jsonSafe(e.data)}` : ''}`
  )
  return lines.join('\n') + '\n'
}

/** 采集：操作轨迹 JSONL（timeline.jsonl 内容） */
export function timelineToJsonl(): string {
  return timelineEntries.map((e) => jsonSafe(e)).join('\n') + '\n'
}

function jsonSafe(v: unknown): string {
  try {
    return JSON.stringify(v, diagDataReplacer)
  } catch {
    return JSON.stringify({ raw: String(v) })
  }
}

// 副作用式安装：模块图求值的最早时机即接管 console + 全局异常（main.ts 只需 import）。
// bootDiagnostics 幂等，重复调用仅补装监听不重复代理。
void bootDiagnostics()