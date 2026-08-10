# @milkdown/preset-gfm

用于 [milkdown](https://milkdown.dev/) 的 GitHub 风格 Markdown（GFM）预设。

> 注意：GFM 预设需要与 [commonmark 预设](https://milkdown.dev/api/preset-commonmark) 配合使用。

```typescript
import { Editor } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'

Editor.make().use(commonmark).use(gfm).create()
```

@gfm

---

# 表格

@tableSchema
@tableRowSchema
@tableHeaderSchema
@tableHeaderRowSchema
@tableCellSchema

@insertTableInputRule
@tablePasteRule
@tableKeymap

## 命令

@goToPrevTableCellCommand
@goToNextTableCellCommand
@exitTable
@insertTableCommand
@moveRowCommand
@moveColCommand
@selectRowCommand
@selectColCommand
@selectTableCommand
@deleteSelectedCellsCommand
@addColBeforeCommand
@addColAfterCommand
@addRowBeforeCommand
@addRowAfterCommand
@setAlignCommand

## 表格工具函数

@getCellsInCol
@getCellsInRow
@getAllCellsInTable
@selectCol
@selectRow
@selectTable

## Prosemirror 插件

@autoInsertSpanPlugin
@columnResizingPlugin
@tableEditingPlugin
@keepTableAlignPlugin

---

# 任务列表

@extendListItemSchemaForTask
@wrapInTaskListInputRule

---

# 删除线

@strikethroughAttr
@strikethroughSchema
@toggleStrikethroughCommand
@strikethroughKeymap
@strikethroughInputRule

---

# 脚注

@footnoteDefinitionSchema
@footnoteReferenceSchema

---

# 其他

@remarkGFMPlugin
@markInputRules
