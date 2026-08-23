// ============================================================
// 诊断模块入口（D2.5）
//  openReportModal()            幂等打开诊断弹窗 + 熄异常红点
//  generateDiagnosticPack(opts) 采集 → 打包 → 落盘（ReportModal 调用）
//  window.__diagnostics e2e/调试钩子
//  启动时注册探针桥 + startMonitor（轻量后台采样）
// ============================================================
import { state, toast } from '../state/store'
import { settings, saveSettings } from '../state/settings'
import { markDiagViewed, logEntries, timelineEntries } from './logger'
import {
  collectEnvironment,
  collectSettings,
  collectAppState,
  collectLogsText,
  collectTimelineJsonl,
  manifestFileList,
} from './collector'
import {
  collectDomSnapshot,
  collectDiffProbe,
  collectEditorProbe,
  detectCompat,
  type DiffProbe,
  type DomSnapshot,
  type EditorProbe,
  type CompatProbe,
} from './probes'
import { getMonitorSnapshot, startMonitor, markEditorRender } from './monitor'
import { buildSummary } from './summary'
import { buildZipBundle, persistPack, copyKeyPoints, type DiagnosticPackResult } from './pack'
import { getActiveTabMarkdown, getInstanceCount } from '../editor/manager'
import { getBrokenPaths } from '../editor/ref/app-plugin'

export interface GeneratePackOptions {
  snapshot: boolean // 截图
  dom: boolean // DOM 快照（含分层探针）
  doc: boolean // 文档内容
  paths: boolean // 完整路径
}

export type DiagProgress = (stage: string, pct: number) => void

/** 打开诊断弹窗（幂等） */
export function openReportModal(): void {
  if (!settings.diagEnabled) {
    toast('诊断功能已在设置中关闭', 'info')
    return
  }
  markDiagViewed()
  state.diagOpen = true
}

/** 记忆勾选偏好（设置持久化） */
export function rememberDiagOptions(opts: GeneratePackOptions): void {
  settings.diagIncludeSnapshot = opts.snapshot
  settings.diagIncludeDom = opts.dom
  settings.diagIncludeDoc = opts.doc
  settings.diagIncludePaths = opts.paths
  saveSettings()
}

/** 最近一次报告的生成结果（ReportModal 展示用；e2e 断言用） */
let lastResult: DiagnosticPackResult | null = null
export function getLastDiagnosticResult(): DiagnosticPackResult | null {
  return lastResult
}

// ---------- 探针桥（避免 probes→editor 循环依赖） ----------
function registerBridges(): void {
  const w = window as unknown as Record<string, unknown>
  w.__diagGetBroken = () => getBrokenPaths()
  w.__diagGetTabs = () =>
    state.tabs.map((t) => ({ path: t.path, name: t.name, viewMode: t.viewMode, dirty: t.dirty }))
  w.__diagGetInstanceCount = () => getInstanceCount()
}

// 模块加载即注册桥 + 启动监控（与 logger 同为副作用；startMonitor 幂等）
registerBridges()
void startMonitor()

/** manager 渲染钩子（markdownUpdated → 渲染计数） */
export function noteEditorRender(): void {
  markEditorRender()
}

// ---------- 采集 → 组装 ----------

interface Bundle {
  files: Record<string, string | Uint8Array>
  fileIndex: Array<{ name: string; size: number; desc: string }>
  env: Record<string, unknown>
  appState: Record<string, unknown>
  summary: string
}

const FILE_DESC: Record<string, string> = {
  'manifest.json': '依赖清单 + 勾选项 + 文件索引（先读）',
  '00-summary.md': 'AI 摘要：异常/关键结论/分层指标/阅读指引（第二读）',
  '04-events.log': '完整事件日志：console + 全局异常 + 业务埋点',
  '05-timeline.jsonl': '操作时间轴（结构化，按序复现）',
  '03-app-state.json': '标签/git/模板/文件树状态',
  '02-settings.json': '应用设置（主题/快捷键/诊断项）',
  '01-environment.json': '环境与设备（版本/OS/屏幕/字体/兼容性）',
  '06-snapshot.svg': '界面 SVG 快照（浏览器打开即所见）',
  '08-probes.json': '分层探针：ui/diff/editor/compat/monitor（紧凑 JSON）',
  '07-document.md': '当前文档内容（勾选项）',
  '09-notes.md': '用户描述 + 预置上下文',
}

