import type { ReferenceDocumentInput } from '../core/reference'

/**
 * Browser-only corpus used to make the v2 shell inspectable on first launch.
 * It is fixture-like demo input: runtime Markdown authority still belongs to
 * DocumentStore after a file is opened.
 */
export const DEFAULT_DEMO_DOCUMENT_PATH = 'welcome.md'

export const DEFAULT_DEMO_FILES: Readonly<Record<string, string>> = Object.freeze({
  'welcome.md': `# WriteIt v2 调试工作区

这是一个用于检查 WriteIt v2 的综合演示文档。它包含 **常规 Markdown**、中文与 English 混排、文件引用和多层 Embed。

> 目标：让 Outline、Search、Raw Source、Live Preview、dirty/save、引用跳转和右键菜单都有真实内容可检查。

## 快速入口

- [Markdown 基础演示](demo/markdown/feature-tour.md)
- [[demo/references/A.md]]
- [[demo/references/B.md#B 的内容]]
- ![[demo/markdown/feature-tour.md#复杂 Markdown]]
- ![[demo/references/readonly.md|ro]]

### Embed 场景

下面两个 Embed 会故意重复，便于检查 occurrence 和组合统计：

![[demo/references/A.md]]
![[demo/references/A.md]]
![[demo/references/E.md#嵌套内容]]
![[demo/references/missing.md]]

## 语法保留检查

~~~unknown-writeit-syntax
这段未知 fenced syntax 应保持为普通源文本。
~~~

:::unknown-syntax
Unknown Markdown remains source text and must survive save/reload.
:::

<!-- 这份演示数据不是新的 Markdown authority。 -->
`,
  'notes/architecture.md': `# Architecture notes

This legacy-compatible note is kept as a small navigation target inside the richer demo corpus.
`,
  'notes/workspace.md': `# Workspace tree

This document remains available for Embed, split-view, and workspace navigation journeys.
`,
  'demo/README.md': `# 演示工作区

这个目录专门放置可重复检查的 Markdown corpus。

- markdown/：常规格式、长正文和图片占位
- references/：A/B/C/D/E 引用关系
- references/cycles/：循环 Embed
- assets/：图片和附件占位
`,
  'demo/markdown/feature-tour.md': `# 常规 Markdown 功能演示

## 复杂 Markdown

这里有 **粗体**、*斜体*、~~删除线~~、inline code，以及一个[外部链接](https://example.com/writeit)和一个[[demo/references/B.md]]。

中文段落可以和 English sentence 混合。WriteIt should preserve the source even when a renderer only understands a subset.

### 引用与列表

> 这是一级引用。
>
> > 这是二级引用，方便检查嵌套块的视觉层级。

1. 有序项目
2. 第二个项目
   1. 嵌套项目
   2. 另一个嵌套项目

- 无序项目
  - 子项目
- [x] 已完成任务
- [ ] 待办任务

### 代码

~~~ts
export function sourceRemainsAuthoritative(markdown: string): string {
  return markdown
}
~~~

### 表格

| 场景 | 预期 | 状态 |
| --- | --- | --- |
| Raw Source | 保留原文 | 可检查 |
| Live Preview | 同一份 source 的 Projection | 可检查 |
| Embed | 不建立第二 authority | 可检查 |

### 图片与附件占位

![本地 SVG 占位图](../assets/demo-placeholder.svg)

附件路径：demo/assets/placeholder.txt（故意保留为普通 Markdown 路径）。

### 未知语法

:::callout
Unknown blocks should remain visible and source-safe.
:::
`,
  'demo/markdown/deep/nested/long-form.md': `# 深层目录长正文

## 目的

这是一个多层目录中的较长文档，用来检查正文宽度、滚动、标签页和文件树展开状态。

### 第一段

WriteIt keeps Markdown as the durable contract. A projection may render headings, links, tables, images, or embeds, but a failed projection must not rewrite the source.

### 第二段

编辑时可以混合使用中文说明、English notes、路径 ../ 和长行文本。这个段落还故意包含足够多的内容，让滚动和自然定位可以被观察。

### 第三段

当文档在多个标签页、分屏和 Embed 中出现时，所有视图仍然指向同一个 DocumentStore revision。
`,
  'demo/references/A.md': `# A.md：引用与嵌入中心

## A 的嵌入关系

A 两次嵌入 B，一次嵌入 E，便于检查重复 Embed 和 occurrence：

![[demo/references/B.md]]
![[demo/references/B.md]]
![[demo/references/E.md]]

普通链接：[[demo/references/B.md]]。

## A 的断链与标题片段

![[demo/references/missing.md#不存在的标题]]
[[demo/references/E.md#嵌套内容]]
`,
  'demo/references/B.md': `# B.md：被重复嵌入的文档

## B 的内容

B 的正文包含一个二级标题和一个只读 Embed：

![[demo/references/readonly.md|ro]]

### B 的深层标题

这里的标题会进入组合内容 Outline。B 也把循环场景接入演示：

![[demo/references/cycles/loop-a.md]]
`,
  'demo/references/C.md': `# C.md：引用 A 一次

## C 的正文

本文档只嵌入 A 一次，用于检查 A 的 incoming occurrence：

![[demo/references/A.md]]
`,
  'demo/references/D.md': `# D.md：引用 A 两次

## D 的正文

以下两个出现位置必须保持独立：

![[demo/references/A.md]]
中间有一段普通文字。
![[demo/references/A.md]]
`,
  'demo/references/E.md': `# E.md：多层嵌套

## 嵌套内容

E 嵌入一个深层 Markdown 文件，再嵌入只读文档：

![[demo/markdown/deep/nested/long-form.md]]
![[demo/references/readonly.md|ro]]
`,
  'demo/references/readonly.md': `# 只读 Embed 文档

## 只读内容

这个文档通过 |ro 被嵌入，子投影应该显示只读状态，不能把编辑写回这个文档。
`,
  'demo/references/cycles/loop-a.md': `# 循环 A

## 循环入口

![[demo/references/cycles/loop-b.md]]
`,
  'demo/references/cycles/loop-b.md': `# 循环 B

## 循环回边

![[demo/references/cycles/loop-a.md]]
`,
  'demo/assets/placeholder.txt': 'Attachment placeholder: this file is intentionally plain text.\n',
})

export const DEFAULT_DEMO_BINARY_FILES: Readonly<Record<string, Uint8Array>> = Object.freeze({
  'demo/assets/demo-placeholder.svg': new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="220" viewBox="0 0 640 220"><rect width="640" height="220" rx="16" fill="#eef1ff"/><path d="M80 165 205 55l85 76 78-64 192 98H80Z" fill="#7385c5"/><circle cx="470" cy="74" r="28" fill="#536dfe"/><text x="320" y="198" text-anchor="middle" fill="#3146b8" font-family="sans-serif" font-size="20">WriteIt demo attachment</text></svg>',
  ),
})

export const DEFAULT_DEMO_REFERENCE_DOCUMENTS: readonly ReferenceDocumentInput[] = Object.freeze(
  Object.entries(DEFAULT_DEMO_FILES).map(([path, markdown]) =>
    Object.freeze({ path, markdown }),
  ),
)
