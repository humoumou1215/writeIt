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

const MERMAID_FENCE_RE = /^```mermaid\s*$/
const FENCE_RE = /^```/
const TABLE_RE = /^\s*\|/

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
      if (ai < aAdds.length) out += `{++${aAdds[ai++]++}`
    }
  }
  while (ai < aAdds.length) out += `{++${aAdds[ai++]++}`
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
  for (let k = 0; k < n; k++) {
    const d = dc[k] ?? ''
    const a = ac[k] ?? ''
    if (d !== a) {
      changed = true
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
  notes.push(makeNote('table', '修改了表格单元格', del.text, add.text, line))
}

// ---------- mermaid fence ----------

function handleMermaidFence(
  rows: DiffLine[],
  out: string[],
  notes: DiffNote[],
  mermaidList: MermaidNodeDiff[]
) {
  const open = rows[0].text
  const close = rows[rows.length - 1].text
  const mid = rows.slice(1, -1)
  const newSrc = mid.filter((r) => r.kind !== 'del').map((r) => r.text).join('\n')
  const oldSrc = mid.filter((r) => r.kind !== 'add').map((r) => r.text).join('\n')
  const d = diffMermaid(oldSrc, newSrc)
  if (d.type === 'unknown' || (!d.add.length && !d.del.length && !d.mod.length)) {
    // 无节点级变化或无法解析 → 新源码原样
    out.push(open)
    for (const r of mid) if (r.kind !== 'del') out.push(r.text)
    out.push(close)
    return
  }
  const label =
    d.type === 'flowchart' ? '流程图' : d.type === 'sequence' ? '时序图' : d.type === 'state' ? '状态图' : '图表'
  const parts: string[] = []
  if (d.add.length) parts.push(`新增 ${d.add.length} 个${d.type === 'sequence' ? '消息' : '节点'}`)
  if (d.del.length) parts.push(`删除 ${d.del.length} 个`)
  if (d.mod.length) parts.push(`修改 ${d.mod.length} 个`)
  out.push(open)
  for (const l of d.merged.split('\n')) out.push(l)
  out.push(close)
  notes.push(makeNote('mermaid', `${label}：${parts.join('、')}`, undefined, undefined, `${label}节点`))
  mermaidList.push(d)
}

// ---------- 段处理 ----------

function handleSeg(
  seg: { dels: DiffLine[]; adds: DiffLine[] },
  out: string[],
  notes: DiffNote[],
  mermaidList: MermaidNodeDiff[]
) {
  const { dels, adds } = seg
  if (adds.length === 0) {
    // 纯删除
    out.push('')
    out.push('```diff-del')
    for (const d of dels) out.push(d.text)
    out.push('```')
    out.push('')
    notes.push(
      makeNote(
        'block',
        `删除了此段${dels.length > 1 ? `（${dels.length} 行）` : ''}`,
        dels.map((d) => d.text).join('\n'),
        undefined,
        dels[0].text.slice(0, 30)
      )
    )
    return
  }
  if (dels.length === 0) {
    // 纯新增
    out.push('')
    out.push('```diff-add')
    for (const a of adds) out.push(a.text)
    out.push('```')
    out.push('')
    notes.push(
      makeNote(
        'block',
        `新增了此段${adds.length > 1 ? `（${adds.length} 行）` : ''}`,
        undefined,
        adds.map((a) => a.text).join('\n'),
        adds[0].text.slice(0, 30)
      )
    )
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
    const dw = del.words ?? []
    const aw = add.words ?? []
    // 中文友好行内 diff：共同前缀/后缀（porcelain words 对无空格中文不可靠）
    const r = splitCommon(del.text, add.text)
    if (r !== null) {
      // 空 del/add 不生成标记（PM 不允许空文本节点）
      const line = `${r.prefix}${r.del ? `{--${r.del}--}` : ''}${r.add ? `{++${r.add}++}` : ''}${r.suffix}`
      if (r.del || r.add) {
        out.push(line)
        notes.push(makeNote('word', `修改"${r.del}"为"${r.add}"`, r.del, r.add, line))
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
    // 整行重写 → 两个代码块（旧红 + 新绿）
    out.push('')
    out.push('```diff-del')
    out.push(del.text)
    out.push('```')
    out.push('')
    out.push('```diff-add')
    out.push(add.text)
    out.push('```')
    out.push('')
    notes.push(makeNote('block', '修改了此行', del.text, add.text, add.text.slice(0, 30)))
  }
  // 多余 del / add
  if (dels.length > n) {
    out.push('')
    out.push('```diff-del')
    for (const d of dels.slice(n)) out.push(d.text)
    out.push('```')
    out.push('')
  }
  if (adds.length > n) {
    out.push('')
    out.push('```diff-add')
    for (const a of adds.slice(n)) out.push(a.text)
    out.push('```')
    out.push('')
  }
}

// ---------- hunk 处理 ----------

function collectFence(i: number, lines: DiffLine[]): { rows: DiffLine[]; end: number } {
  const rows: DiffLine[] = [lines[i]]
  let j = i + 1
  while (
    j < lines.length &&
    !(lines[j].kind === 'ctx' && FENCE_RE.test(lines[j].text.trim()))
  ) {
    rows.push(lines[j])
    j++
  }
  if (j < lines.length && FENCE_RE.test(lines[j].text.trim())) {
    rows.push(lines[j])
    j++
  }
  return { rows, end: j }
}

function processHunk(
  hunk: DiffHunk,
  out: string[],
  notes: DiffNote[],
  mermaidList: MermaidNodeDiff[]
) {
  const lines = hunk.lines
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.kind === 'ctx') {
      if (MERMAID_FENCE_RE.test(line.text.trim())) {
        const fence = collectFence(i, lines)
        i = fence.end
        handleMermaidFence(fence.rows, out, notes, mermaidList)
      } else {
        out.push(line.text)
        // 嵌入引用需独立成段（remark-ref 整段匹配）→ 补空行
        if (/^\s*!\[\[/.test(line.text)) out.push('')
        i++
      }
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
      handleSeg({ dels, adds }, out, notes, mermaidList)
      i = j
    }
  }
}

// ---------- 入口 ----------

export function composeDiff(opts: ComposeOpts): ComposeResult {
  noteSeq = 0
  const newLines = opts.newMd.split('\n')
  const out: string[] = []
  const notes: DiffNote[] = []
  const mermaidList: MermaidNodeDiff[] = []
  let prevNewEnd = 0 // 0-based 已复制到的新版本行索引
  for (const hunk of opts.hunks) {
    // 复制 hunk 前的未变化区（新版本）
    const copyTo = hunk.newStart - 1
    for (let k = prevNewEnd; k < copyTo && k < newLines.length; k++) out.push(newLines[k])
    // hunk 内
    processHunk(hunk, out, notes, mermaidList)
    prevNewEnd = hunk.newStart + hunk.newLines - 1
  }
  for (let k = prevNewEnd; k < newLines.length; k++) out.push(newLines[k])
  return { composedMd: out.join('\n'), notes, mermaid: mermaidList }
}
