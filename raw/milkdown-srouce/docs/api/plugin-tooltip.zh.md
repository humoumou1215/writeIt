# @milkdown/plugin-tooltip

用于 [milkdown](https://milkdown.dev/) 的提示框插件。
为 milkdown 添加通用提示框支持。

## 用法

#### 创建提示框视图

创建提示框视图很简单。
你只需要实现 [Prosemirror Plugin.view](https://prosemirror.net/docs/ref/#state.PluginSpec.view)。

```typescript
import { TooltipProvider } from '@milkdown/kit/plugin/tooltip'

function tooltipPluginView(view) {
  const content = document.createElement('div')

  const provider = new TooltipProvider({
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
```

#### 绑定提示框视图

你需要在 `editor.config` 中将提示框视图绑定到插件。

```typescript
import { Editor } from '@milkdown/core'
import { tooltipFactory } from '@milkdown/plugin-tooltip'

const tooltip = tooltipFactory('my-tooltip')

Editor.make()
  .config((ctx) => {
    ctx.set(tooltip.key, {
      view: tooltipPluginView,
    })
  })
  .use(tooltip)
  .create()
```

## 配合 React 使用

[![在 StackBlitz 中打开](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Milkdown/examples/tree/main/react-tooltip)

## 配合 Vue 使用

[![在 StackBlitz 中打开](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Milkdown/examples/tree/main/vue-tooltip)

## API

@tooltipFactory

@TooltipProvider
@TooltipProviderOptions
