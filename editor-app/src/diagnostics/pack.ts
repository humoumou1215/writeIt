// ============================================================
// 诊断包打包与落盘（D2）
//  jszip 打包 → blob → 落盘（tauri: save_binary 保存对话框 / web+mock: 浏览器下载）
//  附带「复制要点」：环境摘要 + 最近异常 + 当前文件 → 剪贴板文本
// ============================================================
import JSZip from 'jszip'
import type { DiagLogEntry, DiagTimelineEntry } from './logger'
import { fs } from '../fs'
import { toast, openClipboardAuth } from '../state/store'
import { writeClipboardText } from '../clipboard'

export interface DiagnosticPackResult {
  ok: boolean
  filename?: string
  savedPath?: string
  size?: number
  error?: string
}

function safeStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 打包 targets（打包前由 collector 组装好的文件映射）→ blob */
export async function buildZipBundle(
  files: Record<string, string | Uint8Array>
): Promise<{ blob: Blob; size: number }> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content)
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  return { blob, size: blob.size }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

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

async function tauriWrite(path: string, blob: Blob): Promise<void> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('save_binary', { path, base64: bytesToBase64(buf) })
}

/** 落盘：tauri → 保存对话框；web/mock → 浏览器下载 */
export async function persistPack(blob: Blob, filename: string): Promise<DiagnosticPackResult> {
  try {
    if (fs.kind === 'tauri') {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const path = await save({
        title: '保存诊断包',
        defaultPath: filename,
        filters: [{ name: '诊断包 ZIP', extensions: ['zip'] }],
      })
      if (!path || typeof path !== 'string') {
        toast('已取消生成诊断包', 'info')
        return { ok: false, error: 'cancelled' }
      }
      await tauriWrite(path, blob)
      toast('诊断包已保存', 'success')
      return { ok: true, filename, savedPath: path, size: blob.size }
    }
    downloadBlob(blob, filename)
    toast(`诊断包已生成：${filename}`, 'success')
    return { ok: true, filename, size: blob.size }
  } catch (e) {
    toast(`诊断包生成失败：${(e as Error).message ?? '未知错误'}`, 'error')
    return { ok: false, error: (e as Error).message }
  }
}

/** 「复制要点」：环境摘要 + 最近异常（含现场面包屑） + 当前文档摘要 + 操作轨迹 → 剪贴板
 *  docDigest：当前文档结构摘要（默认含）；docFull：用户勾选后附的 Markdown 全文 */
export async function copyKeyPoints(opts: {
  environment: Record<string, unknown>
  appState: Record<string, unknown>
  logs: DiagLogEntry[]
  timeline: DiagTimelineEntry[]
  notesText: string
  docDigest?: string
  docFull?: string
}): Promise<boolean> {
  const errors = opts.logs.filter((l) => l.level === 'error' || l.level === 'warn').slice(-8)
  const recent = opts.timeline.slice(-8)
  const env = opts.environment
  // 操作轨迹 → 可读摘要（常见类型补数据细节，其余保持 type + target）
  const fmtOp = (e: DiagTimelineEntry): string => {
    const d = e.data as Record<string, unknown> | undefined
    let tail = ''
    if (e.type === 'editor:edit' && d) {
      tail = `（编辑 ${String(d.edits)} 次 / 改动 ${String(d.chars)} 字符 / 持续 ${String(d.secs)}s）`
    } else if (e.type === 'editor:ref-insert' && d) {
      tail = `（插入引用 → ${String(e.target ?? '')}，${d.via === 'entity' ? '实体' : d.via === 'menu' ? '联想菜单' : '粘贴/右键'}${d.mode ? `，模式 ${String(d.mode)}` : ''}${d.kind ? `，${String(d.kind)}` : ''}）`
    } else if (e.type === 'editor:ref-replace' && d) {
      tail = `（替换引用 → ${String(e.target ?? '')}，模式 ${String(d.mode)}）`
    }
    return `  [${new Date(e.t).toISOString()}] ${e.type}${e.target ? ` ${e.target}` : ''}${tail}${e.ms != null ? ` (${Math.round(e.ms)}ms)` : ''}${e.ok === false ? ' ✗' : ''}`
  }
  const lines = [
    '【WriteIt 问题反馈】',
    `版本 ${env.appVersion ?? '?'} · 宿主 ${String(env.host) ?? '?'} · 平台 ${String(env.platform ?? '?')}`,
    `当前文件：${(opts.appState.activeTab as { path?: string } | null)?.path ?? '（无）'}`,
    '',
    '最近异常记录：',
    ...(errors.length
      ? errors.map((e) => {
          const crumbs = ((e.data as { crumbs?: Array<{ type: string; target?: string }> } | undefined)?.crumbs ?? []).slice(-2)
          const crumbLine = crumbs.length ? ` ↳ ${crumbs.map((c) => `${c.type}${c.target ? ` ${c.target}` : ''}`).join(' → ')}` : ''
          return `  [${new Date(e.t).toISOString()}] ${e.area}: ${e.msg.slice(0, 200)}${crumbLine}`
        })
      : ['  （无 error/warn 日志）']),
    '',
    '最近操作：',
    ...(recent.length ? recent.map(fmtOp) : ['  （无轨迹）']),
    '',
    '（完整诊断包：应用内 🩺 按钮生成 zip 后发送）',
  ]
  const notes = opts.notesText?.trim()
  if (notes) lines.splice(2, 0, `用户描述：${notes}`)
  // 当前文档摘要（紧凑：结构计数 + 摘录；紧跟「当前文件」之后）
  if (opts.docDigest) lines.splice(3, 0, '', '当前文档：', opts.docDigest)
  // 用户勾选「附全文」→ 追加 Markdown 全文（末尾，zip 提示之前）
  if (opts.docFull) {
    lines.splice(lines.length - 2, 0, '', '—— 当前文档全文（Markdown 源）——', '', opts.docFull)
  }
  const text = lines.join('\n')
  // 标准剪贴板写入（用户手势内会触发浏览器/WebView 的授权询问）；失败 → 弹出授权申请弹窗
  if (await writeClipboardText(text)) {
    toast('诊断要点已复制到剪贴板', 'success')
    return true
  }
  const granted = await openClipboardAuth(text)
  if (granted) {
    toast('诊断要点已复制到剪贴板', 'success')
    return true
  }
  toast('未复制：可点击「生成诊断包」保存完整现场', 'info')
  return false
}