// xxljob suggest：把「基本信息」表的属性（执行器/JobHandler/调度类型...）作为可引用对象。
// 用法：其他文档写「执行器：[[xxljob/notify-executor/下游机构通知#执行器]]」
//   resolve 出「值:notify-executor」
import type { SuggestContext, SuggestObject } from '@milkdown-note/suggest'

export function objectsFor(ctx: SuggestContext): SuggestObject[] {
  const rows = ctx.tableAfterHeading('## 基本信息')
  if (!rows || rows.length < 2) return []
  const header = rows[0]
  const cKey = header.findIndex((h) => /属性|项/.test(h))
  const cVal = header.findIndex((h) => /值/.test(h))
  if (cKey < 0 || cVal < 0) return []
  return rows
    .slice(1)
    .filter((r) => r[cKey]?.trim() && r[cVal]?.trim())
    .map((r) => {
      const name = r[cKey].trim()
      return {
        id: name,
        label: name,
        fragment: '基本信息',
        resolve(ctx2: SuggestContext): string | null {
          const rs = ctx2.tableAfterHeading('## 基本信息') ?? []
          const row = rs.find((x) => x[cKey]?.trim() === name)
          if (!row || !row[cVal]) return null
          return `值:${row[cVal]}`
        },
      }
    })
}
