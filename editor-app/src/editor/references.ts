// 引用/被引用 底部展示区（非编辑区，随文档滚动在正文之后）
// 需求：当 A 文件「块嵌入」或「链接引用」B 文件时，
//   A 的底部展示「引用了 B」（向外引用 Outgoing），
//   B 的底部展示「被 A 引用」（反向引用 / Backlinks / Incoming）。
// 实现：
//   - 向外引用：直接读当前 ProseMirror 文档的 ref 节点（file_ref / object_ref / file_block），
//     不进入 file_block 内部（内部引用归属被嵌入文件）。
//   - 反向引用：扫描工作区所有文本文件，解析其中的 [[…]] / ![[…]]，
//     命中当前文件真实路径即记为反向引用来源。
// 该模块不 import app 装配层（manager），通过回调注入「打开文件」动作，避免循环依赖。
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import type { FsEntry } from '../fs/types'
import { fs } from '../fs'

import './references.css'

// ---------- 引用种类 ----------
export type RefKind = 'link' | 'embed' | 'object'

export const KIND_LABEL: Record<RefKind, string> = {
  link: '链接',
  embed: '嵌入',
  object: '对象',
}

/** 本文档中的单条向外引用 */
export interface RefListItem {
  /** 引用目标（文档内写法，通常不含扩展名） */
  path: string
  kind: RefKind
}

/** 一条反向引用（其它文件 -> 本文档） */
export interface IncomingRef {
  /** 引用方真实路径 */
  source: string
  kind: RefKind
}

const KIND_OF: Record<string, RefKind> = {
  file_ref: 'link',
  object_ref: 'object',
  file_block: 'embed',
}

/** 从 PM 文档收集本文档向外引用（不进入 file_block 内部） */
export function collectOutgoingRefs(editor: Editor): RefListItem[] {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const out: RefListItem[] = []
    const seen = new Set<string>()
    view.state.doc.descendants((node) => {
      const kind = KIND_OF[node.type.name]
      if (kind) {
        const p = node.attrs.path as string
        if (p && !seen.has(p)) {
          seen.add(p)
          out.push({ path: p, kind })
        }
        // 嵌入块：不深入其物质化内容（内部引用归属被嵌入文件）
        if (node.type.name === 'file_block') return false
      }
      return true
    })
    return out
  })
}

// ---------- 工作区扫描（反向引用）----------

function isEditablePath(p: string): boolean {
  return /\.(md|markdown|txt)$/i.test(p)
}

/** 跳过模板/校验/隐藏目录等「非正文」文件（避免反向引用噪音） */
function isScanablePath(p: string): boolean {
  const segs = p.split('/')
  if (segs.some((s) => s === '.template' || s === '.validate' || s === '.git')) return false
  if (p.startsWith('.')) return false
  return isEditablePath(p)
}

/** 取引用目标的基础路径（去掉 #fragment 与模板占位包裹） */
function refBase(raw: string): string {
  let s = raw
  const h = s.indexOf('#')
  if (h >= 0) s = s.slice(0, h)
  return s.trim()
}

/** 归一化真实文件路径（去扩展名），用于命中判断 */
function normPath(p: string): string {
  return p.replace(/\.(md|markdown|txt)$/i, '')
}

/** 把文件树摊平成可编辑文件真实路径列表 */
function flattenFiles(list: FsEntry[]): string[] {
  const out: string[] = []
  const walk = (es: FsEntry[]) => {
    for (const e of es) {
      if (e.kind === 'file') out.push(e.path)
      else if (e.kind === 'dir' && e.children) walk(e.children)
    }
  }
  walk(list)
  return out
}

/** 解析引用目标 -> 候选真实路径（Obsidian 风格补扩展名 / 基线名搜索） */
function resolveTargetReal(fileList: string[], raw: string): string[] {
  const base = refBase(raw)
  if (!base || base === '...') return []
  const cands = [base, `${base}.md`, `${base}.markdown`, `${base}.txt`]
  const real = new Set(fileList)
  const hits: string[] = []
  for (const c of cands) if (real.has(c) && !hits.includes(c)) hits.push(c)
  if (hits.length) return hits
  // 无目录前缀的 Obsidian 风格：按文件名匹配（取全部命中）
  const baseName = base.split('/').pop() ?? base
  for (const p of fileList) {
    if ((p.split('/').pop() ?? p) === baseName && !hits.includes(p)) hits.push(p)
  }
  return hits
}

/** 扫描一行/一文本中出现的引用（[[…]] 与 ![[…]]），返回 {raw, kind} */
function scanRefsInText(text: string): Array<{ raw: string; kind: RefKind }> {
  const out: Array<{ raw: string; kind: RefKind }> = []
  const embedRe = /!\[\[([^\[\]]+)\]\]/g
  let m: RegExpExecArray | null
  while ((m = embedRe.exec(text))) out.push({ raw: m[1], kind: 'embed' })
  const linkRe = /(?<!!)\[\[([^\[\]]+)\]\]/g
  while ((m = linkRe.exec(text))) out.push({ raw: m[1], kind: 'link' })
  return out
}

export interface RefScanOptions {
  /** 已打开标签的实时内容覆盖（path -> markdown），保证未保存的引用也被计入 */
  live?: Map<string, string>
}

/**
 * 扫描工作区，收集「指向 currentPath」的反向引用来源。
 * 每个引用方去重；同一方多个引用只保留一条、kind 合并。
 */
