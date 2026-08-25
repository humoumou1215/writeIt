// 批注插件汇总（供 crepe.editor.use）
//   remark 解析 <mark data-a data-note>（栈式，支持嵌套/重叠）→ annotation mark
//   mark schema（v8 方案A；见 nodes.ts）
//   stringify handler：把 mark 序列化产出的 mdast 'annotation' 节点渲染为 <mark data-a data-note> 标签
//   运行时批注（校验等）→ decorations 高亮（annotationDecorationsPlugin）
// P0：tabId 与运行时批注读取器经 annotationConfigCtx 注入（装配层 config 回调 set），
// 插件包本身不 import app 模块。
import type { Ctx } from '@milkdown/kit/ctx'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { $remark, $prose } from '@milkdown/kit/utils'
import { remarkAnnotation } from './remark-annotation'
import { annotationSchema, escapeAttr } from './nodes'
import { annotationDecorationsPlugin } from './plugin'
import { annotationConfigCtx } from './config'

export { annotationConfigCtx } from './config'

/**
 * mark 序列化产出的 mdast 节点：{type:'annotation', id, note, children}
 * stringify handler（注册进 remarkStringifyOptionsCtx.handlers，mdast-util-to-markdown 调用）：
 *   开标签 + 子内容 + 闭标签；同一逻辑批注跨段时相邻同 id 段由 serializer 的 maybeMerge 合并。
 */
function annotationHandle(
  node: {
    id?: unknown
    note?: unknown
    children?: Array<{ type: string }>
  } & Record<string, unknown>,
  _parent: unknown,
  state: { containerPhrasing: (n: unknown, ctx: { before: string; after: string }) => string }
): string {
  const open = `<mark data-note='${escapeAttr(String(node.note ?? ''))}' data-a='${escapeAttr(String(node.id ?? ''))}'>`
  const inner = state.containerPhrasing(node, { before: '', after: '' })
  return `${open}${inner}</mark>`
}

/** 把 annotation stringify handler 注册进 remark stringify 选项（Create 阶段同步执行，早于 InitReady 消费） */
const annotationStringifyHandler: MilkdownPlugin = (ctx: Ctx) => {
  ctx.update(remarkStringifyOptionsCtx, (opts) => ({
    ...opts,
    handlers: { ...opts.handlers, annotation: annotationHandle as never },
  }))
  return () => {}
}

/** 批注插件：$ctx(config) + stringify handler + remark + schema + decorations（decorations 从 ctx 读 tabId） */
export const annotationPlugin = [
  annotationConfigCtx,
  annotationStringifyHandler,
  ...$remark('annotationRemark', () => remarkAnnotation as never),
  ...annotationSchema,
  $prose((ctx) => {
    const cfg = ctx.get(annotationConfigCtx.key)
    return annotationDecorationsPlugin(() =>
      cfg ? cfg.getRuntimeAnnotations(cfg.tabId) : []
    )
  }),
]