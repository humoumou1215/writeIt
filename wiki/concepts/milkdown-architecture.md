---
title: Milkdown Architecture
type: concept
tags: [milkdown, architecture, core, plugin, preset]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# Milkdown Architecture

Milkdown is a **plugin-driven, WYSIWYG markdown editor framework** built on top of [ProseMirror](https://prosemirror.net/). Instead of a monolithic editor, it is a small **core** plus a constellation of **plugins**, **presets**, **transformers**, and **UI components**, all wired together through a dependency-injection **context** system.

## The layers

1. **Core (`@milkdown/core`)** — the `Editor` class, the lifecycle timers, and the slices that hold schema/parser/serializer/commands/keymap state. See [[Ctx Slice Timer]].
2. **Context system (`@milkdown/ctx`)** — `Ctx`, `Slice`, `Timer`, `Container`, `MilkdownPlugin`. Every value the editor shares is a slice in the context. See [[Ctx Slice Timer]].
3. **Plugins (`@milkdown/plugin-*`)** — ~15 optional capabilities (history, cursor, clipboard, upload, slash, tooltip, trailing, collab, diff, streaming, emoji, highlight, prism, indent, listener). Each is a `MilkdownPlugin`. See [[Plugin System]].
4. **Presets (`@milkdown/preset-commonmark`, `@milkdown/preset-gfm`)** — batteries-included bundles of nodes/marks/commands/keymaps for CommonMark and GitHub-Flavored Markdown. See [[Preset CommonMark GFM]].
5. **Transformer (`@milkdown/transformer`)** — converts between the ProseMirror document and the Markdown AST (remark). See [[Transformer]].
6. **Components (`@milkdown/components/*`)** — rich UI blocks (code block, image block/inline, link tooltip, list-item block, table block). See [[Component System]].
7. **Crepe (`@milkdown/crepe`)** — a high-level, opinionated editor that turns the above into a ready-to-use product with a toolbar, block handle, and AI feature. See [[Crepe Editor]] and [[AI Feature]].
8. **Utils (`@milkdown/utils`)** — factory helpers (`$node`, `$mark`, `$command`, `$view`, `$inputRule`, …) used to author plugins and nodes. See [[Plugin System]].

## Data flow

```
Markdown ──(Parser)──> ProseMirror Doc ──(render)──> Editor UI
   ^                      |                            |
   |                      v                            v
   └────(Serializer)──── Schema/Ctx ──────(Plugins)── Commands / Keymaps
```

The editor holds a single `Ctx`. Plugins read and write slices (e.g. `schemaCtx`, `parserCtx`, `commandsCtx`). Lifecycle **timers** (`ConfigReady`, `SchemaReady`, `ParserReady`, `SerializerReady`, `CommandsReady`, `KeymapReady`, `InitReady`, `EditorStateReady`, `EditorViewReady`) let plugins declare dependencies so the editor boots in the right order.

## Key takeaways

- Milkdown is **composable by design**: you assemble an editor from plugins + presets, or use [[Crepe Editor]] for zero-config.
- Everything flows through the **context** — understanding [[Ctx Slice Timer]] is the key to extending Milkdown.
- Markdown fidelity is handled by the [[Transformer]], not by the core.

## Related

- [[Plugin System]] · [[Preset CommonMark GFM]] · [[Transformer]] · [[Component System]] · [[Crepe Editor]] · [[Ctx Slice Timer]]
- Entities: [[Milkdown]] · [[ProseMirror]] · [[Crepe]]
