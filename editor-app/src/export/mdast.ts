// markdown → 中间文档结构（导出渲染器 docx/pdf 共用的数据模型）
// 管线：markdown → mdast（unified + remark-parse + remark-gfm + 复用引用/批注 remark 插件）
//      → 嵌入块递归合并（![[path]] 读源文件内容，深度 ≤3 + 循环防护）
//      → 引用展示内容解析（[[path#obj]] → suggest resolve 值 / 标题 / 路径）
//      → mermaid 代码块渲染为 PNG（htmlLabels:false 保证可 canvas 绘制）
//      → ExportBlock 树 / 展开后 markdown
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import { remarkRef } from '../editor/ref/remark-ref'
import { remarkAnnotation } from '../annotations/remark-annotation'
import { fs } from '../fs'
import { extractDoctype, templateService } from '../template/service'
import type { SuggestContext } from '../template/types'

// ---------- 中间结构 ----------

export interface InlineText {
  kind: 'text'
  value: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  strike?: boolean
  highlight?: boolean
}

export interface InlineLink {
  kind: 'link'
  href: string
  text: InlineNode[]
}

export type InlineNode = InlineText | InlineLink

export interface ExportHeading {
  kind: 'heading'
  level: 1 | 2 | 3 | 4 | 5 | 6
  text: InlineNode[]
}

export interface ExportParagraph {
  kind: 'paragraph'
  text: InlineNode[]
}

export interface ExportList {
  kind: 'list'
  ordered: boolean
  items: Array<{ text: InlineNode[]; children: ExportBlock[] }>
}

export interface ExportTask {
  kind: 'task'
  checked: boolean
  text: InlineNode[]
}

export interface ExportTable {
  kind: 'table'
  header: InlineNode[][]
  rows: InlineNode[][]
}

export interface ExportCode {
  kind: 'code'
  language: string
  content: string
}

export interface ExportQuote {
  kind: 'quote'
  blocks: ExportBlock[]
}

export interface ExportHr {
  kind: 'hr'
}

/** mermaid 渲染后的位图（PNG data URI） */
export interface ExportImage {
  kind: 'image'
  alt: string
  dataUri: string
  width: number
  height: number
}

export type ExportBlock =
  | ExportHeading
  | ExportParagraph
  | ExportList
  | ExportTask
  | ExportTable
  | ExportCode
  | ExportQuote
  | ExportHr
  | ExportImage

// ---------- mdast 类型（宽松，兼容 remark 11 + 自定义节点） ----------

interface MdastNode {
  type: string
  value?: string
  children?: MdastNode[]
  url?: string
  alt?: string
  lang?: string
  ordered?: boolean
  start?: number
  spread?: boolean
  checked?: boolean | null
  path?: string
  readonly?: boolean
  fragment?: string | null
  note?: string
  depth?: number
  width?: number
  height?: number
  position?: unknown
  [key: string]: unknown
}

// ---------- 嵌入块递归合并 ----------

const MAX_EMBED_DEPTH = 3
/** 解析结果缓存（path → mdast；嵌入块与引用解析共用） */
const EMBED_CACHE = new Map<string, MdastNode[] | null>()
/** 原文缓存（path → markdown） */
const refTextCache = new Map<string, string | null>()

/** Obsidian 风格路径补全（与引用机制一致，带文本缓存） */
async function readRefContent(path: string): Promise<string | null> {
  const cached = refTextCache.get(path)
  if (cached !== undefined) return cached
  const candidates = [path, `${path}.md`, `${path}.markdown`, `${path}.txt`]
  for (const c of candidates) {
    try {
      const content = await fs.readFile(c)
      refTextCache.set(c, content)
      return content
    } catch {
      /* try next */
    }
  }
  refTextCache.set(path, null)
  return null
}

/** 展开 fileBlock 节点：读源文件 → 解析 → 替换为内容块（失败保留为引用段）。
 *  chain 语义：进入时**不含**当前 path；展开子内容时把自身加入（子内容再遇到 = 循环）。 */
