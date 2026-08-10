---
title: Plugin System
type: concept
tags: [milkdown, plugin, utils, extensibility]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# Plugin System

Milkdown is extended by **plugins** — `MilkdownPlugin` values added via `Editor.make().use(plugin)`. Plugins register nodes, marks, commands, keymaps, input/paste rules, and UI views, usually by writing into the shared [[Ctx Slice Timer|context slices]].

## Authoring helpers — `@milkdown/utils`

The `utils` package ships `$`-prefixed factories that return plugins:

- Node/mark: `$node`, `$nodeAsync`, `$mark`, `$markAsync`, `$nodeSchema`, `$markSchema`, `$nodeAttr`, `$markAttr`
- Context: `$ctx`, `$remark`, `$prose`, `$proseAsync`
- Input/paste: `$inputRule`, `$inputRuleAsync`, `$pasteRule`, `$pasteRuleAsync`
- Commands/shortcuts: `$command`, `$commandAsync`, `$shortcut`, `$shortcutAsync`, `$useKeymap`
- View: `$view`, `$viewAsync`

Plus runtime utilities: `getHTML`, `getMarkdown`, `markdownToSlice`, `outline`, `insert`, `insertPos`, `replaceAll`, `replaceRange`, `callCommand`, `setAttr`, `forceUpdate`.

## Catalog of bundled plugins

| Plugin | Purpose | Key exports |
| --- | --- | --- |
| `@milkdown/plugin-block` | Per-block drag handle / block menu | `block`, `BlockProvider`, `blockSpec`, `ActiveNode`, `DeriveContext` |
| `@milkdown/plugin-clipboard` | Copy/paste as Markdown | `clipboard` |
| `@milkdown/plugin-collab` | Collaborative editing (Yjs-style) | `collab`, `CollabService`, `collabServiceCtx` |
| `@milkdown/plugin-cursor` | Drop & gap cursors | `cursor`, `dropCursorConfig`, `gapCursorPlugin` |
| `@milkdown/plugin-diff` | Diff review (accept/reject changes) | `diff`, `startDiffReviewCmd`, `acceptDiffChunkCmd`, `rejectDiffChunkCmd`, `computeDocDiff` |
| `@milkdown/plugin-emoji` | `:emoji:` shortcuts → Twemoji | `emoji`, `remarkEmojiPlugin`, `remarkTwemojiPlugin` |
| `@milkdown/plugin-highlight` | Text highlighting (prosemirror-highlight) | `highlight`, `highlightPlugin` |
| `@milkdown/plugin-history` | Undo/redo | `history`, `undoCommand`, `redoCommand`, `historyKeymap` |
| `@milkdown/plugin-indent` | Tab/shift-tab indent | `indent`, `indentConfig` |
| `@milkdown/plugin-listener` | Event subscriptions (`markdownUpdated`, etc.) | `listener`, `listenerCtx`, `ListenerManager`, `Subscribers` |
| `@milkdown/plugin-prism` | Syntax highlighting via Refractor | `prism`, `prismConfig` |
| `@milkdown/plugin-slash` | Slash command menu (generic, not just `/`) | `slashFactory`, `SlashProvider` |
| `@milkdown/plugin-streaming` | Token-by-token streaming into the editor (AI output) | `streaming`, `startStreamingCmd`, `pushChunkCmd`, `endStreamingCmd`, `InsertStrategy` |
| `@milkdown/plugin-tooltip` | Reusable floating tooltip | `tooltipFactory`, `TooltipProvider` |
| `@milkdown/plugin-trailing` | Auto-append a trailing paragraph | `trailing`, `trailingConfig` |
| `@milkdown/plugin-upload` | Drag/drop & paste to upload files as nodes | `upload`, `uploadConfig`, `defaultUploader`, `readImageAsBase64` |
| `@milkdown/plugin-automd` | Auto-format / `automd` transforms on content | `automd` |

## Two plugins are especially central to AI workflows

- **`plugin-streaming`** streams Markdown tokens into the doc with progressive rendering — the engine behind [[AI Feature]].
- **`plugin-diff`** lets users accept/reject streamed AI edits — also wired into [[AI Feature]].

> [LINT] Reconciled with the source repo ([[Milkdown Source Repository]] / [[Package Catalog]]): Milkdown ships **17 plugins**. This page originally listed 16 (missing `plugin-automd`); it is added above. With the two presets and `theme-nord`, `packages/plugins/` holds 20 packages total. See [[Package Catalog]] for the full list.

## Related

- [[Milkdown Architecture]] · [[Ctx Slice Timer]] · [[Component System]] · [[AI Feature]]
- Entity: [[Milkdown]]
