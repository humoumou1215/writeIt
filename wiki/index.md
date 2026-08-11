---
title: Index
type: index
tags: [index, catalog, start-here]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# Index — Milkdown Wiki Catalog

The roster of every wiki page. **Pi reads this first** when answering a question, then opens only the 2–3 linked pages it needs. One line per page: `path — one-sentence summary`.

> Raw source of truth lives in `../raw/milkdown-docs/` (immutable). This wiki is the compiled, linkable layer. See [[Overview]] for the big picture.

## Start here

- [Overview](syntheses/overview.md) — synthesized map of the whole Milkdown corpus; read this first.

## Concepts (10)

- [Monorepo & Build System](concepts/monorepo-and-build.md) — pnpm workspace layout, toolchain (TS7/Rollup/oxlint/vitest), and build/release scripts.
- [Package Catalog](concepts/package-catalog.md) — all 35 packages grouped by role with internal dependency edges; the "what depends on what" map.
- [Milkdown Architecture](concepts/milkdown-architecture.md) — the layered, plugin-driven design: core, ctx, plugins, presets, transformer, components, Crepe.
- [Ctx Slice Timer](concepts/ctx-slice-timer.md) — Milkdown's dependency-injection context: `Ctx`, `Slice`, `Timer`, lifecycle boot order.
- [Plugin System](concepts/plugin-system.md) — `MilkdownPlugin` pattern, `$`-factory helpers from `@milkdown/utils`, and the 15 bundled plugins.
- [Preset CommonMark GFM](concepts/preset-commonmark-gfm.md) — batteries-included CommonMark + GFM nodes/marks/commands (tables, task lists, strikethrough).
- [Transformer](concepts/transformer.md) — Markdown ↔ ProseMirror conversion via remark (Parser/Serializer).
- [Component System](concepts/component-system.md) — the 6 rich UI blocks: code block, image block/inline, link tooltip, list-item block, table block.
- [Crepe Editor](concepts/crepe-editor.md) — the high-level editor: features, `Crepe` vs `CrepeBuilder`, toolbar vs TopBar, themes, API.
- [AI Feature](concepts/ai-feature.md) — Crepe's streaming + diff AI workflow, OpenAI/Anthropic providers, and API-key safety.

## Entities (9)

- [Milkdown Monorepo](entities/milkdown-monorepo.md) — the upstream pnpm monorepo (35 packages) that is the raw source of truth.
- [Milkdown](entities/milkdown.md) — the plugin-driven WYSIWYG Markdown editor framework (the project).
- [Crepe](entities/crepe.md) — Milkdown's high-level, batteries-included editor product.
- [ProseMirror](entities/prosemirror.md) — the foundational editor toolkit Milkdown is built on.
- [CodeMirror](entities/codemirror.md) — CodeMirror 6 engine behind the Code Block component.
- [KaTeX](entities/katex.md) — math renderer for the Latex feature.
- [Twemoji](entities/twemoji.md) — emoji renderer for `plugin-emoji`.
- [Refractor](entities/refractor.md) — syntax-highlighting engine behind `plugin-prism`.
- [Nord Theme](entities/nord-theme.md) — lightweight Nord/Tailwind-based Milkdown theme.

- [Mermaid](entities/mermaid.md) — diagramming library; no built-in Milkdown plugin, but `renderPreview` + slash `buildMenu` integrate it (30 diagram types, verified examples).

## Sources (2)

- [Milkdown Source Repository](sources/milkdown-source-repo.md) — provenance & inventory of the immutable `raw/milkdown-srouce/` monorepo (the upstream code).
- [Milkdown Docs Corpus](sources/milkdown-docs-corpus.md) — provenance & inventory of the immutable `raw/milkdown-docs/` corpus.

## Syntheses (1)

- [Overview](syntheses/overview.md) — the synthesized big picture and navigation guide.

---

## Raw module map (corpus → wiki coverage)