async function expandFileBlock(
  node: MdastNode,
  depth: number,
  chain: Set<string>
): Promise<MdastNode[]> {
  const path = String(node.path ?? '')
  if (depth >= MAX_EMBED_DEPTH) {
    return [{ type: 'paragraph', children: [{ type: 'text', value: `![[${path}]]（嵌入深度超过 ${MAX_EMBED_DEPTH} 层，已截断）` }] }]
  }
  if (chain.has(path)) {
    return [{ type: 'paragraph', children: [{ type: 'text', value: `![[${path}]]（循环嵌入，已截断）` }] }]
  }
  const nextChain = new Set(chain)
  nextChain.add(path)
  // 缓存命中：复用解析结果（仍按 nextChain 展开，避免链状态污染）
  const cached = EMBED_CACHE.get(path)
  if (cached !== undefined) {
    return (await withChain(cached, depth, nextChain)) ?? []
  }
  let source: string | null = null
  try {
    source = await readRefContent(path)
    if (source === null) {
      EMBED_CACHE.set(path, null)
      return [{ type: 'paragraph', children: [{ type: 'text', value: `![[${path}]]（源文件不存在）` }] }]
    }
  } catch (e) {
    return [{ type: 'paragraph', children: [{ type: 'text', value: `![[${path}]]（读取失败：${(e as Error).message}）` }] }]
  }
  const parsed = parseToMdast(source)
  EMBED_CACHE.set(path, parsed)
  return withChain(parsed, depth, nextChain)
}

async function withChain(nodes: MdastNode[], depth: number, chain: Set<string>): Promise<MdastNode[]> {
  const out: MdastNode[] = []
  for (const n of nodes) {
    if (n.type === 'fileBlock') {
      out.push(...(await expandFileBlock(n, depth + 1, chain)))
    } else if (n.children) {
      const cloned = { ...n, children: await withChain(n.children, depth, chain) }
      out.push(cloned)
    } else {
      out.push(n)
    }
  }
  return out
}

/** 解析 markdown 到 mdast（引用 + 批注自定义节点） */
function parseToMdast(md: string): MdastNode[] {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    // 自定义插件：类型不匹配（mdast 泛型），运行时兼容，转译期断言
    .use(remarkRef as never)
    .use(remarkAnnotation as never)
  const tree = processor.parse(md)
  processor.runSync(tree as never)
  return (tree as unknown as MdastNode).children ?? []
}

// ---------- 引用展示内容解析（[[path#obj]] → suggest resolve 值 / 标题 / 路径） ----------

const refDisplayCache = new Map<string, string>()

