// 导出服务：编排「内容获取 → 模板 export.ts → 格式转换 → 落盘」（单文件 / 批量）
// 流程：
//   1. 内容：活动标签（编辑器 markdown）或按路径（打开标签优先，否则磁盘）
//   2. doctype → 模板 → 有 export.ts（esbuild-wasm 加载）→ 按定义（format/filename/content/build）
//      公共规则（嵌入/引用/mermaid/公式/图片）自动适用；raw = 跳过（仅 md）
//   3. 无 export.ts → 默认：用户选择格式（auto 回落 pdf）
//   4. 转换：md → mdast → docx（docx 库）/ pdf（pdfmake + 内置思源黑体子集）/ md
//   5. 落盘：单文件 tauri → 保存对话框；批量 tauri → 选目录全部写入；浏览器 → 逐个下载
import { state, toast } from '../state/store'
import { templateService } from '../template/service'
import { extractDoctype } from '../template/service'
import type { ExportContext, ExportModule, ExportOptions, ExportOutcome, ExportFormat, ExportChoice } from './types'
import { mdToExportBlocks, mdToExportMarkdown, clearEmbedCache } from './mdast'
import { getActiveTabMarkdown, getTabMarkdownByPath } from '../editor/manager'
import { fs } from '../fs'

const FORMAT_LABEL: Record<ExportFormat, string> = { pdf: 'PDF', docx: 'DOCX', md: 'Markdown' }

/** 文件名清理：去除文件系统非法字符 + 空安全 */
function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^\.+/, '')
  return cleaned || 'export'
}

/** 取文档标题：首行 # 标题（不含 doctype 行）；无则文件名 */
function extractTitle(content: string, fallback: string): string {
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith('doctype:')) continue
    const m = /^#\s+(.+?)\s*$/.exec(t)
    return m ? m[1].trim() : fallback
  }
  return fallback
}

/** Uint8Array → base64（浏览器） */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/** 触发浏览器下载（web / mock 后端） */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** Tauri 写文件（绝对路径；save_binary 命令） */
async function tauriWriteBinary(path: string, blob: Blob): Promise<void> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  const base64 = bytesToBase64(buf)
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('save_binary', { path, base64 })
}

/** Tauri 单文件落盘：保存对话框 */
async function saveViaTauri(blob: Blob, suggested: string): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const ext = suggested.split('.').pop() ?? ''
  const filterName = { pdf: 'PDF 文档', docx: 'Word 文档', md: 'Markdown' }[ext] ?? ext
  const path = await save({
    title: '导出文件',
    defaultPath: suggested,
    filters: [{ name: filterName, extensions: [ext] }],
  })
  if (!path || typeof path !== 'string') return null
  await tauriWriteBinary(path, blob)
  return path
}

/** 内容 + 文件名 → 导出文件（模板 export.ts 处理 + 公共规则 + 格式转换；不含落盘） */
async function buildExportItem(
  content: string,
  path: string,
  name: string,
  options: ExportOptions,
  useCustomFilename = true
): Promise<{ blob: Blob; filename: string; format: ExportFormat; usedExportTs: boolean }> {
  const doctype = extractDoctype(content)
  const ctx: ExportContext = {
    path,
    name,
    doctype,
    content,
    title: extractTitle(content, name),
  }
  const tpl = doctype ? templateService.get(doctype) : undefined
  const exportMod: ExportModule | null = tpl ? await templateService.ensureExport(tpl) : null

  let format: ExportFormat
  let filename: string
  let exportContent: string
  let usedExportTs = false
  let rawExport = false

  if (exportMod) {
    usedExportTs = true
    const built = typeof exportMod.build === 'function' ? exportMod.build(ctx) : null
    const eff = built ?? {}
    // 用户显式选择格式优先；auto 时用模板定义
    format = options.format !== 'auto' ? options.format : ((eff.format ?? exportMod.format ?? 'pdf') as ExportFormat)
    // 单文件可用模板自定义文件名；批量沿用原文件名（防重名）
    filename = useCustomFilename
      ? safeFilename((eff.filename ?? exportMod.filename ?? name).replace(/\.(pdf|docx|md)$/i, ''))
      : name
    exportContent = eff.content ?? exportMod.content ?? ctx.content
    rawExport = Boolean(eff.raw ?? exportMod.raw)
  } else {
    format = options.format === 'auto' ? 'pdf' : options.format
    filename = name
    exportContent = ctx.content
  }

  if (format === 'md') {
    const expanded = rawExport ? exportContent : await mdToExportMarkdown(exportContent)
    const blob = new Blob([expanded], { type: 'text/markdown;charset=utf-8' })
    return { blob, filename: `${filename}.md`, format, usedExportTs }
  }
  const blocks = await mdToExportBlocks(exportContent)
  if (format === 'pdf') {
    const { mdBlocksToPdf } = await import('./pdf')
    const blob = await mdBlocksToPdf(blocks, ctx.title)
    return { blob, filename: `${filename}.pdf`, format, usedExportTs }
  }
  const { mdBlocksToDocx } = await import('./docx')
  const blob = await mdBlocksToDocx(blocks, ctx.title)
  return { blob, filename: `${filename}.docx`, format, usedExportTs }
}

/**
 * 导出当前活动标签（单文件）。
 * @returns 结果摘要（失败时 ok=false + error）
 */
