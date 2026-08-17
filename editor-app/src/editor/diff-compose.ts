// M13：diff 组合器——把 git diff（行级 hunks + 词级 words）组合成「单份组合 md」
// 输出：composedMd（新版本为骨架 + diff 标记）+ notes（批注卡，渲染层自动展示）+ mermaid（节点级变更）
// 规则：
//   ctx 行 → 原样；纯 del 段 → ::: diff-del；纯 add 段 → ::: diff-add
//   修改对（del+add）→ 词级合并 {--del--}{++add++}（行内）；无共同部分 → 两个容器
//   表格行修改对 → 单元格级标记；mermaid fence → 节点级合并源码
import type { DiffHunk, DiffLine } from '../git/types'
import { diffMermaid, type MermaidNodeDiff } from './mermaid-diff'

export interface DiffNote {
  id: string
  kind: 'word' | 'block' | 'mermaid' | 'table'
  text: string
  del?: string
  add?: string
  anchor: string
}

export interface ComposeResult {
  composedMd: string
  notes: DiffNote[]
  mermaid: MermaidNodeDiff[]
}

export interface ComposeOpts {
  oldMd: string
  newMd: string
  hunks: DiffHunk[]
  path: string
}

const FENCE_RE = /^```/
const TABLE_RE = /^\s*\|/
/** 块嵌入引用行（整段匹配 remark-ref 的 fileBlock；复合段落错误会退回内联解析） */
const EMBED_RE = /^\s*!\[\[/

let noteSeq = 0
function makeNote(
  kind: DiffNote['kind'],
  text: string,
  del: string | undefined,
  add: string | undefined,
  anchor: string
): DiffNote {
  return { id: `dn-${++noteSeq}`, kind, text, del, add, anchor }
}

// ---------- 词级合并（中文友好：共同前缀/后缀） ----------

/** 新旧文本的共同前缀/后缀 → 行内标记（中段 del/add）；无共同部分或中段过长返回 null */
function splitCommon(oldText: string, newText: string): {
  prefix: string
  del: string
  add: string
  suffix: string
} | null {
  let p = 0
  while (p < oldText.length && p < newText.length && oldText[p] === newText[p]) p++
  let s = 0
  while (
    s < oldText.length - p &&
    s < newText.length - p &&
    oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]
  ) {
    s++
  }
  const prefix = oldText.slice(0, p)
  const suffix = oldText.slice(oldText.length - s)
  const del = oldText.slice(p, oldText.length - s)
  const add = newText.slice(p, newText.length - s)
  if (!prefix && !suffix) return null
  if (del.length > 60 || add.length > 60) return null
  return { prefix, del, add, suffix }
}

/** 兜底：porcelain words 有共同 ctx 时的词级合并 */
function mergeWordsFallback(
  dw: NonNullable<DiffLine['words']>,
  aw: NonNullable<DiffLine['words']>
): string | null {
  const aAdds = aw.filter((w) => w.kind === 'add').map((w) => w.text)
  let out = ''
  let ai = 0
  let hasCtx = false
  for (const w of dw) {
    if (w.kind === 'ctx') {
      out += w.text
      hasCtx = true
    } else if (w.kind === 'del') {
      out += `{--${w.text}--}`
      if (ai < aAdds.length) {
        out += `{++${aAdds[ai]}++}`
        ai++
      }
    }
  }
  while (ai < aAdds.length) {
    out += `{++${aAdds[ai]}++}`
    ai++
  }
  return hasCtx ? out : null
}

// ---------- 表格单元格级 ----------

function parseCells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim())
}

function mergeTablePair(del: DiffLine, add: DiffLine, out: string[], notes: DiffNote[]) {
  const dc = parseCells(del.text)
  const ac = parseCells(add.text)
  const n = Math.max(dc.length, ac.length)
  const cells: string[] = []
  let changed = false
  let anchorD = ''
  let anchorA = ''
  for (let k = 0; k < n; k++) {
    const d = dc[k] ?? ''
    const a = ac[k] ?? ''
    if (d !== a) {
      changed = true
      if (!anchorA) {
        anchorD = d
        anchorA = a
      }
      cells.push(`${d ? `{--${d}--}` : ''}${a ? `{++${a}++}` : ''}`)
    } else {
      cells.push(a)
    }
  }
  if (!changed) {
    out.push(add.text)
    return
  }
  const line = `| ${cells.join(' | ')} |`
  out.push(line)
  // 锚点用变更单元格值（渲染层 .diff-ins/.diff-del 按 value 定位）
  notes.push(makeNote('table', '修改了表格单元格', anchorD || del.text, anchorA || add.text, line))
}

/** 行级标记：表格行 → 逐单元格标记（整行包 {++..++} 会被 GFM 表格解析吃掉）；普通行 → 整行标记 */
function markLine(line: string, kind: 'add' | 'del'): { text: string; anchor: string } {
  if (TABLE_RE.test(line)) {
    const cells = parseCells(line)
    const marked = cells.map((c) =>
      c ? (kind === 'add' ? `{++${c}++}` : `{--${c}--}`) : ''
    )
    return { text: `| ${marked.join(' | ')} |`, anchor: cells.find((c) => c) ?? '' }
  }
  return { text: kind === 'add' ? `{++${line}++}` : `{--${line}--}`, anchor: line }
}

/** 纯 del 段 → 每行 {--行--}（表格行逐单元格）；纯 add 段 → 每行 {++行++}；修改对 → 词级 {--}{++} 或整行重写 */
function handleSeg(
  seg: { dels: DiffLine[]; adds: DiffLine[] },
  out: string[],
  notes: DiffNote[]
) {
  const { dels, adds } = seg
  if (adds.length === 0) {
    // 纯删除（空行无可视标记，跳过）
    const visible = dels.filter((d) => d.text !== '')
    for (const d of visible) out.push(markLine(d.text, 'del').text)
    if (visible.length) {
      notes.push(
        makeNote(
          'block',
          `删除了此段${visible.length > 1 ? `（${visible.length} 行）` : ''}`,
          visible.map((d) => d.text).join('\n'),
          undefined,
          markLine(visible[0].text, 'del').anchor.slice(0, 30)
        )
      )
    }
    return
  }
  if (dels.length === 0) {
    // 纯新增
    const visible = adds.filter((a) => a.text !== '')
    for (const a of visible) {
      // M14b：嵌入行原样输出（不包 {++..++}，否则 remark-ref 整段匹配失败 → 退化为文件链接）
      if (EMBED_RE.test(a.text)) {
        out.push(a.text)
        out.push('')
      } else {
        out.push(markLine(a.text, 'add').text)
      }
    }
    if (visible.length) {
      notes.push(
        makeNote(
          'block',
          `新增了此段${visible.length > 1 ? `（${visible.length} 行）` : ''}`,
          undefined,
          visible.map((a) => a.text).join('\n'),
          markLine(visible[0].text, 'add').anchor.slice(0, 30)
        )
      )
    }
    return
  }

  // 修改对
  const n = Math.min(dels.length, adds.length)
  for (let k = 0; k < n; k++) {
    const del = dels[k]
    const add = adds[k]
    if (TABLE_RE.test(del.text) && TABLE_RE.test(add.text)) {
      mergeTablePair(del, add, out, notes)
      continue
    }
    // M14b：嵌入改行原样输出新行（旧版本不再需要，卡片展示当前内容）
    if (EMBED_RE.test(del.text) || EMBED_RE.test(add.text)) {
      if (add.text) {
        out.push(add.text)
        out.push('')
      }
      continue
    }
    const dw = del.words ?? []
    const aw = add.words ?? []
    // 中文友好行内 diff：共同前缀/后缀（porcelain words 对无空格中文不可靠）
    const r = splitCommon(del.text, add.text)
    if (r !== null) {
      // 空 del/add 不生成标记（PM 不允许空文本节点）
      const line = `${r.prefix}${r.del ? `{--${r.del}--}` : ''}${r.add ? `{++${r.add}++}` : ''}${r.suffix}`
      if (r.del || r.add) {
        out.push(line)
        const noteText = r.del && r.add
          ? `修改"${r.del}"为"${r.add}"`
          : r.add
            ? `新增"${r.add}"`
            : `删除"${r.del}"`
        notes.push(makeNote('word', noteText, r.del, r.add, line))
      } else {
        // 两行完全相同（理论上 diff 不产生）→ 原样
        out.push(add.text)
      }
      continue
    }
    // 兜底：porcelain words 有共同 ctx 时
    if (dw.length && aw.length && dw.some((w) => w.kind === 'ctx')) {
      const merged = mergeWordsFallback(dw, aw)
      if (merged !== null) {
        out.push(merged)
        continue
      }
    }
    // 整行重写 → 行内 {--旧行--}{++新行++}
    const line = `${del.text ? `{--${del.text}--}` : ''}${add.text ? `{++${add.text}++}` : ''}`
    if (line) {
      out.push(line)
      notes.push(makeNote('block', '修改了此行', del.text, add.text, (add.text || del.text).slice(0, 30)))
    }
  }
  // 多余 del / add（段首/段尾行数不对称）
  for (const d of dels.slice(n)) {
    if (d.text) out.push(markLine(d.text, 'del').text)
  }
  for (const a of adds.slice(n)) {
    if (a.text) out.push(markLine(a.text, 'add').text)
  }
}

// ---------- 代码栅栏（mermaid / 其他） ----------
// M14b：栅栏在文档级跟踪（复制区 + hunk 内统一漏斗）——栅栏开行在 hunk 外（复制区）时，
// 段内的 del/add 行若被 {++..++} 包裹会破坏代码块语法（mermaid Parse error）

interface FenceState {
  lang: string
  rows: Array<{ kind: DiffLine['kind']; text: string }>
}

/** 栅栏收尾：mermaid → 节点级合并源码（diffMermaid）；其他/无节点级变化 → 新版本源码原样 */
function finalizeFence(
  fence: FenceState,
  out: string[],
  notes: DiffNote[],
  mermaidList: MermaidNodeDiff[]
) {
  const rows = fence.rows
  const open = rows[0].text
  const closed = rows.length > 1 && FENCE_RE.test(rows[rows.length - 1].text.trim())
  const mid = closed ? rows.slice(1, -1) : rows.slice(1)
  const close = closed ? rows[rows.length - 1].text : ''
  const newSrc = mid.filter((r) => r.kind !== 'del').map((r) => r.text).join('\n')
  const oldSrc = mid.filter((r) => r.kind !== 'add').map((r) => r.text).join('\n')

  if (fence.lang === 'mermaid') {
    const d = diffMermaid(oldSrc, newSrc)
    if (d.type !== 'unknown' && (d.add.length || d.del.length || d.mod.length)) {
      const label =
        d.type === 'flowchart' ? '流程图' : d.type === 'sequence' ? '时序图' : d.type === 'state' ? '状态图' : '图表'
      const parts: string[] = []
      if (d.add.length) parts.push(`新增 ${d.add.length} 个${d.type === 'sequence' ? '消息' : '节点'}`)
      if (d.del.length) parts.push(`删除 ${d.del.length} 个`)
      if (d.mod.length) parts.push(`修改 ${d.mod.length} 个`)
      out.push(open)
      for (const l of d.merged.split('\n')) out.push(l)
      if (close) out.push(close)
      notes.push(makeNote('mermaid', `${label}：${parts.join('、')}`, undefined, undefined, `${label}节点`))
      mermaidList.push(d)
      return
    }
  }
  // 无节点级变化 / 非 mermaid / 无法解析 → 新版本源码原样
  out.push(open)
  for (const r of mid) if (r.kind !== 'del') out.push(r.text)
  if (close) out.push(close)
}

interface ComposeCtx {
  out: string[]
  notes: DiffNote[]
  mermaidList: MermaidNodeDiff[]
  fence: FenceState | null
}

/** 栅栏漏斗：fence 外遇到开行 → 建 fence 消费；fence 内 → 收集行，闭合时收尾。返回「是否已消费该行」 */
function feedFence(ctx: ComposeCtx, row: { kind: DiffLine['kind']; text: string }): boolean {
  if (!ctx.fence) {
    if (FENCE_RE.test(row.text.trim())) {
      const m = /^```(\w*)\s*$/.exec(row.text.trim())
      ctx.fence = { lang: m ? m[1] : '', rows: [row] }
      return true
    }
    return false
  }
  ctx.fence.rows.push(row)
  if (FENCE_RE.test(row.text.trim())) {
    finalizeFence(ctx.fence, ctx.out, ctx.notes, ctx.mermaidList)
    ctx.fence = null
  }
  return true
}