/** mdast 版 SuggestContext（suggest.ts 的 resolve(ctx) 在导出环境无编辑器，用 mdast 实现同款查询） */
function createMdastSuggestContext(nodes: MdastNode[]): SuggestContext {
  const paragraphs: string[] = []
  const headings: Array<{ level: number; text: string; next: string | null }> = []
  const tasks: Array<{ text: string; done: boolean }> = []
  const tables: Array<{ rows: string[][]; heading: string | null }> = []
  let pending: { level: number; heading: string } | null = null

  const walk = (ns: MdastNode[]) => {
    for (const n of ns) {
      if (n.type === 'paragraph') {
        const t = inlineText(n.children)
        if (t) {
          paragraphs.push(t)
          if (pending) {
            const h = headings.find((x) => x.level === pending!.level && x.text === pending!.heading)
            if (h && h.next === null) h.next = t
            pending = null
          }
        }
      } else if (n.type === 'heading') {
        const level = Number(n.depth ?? 1)
        const text = inlineText(n.children)
        headings.push({ level, text, next: null })
        pending = text ? { level, heading: text } : null
      } else if (n.type === 'list' && Array.isArray(n.children)) {
        for (const li of n.children) {
          if (li.checked !== undefined && li.checked !== null) {
            tasks.push({ text: listItemText(li), done: Boolean(li.checked) })
          }
        }
      } else if (n.type === 'table' && Array.isArray(n.children)) {
        const rows = n.children
          .filter((r) => r.type === 'tableRow')
          .map((r) => (r.children ?? []).map((c) => inlineText(c.children)))
        tables.push({ rows, heading: pending?.heading ?? null })
      } else if (n.children) {
        walk(n.children)
      }
    }
  }
  walk(nodes)

  return {
    findText: (re) => paragraphs.find((p) => re.test(p)) ?? null,
    headingText: (level, re) => headings.find((h) => h.level === level && re.test(h.text))?.text ?? null,
    paragraphAfterHeading: (level, re) => headings.find((h) => h.level === level && re.test(h.text))?.next ?? null,
    taskCount: (re) => {
      const ts = re ? tasks.filter((t) => re.test(t.text)) : tasks
      return ts.length ? String(ts.length) : null
    },
    taskProgress: (re) => {
      const ts = re ? tasks.filter((t) => re.test(t.text)) : tasks
      if (!ts.length) return null
      return `${ts.filter((t) => t.done).length}/${ts.length}`
    },
    firstTask: (re) => (re ? tasks.find((t) => re.test(t.text)) : tasks[0])?.text ?? null,
    firstTableCell: (rowIdx, colIdx, re) => {
      for (const t of tables) {
        const c = t.rows[rowIdx]?.[colIdx]
        if (c && (!re || re.test(c))) return c
      }
      return null
    },
    tableAfterHeading: (heading) => {
      const isRe = heading instanceof RegExp
      const t = tables.find((x) => (isRe ? heading.test(x.heading ?? '') : x.heading === heading))
      return t?.rows ?? null
    },
    allText: () => paragraphs.join('\n'),
  }
}

function inlineText(nodes: MdastNode[] | undefined): string {
  let s = ''
  for (const n of nodes ?? []) {
    if (n.type === 'text' || n.type === 'inlineCode') s += n.value ?? ''
    else if (n.type === 'fileRef') s += n.fragment ? `${n.path}#${n.fragment}` : (n.path ?? '')
    else if (n.children) s += inlineText(n.children)
  }
  return s.trim()
}

function listItemText(li: MdastNode): string {
  const para = (li.children ?? []).find((c) => c.type === 'paragraph')
  return inlineText(para?.children)
}

/** 计算 [[path]] / [[path#frag]] 的展示内容：suggest 对象命中 → resolve 值；否则标题/路径 */
async function computeRefDisplay(path: string, fragment: string | null): Promise<string> {
  try {
    const source = await readRefContent(path)
    if (source === null) return fragment ? `${path}#${fragment}` : path
    const doctype = extractDoctype(source)
    const tpl = doctype ? templateService.get(doctype) : null
    if (tpl && fragment) {
      const staticObjs = (await templateService.ensureSuggest(tpl)) ?? []
      const parsed = parseToMdast(source)
      const ctx = createMdastSuggestContext(parsed)
      const dynObjs = tpl.suggestFactory ? (tpl.suggestFactory(ctx) ?? []) : []
      const objs = [...staticObjs, ...dynObjs]
      const obj = objs.find((o) => o.id === fragment)
      if (obj) {
        try {
          const val = obj.resolve(ctx)
          if (val) return val
        } catch (e) {
          console.error('[export] suggest resolve 失败:', path, e)
        }
        return obj.label ?? fragment
      }
    }
    // 无 suggest 命中：fragment 是标题（或锚点段）→ 展示 fragment；无 fragment → 路径
    return fragment ?? path
  } catch {
    return fragment ? `${path}#${fragment}` : path
  }
}

/** fileRef → link（展示内容已解析） */
async function fileRefToLink(node: MdastNode): Promise<MdastNode> {
  const path = String(node.path ?? '')
  const fragment = node.fragment ?? null
  const key = fragment ? `${path}#${fragment}` : path
  let display = refDisplayCache.get(key)
  if (display === undefined) {
    display = await computeRefDisplay(path, fragment)
    refDisplayCache.set(key, display)
  }
  return { type: 'link', url: path, children: [{ type: 'text', value: display }] }
}

