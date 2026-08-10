---
title: Milkdown Monorepo
type: entity
tags: [milkdown, repository, pnpm, monorepo]
source: [[Milkdown Source Repository]]
updated: 2026-08-10
---

# Milkdown Monorepo

The upstream source repository for Milkdown (the project/entity [[Milkdown]]), stored immutably at `raw/milkdown-srouce/`. It is a **pnpm monorepo of 35 packages** and the source of truth for all Milkdown code.

## Identity

- Repo name (root): `@milkdown/monorepo` (private package).
- Canonical upstream: `github.com/Milkdown/milkdown` (per `README.md`).
- License: MIT (see `LICENSE`).
- Package manager: pnpm 11.20.0; requires Node `>=22`.

## What's inside

- **9 core libraries** — the engine and plugin framework ([[Package Catalog]]).
- **20 plugin / preset / theme packages** under `packages/plugins/`.
- **2 framework integrations** — React, Vue.
- **4 workspace packages** — `dev`, `docs`, `e2e`, `storybook`.

## Build & release

- `tsc -b` project references → Rollup + esbuild per-package build.
- Oxlint / oxfmt for lint / format; Vitest for unit; Cypress for e2e.
- Released via Changesets; published as public `@milkdown/*` scoped packages.
- The docs site (`@milkdown/docs`, `builddocs`) generates the API reference that becomes [[Milkdown Docs Corpus]].

## Relation to the wiki

- This repo is **raw truth**; the wiki pages ([[Monorepo & Build System]], [[Package Catalog]], and the concept pages) are the compiled / linkable layer.
- When the docs corpus and this source disagree: prefer **source** for code & structure, **docs corpus** for the published API surface.
- Conceptually it realizes the architecture described in [[Milkdown Architecture]] and [[Ctx Slice Timer]].

## Navigation

- [[Milkdown Source Repository]] · [[Package Catalog]] · [[Monorepo & Build System]] · [[Milkdown]]
