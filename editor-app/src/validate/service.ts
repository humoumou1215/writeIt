// ValidateService（设计文档 §5）
// 三通道：① decorations 文档内标注（validate/plugin.ts）② 聚合面板（ValidatePanel.vue）③ 报告落盘
// 原则：旁路异步服务 —— rules 加载/执行失败只降级（toast / console），绝不中断编辑器主流程（§10）。
// 严格度：mode 'hint'（默认）仅提示标注；'strict' 保存前校验失败阻止（saveTab 门禁）。
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import { templateService } from '../template/service'
import { extractDoctype } from '../template/service'
import type { RulesModule, Violation } from '../template/types'
import { createValidationContext } from './validate-context'
import { setRuntimeAnnotations } from '../annotations/service'

export interface ValidationResult {
  doctype: string | null
  mode: 'hint' | 'strict'
  /** 报告声明（undefined = 不落盘） */
  report?: { enabled?: boolean; path?: string }
  violations: Violation[]
  /** 规则执行耗时（ms）——超时/异常标记用 */
  stale: boolean
  /** 执行失败（rules 加载失败等） */
  failed: boolean
  ranAt: number
}

const results = new Map<string, ValidationResult>()
const listeners = new Set<() => void>()
const RUN_TIMEOUT_MS = 2000

export function getValidationResult(tabId: string): ValidationResult | null {
  return results.get(tabId) ?? null
}

export function subscribeValidation(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify() {
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* 面板等订阅者异常不影响服务 */
    }
  })
}

/** 从解析后的 doc 提取 doctype（首行 doctype:<value> 被 M1 自定义 doctype 节点解析：
 * 节点类型名为 doctype、值在 attrs.value —— 不能从 textContent 提取） */
export function doctypeFromDoc(doc: import('@milkdown/kit/prose/model').Node): string | null {
  let value: string | null = null
  doc.forEach((node) => {
    if (value !== null) return
    if (node.type.name === 'doctype') {
      const v = (node.attrs.value as string)?.trim()
      if (v) value = v
    } else if (node.isTextblock && node.textContent) {
      value = extractDoctype(node.textContent.trim())
    }
  })
  return value
}

/**
 * 执行校验：doc → doctype → 模板 rules → 违规列表。
 * 幂等可重复调用（打开文档时 / 保存前 / 手动刷新）。
 */
export async function validateEditor(
  editor: Editor,
  tabId: string,
  opts?: { silent?: boolean }
): Promise<ValidationResult> {
  let result: ValidationResult = {
    doctype: null,
    mode: 'hint',
    violations: [],
    stale: false,
    failed: false,
    ranAt: Date.now(),
  }
  try {
    const doc = await editor.action((ctx) => ctx.get(editorViewCtx).state.doc)
    const doctype = doctypeFromDoc(doc)
    result.doctype = doctype

    const tpl = doctype ? templateService.get(doctype) : undefined
    const rulesMod: RulesModule | null = tpl ? await templateService.ensureRules(tpl) : null
    if (!rulesMod || !Array.isArray(rulesMod.rules) || rulesMod.rules.length === 0) {
      // 无 rules → 空结果（无校验需求；不是错误）
      results.set(tabId, result)
      notify()
      return result
    }

    result.mode = rulesMod.mode ?? 'hint'
    if (rulesMod.report) result.report = rulesMod.report

    const ctx = createValidationContext(doc)
    for (const rule of rulesMod.rules) {
      if (!rule || typeof rule.run !== 'function') continue
      const ruleStart = performance.now()
      try {
        ctx.setRule(rule.id, rule.label ?? rule.id)
        rule.run(ctx)
      } catch (e) {
        console.error(`[validate] 规则 ${rule.id} 执行异常:`, e)
        ctx.violation(`规则「${rule.label ?? rule.id}」执行异常：${(e as Error).message ?? '未知错误'}`, 'warning')
      }
      if (performance.now() - ruleStart > RUN_TIMEOUT_MS) {
        // 单条规则超时：结果丢弃该规则产生的违规 + 标记（同步 run 无法中断，仅告警）
        result.stale = true
        console.warn(`[validate] 规则 ${rule.id} 超过 ${RUN_TIMEOUT_MS}ms`)
      }
    }
    result.violations = ctx.violations

    // M6：违规 → 运行时批注（persist=false，decorations 高亮/锚定行；不落盘）
    const anns = ctx.violations
      .filter((v) => v.pos != null)
      .map((v, i) => ({
        id: `${v.ruleId}-${v.pos}-${i}`,
        from: v.pos!,
        to: v.pos!,
        content: v.message,
        level: v.level,
        persist: false,
      }))
    setRuntimeAnnotations(tabId, anns, editor)

    results.set(tabId, result)

    // 报告落盘（§5.2 通道③；失败仅 toast 降级）
    if (result.report?.enabled && result.report.path && tpl) {
      await writeReport(tabId, result)
    }
  } catch (e) {
    console.error('[validate] 校验失败:', e)
    result.failed = true
    result.violations = [
      {
        ruleId: 'service',
        label: '校验服务',
        message: `校验执行失败：${(e as Error).message ?? '未知错误'}`,
        level: 'warning',
        pos: null,
      },
    ]
    results.set(tabId, result)
  }
  notify()
  if (result.failed && !opts?.silent) {
    const { toast } = await import('../state/store')
    toast('校验服务异常，已降级（不影响编辑/保存）', 'error')
  }
  return result
}

/** strict 门禁：mode strict 且有 error 违规 → 不可直接保存（调用方确认/阻止） */
export function hasStrictBlock(result: ValidationResult | null): boolean {
  if (!result || result.failed) return false
  if (result.mode !== 'strict') return false
  return result.violations.some((v) => v.level === 'error')
}

/** 报告落盘（§5.2 通道③）：markdown 报告，供归档/CI */
async function writeReport(tabId: string, result: ValidationResult): Promise<void> {
  try {
    const { fs } = await import('../fs')
    const { state } = await import('../state/store')
    const tab = state.tabs.find((t) => t.id === tabId)
    const lines: string[] = []
    lines.push('# 校验报告')
    lines.push('')
    lines.push(`- 文件：${tab?.path ?? tabId}`)
    lines.push(`- 模板：${result.doctype ?? '（无 doctype）'}`)
    lines.push(`- 模式：${result.mode}`)
    lines.push(`- 时间：${new Date(result.ranAt).toLocaleString()}`)
    lines.push(`- 违规：${result.violations.length}（error ${result.violations.filter((v) => v.level === 'error').length} / warning ${result.violations.filter((v) => v.level === 'warning').length}）`)
    lines.push('')
    if (result.violations.length === 0) {
      lines.push('✅ 未发现违规')
    } else {
      lines.push('## 违规列表')
      lines.push('')
      for (const v of result.violations) {
        lines.push(`- [${v.level}] ${v.message}（规则：${v.label}${v.pos != null ? `，位置 ${v.pos}` : ''}）`)
      }
    }
    await fs.writeFile(result.report!.path!, lines.join('\n'))
  } catch (e) {
    console.warn('[validate] 报告落盘失败:', e)
  }
}

/** 清除标签关闭时的结果 */
export function clearValidation(tabId: string): void {
  results.delete(tabId)
  notify()
}
