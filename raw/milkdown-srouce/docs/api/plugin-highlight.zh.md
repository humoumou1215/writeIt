# @milkdown/plugin-highlight

用于 [milkdown](https://milkdown.dev/) 的高亮插件。
构建于 [prosemirror-highlight](https://github.com/ocavue/prosemirror-highlight) 之上。

支持：

- [Shiki](https://github.com/shikijs/shiki)
- [Lowlight](https://github.com/robertknight/lowlight.js)（基于 [Highlight.js](https://github.com/highlightjs/highlight.js)）
- [Refractor](https://github.com/wooorm/refractor)（基于 [Prism.js](https://github.com/PrismJS/prism)）
- [Sugar high](https://github.com/huozhi/sugar-high)

@highlight
@highlightPluginConfig
@highlightPlugin

## 用法

```typescript
// 对于 shiki
import { getSingletonHighlighter } from 'shiki'
import { createParser } from '@milkdown/plugin-highlight/shiki'
const highlighter = await getSingletonHighlighter({
  themes: ['github-light'],
  langs: ['javascript', 'typescript', 'python'],
})
const parser = createParser(highlighter)

// 对于 lowlight
import 'highlight.js/styles/default.css'
import { common, createLowlight } from 'lowlight'
import { createParser } from '@milkdown/plugin-highlight/lowlight'
const lowlight = createLowlight(common)
const parser = createParser(lowlight)

// 对于 refractor
import { refractor } from 'refractor/all'
import { createParser } from '@milkdown/plugin-highlight/refractor'
const parser = createParser(refractor)

// 对于 sugar high
import { createParser } from '@milkdown/plugin-highlight/sugar-high'
const parser = createParser()

// 初始化
import { highlight, highlightPluginConfig } from '@milkdown/plugin-highlight'
Editor.make()
  .config((ctx) => {
    ctx.set(highlightPluginConfig.key, { parser })
  })
  .use(highlight)
  .create()
```
