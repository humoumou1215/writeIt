---
title: Refractor
type: entity
tags: [dependency, refractor, prism, highlight]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# Refractor

[Refractor](https://www.npmjs.com/package/refractor) is the syntax-highlighting engine behind `@milkdown/plugin-prism`. The plugin "Add support for prism highlight" and inherits Refractor's language support and limitations.

- **Config:** `prismConfig`, `prismPlugin`.
- **Note:** Prism highlighting here is distinct from the CodeMirror-based highlighting in the Code Block component ([[CodeMirror]]).

## Why it matters

For static/serialized highlighting (e.g. when not using the interactive CodeMirror code block), use `plugin-prism`. For editable code, use the Code Block component.

## Related

- [[Plugin System]] · [[Component System]]
- Parent framework: [[Milkdown]]
