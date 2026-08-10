---
title: CodeMirror
type: entity
tags: [dependency, codemirror, code-block, editor]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# CodeMirror

[CodeMirror 6](https://codemirror.net/) is the code-editing engine used by Milkdown's **Code Block** component (`@milkdown/components/code-block`). It is referenced in the docs for language data and theming.

- **Used by:** `component-code-block` (language picker, syntax highlighting, line numbers, autocomplete/folding, search/replace) and the Crepe `CodeMirror` feature (`CodeMirrorFeatureConfig`: `extensions`, `languages`, `theme`, copy/search UI).
- **Packages referenced:** `@codemirror/commands`, `@codemirror/language`, `@codemirror/language-data`, `@codemirror/theme-one-dark`, `@codemirror/view`.
- **Config:** `codeBlockConfig` (`extensions`, `languages`, `renderLanguage`, `renderPreview`, `onCopy`, …).

## Why it matters

If you need code editing/highlighting inside Milkdown, you configure CodeMirror 6 language descriptions and extensions — not Milkdown internals.

## Related

- [[Component System]] · [[Crepe Editor]]
- Parent framework: [[Milkdown]]
