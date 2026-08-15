// 接口文档 suggest：动态对象生成器
// 从「接口详情」下字段说明表提取每个字段为可引用对象。
// 用法：在设计文档写「放款金额取自 [[接口文档/助贷/助贷接口#amount]]」
//   resolve 出「类型:bigint 高风险:是 来源:[[数据库/loan/表结构#amount]]」
import type { SuggestContext, SuggestObject } from '@milkdown-note/suggest'

export function objectsFor(ctx: SuggestContext): SuggestObject[] {
  const rows = ctx.tableAfterHeading('## 接口详情')
  if (!rows || rows.length < 2) return []
  const header = rows[0]
  const cField = header.findIndex((h) => /字段/.test(h))
  const cType = header.findIndex((h) => /^类型$/.test(h))
  const cRisk = header.findIndex((h) => /是否高风险/.test(h))
  const cSrc = header.findIndex((h) => /数据来源/.test(h))
  if (cField < 0) return []
  return rows
    .slice(1)
    .filter((r) => r[cField]?.trim() && !/^\{\{.*\}\}$/.test(r[cField].trim()))
    .map((r) => {
      const name = r[cField].trim()
      return {
        id: name,
        label: name,
        fragment: '接口详情',
        resolve(ctx: SuggestContext): string | null {
          const rs = ctx.tableAfterHeading('## 接口详情') ?? []
          const row = rs.find((x) => x[cField]?.trim() === name)
          if (!row) return null
          const parts = [
            cType >= 0 && row[cType] && `类型:${row[cType]}`,
            cRisk >= 0 && row[cRisk] && `高风险:${row[cRisk]}`,
            cSrc >= 0 && row[cSrc] && `来源:${row[cSrc]}`,
          ].filter(Boolean)
          return parts.length ? parts.join(' ') : null
        },
      }
    })
}
