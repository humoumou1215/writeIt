// 测试共享：jsdom + minimal milkdown editor → parser（model 层 fixture 网的基础设施）
// 用 ParserOnly 编辑器（不创建 EditorView）：schema 含 commonmark+gfm+ref 节点，纯解析。
// vitest 环境下通过 pragma 按文件启用 jsdom。
import { JSDOM } from 'jsdom'
import type { Ctx } from '@milkdown/kit/ctx'
import { Editor, parserCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
// 解析只需节点 schema + remark 转换（菜单/视图/样式等浏览器侧装配不引入——model 层纯解析）
import { $remark } from '@milkdown/kit/utils'
import { doctypeSchema, fileRefSchema, objectRefSchema, fileBlockSchema } from '../../../src/editor/ref/nodes'
import { remarkRef } from '../../../src/editor/ref/remark-ref'
import { registerRefStringify } from '../../../src/editor/ref/stringify'
import type { Node } from '@milkdown/kit/prose/model'
import { parserCtx, serializerCtx } from '@milkdown/kit/core'

const remarkRefPlugin = $remark('remarkRef', () => remarkRef as never)
const refNodesOnly = [
  ...remarkRefPlugin,
  ...doctypeSchema,
  ...fileRefSchema,
  ...objectRefSchema,
  ...fileBlockSchema,
]

export function installJsdom(html = '<!doctype html><html><body><div id="root"></div></body></html>') {
  const dom = new JSDOM(html)
  const w = dom.window as unknown as Record<string, unknown>
  const setGlobal = (k: string, v: unknown) => {
    try {
      Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
    } catch {
      ;(globalThis as Record<string, unknown>)[k] = v
    }
  }
  for (const k of [
    'window', 'document', 'Node', 'getComputedStyle', 'addEventListener', 'removeEventListener',
    'dispatchEvent', 'CustomEvent', 'Event', 'EventTarget', 'Element', 'HTMLElement', 'SVGElement',
    'getSelection', 'DOMParser', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame',
    'DOMRect', 'CSSStyleDeclaration', 'navigator', 'IntersectionObserver',
  ]) {
    const v = w[k]
    if (v !== undefined) setGlobal(k, typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind?.(w) ?? v : v)
  }
  if (!globalThis.IntersectionObserver) {
    class IO {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return []
      }
    }
    setGlobal('IntersectionObserver', IO)
  }
  return dom
}

let parserInstance: ((md: string) => Node | null) | null = null
let serializerInstance: ((doc: Node) => string) | null = null
let destroyed = false

/** 创建（一次性的）纯解析编辑器并返回 parser；editorInstance 供卸载 */
export async function createTestParser(): Promise<{
  parser: (md: string) => Node | null
  serialize: (doc: Node) => string
  destroy: () => Promise<void>
  editor: unknown
}> {
  installJsdom()
  const root = document.getElementById('root') as HTMLElement
  const ed = Editor.make()
    .config((ctx: Ctx) => {
      ctx.set(rootCtx, root)
      registerRefStringify(ctx) // 与 app 装配层一致：file_block 序列化 handler
    })
    .use(commonmark)
    .use(gfm)
    .use(refNodesOnly)
  await ed.create()
  const parser = await ed.action((ctx: Ctx) => {
    const p = ctx.get(parserCtx) as (md: string) => Node | null
    return p
  })
  const serialize = await ed.action((ctx: Ctx) => {
    const s = ctx.get(serializerCtx) as (doc: Node) => string
    return s
  })
  parserInstance = parser
  serializerInstance = serialize
  return { parser, serialize, destroy: () => ed.destroy(), editor: ed }
}

/** 惰性单例 parser（供 profile/深链测试复用；直接抛错不给静默） */
export async function getTestParser() {
  if (!parserInstance) {
    const { parser } = await createTestParser()
    parserInstance = parser
  }
  return parserInstance
}

/** 惰性单例 serializer（docstore canonical 测试用） */
export async function getTestSerializer() {
  if (!serializerInstance) {
    const r = await createTestParser()
    serializerInstance = r.serialize
  }
  return serializerInstance
}

/** 展示 doc 结构（测试断言辅助） */
export function dumpDoc(doc: Node): string {
  const lines: string[] = []
  doc.descendants((n, pos) => {
    lines.push(`${pos}\t${n.type.name}${n.type.name === 'text' ? ':' + n.text : ''} attrs=${JSON.stringify(n.attrs)}`)
    return true
  })
  return lines.join('\n')
}