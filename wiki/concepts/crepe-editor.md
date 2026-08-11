---
title: Crepe Editor
type: concept
tags: [milkdown, crepe, editor, toolbar, theme, config]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# Crepe Editor

`@milkdown/crepe` is Milkdown's **high-level, opinionated editor**. Where the core is a toolkit, Crepe is a product: drop in a root element, enable features, and you get a polished WYSIWYG editor with a toolbar, block handle, placeholders, and (optionally) AI.

## Two ways to build

1. **`Crepe`** — all features on by default (except `TopBar` and `AI`). Simplest entry point.
2. **`CrepeBuilder`** — add only the features you need for smaller bundles (better tree-shaking). `.addFeature(...)` then `.create()`.

## Features (flags on `Crepe.Feature`)

`Cursor`, `ListItem`, `LinkTooltip`, `ImageBlock`, `BlockEdit`, `Placeholder`, `Toolbar`, `CodeMirror`, `Table`, `Latex` are **on by default**. `TopBar` and `AI` are **off by default**.

`CrepeConfig` = `{ features?, featureConfigs?, root?, defaultValue? }`. Each feature has its own config interface (e.g. `ToolbarFeatureConfig`, `BlockEditFeatureConfig`, `CodeMirrorFeatureConfig`, `LatexFeatureConfig`, `TopBarFeatureConfig`).

## Toolbar vs TopBar

- **Toolbar** — floating bubble that appears on text selection (bold/italic/strike/code/link/latex + AI button).
- **TopBar** — always-visible fixed bar with a heading selector and formatting/list/insert/block/more groups. Disabled by default.

Buttons carry stable `data-toolbar-item="<key>"` and accessible names; shortcuts derive from keymaps via `keymapRef` so they stay correct per-platform.

## Themes

Light: `crepe.css`, `nord.css`, `frame.css`. Dark: `crepe-dark.css`, `nord-dark.css`, `frame-dark.css`. Every theme exposes CSS variables on `.milkdown` (e.g. `--crepe-base-font-size`, `--crepe-font-default`, `--crepe-color-*`).

## API surface

`Crepe` / `CrepeBuilder`: `create()`, `getMarkdown()`, `setReadonly(bool)`, `on(listener => listener.markdownUpdated(...))`. Helpers: `useCrepe`, `useCrepeFeatures`. See the entity page [[Crepe]].

## Related

- [[Milkdown Architecture]] · [[Component System]] · [[Plugin System]] · [[AI Feature]] · [[Nord Theme]]
- Entities: [[Crepe]] · [[Milkdown]] · [[Nord Theme]] · [[KaTeX]] (Latex) · [[CodeMirror]] (CodeMirror feature) · [[Mermaid]] (diagram preview)