async function buildBundle(options: GeneratePackOptions, notesText: string): Promise<Bundle> {
  const env = await collectEnvironment()
  const appState = collectAppState({ includePaths: options.paths })
  const settingsData = collectSettings()

  // ---- 分层探针（08-probes.json）----
  const ui: DomSnapshot | null = options.dom ? collectDomSnapshot() : null
  const diff: DiffProbe | null = options.dom ? collectDiffProbe() : null
  const editor: EditorProbe | null = options.dom ? collectEditorProbe() : null
  const compat: CompatProbe = detectCompat()
  const monitor = getMonitorSnapshot()
  const probes = { schema: 2, ui, diff, editor, compat, monitor }

  // ---- 截图 / 文档 ----
  let snapshot: string | null = null
  if (options.snapshot) {
    try {
      snapshot = await captureSnapshot()
    } catch (e) {
      console.warn('[diag] 截图失败:', e)
    }
  }
  const docContent = options.doc ? (getActiveTabMarkdown() ?? '') : null

  const logsText = collectLogsText()
  const timelineJsonl = collectTimelineJsonl()
  const notes = buildNotes(notesText, appState, options.paths)

  const included = { snapshot: options.snapshot, dom: options.dom, doc: options.doc, paths: options.paths }
  const stamp = new Date().toISOString()

  const files: Record<string, string | Uint8Array> = {
    'manifest.json': '', // 最后填（含 files 清单）
    '01-environment.json': JSON.stringify(env),
    '02-settings.json': JSON.stringify(settingsData),
    '03-app-state.json': JSON.stringify(appState),
    '04-events.log': logsText,
    '05-timeline.jsonl': timelineJsonl,
  }
  if (snapshot) files['06-snapshot.svg'] = snapshot
  if (docContent !== null) files['07-document.md'] = docContent
  if (options.dom) files['08-probes.json'] = JSON.stringify(probes) // compact：省 token
  files['09-notes.md'] = notes

  // AI 摘要 + manifest（依赖文件清单）
  const baseList = manifestFileList({ snapshot: options.snapshot, dom: options.dom, doc: options.doc }).filter(
    (n) => n !== '00-summary.md'
  )
  const summary = buildSummary({
    env,
    appState,
    settingsData,
    logs: logEntries,
    timeline: timelineEntries,
    dom: ui,
    diff,
    editor,
    compat,
    monitor,
    fileIndex: baseList.map((name) => ({
      name,
      size: files[name] ? (files[name] as string).length : 0,
      desc: FILE_DESC[name] ?? name,
    })),
    notesUserText: notesText,
    schemaVersion: 2,
  })
  files['00-summary.md'] = summary

  const fileIndex = [...baseList, '00-summary.md'].map((name) => ({
    name,
    size: files[name] ? (files[name] as string).length : 0,
    desc: FILE_DESC[name] ?? name,
  }))

  const manifest = {
    schemaVersion: 2,
    generatedAt: stamp,
    appVersion: env.appVersion,
    buildTime: env.buildTime,
    host: env.host,
    rootName: env.rootName,
    included,
    sanitizedPaths: !options.paths,
    files: ['manifest.json', '00-summary.md', '01-environment.json', '02-settings.json', '03-app-state.json', '04-events.log', '05-timeline.jsonl', '06-snapshot.svg', '08-probes.json', '07-document.md', '09-notes.md'].filter((n) => !n.startsWith('06-') || snapshot !== null).filter((n) => n !== '07-document.md' || docContent !== null),
    index: fileIndex.map((f) => ({ f: f.name, b: f.size, d: f.desc })),
  }
  files['manifest.json'] = JSON.stringify(manifest)

  return { files, fileIndex, env, appState, summary }
}

/**
 * 生成诊断包：采集 → 打包 → 落盘。
 * progress(stage, pct) 回调用于 UI 进度；返回结果摘要。
 */
export async function generateDiagnosticPack(
  options: GeneratePackOptions,
  notesText: string,
  progress?: DiagProgress
): Promise<DiagnosticPackResult> {
  try {
    progress?.('采集现场', 10)
    const bundle = await buildBundle(options, notesText)
    progress?.('打包', 80)
    const { blob } = await buildZipBundle(bundle.files)
    progress?.('保存', 90)
    const stamp = new Date().toISOString()
    const filename = `writeit-diagnostics-${stamp.replace(/[:T]/g, '-').slice(0, 19)}.zip`
    const result = await persistPack(blob, filename)
    lastResult = { ...result, size: blob.size }
    progress?.('完成', 100)
    return result
  } catch (e) {
    toast(`诊断包生成失败：${(e as Error).message ?? '未知错误'}`, 'error')
    lastResult = { ok: false, error: (e as Error).message }
    return lastResult
  }
}

/** 「复制要点」（ReportModal 次要按钮）
 *  includeDoc=true → 附带当前文档 Markdown 全文（要点体积大，用户按需勾选） */
export async function copyDiagnosticPoints(
  options: GeneratePackOptions,
  notesText: string,
  includeDoc = false
): Promise<boolean> {
  const env = await collectEnvironment()
  const appState = collectAppState({ includePaths: options.paths })
  const doc = buildDocDigest(includeDoc)
  return copyKeyPoints({
    environment: env,
    appState,
    logs: logEntries,
    timeline: timelineEntries,
    notesText,
    docDigest: doc?.digest,
    docFull: doc?.full,
  })
}