export async function collectIncomingRefs(
  currentPath: string,
  opts: RefScanOptions = {}
): Promise<IncomingRef[]> {
  try {
    const tree = await fs.readTree(true)
    const files = flattenFiles(tree).filter(isScanablePath)
    const curNorm = normPath(currentPath)
    const result = new Map<string, Set<RefKind>>()
    const live = opts.live ?? new Map()

    for (const file of files) {
      if (normPath(file) === curNorm) continue // 跳过自身
      let content: string
      const lv = live.get(file)
      if (lv !== undefined) content = lv
      else {
        try {
          content = await fs.readFile(file)
        } catch {
          continue
        }
      }
      const targets = new Set<RefKind>()
      for (const hit of scanRefsInText(content)) {
        for (const real of resolveTargetReal(files, hit.raw)) {
          if (normPath(real) === curNorm) targets.add(hit.kind)
        }
      }
      // 命中当前文件：记录引用方与该文件内出现过的引用种类
      if (targets.size) {
        const kinds = result.get(file) ?? new Set<RefKind>()
        for (const k of targets) kinds.add(k)
        result.set(file, kinds)
      }
    }

    return [...result.entries()].map(([source, kinds]) => ({
      source,
      kind: kinds.has('embed') ? 'embed' : kinds.has('object') ? 'object' : 'link',
    }))
  } catch {
    return []
  }
}

// ---------- 底部展示区 DOM ----------

export interface RefFooterHandle {
  el: HTMLElement
  setVisible(v: boolean): void
  /**
   * 渲染底部展示区：currentPath 为当前文档真实路径。
   * editor 用于读取向外引用（实时）；本函数随后扫描反向引用。
   */
  render(currentPath: string, editor: Editor, opts?: RefScanOptions): Promise<void>
  dispose(): void
}

/** 在 pane 容器内创建非编辑的「引用关系」底部展示区（置于 .milkdown 之后） */
export function createRefFooter(
  container: HTMLElement,
  onOpen: (path: string) => void
): RefFooterHandle {
  const el = document.createElement('div')
  el.className = 'refs-footer'
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('aria-label', '引用关系')
  container.appendChild(el)

  // 展示/渲染状态
  const statusEl = document.createElement('div')
  statusEl.className = 'refs-footer-status'

  const outgoingEl = document.createElement('div')
  const incomingEl = document.createElement('div')

  // 卡片式分区构造
  function buildSection(host: HTMLElement, cls: string, head: string): HTMLElement {
    host.innerHTML = ''
    host.className = `refs-footer-section ${cls}`
    const h = document.createElement('div')
    h.className = 'refs-footer-head'
    h.textContent = head
    const chips = document.createElement('div')
    chips.className = 'refs-footer-chips'
    host.append(h, chips)
    return chips
  }

  function renderChips(chips: HTMLElement, items: Array<{ path: string; kind: RefKind }>) {
    chips.innerHTML = ''
    if (!items.length) {
      const empty = document.createElement('span')
      empty.className = 'refs-footer-empty'
      empty.textContent = '暂无'
      chips.appendChild(empty)
      return
    }
    for (const it of items) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = `refs-chip refs-chip-${it.kind}`
      const name = document.createElement('span')
      name.className = 'refs-chip-name'
      name.textContent = it.path
      const kind = document.createElement('span')
      kind.className = 'refs-chip-kind'
      kind.textContent = KIND_LABEL[it.kind]
      chip.append(name, kind)
      chip.title = `${KIND_LABEL[it.kind]}：${it.path}`
      chip.addEventListener('click', () => onOpen(it.path))
      chips.appendChild(chip)
    }
  }

  const outgoingChips = buildSection(outgoingEl, 'outgoing', '引用了')
  const incomingChips = buildSection(incomingEl, 'incoming', '被引用')
  el.append(statusEl, outgoingEl, incomingEl)

  let disposed = false

  async function render(
    currentPath: string,
    editor: Editor,
    opts: RefScanOptions = {}
  ): Promise<void> {
    if (disposed) return
    statusEl.classList.add('refs-footer-loading')
    statusEl.textContent = '…'
    try {
      // 向外引用：实时读文档
      const outgoing = collectOutgoingRefs(editor)
      renderChips(outgoingChips, outgoing)
      if (outgoingChips.querySelector('.refs-footer-empty')) {
        outgoingEl.querySelector('.refs-footer-head')!.textContent = '引用了'
      } else {
        outgoingEl.querySelector('.refs-footer-head')!.textContent = `引用了 ${outgoing.length}`
      }
      // 反向引用：工作区扫描
      const incoming = await collectIncomingRefs(currentPath, opts)
      renderChips(
        incomingChips,
        incoming.map((r) => ({ path: r.source, kind: r.kind }))
      )
      if (incomingChips.querySelector('.refs-footer-empty')) {
        incomingEl.querySelector('.refs-footer-head')!.textContent = '被引用'
      } else {
        incomingEl.querySelector('.refs-footer-head')!.textContent = `被引用 ${incoming.length}`
      }
      statusEl.textContent = ''
    } catch {
      statusEl.textContent = '引用关系加载失败'
    } finally {
      statusEl.classList.remove('refs-footer-loading')
    }
  }

  return {
    el,
    setVisible: (v: boolean) => {
      el.style.display = v ? '' : 'none'
    },
    render,
    dispose: () => {
      disposed = true
      el.remove()
    },
  }
}