// ---------- mermaid 渲染为 PNG ----------

let mermaidSeq = 0
const mermaidImageCache = new Map<string, { dataUri: string; width: number; height: number } | null>()

type MermaidMod = {
  default?: {
    render: (id: string, code: string) => Promise<{ svg: string }>
    initialize: (c: Record<string, unknown>) => void
  }
}

const MERMAID_RESTORE: Record<string, unknown> = { startOnLoad: false, securityLevel: 'strict', htmlLabels: true }

/** mermaid 代码 → PNG data URI（htmlLabels:false 保证无 foreignObject，可被 canvas 绘制含文本） */
async function renderMermaidImage(code: string): Promise<{ dataUri: string; width: number; height: number } | null> {
  const cached = mermaidImageCache.get(code)
  if (cached !== undefined) return cached
  try {
    const mod = (await import('mermaid')) as unknown as MermaidMod
    const mermaid = (mod.default ?? mod) as NonNullable<MermaidMod['default']>
    mermaid.initialize({ htmlLabels: false })
    let svg = ''
    try {
      const r = await mermaid.render(`mmd-export-${++mermaidSeq}`, code)
      svg = r.svg
    } finally {
      // 恢复编辑器默认配置（渲染失败也要恢复）
      mermaid.initialize(MERMAID_RESTORE)
    }
    const vb = /viewBox="([\d.]+)[\s]+([\d.]+)[\s]+([\d.]+)[\s]+([\d.]+)"/.exec(svg)
    const w = vb ? Math.max(1, Math.round(Number(vb[3]))) : 600
    const h = vb ? Math.max(1, Math.round(Number(vb[4]))) : 400
    const dataUri = await svgToPngDataUri(svg, w, h)
    const result = dataUri ? { dataUri, width: w, height: h } : null
    mermaidImageCache.set(code, result)
    return result
  } catch (e) {
    console.error('[export] mermaid 渲染失败:', e)
    try {
      const mod = (await import('mermaid')) as unknown as MermaidMod
      ;(mod.default ?? mod as NonNullable<MermaidMod['default']>).initialize(MERMAID_RESTORE)
    } catch {
      /* ignore */
    }
    mermaidImageCache.set(code, null)
    return null
  }
}

function svgToPngDataUri(svg: string, w: number, h: number): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const cleanup = () => URL.revokeObjectURL(url)
    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, w * scale)
      canvas.height = Math.max(1, h * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        cleanup()
        resolve(null)
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      } catch {
        cleanup()
        resolve(null)
        return
      }
      canvas.toBlob((b) => {
        cleanup()
        if (!b) {
          resolve(null)
          return
        }
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = () => resolve(null)
        fr.readAsDataURL(b)
      }, 'image/png')
    }
    img.onerror = () => {
      cleanup()
      resolve(null)
    }
    img.src = url
  })
}

// ---------- 导出前准备（引用展示 + mermaid 图片，递归） ----------

async function prepareForExport(nodes: MdastNode[]): Promise<MdastNode[]> {
  const out: MdastNode[] = []
  for (const n of nodes) {
    if (n.type === 'fileRef') {
      out.push(await fileRefToLink(n))
    } else if (n.type === 'code' && String(n.lang ?? '').toLowerCase() === 'mermaid') {
      const img = await renderMermaidImage(String(n.value ?? ''))
      if (img) {
        // image 是 inline 节点：包在 paragraph 里保证块级换行（否则会被吸入前一块）
        out.push({
          type: 'paragraph',
          children: [{
            type: 'image',
            url: img.dataUri,
            alt: 'mermaid 图',
            width: img.width,
            height: img.height,
          }],
        })
      } else {
        out.push(n) // 渲染失败：保留代码块
      }
    } else if (n.children) {
      out.push({ ...n, children: await prepareForExport(n.children) })
    } else {
      out.push(n)
    }
  }
  return out
}

// ---------- 对外 API ----------

