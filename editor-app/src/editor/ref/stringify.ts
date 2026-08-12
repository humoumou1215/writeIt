// 引用标记的自定义 stringify handler
// file_ref/object_ref/file_block 的 toMarkdown 输出自定义 mdast 节点，
// 这里注册 remark-stringify handler，原样写出 [[...]] / ![[...]]，避免被转义
import type { Ctx } from '@milkdown/kit/ctx'
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'

type RefNode = {
  path?: unknown
  fragment?: unknown
  object?: unknown
  readonly?: unknown
}

export function registerRefStringify(ctx: Ctx) {
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({
    ...prev,
    handlers: {
      ...(prev.handlers ?? {}),
      fileRef: (node: RefNode) => {
        const path = String(node.path ?? '')
        const fragment = node.fragment ? '#' + String(node.fragment) : ''
        return `[[${path}${fragment}]]`
      },
      objectRef: (node: RefNode) => `[[${String(node.path ?? '')}#${String(node.object ?? '')}]]`,
      fileBlockMarker: (node: RefNode) =>
        `![[${String(node.path ?? '')}${node.readonly ? '|ro' : ''}]]`,
    },
  }))
}