Every file under `raw/milkdown-docs/` and where its knowledge lives:

| Raw file | Covered by |
| --- | --- |
| `api/core.md` | [[Milkdown Architecture]], [[Ctx Slice Timer]] |
| `api/ctx.md` | [[Ctx Slice Timer]] |
| `api/crepe.md` | [[Crepe Editor]], [[AI Feature]], [[Component System]], [[Nord Theme]] |
| `api/transformer.md` | [[Transformer]] |
| `api/utils.md` | [[Plugin System]] |
| `api/plugin-block.md` | [[Plugin System]], [[Component System]] |
| `api/plugin-clipboard.md` | [[Plugin System]] |
| `api/plugin-collab.md` | [[Plugin System]] |
| `api/plugin-cursor.md` | [[Plugin System]] |
| `api/plugin-diff.md` | [[Plugin System]], [[AI Feature]] |
| `api/plugin-emoji.md` | [[Plugin System]], [[Twemoji]] |
| `api/plugin-highlight.md` | [[Plugin System]] |
| `api/plugin-history.md` | [[Plugin System]] |
| `api/plugin-indent.md` | [[Plugin System]] |
| `api/plugin-listener.md` | [[Plugin System]] |
| `api/plugin-prism.md` | [[Plugin System]], [[Refractor]] |
| `api/plugin-slash.md` | [[Plugin System]] |
| `api/plugin-streaming.md` | [[Plugin System]], [[AI Feature]] |
| `api/plugin-tooltip.md` | [[Plugin System]], [[Component System]] |
| `api/plugin-trailing.md` | [[Plugin System]] |
| `api/plugin-upload.md` | [[Plugin System]], [[Component System]] |
| `api/preset-commonmark.md` | [[Preset CommonMark GFM]] |
| `api/preset-gfm.md` | [[Preset CommonMark GFM]] |
| `api/component-code-block.md` | [[Component System]], [[CodeMirror]] |
| `api/component-image-block.md` | [[Component System]] |
| `api/component-image-inline.md` | [[Component System]] |
| `api/component-link-tooltip.md` | [[Component System]] |
| `api/component-list-item-block.md` | [[Component System]] |
| `api/component-table-block.md` | [[Component System]], [[Preset CommonMark GFM]] |
| `api/theme-nord.md` | [[Nord Theme]], [[Crepe Editor]] |
| `src/index.ts`, `src/env.d.ts`, `package.json`, `tsconfig.json`, `templates/*` | [[Milkdown Docs Corpus]] |

### `raw/milkdown-srouce/` (source monorepo → wiki coverage)

| Raw area | Covered by |
| --- | --- |
| `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `vitest.config.mts`, lint/format configs | [[Monorepo & Build System]], [[Milkdown Monorepo]] |
| `packages/*` (9 core libs) | [[Package Catalog]], [[Milkdown Architecture]], [[Ctx Slice Timer]], [[Transformer]], [[Plugin System]], [[Component System]], [[Crepe Editor]] |
| `packages/plugins/*` (17 plugins) | [[Package Catalog]], [[Plugin System]], [[AI Feature]], [[Component System]], [[Twemoji]], [[Refractor]] |
| `packages/plugins/preset-commonmark`, `preset-gfm` | [[Package Catalog]], [[Preset CommonMark GFM]] |
| `packages/plugins/theme-nord` | [[Package Catalog]], [[Nord Theme]], [[Crepe Editor]] |
| `packages/integrations/*` (react, vue) | [[Package Catalog]] |
| `dev/`, `docs/`, `e2e/`, `storybook/`, `scripts/` | [[Monorepo & Build System]], [[Milkdown Monorepo]], [[Milkdown Docs Corpus]] |
| `README.md`, `LICENSE`, `CONTRIBUTING.md` | [[Milkdown Monorepo]], [[Milkdown]] |

_Page count: 1 overview + 10 concepts + 10 entities + 2 sources + 1 synthesis = 24 wiki pages._
