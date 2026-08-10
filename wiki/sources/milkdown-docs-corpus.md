---
title: Milkdown Docs Corpus
type: source
tags: [milkdown, docs, corpus, raw]
source: raw/milkdown-docs
updated: 2026-08-10
---

# Milkdown Docs Corpus

The authoritative raw source for this wiki. It is **immutable**: Pi (the agent) reads from it but never edits it. If a wiki page is ever wrong, the correction is traced back here.

## Provenance

- **Origin:** Auto-generated API documentation for the [Milkdown](https://milkdown.dev/) project (`@milkdown/docs`, v1.0.0).
- **Generation:** Built by `src/index.ts` using `builddocs`, which reads each `@milkdown/*` package's `src/index.ts` and renders Markdown via the templates in `templates/` (class / define / enum / typealias).
- **Mirror location:** `raw/milkdown-docs/`
  - `api/` — 30 module docs (one `.md` per `@milkdown/*` package or component group)
  - `src/index.ts`, `src/env.d.ts` — the doc-builder entry point and its type shim
  - `package.json`, `tsconfig.json` — build config
  - `templates/` — builddocs templates used to render each module

## What is inside

28 module API docs + 2 build scripts, covering: core, ctx, crepe, transformer, utils, 15 plugins, 2 presets, 6 components, and the Nord theme. See [[Milkdown Architecture]] for how the modules relate, and [[Index]] for the full page catalog.

## Ingestion note

These docs are **build artifacts**, not hand-written prose. They list exported symbols (`@Editor`, `@Crepe`, `@Slice`, etc.) and configuration tables. The wiki pages synthesize them into concepts, entities, and cross-links so they can be queried without re-reading the raw files every time.

## Last ingested

2026-08-10 — full corpus indexed into [[Overview]] and the concept/entity pages.
