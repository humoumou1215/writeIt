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

/** 表格分隔行（GFM：每格全为 - 与可选 : 对齐符，如 | --- | :---: |）。
 * 这类行的变化几乎总是列宽对齐格式化（编辑器/格式化工具把 - 拉长），不是业务内容；
 * 若被 {--..--}/{++..++} 包裹会破坏分隔行语法 → GFM 解析失败 → 整表退化为普通段落。
 * 处理原则：永远原样输出（新侧），不标记、不产生批注卡。 */
function isTableSepLine(line: string): boolean {
  if (!TABLE_RE.test(line)) return false
  const cells = parseCells(line)
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))
}

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

/** 行的 markdown 元字符（* _ ` []）——命中时改用字符级 LCS 多点标记，避免单段合并把格式符号包进标记产生乱码 */
const MARKDOWN_META_RE = /[*_`\[\]]/

interface LcsSeg {
  type: 'ctx' | 'del' | 'add'
  text: string
}

/** 字符级 LCS（行通常 <200 字符）→ 多点 del/add/ctx 分割。
 *  正确性优先：* ` [] 等符号随内容走进 del/add，但被打包进原子标记节点后不再触发 markdown 解析 → 无乱码 */
function lcsSegments(oldText: string, newText: string): LcsSeg[] {
  const n = oldText.length
  const m = newText.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = oldText[i] === newText[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const segs: LcsSeg[] = []
  let i = 0
  let j = 0
  let cur: LcsSeg | null = null
  const push = (t: LcsSeg['type'], ch: string) => {
    if (cur && cur.type === t) cur.text += ch
    else {
      cur = { type: t, text: ch }
      segs.push(cur)
    }
  }
  while (i < n && j < m) {
    if (oldText[i] === newText[j]) {
      push('ctx', oldText[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', oldText[i])
      i++
    } else {
      push('add', newText[j])
      j++
    }
  }
  while (i < n) push('del', oldText[i++])
  while (j < m) push('add', newText[j++])
  return segs
}

/** LCS 段 → 行内标记文本 + 首处 del/add 词（批注卡用） */
function segsToLine(segs: LcsSeg[]): { text: string; del: string; add: string } {
  let text = ''
  let del = ''
  let add = ''
  for (const s of segs) {
    if (s.type === 'ctx') {
      text += s.text
    } else if (s.type === 'del') {
      text += `{--${s.text}--}`
      if (!del) del = s.text
    } else {
      text += `{++${s.text}++}`
      if (!add) add = s.text
    }
  }
  return { text, del, add }
}

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
  // M16：纯分隔行变化（列宽对齐格式化）→ 原样输出新行，不标记不产卡
  if (isTableSepLine(del.text) && isTableSepLine(add.text)) {
    out.push(add.text)
    return
  }
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
  notes.push(makeNote('table', '修改了表格单元格', anchorD || del.text, anchorA || add.text, anchorA || add.text))
}

/** 列表项 / 引用块 / 标题行首 marker 保留正则：{++..++} 不能包住 marker，
 *  否则 `- 事项` 变成 `{++- 事项++}` 会失去块语义被吞入上一行（M16 修复） */
const LIST_MARK_RE = /^(\s*(?:[-+*]|\d+[.)])\s+)(.*)$/
const QUOTE_MARK_RE = /^(\s*>[ >]*\s*)(.*)$/
const HEADING_MARK_RE = /^(\s*(#{1,6})\s+)(.*)$/

/** 行级标记：表格行 → 逐单元格标记；块 marker（列表/引用/标题）保留标记外；普通行 → 整行标记 */
function markLine(line: string, kind: 'add' | 'del'): { text: string; anchor: string } {
  if (TABLE_RE.test(line)) {
    // M16：表格分隔行原样输出（标记会破坏 GFM 分隔行识别 → 整表退化为段落）
    if (isTableSepLine(line)) return { text: line, anchor: '' }
    const cells = parseCells(line)
    const marked = cells.map((c) =>
      c ? (kind === 'add' ? `{++${c}++}` : `{--${c}--}`) : ''
    )
    return { text: `| ${marked.join(' | ')} |`, anchor: cells.find((c) => c) ?? '' }
  }
  const mark = (marker: string, inner: string): { text: string; anchor: string } => ({
    text: `${marker}${kind === 'add' ? `{++${inner}++}` : `{--${inner}--}`}`,
    anchor: inner,
  })
  // 列表项：marker 保留在标记外（- / 1. 等），内容做标记
  const lm = LIST_MARK_RE.exec(line)
  if (lm && lm[2]) return mark(lm[1], lm[2])
  // 引用块（> 前缀）同理
  const qm = QUOTE_MARK_RE.exec(line)
  if (qm && qm[2]) return mark(qm[1], qm[2])
  // 标题（## 等）：marker 保留 → 仍是标题元素
  const hm = HEADING_MARK_RE.exec(line)
  if (hm && hm[3]) return mark(hm[1], hm[3])
  return { text: kind === 'add' ? `{++${line}++}` : `{--${line}--}`, anchor: line }
}

/** 无共同内容的修改对 → 旧行红、新行绿 各占一段（比行内 {--..--}{++..++} 清晰；
 *  也避免把两种块语义（如 `> 引用` 与 `## 标题`）拼进同一行 */
function pushReplacedPair(del: DiffLine, add: DiffLine, out: string[], notes: DiffNote[]) {
  const d = markLine(del.text, 'del')
  const a = markLine(add.text, 'add')
  if (out.length && out[out.length - 1] !== '') out.push('')
  out.push(d.text)
  if (out[out.length - 1] !== '') out.push('')
  out.push(a.text)
  out.push('')
  notes.push(makeNote('block', '修改了此行', del.text, add.text, a.anchor || d.anchor))
}

/** LCS 段是否含「有意义的共同内容」（>1 非空白字符） */
function lcsHasMeaningfulCtx(segs: LcsSeg[]): boolean {
  let len = 0
  for (const s of segs) {
    if (s.type === 'ctx' && s.text.trim()) len += s.text.trim().length
  }
  return len >= 2
}

/** 纯 del 段 → 每行 {--行--}（表格行逐单元格）；纯 add 段 → 每行 {++行++}；修改对 → 词级 {--}{++} 或无共同内容拆双行 */
function handleSeg(
  seg: { dels: DiffLine[]; adds: DiffLine[] },
  out: string[],
  notes: DiffNote[]
) {
  const { dels, adds } = seg
  if (adds.length === 0) {
    // 纯删除（空行无可视标记，跳过；分隔行属于结构语法，原样保留避免破坏表格）
    const visible = dels.filter((d) => d.text !== '' && !isTableSepLine(d.text))
    for (const d of visible) out.push(markLine(d.text, 'del').text)
    if (visible.length) {
      notes.push(
        makeNote(
          'block',
          `删除了此段${visible.length > 1 ? `（${visible.length} 行）` : ''}`,
          visible.map((d) => d.text).join('\n'),
          undefined,
          markLine(visible[0].text, 'del').anchor
        )
      )
    }
    return
  }
  if (dels.length === 0) {
    // 纯新增（分隔行原样输出，标记会破坏表格语法）
    const visible = adds.filter((a) => a.text !== '' && !isTableSepLine(a.text))
    // M16b：相邻「段落行」之间补空行，避免多行新增粘连成一段（Milkdown 单换行=hardbreak）
    let prevIsPara = false
    for (const a of visible) {
      // M14b：嵌入行原样输出（不包 {++..++}，否则 remark-ref 整段匹配失败 → 退化为文件链接）
      if (EMBED_RE.test(a.text)) {
        if (out.length && out[out.length - 1] !== '') out.push('')
        out.push(a.text)
        out.push('')
        prevIsPara = false
        continue
      }
      const isBlock = /^(\s*(?:[-+*]|\d+[.)])\s+|>\s|#{1,6}\s|\|)/.test(a.text)
      if (!isBlock && prevIsPara && out.length && out[out.length - 1] !== '') out.push('')
      out.push(markLine(a.text, 'add').text)
      prevIsPara = !isBlock
    }
    if (visible.length) {
      notes.push(
        makeNote(
          'block',
          `新增了此段${visible.length > 1 ? `（${visible.length} 行）` : ''}`,
          undefined,
          visible.map((a) => a.text).join('\n'),
          markLine(visible[0].text, 'add').anchor
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
    // M14b/M16：嵌入行变化——删除以缩略红行展示（1 行，非卡片）；新增原样卡片
    if (EMBED_RE.test(del.text) || EMBED_RE.test(add.text)) {
      if (EMBED_RE.test(del.text)) {
        const p = del.text.trim().replace(/^!\[\[|\]\]$/g, '')
        if (out.length && out[out.length - 1] !== '') out.push('')
        out.push(`{--移除引用：[[${p}]]--}`)
        out.push('')
        notes.push(makeNote('block', `移除了引用「${p}」`, del.text.trim(), undefined, `移除引用：[[${p}]]`))
      }
      if (add.text && EMBED_RE.test(add.text)) {
        if (out.length && out[out.length - 1] !== '') out.push('')
        out.push(add.text)
        out.push('')
        notes.push(makeNote('block', '新增了引用', undefined, add.text.trim(), add.text.trim()))
      }
      continue
    }
    const dw = del.words ?? []
    const aw = add.words ?? []
    // M16：行含 markdown 元字符时用字符级 LCS 多点标记（避免单段合并把 * ` [] 包进标记→强调纠缠乱码）
    if (MARKDOWN_META_RE.test(del.text) || MARKDOWN_META_RE.test(add.text)) {
      const segs = lcsSegments(del.text, add.text)
      if (!lcsHasMeaningfulCtx(segs)) {
        // 无共同内容（纯替换）→ 双行
        if (segs.some((s) => s.type === 'del' || s.type === 'add')) {
          pushReplacedPair(del, add, out, notes)
        } else {
          out.push(add.text)
        }
        continue
      }
      const { text, del: dWord, add: aWord } = segsToLine(segs)
      if (dWord || aWord) {
        out.push(text)
        const noteText =
          dWord && aWord ? `修改"${dWord}"为"${aWord}"` : aWord ? `新增"${aWord}"` : `删除"${dWord}"`
        notes.push(makeNote('word', noteText, dWord || undefined, aWord || undefined, dWord || aWord))
        continue
      }
      // 无标记差异（仅 ctx）→ 原样
      out.push(add.text)
      continue
    }
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
        notes.push(makeNote('word', noteText, r.del, r.add, r.del || r.add))
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
    // M16b：无共同内容（整行替换）→ 旧行红 / 新行绿 两行（替代旧版行内 {--旧--}{++新++}）
    pushReplacedPair(del, add, out, notes)
  }
  // 多余 del / add（段首/段尾行数不对称）——M16：也生成批注卡（此前这批行无卡）
  const extraDels = dels.slice(n).filter((d) => d.text && !isTableSepLine(d.text))
  const extraAdds = adds.slice(n).filter((a) => a.text && !isTableSepLine(a.text))
  for (const d of extraDels) out.push(markLine(d.text, 'del').text)
  for (const a of extraAdds) {
    if (EMBED_RE.test(a.text)) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      out.push(a.text)
      out.push('')
    } else {
      out.push(markLine(a.text, 'add').text)
    }
  }
  if (extraDels.length) {
    notes.push(
      makeNote(
        'block',
        `删除了此段${extraDels.length > 1 ? `（${extraDels.length} 行）` : ''}`,
        extraDels.map((d) => d.text).join('\n'),
        undefined,
        markLine(extraDels[0].text, 'del').anchor
      )
    )
  }
  if (extraAdds.length) {
    notes.push(
      makeNote(
        'block',
        `新增了此段${extraAdds.length > 1 ? `（${extraAdds.length} 行）` : ''}`,
        undefined,
        extraAdds.map((a) => a.text).join('\n'),
        EMBED_RE.test(extraAdds[0].text) ? extraAdds[0].text.trim() : markLine(extraAdds[0].text, 'add').anchor
      )
    )
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
    // M16b：二元语义——只报「新增 N / 删除 N」；mod（同 id 标签变化）并入删+增各 1
    if (d.type !== 'unknown' && (d.add.length || d.del.length || d.mod.length)) {
      const label =
        d.type === 'flowchart' ? '流程图' : d.type === 'sequence' ? '时序图' : d.type === 'state' ? '状态图' : '图表'
      const unit = d.type === 'sequence' ? '消息' : '节点'
      const addCount = d.add.length + d.mod.length
      const delCount = d.del.length + d.mod.length
      const parts: string[] = []
      if (addCount) parts.push(`新增 ${addCount} 个${unit}`)
      if (delCount) parts.push(`删除 ${delCount} 个`)
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
      // 嵌入引用需独立成段（remark-ref 整段匹配）→ 前后补空行（Milkdown 单换行=hardbreak）
      if (/^\s*!\[\[/.test(line.text)) {
        if (ctx.out.length >= 2 && ctx.out[ctx.out.length - 2] !== '') {
          // 前一行可能是被标记的段落行 → 在嵌入行前补空行（在后一行补空行保持对仗）
          ctx.out.splice(ctx.out.length - 1, 0, '')
        }
        ctx.out.push('')
      }
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