export async function exportActiveTab(options: ExportOptions): Promise<ExportOutcome> {
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  if (!tab) {
    toast('请先打开一个文件', 'error')
    return { ok: false, error: 'no-active-tab' }
  }
  const content = getActiveTabMarkdown()
  if (content === null) {
    toast('编辑器尚未就绪', 'error')
    return { ok: false, error: 'editor-not-ready' }
  }
  const name = safeFilename(tab.name.replace(/\.(md|markdown|txt)$/i, ''))
  try {
    const item = await buildExportItem(content, tab.path, name, options)
    return await persist(item, true)
  } catch (e) {
    console.error('[export] 生成失败:', e)
    toast(`导出失败：${(e as Error).message ?? '未知错误'}`, 'error')
    return { ok: false, error: (e as Error).message }
  }
}

/** 批量导出结果摘要 */
export interface BatchExportOutcome {
  ok: number
  fail: number
  errors: string[]
  /** 单个失败是否取消（tauri 批量选目录取消） */
  cancelled?: boolean
}

/**
 * 批量导出多个文件（ExportModal 多选，每文件独立格式选择）。
 * 内容：已打开标签用编辑器最新内容，否则读磁盘。
 * 文件名：用原文件名（export.ts 的自定义 filename 仅单文件导出生效，避免批量重名覆盖）。
 * 格式：'export' = 按模板 export.ts 定义（无模板回落 pdf）；否则用户指定格式优先。
 * 落盘：tauri → 选目录全部写入；浏览器 → 逐个下载。
 */
export async function exportFiles(
  items: Array<{ path: string; format: ExportChoice }>
): Promise<BatchExportOutcome> {
  const result: BatchExportOutcome = { ok: 0, fail: 0, errors: [] }
  const built: Array<{ blob: Blob; filename: string; format: ExportFormat }> = []

  for (const it of items) {
    try {
      const content = getTabMarkdownByPath(it.path) ?? (await fs.readFile(it.path))
      const name = safeFilename(it.path.split('/').pop()?.replace(/\.(md|markdown|txt)$/i, '') ?? 'export')
      // 每文件格式：'export' → 模板定义（auto 回落）；否则用户指定
      const opts: ExportOptions = { format: it.format === 'export' ? 'auto' : it.format }
      // 批量：忽略 export.ts 自定义 filename（防重名），格式仍按模板/用户定义
      const item = await buildExportItem(content, it.path, name, opts, false)
      built.push(item)
    } catch (e) {
      result.fail++
      result.errors.push(`${it.path}: ${(e as Error).message ?? '未知错误'}`)
    }
  }

  if (!built.length) {
    toast('没有可导出的文件', 'error')
    return result
  }

  try {
    if (fs.kind === 'tauri') {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const dir = await open({ directory: true, title: '选择导出目录' })
      if (!dir || typeof dir !== 'string') {
        toast('已取消导出', 'info')
        result.cancelled = true
        return result
      }
      for (const it of built) {
        try {
          await tauriWriteBinary(`${dir}/${it.filename}`, it.blob)
          result.ok++
        } catch (e) {
          result.fail++
          result.errors.push(`${it.filename}: ${(e as Error).message}`)
        }
      }
    } else {
      for (const it of built) downloadBlob(it.blob, it.filename)
      result.ok = built.length
    }
  } catch (e) {
    result.fail = built.length
    result.errors.push((e as Error).message)
  }

  toast(`导出完成：${result.ok} 个成功${result.fail ? `，${result.fail} 个失败` : ''}`, result.fail ? 'error' : 'success')
  return result
}

async function persist(
  item: { blob: Blob; filename: string; format: ExportFormat; usedExportTs: boolean },
  single: boolean
): Promise<ExportOutcome> {
  try {
    let savedPath: string | undefined
    if (fs.kind === 'tauri') {
      savedPath = (await saveViaTauri(item.blob, item.filename)) ?? undefined
      if (!savedPath) {
        toast('已取消导出', 'info')
        return { ok: false, error: 'cancelled' }
      }
    } else {
      downloadBlob(item.blob, item.filename)
    }
    toast(`已导出 ${FORMAT_LABEL[item.format]}：${item.filename}`, 'success')
    return { ok: true, format: item.format, filename: item.filename, savedPath, size: item.blob.size, usedExportTs: item.usedExportTs }
  } catch (e) {
    toast(`导出失败：${(e as Error).message ?? '未知错误'}`, 'error')
    return { ok: false, error: (e as Error).message }
  }
}

/** 调试钩子：绕过 UI 直接导出（e2e 用），返回结果 JSON */
export async function exportDebug(path?: string, format: ExportFormat | 'auto' = 'auto') {
  if (path) {
    // 按路径打开再导出（当前无活动标签时）
    const { openTab } = await import('../editor/manager')
    await openTab(path)
    // 等待编辑器挂载（openTab 异步创建 Crepe 实例）
    const start = Date.now()
    while (Date.now() - start < 5000) {
      if (getActiveTabMarkdown() !== null) break
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  const res = await exportActiveTab({ format })
  clearEmbedCache()
  return res
}

/** 调试钩子：批量导出（e2e 用；统一格式或每文件独立） */
export async function exportDebugMany(
  paths: string[],
  format: ExportFormat | 'export' = 'pdf'
) {
  const res = await exportFiles(paths.map((p) => ({ path: p, format })))
  clearEmbedCache()
  return res
}

;(window as unknown as { __exportDebug?: unknown }).__exportDebug = (path?: string, format?: ExportFormat | 'auto') =>
  exportDebug(path, format)
;(window as unknown as { __exportDebugMany?: unknown }).__exportDebugMany = (paths: string[], format?: ExportFormat | 'auto') =>
  exportDebugMany(paths, format)
