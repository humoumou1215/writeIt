# @milkdown/plugin-cursor

添加 [drop cursor](https://github.com/ProseMirror/prosemirror-dropcursor) 与
[gap cursor](https://github.com/ProseMirror/prosemirror-gapcursor) 支持。

## 用法

```typescript
import { Editor } from '@milkdown/kit/core'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { nord } from '@milkdown/theme-nord'

Editor.make().use(nord).use(commonmark).use(cursor).create()
```

@cursor

## 上下文

@dropIndicatorConfig
@dropIndicatorState

## 插件

@dropIndicatorDOMPlugin
@dropIndicatorPlugin
@gapCursorPlugin

## 已废弃

@dropCursorConfig
