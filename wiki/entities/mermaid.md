---
title: Mermaid
type: entity
tags: [dependency, mermaid, diagram, code-block, render-preview]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-11
---

# Mermaid

[Mermaid](https://mermaid.js.org/) is a JavaScript diagramming library that turns text-based DSL into SVG. Milkdown has **no built-in Mermaid plugin**, but the Code Block component exposes a `renderPreview` hook designed exactly for this: any code block with `language = mermaid` can be rendered to SVG in preview mode.

## Integration points (verified in `editor-app/` editor)

1. **`codeBlockConfig.renderPreview(language, content, applyPreview)`** — return `null` for non-mermaid languages (keeps default behavior); for `mermaid` call `mermaid.render(id, content).then(({ svg }) => applyPreview(svg))`. Returning `undefined` shows the built-in loading state first.
2. **`Crepe.Feature.BlockEdit.buildMenu(builder)`** — appends custom groups/items to the `/` slash menu (the default text/list/advanced groups are kept). Each item's `onRun(ctx)` can insert a mermaid code block with default content via the `insert()` macro from `@milkdown/kit/utils`.
3. **DOMPurify** — the preview panel sanitizes rendered HTML with an SVG-aware configuration that whitelists `foreignObject` (needed by Mermaid v11+ flowchart labels), which is why Mermaid output survives sanitization.

## Supported diagram types (mermaid@11.16.1, 30 total)

| Group | Diagrams |
| --- | --- |
| Flow & structure | Flowchart · Sequence · State · Class · Block β · Mindmap · Timeline · Git |
| Modeling & relations | ER · C4 · Architecture β · Kanban · Requirement · Event Modeling · Cynefin β |
| Data & statistics | Pie · XY Chart · Quadrant · Sankey β · Radar β · Venn β · Treemap β · Info |
| Management & analysis | Gantt · Journey · Ishikawa β · Wardley β · Tree View β · Packet β · Railroad β |

Keying rules learned while validating: diagram keywords are detected by prefix regex (e.g. `flowchart`/`flowchart-v2`, `stateDiagram-v2`, `sankey-beta`, `radar-beta`, `railroad-ebnf-beta`); **identifiers/axis keys must be ASCII** — Chinese works inside quoted labels (`["中文"]`, `title "中文"`) and free text (pie labels, cynefin items) but not as node/component/set names or array elements. `zenuml` is **not** supported in the default build.

## Related

- [[CodeMirror]] · [[Crepe Editor]] · [[Component System]]
- Demo: `editor-app/src/editor/mermaid-diagrams.ts` (all 30 examples, each verified with `mermaid.parse`)
