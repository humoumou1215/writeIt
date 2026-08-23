// M18：增强层状态（§4.5 降级可观测）——每个 diff 单元产出 enhancement 状态 + reason
// 双维度：guarantee 恒定 'ok'（保证层文案永不因 status 隐藏）；enhancement 只影响图内标注/徽标
import { diagEvent } from '../../diagnostics/logger'

/** 增强层结果（R8：静默失败视为 bug） */
export type DiffStatus = 'ok' | 'degraded' | 'failed'

export interface EnhancementState {
  status: DiffStatus
  /** 降级/失败原因（诊断落盘 + UI 微提示） */
  reason?: string
  /** 失败的具体位置（fence id / path），便于定位 */
  at?: string
}

export function okState(): EnhancementState {
  return { status: 'ok' }
}

export function degradedState(reason: string, at?: string): EnhancementState {
  return { status: 'degraded', reason, at }
}

export function failedState(reason: string, at?: string): EnhancementState {
  return { status: 'failed', reason, at }
}

/** 诊断埋点：diff:render 单元级结果（R8 可观测） */
export function diagRenderUnit(unit: string, s: EnhancementState): void {
  diagEvent('diff:render', {
    target: unit,
    ok: s.status === 'ok',
    data: { status: s.status, reason: s.reason ?? null, at: s.at ?? null },
  })
}

/** 状态合并：多个增强子结果取最差（degraded < failed） */
export function mergeStatus(states: EnhancementState[]): EnhancementState {
  let worst: EnhancementState | null = null
  for (const s of states) {
    if (!worst) {
      worst = s
      continue
    }
    if (s.status === 'failed' || (s.status === 'degraded' && worst.status === 'ok')) worst = s
  }
  return worst ?? okState()
}