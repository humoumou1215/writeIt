// SuggestContext 实现：把目标文件（已用编辑器 parser 解析的 doc）包装为
// suggest.ts 对象 resolve(ctx) 可用的结构查询上下文（设计文档 §4.2）
import type { Node } from '@milkdown/kit/prose/model'
import type { SuggestContext } from './types'

function cellText(node: Node): string {
  let text = ''
  node.descendants((n) => {
    if (n.isText && n.text) text += n.text
    else if (n.type.name === 'file_ref') {
      const a = n.attrs as { path?: string; fragment?: string | null }
      text += a.fragment ? `${a.path}#${a.fragment}` : (a.path ?? '')
    } else if (n.type.name === 'object_ref') {
      text += (n.attrs as { object?: string }).object ?? ''
    }
    return true
  })
  return text.trim()
}

export function createSuggestContext(doc: Node): SuggestContext {
  const paragraphs: string[] = []
  // 标题：级别 + 文本 + 位置（tableAfterHeading 定位标题后首个表用）
  const headings: Array<{ level: number; text: string; pos: number; end: number }> = []
  // 标题后紧跟的段落：headingIndex → 下一段文本
  const afterHeading: Array<{ level: number; heading: string; next: string | null }> = []
  // 任务列表项（- [ ] / - [x]）
  const tasks: Array<{ text: string; done: boolean }> = []
  // 表格：行单元格文本 + 位置（tableAfterHeading 取标题后首个表用）
  const tables: Array<{ rows: string[][]; pos: number }> = []

  let pendingHeading: { level: number; heading: string } | null = null
  doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph') {
      const t = node.textContent.trim()
      if (t) {
        paragraphs.push(t)
        if (pendingHeading) {
          afterHeading.push({ ...pendingHeading, next: t })
          pendingHeading = null
        }
      }
    } else if (node.type.name === 'heading') {
      const lvl = node.attrs.level as number
      const h = node.textContent.trim()
      headings.push({ level: lvl, text: h, pos, end: pos + node.nodeSize })
      if (h) pendingHeading = { level: lvl, heading: h }
      else pendingHeading = null
    } else if (node.type.name === 'list_item') {
      const text = node.textContent.trim()
      const checked = (node.attrs as { checked?: boolean }).checked
      if (checked !== undefined) {
        tasks.push({ text, done: Boolean(checked) })
      } else if (text.startsWith('[ ] ') || text.startsWith('[x] ') || text.startsWith('[X] ')) {
        tasks.push({ text: text.slice(4).trim(), done: text.startsWith('[x]') || text.startsWith('[X]') })
      }
    } else if (node.type.name === 'table') {
      const rows: string[][] = []
      node.descendants((c) => {
        if (c.type.name === 'table_header_row' || c.type.name === 'table_row') {
          const cells: string[] = []
          c.descendants((cc) => {
            if (cc.type.name === 'table_cell' || cc.type.name === 'table_header') {
              cells.push(cellText(cc))
            }
            return true
          })
          rows.push(cells)
        }
        return true
      })
      tables.push({ rows, pos })
    }
    return true
  })

  return {
    findText(re) {
      re.lastIndex = 0
      const hit = paragraphs.find((p) => re.test(p))
      return hit ? [hit] : null
    },
    headingText(level, re) {
      re.lastIndex = 0
      const hit = headings.find((h) => h.level === level && re.test(h.text))
      return hit?.text ?? null
    },
    paragraphAfterHeading(level, re) {
      re.lastIndex = 0
      const hit = afterHeading.find(
        (x) => x.level === level && re.test(x.heading) && x.next !== null
      )
      return hit?.next ?? null
    },
    taskCount(re) {
      const list = re ? tasks.filter((t) => re.test(t.text)) : tasks
      return list.length ? String(list.length) : null
    },
    taskProgress(re) {
      const list = re ? tasks.filter((t) => re.test(t.text)) : tasks
      if (!list.length) return null
      const done = list.filter((t) => t.done).length
      return `${done}/${list.length}`
    },
    firstTask(re) {
      const hit = tasks.find((t) => (re ? re.test(t.text) : true))
      return hit?.text ?? null
    },
    firstTableCell(rowIdx, colIdx, re) {
      const table = tables[0]
      const row = table?.rows?.[rowIdx]
      const cell = row?.[colIdx]
      if (cell === undefined) return null
      if (re) { re.lastIndex = 0; if (!re.test(cell)) return null }
      return cell
    },
    tableAfterHeading(heading) {
      const isRe = heading instanceof RegExp
      const norm = (s: string) => s.replace(/^#+\s*/, '').trim()
      const h = headings.find((x) => {
        const t = norm(x.text)
        if (isRe) { heading.lastIndex = 0; return heading.test(t) }
        return t === norm(String(heading))
      })
      if (!h) return null
      const t = tables.find((tb) => tb.pos >= h.end)
      return t?.rows ?? null
    },
    allText() {
      return paragraphs.join('\n')
    },
  }
}
