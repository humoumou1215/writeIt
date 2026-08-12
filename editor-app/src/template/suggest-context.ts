// SuggestContext 实现：把目标文件（已用编辑器 parser 解析的 doc）包装为
// suggest.ts 对象 resolve(ctx) 可用的结构查询上下文（设计文档 §4.2）
import type { Node } from '@milkdown/kit/prose/model'
import type { SuggestContext } from './types'

export function createSuggestContext(doc: Node): SuggestContext {
  const paragraphs: string[] = []
  const headings: Record<number, string[]> = {}
  // 标题后紧跟的段落：headingIndex → 下一段文本
  const afterHeading: Array<{ level: number; heading: string; next: string | null }> = []
  // 任务列表项（- [ ] / - [x]）
  const tasks: Array<{ text: string; done: boolean }> = []
  // 表格（首个表格的每行单元格文本）
  const tables: string[][][] = []

  let pendingHeading: { level: number; heading: string } | null = null
  doc.descendants((node) => {
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
      ;(headings[lvl] ??= []).push(h)
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
        if (c.type.name === 'table_row') {
          const cells: string[] = []
          c.descendants((cc) => {
            if (cc.type.name === 'table_cell' || cc.type.name === 'table_header_cell') {
              cells.push(cc.textContent.trim())
            }
            return true
          })
          rows.push(cells)
        }
        return true
      })
      tables.push(rows)
    }
    return true
  })

  return {
    findText(re) {
      const hit = paragraphs.find((p) => re.test(p))
      return hit ? [hit] : null
    },
    headingText(level, re) {
      const list = headings[level] ?? []
      const hit = list.find((h) => re.test(h))
      return hit ?? null
    },
    paragraphAfterHeading(level, re) {
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
      const row = table?.[rowIdx]
      const cell = row?.[colIdx]
      if (cell === undefined) return null
      if (re && !re.test(cell)) return null
      return cell
    },
    allText() {
      return paragraphs.join('\n')
    },
  }
}
