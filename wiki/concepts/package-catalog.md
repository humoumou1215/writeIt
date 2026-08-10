---
title: Package Catalog
type: concept
tags: [milkdown, packages, catalog, dependencies]
source: [[Milkdown Source Repository]]
updated: 2026-08-10
---

# Package Catalog

All **35 packages** in `raw/milkdown-srouce/`, grouped by role. Internal `@milkdown/*` dependencies are listed so you can trace the build graph. Cross-links point to existing wiki pages where a package is detailed elsewhere. See also the [[Milkdown Monorepo]] entity and [[Monorepo & Build System]].

## Core libraries (9)

| Package | Role | Internal deps |
| --- | --- | --- |
| `@milkdown/exception` | Error / assertion utilities. **Leaf** — no dependencies. | — |
| `@milkdown/ctx` | Dependency-injection context: `Ctx`, `Slice`, `Timer` (see [[Ctx Slice Timer]]). | exception |
| `@milkdown/prose` | Thin wrappers / re-exports over ProseMirror (see [[ProseMirror]]). | exception |
| `@milkdown/transformer` | Markdown ↔ ProseMirror via remark — Parser/Serializer (see [[Transformer]]). | exception, prose |
| `@milkdown/core` | The `Editor` class and boot lifecycle (see [[Milkdown Architecture]]). | ctx, exception, prose, transformer |
| `@milkdown/utils` | `$`-factory helpers + `MilkdownPlugin` base (see [[Plugin System]]). | core, ctx, exception, prose, transformer |
| `@milkdown/components` | Rich UI blocks: code/image/table/list-item/link-tooltip (see [[Component System]]). Peer: `@codemirror/*`. | core, ctx, exception, plugin-diff, plugin-tooltip, preset-commonmark, preset-gfm, prose, transformer, utils |
| `@milkdown/kit` | Batteries-included bundle: core + components + block/clipboard/cursor/diff/history/indent/listener/slash/streaming/tooltip/trailing/upload + both presets. | (nearly all core + plugins + presets) |
| `@milkdown/crepe` | High-level editor product (see [[Crepe Editor]], [[AI Feature]]). | kit |

## Plugins (17) — `packages/plugins/*`

Each is a `MilkdownPlugin` (see [[Plugin System]]). Baseline deps `core, ctx, prose, utils` are omitted below unless notable.

| Package | Role | Notable deps |
| --- | --- | --- |
| `plugin-automd` | Auto-format / `automd` transforms. | (baseline) |
| `plugin-block` | Block-level handle / drag UI. | (baseline) |
| `plugin-clipboard` | Rich clipboard (HTML / Markdown paste & copy). | (baseline) |
| `plugin-collab` | Collaboration (Yjs). Peer: `yjs`, `y-prosemirror`, `y-protocols`. | exception |
| `plugin-cursor` | Remote / selection cursor. | — |
| `plugin-diff` | Diff / replace — powers [[AI Feature]] streaming diff. | transformer |
| `plugin-emoji` | Emoji picker (see [[Twemoji]]). | exception, transformer |
| `plugin-highlight` | Text highlight mark. | — |
| `plugin-history` | Undo / redo stack. | — |
| `plugin-indent` | List / paragraph indentation. | — |
| `plugin-listener` | DOM / selection event listeners. | (no utils) |
| `plugin-prism` | Syntax highlighting (see [[Refractor]]). | — |
| `plugin-slash` | Slash command menu. | — |
| `plugin-streaming` | Streaming insert — powers [[AI Feature]]. | plugin-diff |
| `plugin-tooltip` | Floating tooltip (used by components). | — |
| `plugin-trailing` | Trailing node (always-end paragraph). | — |
| `plugin-upload` | Image / file upload. | exception |

> [LINT] The earlier [[Plugin System]] page stated "15 bundled plugins"; the source repo actually contains **17** plugin packages. Treat **17** as authoritative — the docs corpus predates `plugin-automd` / `plugin-collab` additions. Update note recorded on both pages.

## Presets (2)

| Package | Role | Notable deps |
| --- | --- | --- |
| `preset-commonmark` | CommonMark nodes/marks/commands (see [[Preset CommonMark GFM]]). | exception, transformer |
| `preset-gfm` | GitHub-Flavored Markdown (tables, task lists, strikethrough). Depends on `preset-commonmark`. | preset-commonmark, exception, transformer |

## Themes (1)

| Package | Role | deps |
| --- | --- | --- |
| `theme-nord` | Nord / Tailwind theme (see [[Nord Theme]]). | core, ctx, prose |

## Framework integrations (2) — `packages/integrations/*`

| Package | Role | peerDeps |
| --- | --- | --- |
| `@milkdown/react` | React binding for Crepe / editor. | react, react-dom |
| `@milkdown/vue` | Vue binding for Crepe / editor. | vue |

## Workspace support (4)

| Package | Role | deps |
| --- | --- | --- |
| `@milkdown/dev` | Internal build/dev helper (lodash, chalk, jsonc-parser); no `bin`. | — |
| `@milkdown/docs` | Documentation site; uses `builddocs` to generate [[Milkdown Docs Corpus]]. | @milkdown/dev |
| `@milkdown/e2e` | End-to-end test playground (Cypress). | many core/plugin pkgs |
| `@milkdown/storybook` | Component explorer. | crepe, kit, theme-nord |

## Dependency tiers (bottom → top)

1. `exception`
2. `ctx`, `prose`
3. `transformer`
4. `core`
5. `utils`
6. `components` + plugins
7. `kit`
8. `crepe`
9. integrations (`react` / `vue`)

This mirrors the conceptual layers in [[Milkdown Architecture]] and is the canonical "what depends on what" map.

## Navigation

- [[Milkdown Source Repository]] · [[Monorepo & Build System]] · [[Milkdown Monorepo]] · [[Milkdown Architecture]] · [[Plugin System]]
