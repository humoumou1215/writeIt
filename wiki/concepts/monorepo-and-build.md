---
title: Monorepo & Build System
type: concept
tags: [milkdown, monorepo, build, pnpm, toolchain]
source: [[Milkdown Source Repository]]
updated: 2026-08-10
---

# Monorepo & Build System

How the Milkdown codebase is organized and built, per `raw/milkdown-srouce/`. Companion to [[Package Catalog]] and the [[Milkdown Monorepo]] entity.

## Workspace layout (pnpm)

Defined in `pnpm-workspace.yaml`:

- `packages/*` — core libraries (9)
- `packages/plugins/*` — plugins, presets, themes (20)
- `packages/integrations/*` — framework bindings (react, vue)
- `e2e`, `storybook`, `dev`, `docs` — workspace support packages

The `overrides:` block swaps many legacy `es5-ext`/polyfill deps for `@nolyfill/*` to slim the install. `peerDependencyRules.ignoreMissing` covers `prosemirror-*`, `@babel/core`, and dev-only peers (cypress, jest, vue, vite). `peerDependencyRules.allowedVersions` pins react/react-dom to `18`.

## Toolchain (verified versions from root `package.json`)

- **Language**: TypeScript `^7.0.0`, strict project references (`tsconfig.base.json` → per-package `tsconfig.json`).
- **Bundler**: Rollup `^4.22.4` with `rollup-plugin-esbuild` + `@rollup/plugin-node-resolve`/`commonjs`/`json`; `terser` for minify.
- **Lint / format**: `oxlint ^1.8.0` + `oxfmt ^0.62.0` (modern replacements for ESLint/Prettier).
- **Unit tests**: `vitest ^4.0.0` (jsdom env, Testing Library).
- **E2E**: Cypress via `@milkdown/e2e`.
- **Dead-code**: `knip ^6.0.0`.
- **Release**: Changesets (`@changesets/cli`), `tsx` for scripts.
- **Git hooks**: husky + lint-staged + commitlint (`git-cz` for conventional commits).

## Build & release scripts (root `package.json`)

- `pnpm build` = `build:tsc` (`tsc -b --verbose`) then `build:post` (`pnpm -r run build`).
- `pnpm test` = `test:lint` (oxlint, `--deny-warnings`) + `test:unit` (vitest run).
- `pnpm start` / `storybook` → `@milkdown/storybook`.
- `pnpm changeset` → changeset + `scripts/changelog.mts`.
- `pnpm ci:publish` → build + publish all public packages (`-r --no-git-checks --tag latest`).
- `pnpm clear` → rimraf build artifacts (`lib`, `.rollup.cache`, `node_modules`).

## Why it matters

The layered core ([[Milkdown Architecture]] + [[Ctx Slice Timer]]) is mirrored 1:1 in the package graph: `@milkdown/core` depends on `@milkdown/ctx`/`prose`/`transformer`; `@milkdown/utils` adds plugin factories ([[Plugin System]]); `@milkdown/kit` bundles them; `@milkdown/crepe` (see [[Crepe Editor]]) is the consumer-facing product. The full graph and tiers are in [[Package Catalog]].

## Navigation

- [[Milkdown Source Repository]] · [[Package Catalog]] · [[Milkdown Monorepo]] · [[Milkdown Architecture]] · [[Ctx Slice Timer]]
