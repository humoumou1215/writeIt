// 数据库表结构 suggest：动态对象生成器
// 1 个 .md 文件 = 1 张表：直接从「字段说明」表提取字段为可引用对象。
// 用法：在接口文档「数据来源」列写「[[数据库/loan/loan_apply#amount]]」
//   resolve 出「类型:decimal(18,2) 约束:非空 说明:放款金额（元）」
import type { SuggestContext, SuggestObject } from '@milkdown-note/suggest'

export function objectsFor(ctx: SuggestContext): SuggestObject[] {
  const rows = ctx.tableAfterHeading('## 字段说明')
  if (!rows || rows.length < 2) return []
  const h = rows[0]
  const cField = h.findIndex((x) => /字段/.test(x))
  const cType = h.findIndex((x) => /^类型$/.test(x))
  const cCons = h.findIndex((x) => /约束/.test(x))
  const cDesc = h.findIndex((x) => /^说明$/.test(x))
  if (cField < 0) return []
  // 表名（基本信息表「表名」行）作 fragment，便于定位
  const bi = ctx.tableAfterHeading('## 基本信息') ?? []
  const tRow = bi.slice(1).find((r) => r[0]?.trim() === '表名')
  const tableName = tRow?.[1]?.trim() ?? ''
  return rows
    .slice(1)
    .filter((r) => r[cField]?.trim() && !/^\{\{.*\}\}$/.test(r[cField].trim()))
    .map((r) => {
      const name = r[cField].trim()
      const type = cType >= 0 ? (r[cType] ?? '') : ''
      const cons = cCons >= 0 ? (r[cCons] ?? '') : ''
      const desc = cDesc >= 0 ? (r[cDesc] ?? '') : ''
      return {
        id: name,
        label: name,
        fragment: tableName || '字段说明',
        resolve(): string | null {
          const parts = [type && `类型:${type}`, cons && `约束:${cons}`, desc && `说明:${desc}`].filter(Boolean)
          return parts.length ? parts.join(' ') : null
        },
      }
    })
}
