// 引用机制的自定义节点 schema（设计文档 §6.3）
// doctype / file_ref / object_ref / file_block
// 均通过 $nodeSchema 注册，附带 parseMarkdown / toMarkdown 实现 markdown 往返
import { $nodeSchema } from '@milkdown/kit/utils'
import type { NodeType } from '@milkdown/kit/prose/model'
import type { ParserState } from '@milkdown/transformer'

// ---------- 工具 ----------

/** 取 mdast 节点的纯文本（仅 text 子节点） */
export function mdastText(node: { children?: Array<{ type: string; value?: string }> }): string {
  return (node.children ?? [])
    .map((c) => (c.type === 'text' ? (c.value ?? '') : ''))
    .join('')
}

/** 内联引用语法：[[path]] 或 [[path#fragment]]；负向后顾排除 ![[ 块嵌入 */
export const INLINE_REF_RE = /(?<!!)\[\[([^\[\]|]+?)(?:#([^\[\]]+))?\]\]/g

// ---------- doctype ----------
// 首行 doctype:<value>，弱化只读渲染

export const doctypeSchema = $nodeSchema('doctype', (_ctx) => {
  return {
    group: 'block',
    atom: true,
    attrs: {
      value: { default: '' },
    },
    parseDOM: [
      {
        tag: 'div[data-doctype]',
        getAttrs: (dom) => ({ value: dom.getAttribute('data-doctype') ?? '' }),
      },
    ],
    toDOM: (node) => [
      'div',
      { 'data-doctype': node.attrs.value, class: 'ref-doctype' },
      `doctype:${node.attrs.value}`,
    ],
    parseMarkdown: {
      // mdast 由 remark-ref 插件转换为 doctype 类型
      match: (node) => node.type === 'doctype',
      runner: (state: ParserState, node, type: NodeType) => {
        state.addNode(type, { value: String(node.value ?? '') })
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'doctype',
      runner: (state, node) => {
        state.openNode('paragraph')
        state.addNode('text', undefined, `doctype:${node.attrs.value}`)
        state.closeNode()
      },
    },
  }
})

// ---------- file_ref ----------
// [[path]] 文件名链接；[[path#fragment]] 标题/对象链接（# 消歧在 resolve 阶段）

export const fileRefSchema = $nodeSchema('file_ref', (_ctx) => {
  return {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,
    marks: '',
    defining: true,
    isolating: true,
    attrs: {
      path: { default: '' },
      fragment: { default: null },
    },
    parseDOM: [
      {
        tag: 'a[data-file-ref]',
        getAttrs: (dom) => ({
          path: dom.getAttribute('data-path') ?? '',
          fragment: dom.getAttribute('data-fragment'),
        }),
      },
    ],
    toDOM: (node) => [
      'a',
      {
        'data-file-ref': '',
        'data-path': node.attrs.path,
        ...(node.attrs.fragment ? { 'data-fragment': node.attrs.fragment } : {}),
        class: 'ref-file',
      },
      node.attrs.fragment
        ? `${node.attrs.path}#${node.attrs.fragment}`
        : (node.attrs.path ?? ''),
    ],
    parseMarkdown: {
      // mdast 由 remark-ref 插件转换为 fileRef 类型（文本已拆分）
      match: (node) => node.type === 'fileRef',
      runner: (state: ParserState, node, type: NodeType) => {
        state.addNode(type, {
          path: String(node.path ?? ''),
          fragment: node.fragment ?? null,
        })
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'file_ref',
      runner: (state, node) => {
        // 输出自定义 mdast 节点，由 stringify handler 原样写出（避免被转义）
        state.addNode('fileRef', undefined, undefined, {
          path: node.attrs.path,
          fragment: node.attrs.fragment,
        })
      },
    },
  }
})

// ---------- object_ref ----------
// [[path#object]] 模板对象引用（字符串展示）
// 语法与 file_ref 相同，由 resolve 阶段按 suggest 规则消歧后生成此节点（§6.2）

export const objectRefSchema = $nodeSchema('object_ref', (_ctx) => {
  return {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,
    marks: '',
    defining: true,
    isolating: true,
    attrs: {
      path: { default: '' },
      object: { default: '' },
      resolvedText: { default: null },
      /** 对象展示名（suggest 对象的 label，浮窗显示用） */
      label: { default: null },
      /** 点击跳转的标题锚点（suggest 对象声明的 fragment；null = 顶部） */
      fragment: { default: null },
    },
    parseDOM: [
      {
        tag: 'span[data-object-ref]',
        getAttrs: (dom) => ({
          path: dom.getAttribute('data-path') ?? '',
          object: dom.getAttribute('data-object') ?? '',
          resolvedText: dom.getAttribute('data-text'),
          label: dom.getAttribute('data-label'),
          fragment: dom.getAttribute('data-fragment'),
        }),
      },
    ],
    toDOM: (node) => [
      'span',
      {
        'data-object-ref': '',
        'data-path': node.attrs.path,
        'data-object': node.attrs.object,
        ...(node.attrs.resolvedText ? { 'data-text': node.attrs.resolvedText } : {}),
        ...(node.attrs.label ? { 'data-label': node.attrs.label } : {}),
        ...(node.attrs.fragment ? { 'data-fragment': node.attrs.fragment } : {}),
        class: 'ref-object',
      },
      node.attrs.resolvedText ?? `[[${node.attrs.path}#${node.attrs.object}]]`,
    ],
    // 该节点由 resolve 阶段创建，不直接从 markdown 解析（避免与 file_ref 歧义）
    parseMarkdown: {
      match: () => false,
      runner: () => undefined,
    },
    toMarkdown: {
      match: (node) => node.type.name === 'object_ref',
      runner: (state, node) => {
        state.addNode('objectRef', undefined, undefined, {
          path: node.attrs.path,
          object: node.attrs.object,
        })
      },
    },
  }
})

// ---------- file_block ----------
// ![[path]] 块嵌入（可编辑 / |ro 只读）
// 解析时为空容器，内容由 resolve 阶段物化；序列化只输出标记行

export const fileBlockSchema = $nodeSchema('file_block', (_ctx) => {
  return {
    group: 'block',
    content: 'block+',
    defining: true,
    isolating: true,
    attrs: {
      path: { default: '' },
      readonly: { default: false },
    },
    parseDOM: [
      {
        tag: 'div[data-file-block]',
        getAttrs: (dom) => ({
          path: dom.getAttribute('data-path') ?? '',
          readonly: dom.getAttribute('data-readonly') === 'true',
        }),
      },
    ],
    // NodeView 接管渲染，toDOM 仅作占位
    toDOM: (node) => [
      'div',
      {
        'data-file-block': '',
        'data-path': node.attrs.path,
        'data-readonly': String(node.attrs.readonly),
      },
      0,
    ],
    parseMarkdown: {
      // mdast 由 remark-ref 插件转换为 fileBlock 类型
      match: (node) => node.type === 'fileBlock',
      runner: (state: ParserState, node, type: NodeType) => {
        // 解析阶段容器为空；内容由 resolve 阶段异步物化
        state.openNode(type, {
          path: String(node.path ?? ''),
          readonly: Boolean(node.readonly),
        })
        state.closeNode()
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'file_block',
      runner: (state, node) => {
        // 只输出标记行（单一真相源），由 stringify handler 原样写出
        state.addNode('fileBlockMarker', undefined, undefined, {
          path: node.attrs.path,
          readonly: node.attrs.readonly,
        })
      },
    },
  }
})

/** 解析暂态：把 markdown 中出现的 [[…]] / ![[…]] 解析为对应节点 */
export const refNodes = [doctypeSchema.node, fileRefSchema.node, objectRefSchema.node, fileBlockSchema.node]