/** 解析并展开：md → ExportBlock[]（引用展示 + mermaid 图片已处理） */
export async function mdToExportBlocks(md: string): Promise<ExportBlock[]> {
  const nodes = await withChain(parseToMdast(md), 0, new Set())
  const prepared = await prepareForExport(nodes)
  return prepared.flatMap(mdastToBlocks)
}

/**
 * 展开后的 markdown（md 格式导出用）：
 * 嵌入块内容合并 + 引用展示内容（[[x#obj]] → resolve 值）+ mermaid 代码块 → data URI 图片
 * + fileRef 转链接 + doctype 删除 + annotation 解包为纯文本。
 */
export async function mdToExportMarkdown(md: string): Promise<string> {
  const nodes = await withChain(parseToMdast(md), 0, new Set())
  const prepared = await prepareForExport(nodes)
  const converted = prepared.flatMap((n) => mdastForStringify([n]))
  const tree = { type: 'root' as const, children: converted }
  const processor = unified()
    .use(remarkStringify, { bullet: '-', emphasis: '*', strong: '*', fences: true })
    .use(remarkGfm)
  return processor.stringify(tree as never)
}

/** 源文件/引用/mermaid 变化后调用（保存/写回时清缓存，保证导出内容新鲜） */
export function clearEmbedCache(): void {
  EMBED_CACHE.clear()
  refTextCache.clear()
  refDisplayCache.clear()
  mermaidImageCache.clear()
}

/** 序列化前转换：fileRef → link、doctype 删除、annotation 解包（image 节点由 remark-stringify 原生处理） */
function mdastForStringify(nodes: MdastNode[]): MdastNode[] {
  const out: MdastNode[] = []
  for (const n of nodes) {
    if (n.type === 'doctype') continue
    if (n.type === 'fileRef') {
      const label = n.fragment ? `${n.path}#${n.fragment}` : (n.path ?? '')
      out.push({ type: 'link', url: n.path ?? '', children: [{ type: 'text', value: label }] })
      continue
    }
    if (n.type === 'annotation') {
      out.push(...mdastForStringify(n.children ?? []))
      continue
    }
    if (n.children) {
      out.push({ ...n, children: mdastForStringify(n.children) })
    } else {
      out.push(n)
    }
  }
  return out
}

// ---------- mdast → ExportBlock ----------

function inlineToNodes(nodes: MdastNode[] | undefined): InlineNode[] {
  const out: InlineNode[] = []
  for (const n of nodes ?? []) {
    if (n.type === 'text' || n.type === 'inlineCode') {
      out.push({ kind: 'text', value: n.value ?? '', code: n.type === 'inlineCode' })
    } else if (n.type === 'emphasis') {
      for (const c of inlineToNodes(n.children)) {
        if (c.kind === 'text') c.italic = true
      }
      out.push(...inlineToNodes(n.children))
    } else if (n.type === 'strong') {
      for (const c of inlineToNodes(n.children)) {
        if (c.kind === 'text') c.bold = true
      }
      out.push(...inlineToNodes(n.children))
    } else if (n.type === 'delete') {
      for (const c of inlineToNodes(n.children)) {
        if (c.kind === 'text') c.strike = true
      }
      out.push(...inlineToNodes(n.children))
    } else if (n.type === 'link') {
      out.push({ kind: 'link', href: n.url ?? '', text: inlineToNodes(n.children) })
    } else if (n.type === 'fileRef') {
      // 防御：prepareForExport 已转换；未经过时按路径文本
      const label = n.fragment ? `${n.path}#${n.fragment}` : (n.path ?? '')
      out.push({ kind: 'link', href: n.path ?? '', text: [{ kind: 'text', value: label }] })
    } else if (n.type === 'annotation') {
      // <mark data-note> 批注 → 高亮文本
      const inner = inlineToNodes(n.children)
      for (const c of inner) if (c.kind === 'text') c.highlight = true
      out.push(...inner)
    } else if (n.type === 'image') {
      // 段落内图片：降级为文本（顶层 mermaid 图片由 mdastToBlocks case 'image' 处理）
      out.push({ kind: 'text', value: `[图片：${n.alt ?? ''}]` })
    } else if (n.type === 'break') {
      out.push({ kind: 'text', value: '\n' })
    } else {
      // 其余（html 等）→ 原样文本
      if (n.value) out.push({ kind: 'text', value: n.value })
    }
  }
  return out
}

