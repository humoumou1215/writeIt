// 数据库表结构 suggest：动态对象生成器
// 从「表清单」读表名 → 每个表章节的字段表提取字段为可引用对象。
// 用法：在接口文档「数据来源」列写「[[数据库/loan/表结构#amount]]」
//   resolve 出「类型:decimal(18,2) 约束:非空 说明:放款金额（元）」
import type { SuggestContext, SuggestObject } from '@milkdown-note/suggest'

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function objectsFor(ctx: SuggestContext): SuggestObject[] {
  const list = ctx.tableAfterHeading('## 表清单')
  if (!list || list.length < 2) return []
  const cTable = list[0].findIndex((h) => /表名/.test(h))
  if (cTable < 0) return []
  const out: SuggestObject[] = []
  for (const r of list.slice(1)) {
    const t = r[cTable]?.trim()
    if (!t || /待补充/.test(t)) continue
    const rows = ctx.tableAfterHeading(new RegExp('^' + esc(t)))
    if (!rows || rows.length < 2) continue
    const h = rows[0]
    const cField = h.findIndex((x) => /字段/.test(x))
    const cType = h.findIndex((x) => /^类型$/.test(x))
    const cCons = h.findIndex((x) => /约束/.test(x))
    const cDesc = h.findIndex((x) => /^说明$/.test(x))
    if (cField < 0) continue
    for (const row of rows.slice(1)) {
      const name = row[cField]?.trim()
      if (!name || /^\{\{.*\}\}$/.test(name)) continue
      const type = cType >= 0 ? (row[cType] ?? '') : ''
      const cons = cCons >= 0 ? (row[cCons] ?? '') : ''
      const desc = cDesc >= 0 ? (row[cDesc] ?? '') : ''
      out.push({
        id: name,
        label: name,
        fragment: t,
        resolve(): string | null {
          const parts = [type && `类型:${type}`, cons && `约束:${cons}`, desc && `说明:${desc}`].filter(Boolean)
          return parts.length ? parts.join(' ') : null
        },
      })
    }
  }
  return out
}
