// 表格增强插件——多选单元格复制/粘贴
// 现状：prosemirror-tables 已支持多选（Shift+方向键 → CellSelection），但内置剪贴板对 CellSelection 的复制
// 是「包装 DOM 选区」的杂乱格式 → 粘贴后错乱。
// 修复关键：prosemirror 内置剪贴板在「冒泡阶段」处理 copy/cut/paste；若它在我的 handleDOMEvents 之前**先返回
// true**，我的处理就不会执行。因此本插件改用**捕获阶段（capture）的 DOM 监听**，确保 CellSelection 的复制被
// 我优先接管，再 preventDefault + stopPropagation 阻止内置处理。
//   copy/cut（CellSelection）→ 序列化为「规范 HTML <table>」+「TSV（行=\n 列=\t，格内换行=\\n 转义）」
//   paste             → 纯文本 TSV（外部来源）→ 解析成表格插入；其余交回 prosemirror 处理
import { $prose } from '@milkdown/kit/utils'
import type { EditorView } from '@milkdown/kit/prose/view'
import { DOMParser } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { CellSelection, handlePaste, isInTable, selectedRect } from '@milkdown/kit/prose/tables'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 单元格 → 文本行数组（递归识别段落内部的 hardbreak） */
function cellLines(cell: { content: { forEach: (fn: (n: NodeLike) => void) => void } }): string[] {
  const lines: string[] = []
  let cur = ''
  const visit = (node: NodeLike) => {
    if (node.isText) cur += node.text ?? ''
    else if (node.type?.name === 'hardbreak') {
      lines.push(cur)
      cur = ''
    } else if (node.content) node.content.forEach(visit)
    else cur += node.textContent ?? ''
  }
  cell.content.forEach(visit)
  lines.push(cur)
  return lines
}

interface NodeLike {
  isText?: boolean
  text?: string
  textContent?: string
  type?: { name: string }
  content?: { forEach: (fn: (n: NodeLike) => void) => void }
}

/** 单元格 → TSV 字段（保留真实换行，按 Excel 约定转义） */
function cellToText(cell: { attrs?: unknown; content: { forEach: (fn: (n: NodeLike) => void) => void } }): string {
  const lines = cellLines(cell)
  return lines.join('\n')
}

/** 单元格 → HTML（换行用 <br>，保留对齐） */
function cellToHtml(cell: { attrs: { alignment?: string }; content: { forEach: (fn: never) => void } }): string {
  const align = cell.attrs.alignment
  const alignStyle = align && align !== 'left' ? ` style="text-align:${align}"` : ''
  const body = cellLines(cell).map(escapeHtml).join('<br>')
  return `<td${alignStyle}>${body}</td>`
}

