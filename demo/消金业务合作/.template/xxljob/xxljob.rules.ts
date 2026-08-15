// xxljob 校验规则：一个 md 文件 = 一个 xxljob 任务（mode=hint，不阻止保存）
// 校验：基本信息表 / 执行器 / JobHandler / 调度类型 / cron / 路由策略 / 阻塞策略 / 任务职责 / 变更记录
import type { Rule, ValidationContext } from '@milkdown-note/validate'

const SCHEDULE_TYPES = ['cron', '固定速度', '固定延迟']
const ROUTE_STRATEGIES = ['第一个', '最后一个', '轮询', '随机', '一致性HASH', '最不经常使用', '最近最久未使用', '故障转移', '忙碌转移', '分片广播']
const BLOCK_STRATEGIES = ['单机串行', '丢弃后续调度', '覆盖之前调度']
const STATUS = ['启动', '停止']

/** 从「## 基本信息」表按「属性」名取值（列名支持 属性/项 + 值） */
function basicInfo(ctx: ValidationContext, label: string): string | null {
  const t = ctx.findTableAfterHeading('## 基本信息')
  if (!t) return null
  const h = t.headerRow()
  if (!h) return null
  const cols = h.cells().map((c) => c.text())
  const cKey = cols.findIndex((c) => /属性|项/.test(c))
  const cVal = cols.findIndex((c) => /值/.test(c))
  if (cKey < 0 || cVal < 0) return null
  for (const row of t.dataRows()) {
    if (row.cell(cKey).text().trim() === label) {
      const v = row.cell(cVal).text().trim()
      return v || null
    }
  }
  return null
}

export const rules: Rule[] = [
  {
    id: 'basic-table',
    label: '基本信息表存在',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 基本信息')
      if (!t) ctx.violation('缺少「基本信息」表格', 'error')
    },
  },
  {
    id: 'basic-headers',
    label: '基本信息表头为「属性 | 值」',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 基本信息')
      if (!t) return
      const h = t.headerRow()
      if (!h) ctx.violation('基本信息表缺少表头行', 'error')
      else {
        const cols = h.cells().map((c) => c.text())
        if (!cols.some((c) => /属性|项/.test(c)) || !cols.some((c) => /值/.test(c)))
          ctx.violation('基本信息表头应包含「属性」和「值」列', 'error')
      }
    },
  },
  {
    id: 'executor-required',
    label: '执行器必填',
    run(ctx) {
      const v = basicInfo(ctx, '执行器')
      if (!v) ctx.violation('「执行器」未填写', 'error')
    },
  },
  {
    id: 'handler-format',
    label: 'JobHandler 必填且为标识符',
    run(ctx) {
      const v = basicInfo(ctx, 'JobHandler')
      if (!v) ctx.violation('「JobHandler」未填写', 'warning')
      else if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(v)) ctx.violation(`JobHandler「${v}」应为字母开头标识符（如 notifyHandler）`, 'warning')
    },
  },
  {
    id: 'schedule-type',
    label: '调度类型枚举',
    run(ctx) {
      const v = basicInfo(ctx, '调度类型')
      if (v && !SCHEDULE_TYPES.includes(v)) ctx.violation(`调度类型「${v}」应为 ${SCHEDULE_TYPES.join('/')}`, 'warning')
    },
  },
  {
    id: 'cron-format',
    label: 'cron 表达式格式',
    run(ctx) {
      const cron = basicInfo(ctx, 'cron 表达式')
      if (!cron) return
      const fields = cron.trim().split(/\s+/)
      if (fields.length < 6 || fields.length > 7) ctx.violation(`cron「${cron}」应为「秒 分 时 日 月 周」6-7 段`, 'warning')
    },
  },
  {
    id: 'route-strategy',
    label: '路由策略枚举',
    run(ctx) {
      const v = basicInfo(ctx, '路由策略')
      if (v && !ROUTE_STRATEGIES.includes(v)) ctx.violation(`路由策略「${v}」不在枚举内（${ROUTE_STRATEGIES.join('/')}）`, 'warning')
    },
  },
  {
    id: 'block-strategy',
    label: '阻塞处理策略枚举',
    run(ctx) {
      const v = basicInfo(ctx, '阻塞处理策略')
      if (v && !BLOCK_STRATEGIES.includes(v)) ctx.violation(`阻塞处理策略「${v}」应为 ${BLOCK_STRATEGIES.join('/')}`, 'warning')
    },
  },
  {
    id: 'status-enum',
    label: '调度状态枚举',
    run(ctx) {
      const v = basicInfo(ctx, '调度状态')
      if (v && !STATUS.includes(v)) ctx.violation(`调度状态「${v}」应为 启动/停止`, 'warning')
    },
  },
  {
    id: 'duty-section',
    label: '任务职责章节存在',
    run(ctx) {
      if (!ctx.findHeading('## 任务职责')) ctx.violation('缺少「## 任务职责」章节', 'warning')
    },
  },
  {
    id: 'change-log',
    label: '变更记录存在',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 变更记录')
      if (!t) ctx.violation('缺少「变更记录」表格', 'warning')
    },
  },
]
