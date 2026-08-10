# @milkdown/plugin-history

为 [milkdown](https://milkdown.dev/) 提供历史撤销与重做支持。

## 用法

```typescript
import { Editor } from '@milkdown/kit/core'
import { history } from '@milkdown/kit/plugin/history'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { nord } from '@milkdown/theme-nord'

Editor.make().use(nord).use(commonmark).use(history).create()
```

## 插件

@history
@historyProviderConfig
@historyProviderPlugin

## 快捷键

@historyKeymap

你可以通过 `historyKeymap.key` 重新映射快捷键。

```typescript
import { history, historyKeymap } from '@milkdown/plugin-history'

Editor.make()
  .config((ctx) => {
    ctx.set(historyKeymap.key, {
      // 重新映射为单个快捷键。
      Undo: 'Mod-z',
      // 重新映射为多个快捷键。
      Redo: ['Mod-y', 'Shift-Mod-z'],
    })
  })
  .use(nord)
  .use(commonmark)
  .use(history)
  .create()
```

## 命令

@undoCommand
@redoCommand

你可以通过编程方式调用这些命令。

```typescript
import { Undo, history } from '@milkdown/plugin-history'
import { callCommand } from '@milkdown/plugin-utils'

const editor = await Editor.make().use(/* ... */).use(history).create()

editor.action(callCommand(Undo))
```