function escapeTsvField(value: string): string {
  const escaped = value.replace(/"/g, '""')
  return /[\t\r\n"]/.test(value) ? `"${escaped}"` : escaped
}

/** 清洗 Excel/WPS HTML，只保留表格语义和少量可安全解析的行内标签。 */
function cleanExcelTable(source: HTMLTableElement): HTMLTableElement {
  const out = document.createElement('table')
  const body = document.createElement('tbody')
  const grid: Array<Array<{ html: string; occupied: boolean } | null>> = []
  const allowed = new Set(['BR', 'A', 'B', 'STRONG', 'I', 'EM', 'CODE', 'SPAN'])
  const cleanCell = (cell: HTMLTableCellElement): string => {
    const clone = cell.cloneNode(true) as HTMLElement
    clone.querySelectorAll('*').forEach((el) => {
      if (!allowed.has(el.tagName)) {
        el.replaceWith(document.createTextNode(el.textContent || ''))
        return
      }
      for (const attr of [...el.attributes]) {
        if (el.tagName !== 'A' || attr.name !== 'href') el.removeAttribute(attr.name)
      }
    })
    return clone.innerHTML || escapeHtml(cell.textContent || '')
  }
  const rows = [...source.querySelectorAll('tr')]
  rows.forEach((row, ri) => {
    if (!grid[ri]) grid[ri] = []
    let ci = 0
    for (const cell of [...row.cells]) {
      while (grid[ri][ci]) ci++
      const rs = Math.max(1, Number(cell.getAttribute('rowspan')) || 1)
      const cs = Math.max(1, Number(cell.getAttribute('colspan')) || 1)
      const html = cleanCell(cell)
      for (let y = 0; y < rs; y++) {
        if (!grid[ri + y]) grid[ri + y] = []
        for (let x = 0; x < cs; x++) {
          grid[ri + y][ci + x] = { html: y === 0 && x === 0 ? html : '', occupied: true }
        }
      }
      ci += cs
    }
  })
  for (const row of grid) {
    const tr = document.createElement('tr')
    for (const cell of row || []) {
      const td = document.createElement('td')
      td.innerHTML = cell?.html || ''
      tr.appendChild(td)
    }
    if (tr.cells.length) body.appendChild(tr)
  }
  out.appendChild(body)
  return out
}

/** 把当前多选单元格矩形序列化为 HTML <table> 字符串 */
export function cellSelectionToHtml(state: { selection: CellSelection }): string | null {
  const sel = state.selection
  if (!(sel instanceof CellSelection)) return null
  const rect = selectedRect(state as never)
  const { table, map, left, right, top, bottom } = rect
  const rows: string[] = ['<table><tbody>']
  for (let r = top; r < bottom; r++) {
    const cells: string[] = []
    for (let c = left; c < right; c++) {
      const cell = table.nodeAt(map.map[r * map.width + c])
      cells.push(cell ? cellToHtml(cell as never) : '<td></td>')
    }
    rows.push(`<tr>${cells.join('')}</tr>`)
  }
  rows.push('</tbody></table>')
  return rows.join('')
}

/** 把当前多选单元格矩形序列化为 TSV 文本 */
export function cellSelectionToTsv(state: { selection: CellSelection }): string | null {
  const sel = state.selection
  if (!(sel instanceof CellSelection)) return null
  const rect = selectedRect(state as never)
  const { table, map, left, right, top, bottom } = rect
  const lines: string[] = []
  for (let r = top; r < bottom; r++) {
    const cells: string[] = []
    for (let c = left; c < right; c++) {
      const cell = table.nodeAt(map.map[r * map.width + c])
      cells.push(cell ? escapeTsvField(cellToText(cell as never)) : '')
    }
    lines.push(cells.join('\t'))
  }
  return lines.join('\n')
}

/** 判定纯文本是否像一张表格（含制表符分隔的多列） */
function looksLikeTable(text: string): boolean {
  return text.includes('\t')
}

/** 解析 Excel/Sheets 的 TSV：支持 CRLF、双引号和单元格内换行。 */
function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field.length === 0) quoted = true
    else if (ch === '\t') { row.push(field); field = '' }
    else if (ch === '\r' || ch === '\n') {
      row.push(field); field = ''
      if (ch === '\r' && text[i + 1] === '\n') i++
      rows.push(row); row = []
    } else field += ch
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  while (rows.length && rows[rows.length - 1].every((v) => v === '')) rows.pop()
  return rows
}

/** TSV 矩阵 →干净的 table HTML（避免把 table 嵌套进 table）。 */
function tsvToHtmlTable(text: string): string {
  const parts: string[] = ['<tbody>']
  for (const row of parseTsv(text)) {
    parts.push(`<tr>${row.map((c) => `<td>${escapeHtml(c) .replace(/\n/g, '<br>')}</td>`).join('')}</tr>`)
  }
  parts.push('</tbody>')
  return parts.join('')
}

/** 剪下：清空选中各单元格内容（保留表格结构） */
function cutCells(view: EditorView): void {
  const { selection } = view.state
  if (!(selection instanceof CellSelection)) return
  const rect = selectedRect(view.state)
  const { table, map, left, right, top, bottom } = rect
  const tr = view.state.tr
  const emptyPara = view.state.schema.nodes.paragraph.create()
  for (let r = top; r < bottom; r++) {
    for (let c = left; c < right; c++) {
      const pos = rect.tableStart + map.map[r * map.width + c]
      const cell = table.nodeAt(map.map[r * map.width + c])
      if (!cell) continue
      tr.replaceWith(pos + 1, pos + cell.nodeSize - 1, emptyPara)
    }
  }
  view.dispatch(tr)
}

