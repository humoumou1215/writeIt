// ============================================================
// 诊断监控器（D2.5）——随应用启动后台采样的轻量性能/健康指标
//  1. FPS 采样：rAF 间隔统计（avg / 低帧率秒数）——动画/渲染卡顿的直接证据
//  2. 长任务：PerformanceObserver longtask（Chrome/Edge；WebKit 不支持则静默）
//  3. 渲染计数：markdownUpdated 触发频率（编辑器内容变更节奏）
// 仅当 settings.diagEnabled 开启时工作；忽略所有异常（不干扰应用）
// 采集器在生成诊断包时读取快照取样（而非实时测，保证证据时间点一致）
// ============================================================
import { settings } from '../state/settings'

const FPS_WINDOW = 2000 // 累计采样窗口上限 ms
let _fpsSamples = 0
let _fpsTotal = 0
let _lowFpsSeconds = 0
let _running = false

// rAF 环：每帧记间隔，并按 500ms 窗口聚合
let _lastRaF = 0
let _winStart = 0
let _winFrames = 0
let _monitorStart = 0

function frameTick(ts: number) {
  if (!settings.diagEnabled) {
    _running = false
    return
  }
  if (_lastRaF) {
    const dt = ts - _lastRaF
    if (dt > 0 && dt < 250) {
      _fpsTotal += 1000 / dt
      _fpsSamples++
      _winFrames++
      // 低帧率：单帧间隔 > 33ms（<30fps）
      if (dt > 33) _lowFpsSeconds += dt / 1000
    }
  }
  _lastRaF = ts
  // 每 500ms 窗口输出一次 avg（供临时指标，窗口增速太快时重置）
  if (ts - _winStart >= FPS_WINDOW) {
    _winStart = ts
    _winFrames = 0
  }
  requestAnimationFrame(frameTick)
}

let _longTasks: Array<{ start: number; duration: number; name: string }> = []
let _longObs: PerformanceObserver | null = null

/** 启动采样（幂等；main.ts logger 安装后由 index.boot 调用） */
export function startMonitor(): void {
  if (_running) return
  _running = true
  _monitorStart = Date.now()
  _lastRaF = 0
  _winStart = performance.now()
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame((t) => {
      _winStart = t
      frameTick(t)
    })
  }
  // 长任务（blink：render/main 长任务；WebKit 无此 API 会抛 → 忽略）
  try {
    if (typeof PerformanceObserver === 'function') {
      _longObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          _longTasks.push({
            start: Math.round(e.startTime),
            duration: Math.round((e as PerformanceEntry & { duration: number }).duration),
            name: (e as PerformanceEntry & { name?: string }).name ?? '',
          })
          if (_longTasks.length > 20) _longTasks.splice(0, _longTasks.length - 20)
        }
      })
      _longObs.observe({ entryTypes: ['longtask'] })
    }
  } catch {
    /* 不支持则跳过 */
  }
}

/** 渲染计数表：markdownUpdated 触发（编辑器内容变更节奏） */
let _renderCount = 0
let _lastRenderAt = 0
/** manager.ts markdownUpdated 钩子调用（非 suppressing 时由 manager 调） */
export function markEditorRender(): void {
  _renderCount++
  _lastRenderAt = Date.now()
}

/** 生成时读取快照（同步、无副作用） */
export function getMonitorSnapshot(): Record<string, unknown> {
  const elapsed = Math.max(1, Date.now() - _monitorStart)
  const avgFps = _fpsSamples ? Math.round(_fpsTotal / _fpsSamples) : null
  const insufficient = _fpsSamples < 24 // 采样不足（<约 10s 运行）时 fps 视为噪音
  return {
    uptimeSec: Math.round(elapsed / 1000),
    fps: {
      sampled: _fpsSamples,
      avgFps: insufficient ? null : avgFps,
      lowFpsSeconds: Math.round(_lowFpsSeconds * 10) / 10,
      lowRatio: _fpsSamples ? Math.round((_lowFpsSeconds * 1000 / _fpsSamples) * 10) / 10 : null,
      insufficient,
    },
    longTasks: _longTasks,
    longTaskCount: _longTasks.length,
    maxLongTaskMs: _longTasks.length ? Math.max(..._longTasks.map((t) => t.duration)) : 0,
    editorRenders: {
      count: _renderCount,
      perMin: Math.round((_renderCount * 60) / elapsed),
      lastAt: _lastRenderAt ? new Date(_lastRenderAt).toISOString() : null,
    },
  }
}