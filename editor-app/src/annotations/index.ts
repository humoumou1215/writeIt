// 批注插件汇总（供 crepe.editor.use）
//   remark 解析 <mark data-note> → annotation 节点
//   运行时批注（校验等）→ decorations 高亮（annotationDecorationsPlugin）
// P0：tabId 与运行时批注读取器经 annotationConfigCtx 注入（装配层 config 回调 set），
// 插件包本身不 import app 模块。
import { $remark, $prose } from '@milkdown/kit/utils'
import { remarkAnnotation } from './remark-annotation'
import { annotationSchema } from './nodes'
import { annotationDecorationsPlugin } from './plugin'
import { annotationConfigCtx } from './config'

export { annotationConfigCtx } from './config'

/** 批注插件：$ctx(config) + remark + schema + decorations（decorations 从 ctx 读 tabId） */
export const annotationPlugin = [
  annotationConfigCtx,
  ...$remark('annotationRemark', () => remarkAnnotation as never),
  ...annotationSchema,
  $prose((ctx) => {
    const cfg = ctx.get(annotationConfigCtx.key)
    return annotationDecorationsPlugin(() =>
      cfg ? cfg.getRuntimeAnnotations(cfg.tabId) : []
    )
  }),
]