function listItemToBlocks(node: MdastNode): Array<{ text: InlineNode[]; children: ExportBlock[] }> {
  const items: Array<{ text: InlineNode[]; children: ExportBlock[] }> = []
  const text: InlineNode[] = []
  const children: ExportBlock[] = []
  for (const c of node.children ?? []) {
    if (c.type === 'paragraph') {
      text.push(...inlineToNodes(c.children))
    } else if (c.type === 'list') {
      children.push(...mdastToBlocks(c))
    } else {
      const b = mdastToBlocks(c)
      if (b.length === 1 && b[0].kind === 'paragraph') {
        text.push(...(b[0] as ExportParagraph).text)
      } else {
        children.push(...b)
      }
    }
  }
  items.push({ text, children })
  return items
}

function mdastToBlocks(node: MdastNode): ExportBlock[] {
  switch (node.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.depth ?? 1))) as 1 | 2 | 3 | 4 | 5 | 6
      return [{ kind: 'heading', level, text: inlineToNodes(node.children) }]
    }
    case 'paragraph':
      return [{ kind: 'paragraph', text: inlineToNodes(node.children) }]
    case 'list': {
      // GFM 任务列表：checked 属性非 null
      const allTasks = (node.children ?? []).every((li) => li.checked !== undefined && li.checked !== null)
      if (allTasks && (node.children ?? []).length > 0) {
        return (node.children ?? []).map((li) => ({
          kind: 'task' as const,
          checked: Boolean(li.checked),
          text: inlineToNodes((li.children ?? []).find((c) => c.type === 'paragraph')?.children),
        }))
      }
      const items = (node.children ?? []).flatMap((li) => listItemToBlocks(li))
      return [{ kind: 'list', ordered: Boolean(node.ordered), items }]
    }
    case 'table': {
      const rows = (node.children ?? []).filter((r) => r.type === 'tableRow')
      const cellText = (c: MdastNode | undefined): InlineNode[] => inlineToNodes(c?.children)
      const header = rows[0]?.children?.map((c) => cellText(c)) ?? []
      const body = rows.slice(1).map((r) => (r.children ?? []).map((c) => cellText(c)))
      return [{ kind: 'table', header, rows: body }]
    }
    case 'code':
      return [{ kind: 'code', language: String(node.lang ?? ''), content: String(node.value ?? '') }]
    case 'blockquote':
      return [{ kind: 'quote', blocks: (node.children ?? []).flatMap(mdastToBlocks) }]
    case 'thematicBreak':
      return [{ kind: 'hr' }]
    case 'image': {
      const url = node.url ?? ''
      if (url.startsWith('data:image/png')) {
        return [{
          kind: 'image',
          alt: node.alt ?? '图',
          dataUri: url,
          width: Number(node.width ?? 600),
          height: Number(node.height ?? 400),
        }]
      }
      return node.alt ? [{ kind: 'paragraph', text: [{ kind: 'text', value: `[图片：${node.alt}]` }] }] : []
    }
    case 'fileBlock': {
      // 未展开的（withChain 处理过的不应到这里）→ 路径文本
      return [{ kind: 'paragraph', text: [{ kind: 'text', value: `![[${node.path ?? ''}]]` }] }]
    }
    case 'doctype':
      return [] // 类型声明行不导出
    default:
      // 未知块（html 块等）→ 若带文本按段落输出
      if (node.value !== undefined) {
        return [{ kind: 'paragraph', text: [{ kind: 'text', value: String(node.value) }] }]
      }
      return (node.children ?? []).flatMap(mdastToBlocks)
  }
}
