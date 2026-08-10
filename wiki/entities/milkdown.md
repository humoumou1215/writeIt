---
title: Milkdown
type: entity
tags: [milkdown, project, editor, framework]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# Milkdown

**Milkdown** is an open-source, plugin-driven **WYSIWYG Markdown editor framework** for the web, built on [ProseMirror](https://prosemirror.net/). Repo: `github.com/Milkdown/milkdown`.

- **Nature:** a framework, not a single editor. You compose an editor from `@milkdown/core` + plugins + presets, or use the high-level [[Crepe]] product.
- **Packages (per the indexed docs):** `@milkdown/core`, `@milkdown/ctx`, `@milkdown/transformer`, `@milkdown/utils`, `@milkdown/preset-commonmark`, `@milkdown/preset-gfm`, `@milkdown/crepe`, 15× `@milkdown/plugin-*`, 6× `@milkdown/components/*`, `@milkdown/theme-nord`.
- **Markdown fidelity:** handled by the [[Transformer]] (remark-based), not the core.
- **Philosophy:** composable, typed, Markdown-as-source-of-truth.

## Why it matters here

This wiki's raw corpus is the auto-generated API reference for Milkdown (`@milkdown/docs`). Every concept page traces back to [[Milkdown Docs Corpus]].

## Related

- [[Milkdown Architecture]] · [[Ctx Slice Timer]] · [[Plugin System]] · [[Preset CommonMark GFM]] · [[Transformer]] · [[Crepe Editor]] · [[Component System]]
- Depends on: [[ProseMirror]] · [[CodeMirror]] (via components) · [[KaTeX]] (Latex) · [[Twemoji]] (emoji) · [[Refractor]] (prism)
