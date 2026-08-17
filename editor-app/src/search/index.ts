// 全局全文搜索（M15 补全 —— 恢复「搜索结果点击 → scrollToSearchMatch」的完整链路）
//  - 遍历当前可见文件树中的可编辑文件，逐行匹配关键词（默认忽略大小写）
//  - 已打开且已挂载的标签优先取内存实时内容（反映未保存编辑）
//  - 并发受限读取 + 磁盘内容缓存（treeVersion 变化即失效）
import { state } from '../state/store'
import { fs } from '../fs'
import { isEditableFile, type FsEntry } from '../fs/types'
import { getTabMarkdownByPath } from '../editor/manager'

export interface SearchHit {
  path: string
  /** 行号（1 起） */
  lineNo: number
  /** 原始行文本（供 scrollToSearchMatch 精确定位） */
  line: string
  /** 命中的关键词（trim 后原始大小写） */
  keyword: string
  /** 命中列（0 起） */
  col: number
  /** 该命中在本文件中是关键词的第几次出现（0 起；跳转定位用） */
  occurrence: number
  /** 关键词前 12 字符（行内上下文，跳转定位纠偏用） */
  before: string
  /** 关键词后 12 字符（行内上下文，跳转定位纠偏用） */
  after: string
}

export interface SearchFileGroup {
  path: string
  hits: SearchHit[]
}

export interface SearchOptions {
  /** 大小写敏感 */
  caseSensitive?: boolean
}

/** 每文件最多保留的命中行 */
const PER_FILE_LIMIT = 100
/** 结果总数上限（防止大仓库刷屏） */
const TOTAL_LIMIT = 4000

// 磁盘内容缓存：key = 相对路径；treeVersion 变化时整体失效（结构变了，路径集合可能不同）
const contentCache = new Map<string, string>()
let cacheTreeVersion = -1
/** 搜索序号：只采纳最新一次搜索的结果（防乱序覆盖） */
let searchSeq = 0

function collectEditablePaths(entries: FsEntry[]): string[] {
  const out: string[] = []
  const walk = (list: FsEntry[]) => {
    for (const e of list) {
      if (e.kind === 'dir') walk(e.children ?? [])
      else if (isEditableFile(e.name) && !e.path.startsWith('.git/')) out.push(e.path)
    }
  }
  walk(entries)
  return out
}

async function getContent(path: string): Promise<string> {
  // 已打开且非 diff 的标签：取编辑器实时 markdown（反映未保存编辑；源码模式取 textarea 最新值）
  const tab = state.tabs.find((t) => t.path === path)
  if (tab && tab.viewMode !== 'diff') {
    const live = getTabMarkdownByPath(path)
    if (live != null) return live
  }
  if (contentCache.has(path)) return contentCache.get(path)!
  const text = await fs.readFile(path)
  contentCache.set(path, text)
  return text
}

/** 读取某文件用于搜索的内容（已打开且非 diff 标签取实时 markdown，否则取磁盘 + 缓存） */
export async function readSearchContent(path: string): Promise<string> {
  return getContent(path)
}

/** 读磁盘原文（替换的基准：替换结果写回磁盘） */
export async function readSearchDiskContent(path: string): Promise<string> {
  return fs.readFile(path)
}

function matchLines(content: string, rawQuery: string, opts: SearchOptions): SearchHit[] {
  const needle = opts.caseSensitive ? rawQuery : rawQuery.toLowerCase()
  const lines = content.split('\n')
  const hits: SearchHit[] = []
  let seen = 0 // 已累计出现次数（跨行累计 → occurrence）
  for (let i = 0; i < lines.length && hits.length < PER_FILE_LIMIT; i++) {
    const line = lines[i]
    const src = opts.caseSensitive ? line : line.toLowerCase()
    // 统计本行出现次数
    let count = 0
    let idx = src.indexOf(needle)
    while (idx >= 0) {
      count++
      idx = src.indexOf(needle, idx + Math.max(needle.length, 1))
    }
    if (count > 0) {
      const col = src.indexOf(needle)
      hits.push({
        path: '',
        lineNo: i + 1,
        line,
        keyword: rawQuery,
        col,
        occurrence: seen,
        before: line.slice(Math.max(0, col - 12), col),
        after: line.slice(col + rawQuery.length, col + rawQuery.length + 12),
      })
      seen += count
    }
  }
  return hits
}

