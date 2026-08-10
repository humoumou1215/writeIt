# @milkdown/plugin-listener

milkdown 的监听器插件。

## 用法

```typescript
import { Editor } from '@milkdown/kit/core'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { nord } from '@milkdown/theme-nord'

Editor.make()
  .config((ctx) => {
    const listener = ctx.get(listenerCtx)

    listener.markdownUpdated((ctx, markdown, prevMarkdown) => {
      if (markdown !== prevMarkdown) {
        YourMarkdownUpdater(markdown)
      }
    })
  })
  .use(listener)
  // 使用其他插件
  .create()
```

## 插件

@key
@listener

## 监听器

@listenerCtx

@ListenerManager
@Subscribers
