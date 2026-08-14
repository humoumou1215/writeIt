// ValidationContext 实现（设计文档 §4.2 / §5）
// 把目标文件已解析的 ProseMirror doc 包装为 rules.ts 可用的结构查询上下文。
// 与 SuggestContext 同一思路（suggest-context.ts），但面向「校验」：
//   定位标题/表格/单元格 + 记录违规（violation / violationAt 带位置，供 decorations 标注）。
// 注意：file_block 的物化内容属于源文件，不参与宿主文档校验（§5.4）→ 遍历时跳过。
import type { Node } from '@milkdown/kit/prose/model'
import type {
  CodeBlock,
  TableCell,
  TableContext,
  TableRow,
  ValidationContext,
  Violation,
} from '../template/types'

interface HeadingInfo {
  level: number
  text: string
  pos: number
}

interface CellInfo {
  text: string
  pos: number
}

interface TableInfo {
  pos: number
  rows: CellInfo[][] // 每行 = 单元格数组（含表头行）
}

/** 遍历 doc 收集结构信息（跳过 file_block 物化内容） */
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

function collect(doc: Node): { headings: HeadingInfo[]; tables: TableInfo[]; paragraphs: string[]; codeBlocks: CodeBlock[] } {
  const headings: HeadingInfo[] = []
  const tables: TableInfo[] = []
  const paragraphs: string[] = []
  const codeBlocks: CodeBlock[] = []
  doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === 'file_block') return false // §5.4：嵌入内容不参与宿主校验
    if (name === 'code_block' || name === 'fence') {
      codeBlocks.push({
        content: node.textContent,
        language: ((node.attrs as { language?: string }).language ?? '').trim(),
        pos,
      })
      return false
    }
    if (name === 'heading') {
      const text = node.textContent.trim()
      if (text) headings.push({ level: node.attrs.level as number, text, pos })
    } else if (name === 'paragraph') {
      const t = node.textContent.trim()
      if (t) paragraphs.push(t)
    } else if (name === 'table') {
      const rows: CellInfo[][] = []
      node.forEach((row, rowOff) => {
        const cells: CellInfo[] = []
        row.forEach((cell, cellOff) => {
          cells.push({
            text: cellText(cell),
            // 绝对位置 = table.pos + 1（table 内容起点）+ rowOff + 1（row 内容起点）+ cellOff
            pos: pos + 2 + rowOff + cellOff,
          })
        })
        if (cells.length) rows.push(cells)
      })
      tables.push({ pos, rows })
    }
    return true
  })
  return { headings, tables, paragraphs, codeBlocks }
}

function matchText(pat: string | RegExp, text: string): boolean {
  if (pat instanceof RegExp) {
    pat.lastIndex = 0
    return pat.test(text)
  }
  // 支持「## 需求」前缀：剥掉 # 再比较
  const norm = pat.replace(/^#+\s*/, '').trim()
  return text === norm
}

export function createValidationContext(doc: Node): ValidationContext & { violations: Violation[] } {
  const { headings, tables, paragraphs, codeBlocks } = collect(doc)
  const violations: Violation[] = []
  let currentRuleId = ''
  let currentLabel = ''

  const findTableAfterHeading = (heading: string | RegExp): TableContext | null => {
    const h = headings.find((x) => matchText(heading, x.text))
    if (!h) return null
    // 标题之后（pos 大于标题结束）的第一个表格
    const after = tables.find((t) => t.pos > h.pos + h.text.length)
    if (!after) return null
    const mkCell = (c: CellInfo): TableCell => ({
      text: () => c.text,
      pos: c.pos,
    })
    const mkRow = (cells: CellInfo[], rowPos: number): TableRow => ({
      cell: (i: number) => mkCell(cells[i] ?? { text: '', pos: rowPos }),
      cells: () => cells.map(mkCell),
      pos: rowPos,
    })
    const rows = after.rows.map((cells) => mkRow(cells, after.pos + 1))
    return {
      headerRow: () => rows[0] ?? null,
      rows: () => rows,
      dataRows: () => rows.slice(1),
      cell: (r, c) => {
        const row = rows[r]
        if (!row) return null
        const cell = row.cells()[c]
        return cell ?? null
      },
      pos: after.pos,
    }
  }

  const findHeading = (heading: string | RegExp) => {
    const h = headings.find((x) => matchText(heading, x.text))
    return h ? { level: h.level, text: h.text, pos: h.pos } : null
  }

  const findText = (re: RegExp) => {
    re.lastIndex = 0
    const p = paragraphs.find((t) => re.test(t))
    return p ?? null
  }

  const allText = () => paragraphs.join('\n')

  const findCodeBlocks = (languageRe?: RegExp): CodeBlock[] | null => {
    if (languageRe) languageRe.lastIndex = 0
    const list = languageRe ? codeBlocks.filter((b) => languageRe.test(b.language)) : codeBlocks
    return list.length ? list : null
  }

  const violation = (message: string, level: 'warning' | 'error' = 'warning') => {
    violations.push({ ruleId: currentRuleId, label: currentLabel, message, level, pos: null })
  }

  const violationAt = (pos: number, message: string, level: 'warning' | 'error' = 'warning') => {
    if (pos < 0 || pos > doc.content.size) return
    violations.push({ ruleId: currentRuleId, label: currentLabel, message, level, pos })
  }

  return {
    findTableAfterHeading,
    findHeading,
    findText,
    allText,
    findCodeBlocks,
    violation,
    violationAt,
    violations,
    /** 执行规则前由 service 注入当前规则身份 */
    setRule: (id: string, label: string) => {
      currentRuleId = id
      currentLabel = label
    },
  }
}