/** 并发受限的遍历器 */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++
        await fn(items[i])
      }
    }
  )
  await Promise.all(workers)
}

/**
 * 全文搜索：返回按路径排序的分组结果。
 *  - query 为空 → []
 *  - 快速失败：已无可用树/读取失败的文件静默跳过
 *  - 支持大小写敏感开关（opts.caseSensitive）
 */
export async function searchWorkspace(
  query: string,
  opts: SearchOptions = {}
): Promise<SearchFileGroup[]> {
  const q = query.trim()
  if (!q) return []
  if (cacheTreeVersion !== state.treeVersion) {
    contentCache.clear()
    cacheTreeVersion = state.treeVersion
  }
  const mySeq = ++searchSeq
  const paths = collectEditablePaths(state.tree)
  const groups: SearchFileGroup[] = []
  let total = 0

  await pool(paths, 6, async (path) => {
    if (mySeq !== searchSeq) return // 已被新一轮搜索取代
    let content: string
    try {
      content = await getContent(path)
    } catch {
      return // 读取失败（已删除等）静默跳过
    }
    const hits = matchLines(content, q, opts)
    if (!hits.length) return
    for (const h of hits) h.path = path
    groups.push({ path, hits })
    total += hits.length
  })

  if (mySeq !== searchSeq) return []
  groups.sort((a, b) => a.path.localeCompare(b.path))
  // 总数超限时截断（按路径字典序靠后者丢弃）
  let keep = 0
  const out: SearchFileGroup[] = []
  for (const g of groups) {
    if (keep >= TOTAL_LIMIT) break
    const slice = g.hits.slice(0, Math.max(0, Math.min(g.hits.length, TOTAL_LIMIT - keep)))
    if (slice.length) out.push({ path: g.path, hits: slice })
    keep += slice.length
  }
  return out
}

/**
 * 行文本高亮分段（安全渲染用，不依赖 v-html）：
 * 返回 [{ text, hit }] 片段数组，调用方渲染 <span v-for> 即可。
 */
export function highlightSegments(
  line: string,
  keyword: string,
  caseSensitive: boolean
): { text: string; hit: boolean }[] {
  const q = keyword.trim()
  if (!q) return [{ text: line, hit: false }]
  const lower = q.toLowerCase()
  const src = caseSensitive ? line : line.toLowerCase()
  const out: { text: string; hit: boolean }[] = []
  let i = 0
  for (;;) {
    const idx = src.indexOf(lower, i)
    if (idx < 0) {
      if (i < line.length) out.push({ text: line.slice(i), hit: false })
      break
    }
    if (idx > i) out.push({ text: line.slice(i, idx), hit: false })
    out.push({ text: line.slice(idx, idx + q.length), hit: true })
    i = idx + q.length
  }
  return out
}

/**
 * 替换工具：把 content 中所有匹配替换为 replacement；
 * 或只替换第 occurrence（0 起）次出现（用于「替换当前命中」）。
 * 返回新内容与替换次数（occurrence 模式下返回命中是否完成）。
 */
export function replaceInContent(
  content: string,
  keyword: string,
  replacement: string,
  opts: SearchOptions & { occurrence?: number } = {}
): { content: string; count: number } {
  const needle = opts.caseSensitive ? keyword : keyword.toLowerCase()
  let out = ''
  let rest = content
  let count = 0
  let replaced = 0
  const want = opts.occurrence ?? -1
  while (rest) {
    const src = opts.caseSensitive ? rest : rest.toLowerCase()
    const i = src.indexOf(needle)
    if (i < 0) {
      out += rest
      break
    }
    out += rest.slice(0, i)
    if (want < 0 || replaced === want) {
      out += replacement
      count++
    } else {
      out += rest.slice(i, i + keyword.length)
    }
    replaced++
    rest = rest.slice(i + keyword.length)
  }
  return { content: out, count }
}