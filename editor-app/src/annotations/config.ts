// 批注插件配置切片（P0：tabId 绑定与运行时批注读取经 ctx 注入，替代 manager 闭包绑定）
import { $ctx } from '@milkdown/kit/utils'
import type { Annotation } from './service'

export interface AnnotationConfig {
  /** 当前编辑器所属标签（批注服务按 tabId 隔离） */
  tabId: string
  /** 运行时批注读取器（校验违规等，persist=false） */
  getRuntimeAnnotations: (tabId: string) => Annotation[]
}

/** 批注配置切片（$ctx 插件：注册进容器默认 null；装配层 config 回调 set 覆盖）。
 *  annotationPlugin 需整体 use，插件内部 ctx.get(annotationConfigCtx.key) 读取。 */
export const annotationConfigCtx = $ctx<AnnotationConfig | null, 'annotationConfig'>(
  null,
  'annotationConfig'
)
