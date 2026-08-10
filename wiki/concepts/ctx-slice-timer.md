---
title: Ctx Slice Timer
type: concept
tags: [milkdown, ctx, slice, timer, di, lifecycle]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# Ctx Slice Timer

`@milkdown/ctx` is Milkdown's **dependency-injection / service-locator** layer. The whole editor is a single `Ctx` object that holds named, typed values called **slices**. Plugins publish and consume slices instead of using globals or constructor wiring.

## Core primitives (from `@milkdown/ctx`)

- **`Ctx`** — the container. `ctx.get(slice.key)` reads a value; `ctx.set(slice.key, v)` / `ctx.update(slice.key, fn)` writes it.
- **`Slice` / `SliceType` / `createSlice`** — a typed, named container for a single value. `createSlice(defaultValue, 'name')` returns a slice with a `.key`.
- **`Container`** — the underlying store behind `Ctx`.
- **`Timer` / `TimerType` / `createTimer`** — declarative lifecycle dependencies. A plugin declares "I am ready after X and Y" so the editor initializes deterministically.
- **`Clock`** — drives the timer scheduling.
- **`MilkdownPlugin`** — the unit of extensibility: `(ctx, utils) => void` (or with a cleanup). Plugins are what you `.use(...)` on the editor.
- **`Inspector` / `Telemetry` / `Meta` / `TimerStatus`** — observability helpers for debugging plugin/timer state.

## How slices are used in core

`@milkdown/core` exposes dozens of slices (see [[Milkdown Architecture]]) such as:

- Schema: `schemaCtx`, `nodesCtx`, `marksCtx`
- Parser: `parserCtx`, `remarkPluginsCtx`, `remarkCtx`, `remarkStringifyOptionsCtx`
- Serializer: `serializerCtx`
- Commands: `commandsCtx`, `CommandManager`, `createCmdKey`, `CommandChain`
- Keymap: `keymapCtx`, `KeymapManager`
- View: `editorViewCtx`, `editorStateCtx`, `rootCtx`, `defaultValueCtx`
- Input/paste: `inputRulesCtx`, `pasteRulesCtx`

## Timer lifecycle (boot order)

Each phase has a `…Ready` timer and a `…TimerCtx` slice:

`ConfigReady → InitReady → SchemaReady → ParserReady → SerializerReady → CommandsReady → KeymapReady → EditorStateReady → EditorViewReady`

Plugins declare prerequisites via `ctx.timer`, so e.g. the [[Preset CommonMark GFM|CommonMark preset]] waits for `SchemaReady` before registering its nodes.

## Why it matters

- **Decoupling:** a plugin reads `commandsCtx` without knowing who created it.
- **Ordering:** timers prevent "used before defined" races during boot.
- **Testability & composition:** swap slices (e.g. a custom parser) without touching plugins.

## Related

- [[Milkdown Architecture]] · [[Plugin System]] · [[Transformer]]
- Entity: [[Milkdown]]
