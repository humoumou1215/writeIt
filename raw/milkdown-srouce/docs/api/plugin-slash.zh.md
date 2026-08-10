# @milkdown/plugin-slash

用于 [milkdown](https://milkdown.dev/) 的斜杠插件。
添加斜杠命令支持。

> 尽管该插件名为 _slash_，但它并不局限于斜杠命令。你也可以将它用于其他命令，例如用 `@` 触发提及，或用 `:` 触发 emoji。它的设计初衷是解决一个问题：输入某些字符，得到一个建议列表。

## 用法

#### 创建斜杠视图

创建斜杠视图很简单。
你只需要实现 [Prosemirror Plugin.view](https://prosemirror.net/docs/ref/#state.PluginSpec.view)。

```typescript
import { SlashProvider } from '@milkdown/kit/plugin/slash'

function slashPluginView(view) {
  const content = document.createElement('div')

  const provider = new SlashProvider({
    content,
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
```

#### 绑定斜杠视图

你需要在 `editor.config` 中将斜杠视图绑定到插件。

```typescript
import { Editor } from '@milkdown/core'
import { slashFactory } from '@milkdown/plugin-slash'

const slash = slashFactory('my-slash')

Editor.make()
  .config((ctx) => {
    ctx.set(slash.key, {
      view: slashPluginView,
    })
  })
  .use(slash)
  .create()
```

## 配合 React 使用

[![在 StackBlitz 中打开](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Milkdown/examples/tree/main/react-slash)

## 配合 Vue 使用

[![在 StackBlitz 中打开](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Milkdown/examples/tree/main/vue-slash)

## API

@slashFactory

@SlashProvider
@SlashProviderOptions
