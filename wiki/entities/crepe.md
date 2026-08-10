---
title: Crepe
type: entity
tags: [milkdown, crepe, editor, product]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# Crepe

**Crepe** (`@milkdown/crepe`) is Milkdown's **high-level, batteries-included editor** — the "product" layer over the [[Milkdown]] core. It bundles a toolbar, block handle, placeholders, themes, and an optional AI feature into one drop-in class.

- **Classes:** `Crepe` (all features on, except `TopBar`/`AI`) and `CrepeBuilder` (feature-by-feature, smaller bundle).
- **Features:** `Cursor, ListItem, LinkTooltip, ImageBlock, BlockEdit, Placeholder, Toolbar, CodeMirror, Table, Latex` on by default; `TopBar, AI` off.
- **Config:** `CrepeConfig` / `CrepeBuilderConfig` + per-feature configs.
- **Themes:** `crepe`, `nord`, `frame` (+ dark variants). See [[Nord Theme]].
- **AI:** see [[AI Feature]].

## Distinguishing from the concept page

- This **entity page** is the "what is Crepe" reference.
- [[Crepe Editor]] is the deeper **concept** treatment (features, config interfaces, toolbar vs TopBar, theming variables, API surface).

## Related

- [[Crepe Editor]] · [[AI Feature]] · [[Component System]] · [[Milkdown Architecture]]
- Parent project: [[Milkdown]]