/** 当前文档摘要：结构计数 + 开头摘录；includeFull → 附全文（用户勾选） */
function buildDocDigest(
  includeFull: boolean
): { digest: string; full?: string } | null {
  const md = getActiveTabMarkdown()
  if (md == null || md.length === 0) return null
  const probe = collectEditorProbe()
  const active = probe.activeDoc
  const lines: string[] = []
  if (active) {
    lines.push(`  结构：引用 ${active.fileRefs} · 对象引用 ${active.objectRefs} · 嵌入块 ${active.fileBlocks} · 表格 ${active.tables} · 批注 ${active.annotations}`)
  } else {
    lines.push('  结构：编辑器探针不可用（可能未聚焦编辑区）')
  }
  const mermaidCount = (md.match(/```mermaid/gi) ?? []).length
  if (mermaidCount) lines.push(`  mermaid 图表 ${mermaidCount} 个`)
  if (probe.brokenRefs > 0) lines.push(`  ⚠️ 断链引用 ×${probe.brokenRefs}`)
  const excerpt = md.replace(/\s+/g, ' ').trim().slice(0, 300)
  lines.push(`  摘录：${excerpt}${md.length > 300 ? '…' : ''}`)
  lines.push(`  大小：${(md.length / 1024).toFixed(1)}KB`)
  return { digest: lines.join('\n'), full: includeFull ? md : undefined }
}

/** 09-notes.md：用户描述 + 预置上下文 */
function buildNotes(userText: string, appState: Record<string, unknown>, includePaths: boolean): string {
  const active = appState.activeTab as { path?: string } | null
  const errors = logEntries.filter((l) => l.level === 'error').slice(-3)
  const lastError = errors.length ? new Date(errors[errors.length - 1].t).toISOString() : '（无）'
  return [
    '# 诊断说明',
    '',
    `> 生成时间：${new Date().toISOString()}`,
    `> 当前文件：${active?.path ?? '（无）'}（记录模式：${includePaths ? '完整路径' : '文件名脱敏'}）`,
    `> 最近一次 error 日志：${lastError}`,
    '',
    '## 用户描述',
    '',
    userText?.trim() || '（用户未填写描述）',
    '',
    '## 提示',
    '',
    '将本 zip 发给开发者即可；开发者可用 scripts/parse-diagnostics.mjs 解析查看。',
    '',
  ].join('\n')
}

/** 界面 SVG 快照（foreignObject 内嵌 DOM；见设计文档 §6 实现说明） */
async function captureSnapshot(): Promise<string> {
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const root = document.documentElement.cloneNode(true) as HTMLElement
  if (!vw || !vh) throw new Error('视口为空')

  // 移除会阻塞 SVG 图片加载的外部资源元素；外链样式抓取内联（foreignObject 不加载 <link>）
  for (const el of root.querySelectorAll('script, iframe, object, embed, video, audio, canvas')) {
    el.remove()
  }
  for (const l of [...root.querySelectorAll('link[rel="stylesheet"]')]) {
    const href = l.getAttribute('href')
    if (!href) continue
    try {
      const res = await fetch(href)
      const style = document.createElement('style')
      style.textContent = await res.text()
      l.replaceWith(style)
    } catch {
      /* 单个样式加载失败忽略 */
    }
  }
  root.setAttribute('style', (root.getAttribute('style') ?? '') + `;width:${vw}px;height:${vh}px;overflow:hidden`)

  const html = root.innerHTML.replace(/]]>/g, ']]]]><![CDATA[>')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${vw}px;height:${vh}px;overflow:hidden"><![CDATA[${html}]]></div>` +
    `</foreignObject></svg>`
  )
}

/** 勾选默认值（来自设置记忆） */
export function defaultDiagOptions(): GeneratePackOptions {
  return {
    snapshot: settings.diagIncludeSnapshot,
    dom: settings.diagIncludeDom,
    doc: settings.diagIncludeDoc,
    paths: settings.diagIncludePaths,
  }
}

// ---- 调试钩子（e2e / 排障）----
;(window as unknown as Record<string, unknown>).__diagnostics = {
  open: () => openReportModal(),
  /** 生成诊断包（不落盘 UI，返回 manifest/文件清单/关键摘要片段）——e2e 断言用 */
  generate: async (opts?: Partial<GeneratePackOptions>, notes?: string) => {
    const o = { ...defaultDiagOptions(), ...(opts ?? {}) }
    const bundle = await buildBundle(o, notes ?? '')
    const files = Object.keys(bundle.files)
    const manifest = JSON.parse(String(bundle.files['manifest.json'])) as Record<string, unknown>
    return {
      ok: true,
      files,
      manifest,
      entryCount: files.length,
      summaryHead: bundle.summary.slice(0, 600),
      probesHead: o.dom ? String(bundle.files['08-probes.json'] ?? '').slice(0, 400) : '',
    }
  },
  /** 注入异常 → 观察自动提示 + 红点 */
  throwError: (msg = 'e2e 注入异常') => {
    ;(window as unknown as { __diag?: { throwForTest(msg: string): void } }).__diag?.throwForTest(msg)
  },
  defaultOptions: () => defaultDiagOptions(),
  /** 探针直读（e2e/diff 场景断言用） */
  probes: (name?: string) => {
    const p = { ui: collectDomSnapshot(), diff: collectDiffProbe(), editor: collectEditorProbe(), compat: detectCompat(), monitor: getMonitorSnapshot() }
    return name ? p[name as keyof typeof p] : p
  },
}