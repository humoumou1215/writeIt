---
title: Transformer
type: concept
tags: [milkdown, transformer, markdown, remark, parser, serializer]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# Transformer

`@milkdown/transformer` converts **between the ProseMirror document and Markdown**. In most apps you never call it directly — the editor uses it under the hood for `getMarkdown()` / `Editor.make().config(defaultValueCtx, '# Hello')`. You only touch it when you need custom Markdown round-tripping.

## Two directions

- **Parser** — Markdown (via [remark](https://github.com/remarkjs/remark)) → ProseMirror nodes/marks.
- **Serializer** — ProseMirror doc → Markdown string.

## Key exports

- **State machines:** `ParserState`, `SerializerState`
- **Entry points:** `Parser`, `Serializer`
- **Specs:** `NodeParserSpec`, `MarkParserSpec`, `NodeSerializerSpec`, `MarkSerializerSpec`
- **Schema glue:** `NodeSchema`, `MarkSchema`
- **Remark bridge:** `RemarkPlugin`, `RemarkParser`
- **AST helpers:** `MarkdownNode`, `Stack`, `StackElement`

## How it connects to the rest

The parser/serializer are stored as slices in the context (`parserCtx`, `serializerCtx`) — see [[Ctx Slice Timer]]. The remark plugins that drive parsing (`remarkPluginsCtx`, `remarkCtx`) and stringify options (`remarkStringifyOptionsCtx`) are configured through core. Presets register node/mark parser+serializer specs so Markdown survives a full round-trip (headings, lists, tables, images, etc.).

## When to customize

Write a custom `NodeParserSpec`/`NodeSerializerSpec` when you add a node (e.g. a custom callout) and need it to survive Markdown export/import.

## Related

- [[Milkdown Architecture]] · [[Ctx Slice Timer]] · [[Preset CommonMark GFM]]
- Entity: [[Milkdown]]
