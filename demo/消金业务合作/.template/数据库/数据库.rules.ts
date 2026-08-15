// 数据库表结构校验规则（mode=hint，不阻止保存；违规写入 .validate/report.md）
// 1 个 .md 文件 = 1 张表：基本信息（表名/中文名/schema/版本号）+ 字段说明表 + 索引 + 变更记录
import type { ValidationContext, Rule } from '@milkdown-note/validate'

function basicInfo(ctx: ValidationContext, key: string): string | null {
  const t = ctx.findTableAfterHeading('## 基本信息')
  if (!t) return null
  for (const row of t.dataRows()) {
    if (row.cell(0).text().trim() === key) return row.cell(1).text().trim()
  }
  return null
}

export const mode = 'hint' as const
export const report = { enabled: true, path: '.validate/report.md' }

export const rules: Rule[] = [
  {
    id: 'sections-required',
    label: '必备章节齐全',
    run(ctx) {
      for (const h of ['## 基本信息', '## 字段说明', '## 变更记录']) {
        if (!ctx.findHeading(h)) ctx.violation(`缺少必备章节「${h}」`, 'error')
      }
    },
  },
  {
    id: 'basic-info-table',
    label: '基本信息表存在',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 基本信息')
      if (!t) { ctx.violation('缺少「基本信息」表格', 'error'); return }
      const h = t.headerRow()
      if (!h || !/项/.test(h.cell(0).text()) || !/值/.test(h.cell(1).text())) {
        ctx.violation('基本信息表表头应为「项 | 值 | 备注」', 'error')
      }
      for (const key of ['表名', '中文名', 'schema', '版本号']) {
        if (!basicInfo(ctx, key)) ctx.violation(`基本信息缺少「${key}」`, 'warning')
      }
    },
  },
  {
    id: 'table-name-format',
    label: '表名格式',
    run(ctx) {
      const t = basicInfo(ctx, '表名')
      if (t && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t)) {
        ctx.violation(`表名「${t}」应为英文标识符（无空格/特殊字符）`, 'warning')
      }
    },
  },
  {
    id: 'version-format',
    label: '版本号格式',
    run(ctx) {
      const v = basicInfo(ctx, '版本号')
      if (v && !/^v\d+\.\d+\.\d+$/.test(v)) ctx.violation(`版本号「${v}」应为 vX.Y.Z`, 'warning')
    },
  },
  {
    id: 'field-table',
    label: '字段说明表存在',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 字段说明')
      if (!t) { ctx.violation('「字段说明」下缺少字段表', 'error'); return }
      if (t.dataRows().length === 0) { ctx.violation('字段说明表为空', 'error'); return }
      const h = t.headerRow()
      if (!h) { ctx.violation('字段说明表缺少表头', 'error'); return }
      const cols = h.cells().map((c) => c.text())
      if (!cols.some((c) => /字段/.test(c))) ctx.violation('字段说明表缺少「字段」列', 'error')
      if (!cols.some((c) => /^类型$/.test(c))) ctx.violation('字段说明表缺少「类型」列', 'error')
      if (!cols.some((c) => /约束/.test(c))) ctx.violation('字段说明表缺少「约束」列', 'warning')
      if (!cols.some((c) => /^说明$/.test(c))) ctx.violation('字段说明表缺少「说明」列', 'warning')
    },
  },
  {
    id: 'field-name-format',
    label: '字段名格式',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 字段说明')
      if (!t) return
      const h = t.headerRow()
      if (!h) return
      const cols = h.cells().map((c) => c.text())
      const cField = cols.findIndex((c) => /字段/.test(c))
      if (cField < 0) return
      for (const row of t.dataRows()) {
        const f = row.cell(cField).text().trim()
        if (!f || /^\{\{.*\}\}$/.test(f)) continue
        // 英文标识符或中文（无空格）；禁止空格/特殊字符（会破坏 wikilink 引用语法）
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f) && !/^[\u4e00-\u9fa5]+$/.test(f)) {
          ctx.violation(`字段「${f}」应为英文标识符或无空格中文（当前含空格/特殊字符，无法被 wikilink 引用）`, 'warning')
        }
      }
    },
  },
  {
    id: 'pk-exists',
    label: '主键',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 字段说明')
      if (!t) return
      const h = t.headerRow()
      if (!h) return
      const cols = h.cells().map((c) => c.text())
      const cCons = cols.findIndex((c) => /约束/.test(c))
      if (cCons < 0) return
      if (!t.dataRows().some((r) => /PK/i.test(r.cell(cCons).text()))) {
        ctx.violation('字段表缺少主键（约束列应含 PK）', 'warning')
      }
    },
  },
  {
    id: 'change-log',
    label: '变更记录非空',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 变更记录')
      if (!t) { ctx.violation('缺少「变更记录」表格', 'warning'); return }
      if (t.dataRows().length === 0) ctx.violation('变更记录为空', 'warning')
    },
  },
]
