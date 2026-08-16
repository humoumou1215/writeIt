// 导出服务：编排「内容获取 → 模板 export.ts → 格式转换 → 落盘」
// 流程：
//   1. 当前活动标签 markdown + path/name/doctype/title
//   2. doctype → 模板 → 有 export.ts（esbuild-wasm 加载）→ 按定义（format/filename/content/build）
//   3. 无 export.ts → 默认：用户选择格式（auto 回落 pdf）导出 markdown
//   4. 转换：md → mdast → docx（docx 库）/ pdf（pdfmake + 内置思源黑体子集）/ md（原样）
//   5. 落盘：tauri → 保存对话框 + Rust save_binary；web/mock → 浏览器下载
import { state, toast } from '../state/store'
import { templateService } from '../template/service'
import { extractDoctype } from '../template/service'
import type { ExportContext, ExportModule, ExportOptions, ExportOutcome, ExportFormat } from './types'
import { mdToExportBlocks, mdToExportMarkdown, clearEmbedCache } from './mdast'
import { getActiveTabMarkdown } from '../editor/manager'
import { fs } from '../fs'

const FORMAT_EXT: Record<ExportFormat, string> = { pdf: 'pdf', docx: 'docx', md: 'md' }
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

/** Tauri 落盘：保存对话框 → Rust save_binary（base64） */
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
  const buf = new Uint8Array(await blob.arrayBuffer())
  const base64 = bytesToBase64(buf)
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('save_binary', { path, base64 })
  return path
}

/**
 * 导出当前活动标签。
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

  const doctype = extractDoctype(content)
  const name = safeFilename(tab.name.replace(/\.(md|markdown|txt)$/i, ''))
  const ctx: ExportContext = {
    path: tab.path,
    name,
    doctype,
    content,
    title: extractTitle(content, name),
  }

  // ---- 模板 export.ts（有则按定义） ----
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
    format = (eff.format ?? exportMod.format ?? 'pdf') as ExportFormat
    filename = safeFilename((eff.filename ?? exportMod.filename ?? name).replace(/\.(pdf|docx|md)$/i, ''))
    exportContent = eff.content ?? exportMod.content ?? ctx.content
    // raw：build 返回或模块顶层声明（仅 md 格式生效，见 types.ts）
    rawExport = Boolean(eff.raw ?? exportMod.raw)
  } else {
    // 默认：用户选择（auto 回落 pdf）
    format = options.format === 'auto' ? 'pdf' : options.format
    filename = name
    exportContent = ctx.content
  }

  // ---- 生成文件 ----
  try {
    if (format === 'md') {
      // markdown：展开嵌入块后序列化（![[path]] 内容合并进导出文件）；raw = 原文
      const expanded = rawExport ? exportContent : await mdToExportMarkdown(exportContent)
      const blob = new Blob([expanded], { type: 'text/markdown;charset=utf-8' })
      return await persist(blob, `${filename}.md`, format, usedExportTs)
    }
    const blocks = await mdToExportBlocks(exportContent)
    if (format === 'pdf') {
      const { mdBlocksToPdf } = await import('./pdf')
      const blob = await mdBlocksToPdf(blocks, ctx.title)
      return await persist(blob, `${filename}.pdf`, 'pdf', usedExportTs)
    }
    const { mdBlocksToDocx } = await import('./docx')
    const blob = await mdBlocksToDocx(blocks, ctx.title)
    return await persist(blob, `${filename}.docx`, 'docx', usedExportTs)
  } catch (e) {
    console.error('[export] 生成失败:', e)
    toast(`导出失败：${(e as Error).message ?? '未知错误'}`, 'error')
    return { ok: false, error: (e as Error).message }
  }
}

async function persist(
  blob: Blob,
  filename: string,
  format: ExportFormat,
  usedExportTs: boolean
): Promise<ExportOutcome> {
  try {
    let savedPath: string | undefined
    if (fs.kind === 'tauri') {
      savedPath = (await saveViaTauri(blob, filename)) ?? undefined
      if (!savedPath) {
        toast('已取消导出', 'info')
        return { ok: false, error: 'cancelled' }
      }
    } else {
      downloadBlob(blob, filename)
    }
    const size = blob.size
    toast(`已导出 ${FORMAT_LABEL[format]}：${filename}`, 'success')
    return { ok: true, format, filename, savedPath, size, usedExportTs }
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

;(window as unknown as { __exportDebug?: unknown }).__exportDebug = (path?: string, format?: ExportFormat | 'auto') =>
  exportDebug(path, format)