export const tableClipboardPlugin = $prose(() => {
  const key = new PluginKey('WRITEIT_TABLE_CLIPBOARD')
  return new Plugin({
    key,
    view(view: EditorView) {
      const dom = view.dom as HTMLElement
      // ---- copy / cut：捕获阶段，优先处理 CellSelection ----
      const onCopy = (e: Event) => {
        if (!(view.state.selection instanceof CellSelection)) return
        const ce = e as ClipboardEvent
        if (ce.clipboardData) {
          const tsv = cellSelectionToTsv(view.state)
          const html = cellSelectionToHtml(view.state)
          if (tsv) ce.clipboardData.setData('text/plain', tsv)
          if (html) ce.clipboardData.setData('text/html', html)
        }
        e.preventDefault()
        e.stopPropagation()
      }
      const onCut = (e: Event) => {
        if (!(view.state.selection instanceof CellSelection)) return
        const ce = e as ClipboardEvent
        if (ce.clipboardData) {
          const tsv = cellSelectionToTsv(view.state)
          const html = cellSelectionToHtml(view.state)
          if (tsv) ce.clipboardData.setData('text/plain', tsv)
          if (html) ce.clipboardData.setData('text/html', html)
        }
        cutCells(view)
        e.preventDefault()
        e.stopPropagation()
      }
      // ---- paste：TSV 表格文本 → 解析插入；其余留默认 ----
      const onPaste = (e: Event) => {
        const ce = e as ClipboardEvent
        // 优先用剪贴板里的 HTML `<table>` 重建切片，否则回退纯文本 TSV
        const html = ce.clipboardData?.getData('text/html') || ''
        const text = ce.clipboardData?.getData('text/plain') || ''
        let slice = null
        if (html && /<table/i.test(html)) {
          const wrap = document.createElement('div')
          wrap.innerHTML = html
          const tbl = wrap.querySelector('table')
          if (tbl) {
            slice = DOMParser.fromSchema(view.state.schema).parseSlice(cleanExcelTable(tbl), {
              preserveWhitespace: true,
            })
          }
        } else if (looksLikeTable(text)) {
          const dom2 = document.createElement('table')
          dom2.innerHTML = tsvToHtmlTable(text)
          slice = DOMParser.fromSchema(view.state.schema).parseSlice(dom2, {
            preserveWhitespace: true,
          })
        }
        if (!slice) return
        // 表格内：显式用 prosemirror-tables 的 handlePaste → 按格填充（防止默认整表/嵌套粘贴搅乱结构）
        if (isInTable(view.state)) {
          if (handlePaste(view, ce, slice)) {
            e.preventDefault()
            e.stopPropagation()
          }
        } else {
          // 表格外：插入一张新表格
          const tableNode = slice.content.firstChild
          if (tableNode && tableNode.type.name === 'table') {
            view.dispatch(view.state.tr.replaceSelectionWith(tableNode).scrollIntoView())
            e.preventDefault()
            e.stopPropagation()
          }
        }
      }
      dom.addEventListener('copy', onCopy, true)
      dom.addEventListener('cut', onCut, true)
      dom.addEventListener('paste', onPaste, true)
      // 调试钩子：暴露当前 CellSelection 的序列化结果（供 e2e 断言复制内容）
      ;(window as unknown as { __cellSelectionCopy?: unknown }).__cellSelectionCopy = () => {
        if (!(view.state.selection instanceof CellSelection)) return null
        return { tsv: cellSelectionToTsv(view.state), html: cellSelectionToHtml(view.state) }
      }
      return {
        destroy() {
          dom.removeEventListener('copy', onCopy, true)
          dom.removeEventListener('cut', onCut, true)
          dom.removeEventListener('paste', onPaste, true)
          delete (window as unknown as { __cellSelectionCopy?: unknown }).__cellSelectionCopy
        },
      }
    },
  })
})
