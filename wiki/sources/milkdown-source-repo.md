---
title: Milkdown Source Repository
type: source
tags: [milkdown, source-repo, monorepo, pnpm]
source: [[Milkdown Source Repository]]
updated: 2026-08-10
---

# Milkdown Source Repository

Provenance and inventory of the immutable corpus at `raw/milkdown-srouce/` (the original directory name carries a typo — `srouce` instead of `source`; that is preserved as-is). This is the **full Milkdown pnpm monorepo source** — the upstream code from which the API-reference corpus (`raw/milkdown-docs/`, see [[Milkdown Docs Corpus]]) is generated.

## Inventory

- **Root config**: `README.md`, `package.json` (`@milkdown/monorepo`, private), `pnpm-workspace.yaml`, `pnpm-lock.yaml` (350 KB), `tsconfig*.json`, `vitest.config.mts`, plus lint/format configs (`.oxlintrc.json`, `.oxfmtrc.json`, `.editorconfig`, `commitlint.config.js`, `.lintstagedrc.json`, `knip.json`).
- **packages/** — 9 core libraries + `packages/plugins/*` (17 plugins + 2 presets + 1 theme) + `packages/integrations/*` (react, vue).
- **dev/** — `@milkdown/dev` internal build/dev helper.
- **docs/** — `@milkdown/docs` documentation site; uses `builddocs` to generate the API reference that becomes [[Milkdown Docs Corpus]].
- **e2e/** — `@milkdown/e2e` end-to-end test playground (Cypress).
- **storybook/** — `@milkdown/storybook` component explorer.
- **scripts/** — `changelog.mts` (changeset changelog), `gen-ts-config.mts` (TS project-references config generation).

## Key facts (verified directly from raw)

- Package manager: `pnpm@11.20.0`; engine requires Node `>=22`.
- **35 packages total** — see [[Package Catalog]] and the [[Milkdown Monorepo]] entity.
- Build pipeline: `tsc -b` project references → per-package Rollup + esbuild build (`pnpm build:tsc && pnpm build:post`).
- Lint/format: `oxlint` + `oxfmt`; unit tests: `vitest`; dead-code scan: `knip`.
- Releases via Changesets (`changeset` / `ci:publish`); conventional commits via `commitlint` + `git-cz` (husky).
- `pnpm-workspace.yaml` overrides swap legacy `es5-ext`/polyfill deps for `@nolyfill/*`; `peerDependencyRules.ignoreMissing` covers prosemirror-* and dev-only peers.

## Relation to other corpora

- `raw/milkdown-docs/` ([[Milkdown Docs Corpus]]) is a **downstream build artifact** of this repo's `docs/` + `builddocs`. When the two disagree:
  - **This source repo is authority** for how the code is structured and built ([[Monorepo & Build System]]).
  - **The docs corpus is authority** for the published API surface (symbol signatures, options).
- The conceptual layering in [[Milkdown Architecture]] maps 1:1 onto the package dependency tiers in [[Package Catalog]].

## Navigation

- [[Monorepo & Build System]] · [[Package Catalog]] · [[Milkdown Monorepo]] · [[Milkdown Docs Corpus]] · [[Milkdown]]