function processHunk(ctx: ComposeCtx, hunk: DiffHunk) {
  const lines = hunk.lines
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.kind === 'ctx') {
      if (feedFence(ctx, line)) {
        i++
        continue
      }
      ctx.out.push(line.text)
      // 嵌入引用需独立成段（remark-ref 整段匹配）→ 补空行
      if (/^\s*!\[\[/.test(line.text)) ctx.out.push('')
      i++
    } else {
      // del/add 段
      const dels: DiffLine[] = []
      const adds: DiffLine[] = []
      let j = i
      while (j < lines.length && lines[j].kind === 'del') {
        dels.push(lines[j])
        j++
      }
      while (j < lines.length && lines[j].kind === 'add') {
        adds.push(lines[j])
        j++
      }
      // 段内含栅栏开行（整块新增代码块）或当前在栅栏内 → 原样进漏斗（避免标记破坏代码块）
      const segRows = [...dels, ...adds]
      if (ctx.fence || segRows.some((r) => FENCE_RE.test(r.text.trim()))) {
        for (const r of segRows) feedFence(ctx, r)
      } else {
        handleSeg({ dels, adds }, ctx.out, ctx.notes)
      }
      i = j
    }
  }
}

// ---------- 入口 ----------

export function composeDiff(opts: ComposeOpts): ComposeResult {
  noteSeq = 0
  const newLines = opts.newMd.split('\n')
  const ctx: ComposeCtx = { out: [], notes: [], mermaidList: [], fence: null }
  let prevNewEnd = 0 // 0-based 已复制到的新版本行索引
  const feed = (row: { kind: DiffLine['kind']; text: string }) => feedFence(ctx, row)
  for (const hunk of opts.hunks) {
    // 复制 hunk 前的未变化区（新版本；经栅栏漏斗，避免栅栏开行在 hunk 外时漏处理）
    const copyTo = hunk.newStart - 1
    for (let k = prevNewEnd; k < copyTo && k < newLines.length; k++) {
      if (!feed({ kind: 'ctx', text: newLines[k] })) ctx.out.push(newLines[k])
    }
    // hunk 内
    processHunk(ctx, hunk)
    prevNewEnd = hunk.newStart + hunk.newLines - 1
  }
  for (let k = prevNewEnd; k < newLines.length; k++) {
    if (!feed({ kind: 'ctx', text: newLines[k] })) ctx.out.push(newLines[k])
  }
  // 文档末尾未闭合栅栏 → 收尾（不丢内容）
  if (ctx.fence) finalizeFence(ctx.fence, ctx.out, ctx.notes, ctx.mermaidList)
  return { composedMd: ctx.out.join('\n'), notes: ctx.notes, mermaid: ctx.mermaidList }
}
