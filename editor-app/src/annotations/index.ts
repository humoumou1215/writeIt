// 批注插件汇总（供 crepe.editor.use）
//   remark 解析 <mark data-note> → annotation 节点
//   运行时批注（校验等）→ decorations 高亮（annotationDecorationsPlugin）
import { $remark, $prose } from '@milkdown/kit/utils'
import { remarkAnnotation } from './remark-annotation'
import { annotationSchema } from './nodes'
import { annotationDecorationsPlugin } from './plugin'
import { getRuntimeAnnotations } from './service'

export const annotationPlugin = [
  $remark('annotationRemark', () => remarkAnnotation as never),
  annotationSchema,
  // decorations 从 service 读运行时批注（按 tabId 由 manager 绑定闭包）
  $prose(() => annotationDecorationsPlugin(() => getRuntimeAnnotations('__bind_later__'))),
]

/** manager 装配用：把 decorations 绑定到具体 tabId */
export function bindAnnotationDecorations(tabId: string) {
  return $prose(() =>
    annotationDecorationsPlugin(() => getRuntimeAnnotations(tabId))
  )
}
