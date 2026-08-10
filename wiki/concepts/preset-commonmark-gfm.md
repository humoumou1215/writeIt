---
title: Preset CommonMark GFM
type: concept
tags: [milkdown, preset, commonmark, gfm, nodes, marks]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# Preset CommonMark GFM

Presets are batteries-included bundles of **nodes, marks, commands, keymaps, and input rules**. You `.use()` them on the editor instead of wiring each piece by hand.

## `@milkdown/preset-commonmark`

Implements the CommonMark spec. Exports ~95 symbols, including:

- **Block schemas:** `docSchema`, `paragraphSchema`, `headingSchema`, `blockquoteSchema`, `orderedListSchema`, `bulletListSchema`, `listItemSchema`, `imageSchema`, `textSchema`
- **Commands:** `wrapInHeadingCommand`, `downgradeHeadingCommand`, `insertImageCommand`, `updateImageCommand`, `wrapInBlockquoteCommand`, `wrapInOrderedListCommand`, `wrapInBulletListCommand`, `sinkListItemCommand`, `liftListItemCommand`, `splitListItemCommand`, `turnIntoTextCommand`
- **Input rules:** `wrapInHeadingInputRule`, `insertImageInputRule`, `wrapInBlockquoteInputRule`, `wrapIn*ListInputRule`
- **Keymaps:** `paragraphKeymap`, `headingKeymap`, `blockquoteKeymap`, `orderedListKeymap`, `bulletListKeymap`
- **Attrs:** `headingAttr`, `imageAttr`, `blockquoteAttr`, `orderedListAttr`, `bulletListAttr`, `listItemAttr`, `paragraphAttr`

## `@milkdown/preset-gfm`

GitHub-Flavored Markdown on top of CommonMark. **Must be used together with the CommonMark preset.** Exports ~45 symbols:

- **Tables:** `tableSchema`, `tableRowSchema`, `tableHeaderSchema`, `tableCellSchema`, `insertTableCommand`, `tableKeymap`, `moveRowCommand`, `moveColCommand`, `addRowBefore/AfterCommand`, `addColBefore/AfterCommand`, `deleteSelectedCellsCommand`, `setAlignCommand`, `selectRow/Col/TableCommand`, `columnResizingPlugin`, `tableEditingPlugin`, `keepTableAlignPlugin`, `autoInsertSpanPlugin`
- **Task lists:** `extendListItemSchemaForTask`, `wrapInTaskListInputRule`
- **Strikethrough:** `strikethroughSchema`, `toggleStrikethroughCommand`, `strikethroughKeymap`
- Helpers: `getCellsInCol`, `getCellsInRow`, `getAllCellsInTable`, `insertTableInputRule`, `tablePasteRule`, `exitTable`

## Usage pattern

```ts
import { Editor } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'

await Editor.make().use(commonmark).use(gfm).create()
```

## Related

- [[Milkdown Architecture]] · [[Ctx Slice Timer]] · [[Component System]] · [[Plugin System]]
- Entity: [[Milkdown]]
