# @milkdown/preset-commonmark

用于 [milkdown](https://milkdown.dev/) 的 Commonmark 预设。

```typescript
import { Editor } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'

Editor.make().use(commonmark).create()
```

@commonmark

# 属性

名为 `attr` 的上下文用于设置节点和标记的属性（attribute）。你可以通过在 `editor.config` 中设置 `attr` 来设定这些属性。

例如，你可以设置所有 `paragraph` 节点的 `data-test-id` 和 `class`。

```typescript
import { commonmark, paragraphAttr } from '@milkdown/kit/preset/commonmark'

Editor.make()
  .config((ctx) => {
    ctx.set(paragraphAttr.key, {
      'data-test-id': uuid(),
      class: 'paragraph',
    })
  })
  .use(commonmark)
  .create()
```

---

# 节点

## 文档

@docSchema

## 文本

@textSchema

## 段落

@paragraphAttr
@paragraphSchema
@turnIntoTextCommand
@paragraphKeymap

## 标题

@headingAttr
@headingSchema
@headingIdGenerator
@wrapInHeadingInputRule
@wrapInHeadingCommand
@downgradeHeadingCommand
@headingKeymap

## 图片

@imageAttr
@imageSchema
@insertImageCommand
@updateImageCommand
@insertImageInputRule

## 引用块

@blockquoteAttr
@blockquoteSchema
@wrapInBlockquoteInputRule
@wrapInBlockquoteCommand
@blockquoteKeymap

## 有序列表

@orderedListAttr
@orderedListSchema
@wrapInOrderedListInputRule
@wrapInOrderedListCommand
@orderedListKeymap

## 无序列表

@bulletListAttr
@bulletListSchema
@wrapInBulletListInputRule
@wrapInBulletListCommand
@bulletListKeymap

## 列表项

@listItemAttr
@listItemSchema
@sinkListItemCommand
@liftListItemCommand
@splitListItemCommand
@liftFirstListItemCommand
@listItemKeymap

## 代码块

@codeBlockAttr
@codeBlockSchema
@createCodeBlockInputRule
@createCodeBlockCommand
@updateCodeBlockLanguageCommand
@codeBlockKeymap

## 硬换行

@hardbreakAttr
@hardbreakSchema
@insertHardbreakCommand
@hardbreakKeymap

## 水平分割线

@hrAttr
@hrSchema
@insertHrInputRule
@insertHrCommand

## HTML

@htmlAttr
@htmlSchema

---

# 标记

## 强调

@emphasisAttr
@emphasisSchema
@toggleEmphasisCommand
@emphasisKeymap
@emphasisStarInputRule
@emphasisUnderscoreInputRule

## 加粗

@strongAttr
@strongSchema
@toggleStrongCommand
@strongKeymap
@strongInputRule

## 行内代码

@inlineCodeAttr
@inlineCodeSchema
@toggleInlineCodeCommand
@inlineCodeKeymap
@inlineCodeInputRule

## 链接

@linkAttr
@linkSchema
@toggleLinkCommand
@updateLinkCommand
@sanitizeLinkHref

---

# 工具命令

@isMarkSelectedCommand
@isNodeSelectedCommand
@clearTextInCurrentBlockCommand
@setBlockTypeCommand
@wrapInBlockTypeCommand
@addBlockTypeCommand
@selectTextNearPosCommand

---

# Prosemirror 插件

@inlineNodesCursorPlugin

@hardbreakFilterPlugin
@hardbreakFilterNodes

@syncHeadingIdPlugin

@syncListOrderPlugin

@hardbreakClearMarkPlugin

---

# Remark 插件

@remarkInlineLinkPlugin
@remarkAddOrderInListPlugin
@remarkLineBreak
@remarkMarker
