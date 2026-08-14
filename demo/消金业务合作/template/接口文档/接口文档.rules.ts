// 接口文档校验规则（mode=hint，不阻止保存；违规写入 .validate/report.md）
// 规则 9「请求/响应示例字段一致性」依赖 ValidationContext.findCodeBlocks（M7 新增）
import type { ValidationContext, Rule } from '@milkdown-note/validate'

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
const HIGH_RISK_TYPES = ['金额', '本金', '利息', '罚息', '总额', '单位', '精度', '四舍五入', '还款方式', '期次', '业务状态', '响应结果判断', '发送前状态更新', '幂等', '防重', '征信']
/** 通用响应包装字段（非业务字段；规则 9 跳过其「出现未声明」检查） */
const WRAPPER_FIELDS = new Set(['code', 'msg', 'message', 'data', 'success', 'requestId', 'traceId', 'timestamp'])

/** 递归收集 JSON 对象所有 key（含嵌套/数组） */
function collectKeys(obj: unknown, out: Set<string>): void {
  if (!obj || typeof obj !== 'object') return
  if (Array.isArray(obj)) {
    for (const v of obj) collectKeys(v, out)
    return
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.add(k)
    collectKeys(v, out)
  }
}

/** 基本信息表「项」列匹配 key 的「值」列文本 */
function basicInfo(ctx: ValidationContext, key: string): string | null {
  const t = ctx.findTableAfterHeading('## 基本信息')
  if (!t) return null
  for (const row of t.rows()) {
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
      for (const h of ['## 基本信息', '## 接口详情', '## 变更记录']) {
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
    id: 'method-valid',
    label: '方法合法',
    run(ctx) {
      const m = basicInfo(ctx, '方法')
      if (m && !METHODS.includes(m.toUpperCase())) {
        ctx.violation(`方法「${m}」不在合法集合 {${METHODS.join(',')}}`, 'warning')
      }
    },
  },
  {
    id: 'path-format',
    label: '路径格式',
    run(ctx) {
      const p = basicInfo(ctx, '路径')
      if (p && !p.startsWith('/')) ctx.violation(`路径「${p}」应以 / 开头`, 'warning')
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
    id: 'critical-enum',
    label: '是否关键接口枚举',
    run(ctx) {
      const c = basicInfo(ctx, '是否关键接口')
      if (c && c !== '是' && c !== '否') ctx.violation('「是否关键接口」应为 是/否', 'warning')
    },
  },
  {
    id: 'field-spec-table',
    label: '字段说明表存在',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 接口详情')
      if (!t) { ctx.violation('「接口详情」下缺少字段说明表', 'error'); return }
      const h = t.headerRow()
      if (!h) { ctx.violation('字段说明表缺少表头', 'error'); return }
      const cols = h.cells().map((c) => c.text())
      if (!cols.some((c) => /字段/.test(c))) ctx.violation('字段说明表缺少「字段」列', 'error')
      if (!cols.some((c) => /是否高风险/.test(c))) ctx.violation('字段说明表缺少「是否高风险字段」列', 'error')
    },
  },
  {
    id: 'high-risk-source',
    label: '高风险字段必填数据来源',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 接口详情')
      if (!t) return
      const h = t.headerRow()
      if (!h) return
      const cols = h.cells().map((c) => c.text())
      const cField = cols.findIndex((c) => /字段/.test(c))
      const cRisk = cols.findIndex((c) => /是否高风险/.test(c))
      const cSrc = cols.findIndex((c) => /数据来源/.test(c))
      if (cRisk < 0 || cSrc < 0) return
      for (const row of t.dataRows()) {
        if (row.cell(cRisk).text().trim() !== '是') continue
        const src = row.cell(cSrc).text().trim()
        const field = cField >= 0 ? row.cell(cField).text().trim() : ''
        if (!src || src === '<br />' || /^\{\{.*\}\}$/.test(src)) {
          ctx.violation(`高风险字段「${field}」未填写数据来源`, 'warning')
        }
      }
    },
  },
  {
    id: 'req-resp-field-consistency',
    label: '请求/响应示例字段与字段说明一致',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 接口详情')
      if (!t) return
      const h = t.headerRow()
      if (!h) return
      const cols = h.cells().map((c) => c.text())
      const cField = cols.findIndex((c) => /字段/.test(c))
      if (cField < 0) return
      const declared = new Set<string>()
      for (const row of t.dataRows()) {
        const f = row.cell(cField).text().trim()
        if (f && !/^\{\{.*\}\}$/.test(f)) declared.add(f)
      }
      const blocks = ctx.findCodeBlocks(/^json$/i) ?? []
      const sample = new Set<string>()
      for (const b of blocks) {
        try { collectKeys(JSON.parse(b.content), sample) } catch { /* 非 JSON 跳过 */ }
      }
      if (sample.size === 0) return // 无可解析 JSON 示例则跳过
      for (const f of declared) {
        if (!sample.has(f)) ctx.violation(`字段「${f}」在字段说明中登记，但请求/响应示例中未出现`, 'warning')
      }
      for (const f of sample) {
        // 通用响应包装字段（code/msg/data 等）非业务字段，跳过「出现未声明」
        if (WRAPPER_FIELDS.has(f)) continue
        if (!declared.has(f)) ctx.violation(`字段「${f}」在请求/响应示例中出现，但字段说明中未登记`, 'warning')
      }
    },
  },
]
