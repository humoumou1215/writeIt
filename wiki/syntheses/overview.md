---
title: Overview
type: synthesis
tags: [milkdown, overview, map, start-here]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# Overview — Milkdown Knowledge Base

A synthesized map of the Milkdown documentation corpus. **Start here**, then follow `[[…]]` links into concepts and entities. This page is the human-readable big picture; [[Index]] is the machine-friendly catalog.

## What Milkdown is

[[Milkdown]] is a **plugin-driven, WYSIWYG Markdown editor framework** built on [[ProseMirror]]. Markdown is the source of truth; ProseMirror is the editing engine; Milkdown adds a Markdown layer, a plugin system, and presets. [[Crepe]] is the ready-to-use editor product on top.

## The mental model (4 moving parts)

1. **Core + Context** — `Editor` plus the [[Ctx Slice Timer]] DI system. Everything is a typed slice in one `Ctx`; timers order boot.
2. **Presets** — [[Preset CommonMark GFM]] give you nodes/marks/commands for CommonMark + GFM (tables, task lists, strikethrough) out of the box.
3. **Plugins & Components** — [[Plugin System]] (17 capabilities: automd, block, clipboard, collab, cursor, diff, emoji, highlight, history, indent, listener, prism, slash, streaming, tooltip, trailing, upload) and [[Component System]] (6 rich UI blocks: code block, image block/inline, link tooltip, list-item block, table block).
4. **Transformer** — [[Transformer]] converts Markdown ↔ ProseMirror via remark, so content round-trips cleanly.

## Two ways to use it

- **Low-level:** `Editor.make().use(commonmark).use(gfm).use(pluginX).create()` — full control, smaller bundle via tree-shaking.
- **High-level:** `new Crepe({ root, features, featureConfigs })` or `CrepeBuilder` — polished editor with toolbar, block handle, themes, and optional AI.

## The AI angle (notable)

[[AI Feature]] (Crepe, off by default) streams model output into the doc and diff-reviews it. Built-in OpenAI/Anthropic providers exist; **never embed API keys in the browser** — use BYOK (`dangerouslyAllowBrowser: true`) or a backend proxy. This is the most operationally important caveat in the corpus.

## Dependency footprint

Milkdown leans on [[ProseMirror]] (core), [[CodeMirror]] (code block), [[KaTeX]] (math), [[Twemoji]] (emoji), and [[Refractor]] (prism highlighting). [[Nord Theme]] is an optional look.

## The source repository (raw truth)

The wiki also indexes the upstream **Milkdown monorepo source** at `raw/milkdown-srouce/` (see [[Milkdown Source Repository]]). It holds **35 packages** — 9 core libraries, 17 plugins, 2 presets, 1 theme, 2 framework integrations (React/Vue), and 4 workspace support packages (dev/docs/e2e/storybook). Build/layout details live in [[Monorepo & Build System]]; the full package graph is [[Package Catalog]]; the repo as an entity is [[Milkdown Monorepo]]. The `docs/` package uses `builddocs` to generate the API reference that becomes [[Milkdown Docs Corpus]].

## How to navigate this wiki

- **Concepts:** [[Milkdown Architecture]], [[Ctx Slice Timer]], [[Plugin System]], [[Preset CommonMark GFM]], [[Transformer]], [[Component System]], [[Crepe Editor]], [[AI Feature]], [[Monorepo & Build System]], [[Package Catalog]]
- **Entities:** [[Milkdown]], [[Crepe]], [[ProseMirror]], [[CodeMirror]], [[KaTeX]], [[Twemoji]], [[Refractor]], [[Nord Theme]], [[Milkdown Monorepo]]
- **Sources:** [[Milkdown Docs Corpus]], [[Milkdown Source Repository]]

> Maintained by Pi per [[Agent.md]]. To answer a question, read [[Index]] first, then open only the 2–3 linked pages you need.
