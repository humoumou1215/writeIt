// 数据库表结构校验规则（mode=hint，不阻止保存；违规写入 .validate/report.md）
// 「表清单 ↔ 字段表章节」一致性：表清单声明的每个表名必须有「## 表名」标题下的字段表
import type { ValidationContext, Rule } from '@milkdown-note/validate'

/** 表清单「表名」列集合 */
function tableNames(ctx: ValidationContext): string[] {
  const t = ctx.findTableAfterHeading('## 表清单')
  if (!t) return []
  const h = t.headerRow()
  if (!h) return []
  const cols = h.cells().map((c) => c.text())
  const cTable = cols.findIndex((c) => /表名/.test(c))
  if (cTable < 0) return []
  return t
    .dataRows()
    .map((r) => r.cell(cTable).text().trim())
    .filter((n) => n && !/待补充/.test(n))
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const mode = 'hint' as const
export const report = { enabled: true, path: '.validate/report.md' }

export const rules: Rule[] = [
  {
    id: 'sections-required',
    label: '必备章节齐全',
    run(ctx) {
      for (const h of ['## 基本信息', '## 表清单', '## 变更记录']) {
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
    },
  },
  {
    id: 'version-format',
    label: '版本号格式',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 基本信息')
      if (!t) return
      for (const row of t.dataRows()) {
        if (row.cell(0).text().trim() !== '版本号') continue
        const v = row.cell(1).text().trim()
        if (v && !/^v\d+\.\d+\.\d+$/.test(v)) ctx.violation(`版本号「${v}」应为 vX.Y.Z`, 'warning')
      }
    },
  },
  {
    id: 'table-list',
    label: '表清单存在且有表',
    run(ctx) {
      if (tableNames(ctx).length === 0) ctx.violation('表清单为空或缺少「表名」列', 'error')
    },
  },
  {
    id: 'table-field-consistency',
    label: '表清单与字段表章节一致',
    run(ctx) {
      for (const t of tableNames(ctx)) {
        const sec = ctx.findHeading(new RegExp('^' + esc(t)))
        if (!sec) {
          ctx.violation(`表「${t}」在表清单中声明，但缺少「## ${t}」字段表章节`, 'warning')
          continue
        }
        const ft = ctx.findTableAfterHeading(new RegExp('^' + esc(t)))
        if (!ft || ft.dataRows().length === 0) {
          ctx.violation(`表「${t}」缺少字段说明表或字段表为空`, 'warning')
        }
      }
    },
  },
  {
    id: 'field-table-cols',
    label: '字段表列齐全',
    run(ctx) {
      for (const t of tableNames(ctx)) {
        const ft = ctx.findTableAfterHeading(new RegExp('^' + esc(t)))
        if (!ft) continue
        const h = ft.headerRow()
        if (!h) continue
        const cols = h.cells().map((c) => c.text())
        if (!cols.some((c) => /字段/.test(c))) ctx.violation(`表「${t}」字段表缺少「字段」列`, 'error')
        if (!cols.some((c) => /^类型$/.test(c))) ctx.violation(`表「${t}」字段表缺少「类型」列`, 'error')
        if (!cols.some((c) => /约束/.test(c))) ctx.violation(`表「${t}」字段表缺少「约束」列`, 'warning')
        if (!cols.some((c) => /^说明$/.test(c))) ctx.violation(`表「${t}」字段表缺少「说明」列`, 'warning')
      }
    },
  },
  {
    id: 'field-name-format',
    label: '字段名格式',
    run(ctx) {
      for (const t of tableNames(ctx)) {
        const ft = ctx.findTableAfterHeading(new RegExp('^' + esc(t)))
        if (!ft) continue
        const h = ft.headerRow()
        if (!h) continue
        const cols = h.cells().map((c) => c.text())
        const cField = cols.findIndex((c) => /字段/.test(c))
        if (cField < 0) continue
        for (const row of ft.dataRows()) {
          const f = row.cell(cField).text().trim()
          if (!f || /^\{\{.*\}\}$/.test(f)) continue
          // 英文标识符或中文（无空格）；禁止空格/特殊字符（会破坏 wikilink 引用语法）
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f) && !/^[\u4e00-\u9fa5]+$/.test(f)) {
            ctx.violation(`字段「${f}」应为英文标识符或无空格中文（当前含空格/特殊字符，无法被 wikilink 引用）`, 'warning')
          }
        }
      }
    },
  },
  {
    id: 'pk-exists',
    label: '每表主键',
    run(ctx) {
      for (const t of tableNames(ctx)) {
        const ft = ctx.findTableAfterHeading(new RegExp('^' + esc(t)))
        if (!ft) continue
        const h = ft.headerRow()
        if (!h) continue
        const cols = h.cells().map((c) => c.text())
        const cCons = cols.findIndex((c) => /约束/.test(c))
        if (cCons < 0) continue
        const hasPk = ft.dataRows().some((r) => /PK/i.test(r.cell(cCons).text()))
        if (!hasPk) ctx.violation(`表「${t}」字段表缺少主键（约束列应含 PK）`, 'warning')
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
