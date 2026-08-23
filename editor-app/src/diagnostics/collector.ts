// ============================================================
// 诊断采集器（D2）—— 把应用现场组装成结构化 JSON
//  01-environment  02-settings  03-app-state  08-dom-snapshot
// 日志/轨迹文本由 logger.ts 提供（04/05）；截图/文档由 pack.ts 单独处理
// ============================================================
import { state } from '../state/store'
import { settings } from '../state/settings'
import { fs } from '../fs'
import { logEntries, timelineEntries, logsToText, timelineToJsonl } from './logger'
import { collectDomSnapshot } from './probes'
import { templateService } from '../template/service'
import { baseName } from '../fs/types'

export interface CollectOptions {
  /** 完整路径 or basename 脱敏 */
  includePaths: boolean
}

/** 按勾选脱敏路径 */
export function sanitizePath(path: string, includePaths: boolean): string {
  return includePaths ? path : baseName(path)
}

/** 01-environment（tauri 的 diagnostics_info 为异步补充；失败静默） */
export async function collectEnvironment(): Promise<Record<string, unknown>> {
  const nav = navigator
  const env: Record<string, unknown> = {
    appVersion: __APP_VERSION__,
    buildTime: __BUILD_TIME__,
    host: fs.kind,
    rootName: state.rootName || fs.rootName,
    // 运行时
    bootAt: new Date().toISOString(),
    uptimeSec: Math.round((Date.now() - (window.performance?.timeOrigin ?? Date.now())) / 1000),
    // 设备
    platform: nav.platform,
    userAgent: nav.userAgent,
    language: nav.language,
    languages: nav.languages ? [...nav.languages] : undefined,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: (nav as unknown as { deviceMemory?: number }).deviceMemory,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    // 显示
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      orientation: (screen as unknown as { orientation?: { type?: string } }).orientation?.type,
    },
    devicePixelRatio: window.devicePixelRatio || 1,
    innerSize: { w: window.innerWidth, h: window.innerHeight },
    font: {
      vwMode: 'applyFonts?',
      loadedFonts: (document.fonts?.size ?? 0),
      // 常见中文渲染字体是否可用（判断字形缺失/回退）
      checks: {
        'PingFang SC': document.fonts?.check('16px "PingFang SC"') ?? false,
        'Microsoft YaHei': document.fonts?.check('16px "Microsoft YaHei"') ?? false,
        SimSun: document.fonts?.check('16px "SimSun"') ?? false,
        'Noto Sans CJK SC': document.fonts?.check('16px "Noto Sans CJK SC"') ?? false,
      },
    },
    prefersReducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false,
    jsHeap: performanceMemory(),
  }
  // Tauri 宿主：Rust 侧系统信息（os/arch/版本/locale）
  if (fs.kind === 'tauri') {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const info = await invoke<Record<string, unknown>>('diagnostics_info')
      env.tauri = info
    } catch (e) {
      env.tauri = { error: String(e) }
    }
  }
  return env
}

function performanceMemory(): Record<string, unknown> | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number } }).memory
  if (!mem) return null
  const toMB = (n?: number) => (n ? Math.round(n / 1024 / 1024) : 0)
  return { usedJSHeapMB: toMB(mem.usedJSHeapSize), totalJSHeapMB: toMB(mem.totalJSHeapSize) }
}

/** 02-settings：把 reactive settings 转纯 JSON（不含诊断偏好外的敏感项；lastDir 属路径类，含） */
export function collectSettings(): Record<string, unknown> {
  return JSON.parse(JSON.stringify({ ...settings }))
}

/** 03-app-state */
export function collectAppState(opts: CollectOptions): Record<string, unknown> {
  const tabs = state.tabs.map((t) => ({
    id: t.id,
    path: sanitizePath(t.path, opts.includePaths),
    name: t.name,
    viewMode: t.viewMode,
    dirty: t.dirty,
    lastModified: t.lastModified,
  }))
  const active = state.activeTabId ? tabs.find((t) => t.id === state.activeTabId) : null
  return {
    fsName: state.fsName,
    rootName: state.rootName,
    tabCount: state.tabs.length,
    tabs,
    activeTab: active ?? null,
    treeVersion: state.treeVersion,
    sidebarCollapsed: state.sidebarCollapsed,
    git: {
      isRepo: state.gitPanel.repo?.isRepo ?? false,
      branch: state.gitPanel.repo?.branch ?? null,
      headHash: state.gitPanel.repo?.headHash ? state.gitPanel.repo.headHash.slice(0, 8) : null,
      statusCount: state.gitPanel.status?.length ?? 0,
    },
    templates: templateService.list().map((t) => ({
      doctype: t.doctype,
      domain: t.domain,
      hasRules: !!t.rulesFile,
      hasSuggest: !!t.suggestFile,
    })),
  }
}

/** 08-dom-snapshot */
export function collectDom(): ReturnType<typeof collectDomSnapshot> {
  return collectDomSnapshot()
}

/** 04-events.log 文本 */
export function collectLogsText(): string {
  return logsToText()
}

/** 05-timeline.jsonl 文本 */
export function collectTimelineJsonl(): string {
  return timelineToJsonl()
}

/** 诊断包文件清单描述（manifest 用） */
export function manifestFileList(included: Record<string, boolean>): string[] {
  const files = [
    'manifest.json',
    '00-summary.md',
    '01-environment.json',
    '02-settings.json',
    '03-app-state.json',
    '04-events.log',
    '05-timeline.jsonl',
    '09-notes.md',
  ]
  if (included.snapshot) files.push('06-snapshot.svg')
  if (included.dom) files.push('08-probes.json')
  if (included.doc) files.push('07-document.md')
  return files
}

export { logEntries, timelineEntries }