// 接口文档模板的导出定义（M10 导出机制）
// 导出「对外版本」：提供给其他系统人员联调查看，过滤内部信息：
//   - 基本信息表仅保留对外行（方法/路径/版本号/业务范围/会调用该系统），
//     删除内部评估行（是否关键接口/并发量/幂等规则/防重复机制/交易状态判断/外部接口引用）
//   - 字段说明表仅保留列（字段/类型/长度/说明），删除内部列（是否高风险字段/高风险字段类型/数据来源）
//   - 删除「变更记录」章节
// 请求示例 / 响应示例保留。
import type { ExportContext, ExportResult } from '@milkdown-note/export'

/** 默认导出格式（「自动」模式） */
export const format: 'pdf' | 'docx' | 'md' = 'pdf'

/** 默认导出文件名（不含扩展名） */
export const filename: string = '接口文档-对外'

/** 基本信息表中对外保留的项 */
const KEEP_BASIC = ['方法', '路径', '版本号', '该接口涉及的业务范围', '会调用该接口的系统']

/** 字段说明表对外保留的列 */
const KEEP_FIELD_COLS = ['字段', '类型', '长度', '说明']

/** 可选：自定义导出内容（对外版本过滤） */
export const build = (ctx: ExportContext): ExportResult | null => {
  const lines = ctx.content.split('\n')
  const out: string[] = []
  let inBasic = false
  let inFieldTable = false
  let inChangeLog = false
  let keepIdx: number[] = []

  for (const raw of lines) {
    const t = raw.trim()

    // 变更记录章节：直接跳过（文档末节，之后所有行）
    if (/^## 变更记录/.test(t)) {
      inChangeLog = true
      continue
    }
    if (inChangeLog) continue

    // ---- 基本信息表：仅保留对外行，且只留「项 | 值」两列（去掉备注） ----
    if (t.startsWith('| 项 | 值 | 备注')) {
      inBasic = true
      out.push('| 项 | 值 |')
      continue
    }
    if (inBasic) {
      if (t.startsWith('| ---')) {
        out.push('| --- | --- |')
        continue
      }
      if (!t.startsWith('|')) {
        inBasic = false
      } else {
        const cells = t.split('|').slice(1, -1).map((c) => c.trim())
        const item = cells[0] ?? ''
        if (KEEP_BASIC.includes(item)) out.push(`| ${cells[0]} | ${cells[1] ?? ''} |`)
        continue
      }
    }

    // ---- 字段说明表：仅保留列（字段/类型/长度/说明） ----
    if (t.startsWith('| 字段 | 类型 | 长度')) {
      inFieldTable = true
      const header = t.split('|').slice(1, -1).map((c) => c.trim())
      keepIdx = header
        .map((h, i) => (KEEP_FIELD_COLS.includes(h) ? i : -1))
        .filter((i) => i >= 0)
      out.push(`| ${keepIdx.map((i) => header[i]).join(' | ')} |`)
      continue
    }
    if (inFieldTable) {
      if (t.startsWith('| ---')) {
        const sep = t.split('|').slice(1, -1)
        out.push(`| ${keepIdx.map((i) => sep[i] ?? '---').join(' | ')} |`)
        continue
      }
      if (!t.startsWith('|')) {
        inFieldTable = false
      } else {
        const cells = t.split('|').slice(1, -1).map((c) => c.trim())
        out.push(`| ${keepIdx.map((i) => cells[i] ?? '').join(' | ')} |`)
        continue
      }
    }

    out.push(raw)
  }
  return { content: out.join('\n') }
}
