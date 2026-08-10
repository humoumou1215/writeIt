# @milkdown/plugin-block

为 [milkdown](https://milkdown.dev/) 提供 block 插件，用于为每个块添加操作手柄。

## 用法

#### 创建块视图

创建块视图很简单。
你只需要实现 [Prosemirror Plugin.view](https://prosemirror.net/docs/ref/#state.PluginSpec.view)。

```typescript
import { BlockProvider } from '@milkdown/kit/plugin/block'

function createBlockPluginView(ctx) {
  return (view) => {
    const content = document.createElement('div')

    const provider = new BlockProvider({
      ctx,
      content: this.content,
    })

    return {
      update: (updatedView, prevState) => {
        provider.update(updatedView, prevState)
      },
      destroy: () => {
        provider.destroy()
        content.remove()
      },
    }
  }
}
```

#### 绑定块视图

你需要在 `editor.config` 中将块视图绑定到插件。

```typescript
import { Editor } from '@milkdown/core'
import { block } from '@milkdown/plugin-block'

Editor.make()
  .config((ctx) => {
    ctx.set(block.key, {
      view: blockPluginView(ctx),
    })
  })
  .use(block)
  .create()
```

@block

## 与 React 配合使用

[![在 StackBlitz 中打开](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Milkdown/examples/tree/main/react-block)

## 与 Vue 配合使用

[![在 StackBlitz 中打开](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Milkdown/examples/tree/main/vue-block)

## API

@BlockProvider
@BlockProviderOptions

@blockPlugin
@blockSpec

@blockConfig

@ActiveNode
@DeriveContext
