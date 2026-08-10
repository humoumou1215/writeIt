---
title: ProseMirror
type: entity
tags: [dependency, prosemirror, editor, foundation]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# ProseMirror

[ProseMirror](https://prosemirror.net/) is the **foundational editor toolkit** that [[Milkdown]] is built on. Milkdown's document model, schema, state, and view are all ProseMirror's; Milkdown adds the Markdown layer, plugin system, and presets on top.

- **Referenced directly in the docs** for plugin authoring: e.g. `Prosemirror Plugin.view` ([[Plugin System|plugin-block]]), drop cursor & gap cursor (`@milkdown/plugin-cursor`), and the editing/resizing plugins behind tables.
- **Schemas** in Milkdown presets (`tableSchema`, `headingSchema`, …) are ProseMirror node/mark schemas.
- **State/View** are exposed as context slices (`editorStateCtx`, `editorViewCtx`) — see [[Ctx Slice Timer]].

## Why it matters

Understanding ProseMirror is the prerequisite for deep Milkdown customization (custom nodes, views, plugins). Milkdown inverts ProseMirror's low-level API into a Markdown-first, plugin-friendly framework.

## Related

- [[Milkdown]] · [[Milkdown Architecture]] · [[Ctx Slice Timer]] · [[Plugin System]] · [[Preset CommonMark GFM]]
