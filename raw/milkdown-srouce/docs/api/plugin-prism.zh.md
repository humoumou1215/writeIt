# @milkdown/plugin-prism

用于 [milkdown](https://milkdown.dev/) 的 Prism 插件。
添加 Prism 高亮支持。
该包使用 [refractor](https://www.npmjs.com/package/refractor)，因此具备与 refractor 相同的支持范围与限制。

> **来自 refractor 的 README：**
>
> 只有 refractor/lang/*.js 中自定义构建的语法才能与 refractor 配合工作，因为 Prism 自身的语法是依赖全局变量构建的，无法被导入。
>
> 出于同样的限制，Refractor 也不支持 Prism 插件，因为它们几乎完全是针对 DOM 处理的。

## 用法

```typescript
import { Editor } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { prism } from '@milkdown/plugin-prism'

Editor.make().use(commonmark).use(prism).create()
```

⚠️ 请注意，你需要自行导入 prism 的样式。

例如，使用 [prism-themes](https://www.npmjs.com/package/prism-themes)。

```typescript
import 'prism-themes/themes/prism-nord.css'
```

@prism

@prismConfig
@prismPlugin

## 注册语言

默认情况下，refractor 不会注册任何语言。你可以自行注册语言。

```typescript
import { prism, prismConfig } from '@milkdown/plugin-prism'
import css from 'refractor/lang/css'
import javascript from 'refractor/lang/javascript'
import jsx from 'refractor/lang/jsx'
import markdown from 'refractor/lang/markdown'
import tsx from 'refractor/lang/tsx'
import typescript from 'refractor/lang/typescript'

Editor.make()
  .config((ctx) => {
    ctx.set(prismConfig.key, {
      configureRefractor: (refractor) => {
        refractor.register(markdown)
        refractor.register(css)
        refractor.register(javascript)
        refractor.register(typescript)
        refractor.register(jsx)
        refractor.register(tsx)
      },
    })
  })
  .use(prism)
  .create()
```

## 其他方案

如果你更倾向于使用其他高亮器，我们提供了一个示例，演示如何使用 [shiki](https://shiki.matsu.io/) 构建高亮插件。

[![在 StackBlitz 中打开](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Milkdown/examples/tree/main/vanilla-shiki-highlight)
