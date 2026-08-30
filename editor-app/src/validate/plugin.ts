// 校验的编辑器集成层（P1）——独立为 milkdown 插件包
// 设计：规则引擎（rules 执行 / doctype 提取 / 报告落盘）保留在 validate/service.ts（app 领域服务），
// 本插件只负责编辑器侧接线：
//   1. $prose 监听文档变化 → 防抖（默认 1.5s）→ 调注入的 run()（装配层 = validateEditor）
//   2. $command('validate') 手动触发（替代 app 侧自由函数）
// 校验结果经 service 内部广播（订阅者：批注体系/抽屉），decorations 走 annotations 的运行时批注。
import { $command, $ctx, $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { ValidationResult } from './service'

export interface ValidateConfig {
  /** 当前编辑器所属标签（校验结果按 tabId 隔离） */
  tabId: string
  /** 校验执行器（装配层注入：validateEditor 包装） */
  run: (tabId: string, opts?: { silent?: boolean }) => Promise<ValidationResult>
  /** 编辑防抖毫秒（默认 1500） */
  debounceMs?: number
  /** 跳过调度（装配层注入；M4 后恒 false——外部事务同可校验，无程序化抑制） */
  shouldSkip?: () => boolean
}

/** 校验配置切片（$ctx 插件：默认 null；装配层 config 回调 set 覆盖） */
export const validateConfigCtx = $ctx<ValidateConfig | null, 'validateConfig'>(
  null,
  'validateConfig'
)

// 防抖调度（按 tabId 隔离；编辑器销毁时由装配层清理）
const timers = new Map<string, ReturnType<typeof setTimeout>>()

export function clearValidationTimer(tabId: string): void {
  const t = timers.get(tabId)
  if (t) {
    clearTimeout(t)
    timers.delete(tabId)
  }
}

function schedule(cfg: ValidateConfig): void {
  clearValidationTimer(cfg.tabId)
  timers.set(
    cfg.tabId,
    setTimeout(() => {
      timers.delete(cfg.tabId)
      void cfg.run(cfg.tabId, { silent: true })
    }, cfg.debounceMs ?? 1500)
  )
}

/** $prose：任何 docChanged 事务 → 防抖调度校验（M4 起无程序化抑制） */
const onChangePlugin = (getCfg: () => ValidateConfig | null) =>
  new Plugin({
    key: new PluginKey('VALIDATE_ON_CHANGE'),
    state: {
      init: () => null,
      apply: (tr) => {
        const cfg = getCfg()
        if (tr.docChanged && cfg && !cfg.shouldSkip?.()) {
          schedule(cfg)
        }
        return null
      },
    },
  })

/** 校验插件：$ctx(config) + $prose(编辑监听) + $command('validate') */
export const validatePlugin = [
  validateConfigCtx,
  $prose((ctx) => onChangePlugin(() => ctx.get(validateConfigCtx.key))),
  $command('validate', (ctx) => () => {
    // 副作用命令：触发校验后返回成功的 no-op Command（ProseMirror Command 签名）
    const cfg = ctx.get(validateConfigCtx.key)
    if (cfg) void cfg.run(cfg.tabId, { silent: true })
    return () => true
  }),
]
