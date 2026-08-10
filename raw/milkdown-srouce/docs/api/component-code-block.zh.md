# 代码块组件

`codeBlock` 组件使用 [Codemirror](https://codemirror.net/) 编辑器渲染代码块。

该组件提供以下功能：

- [x] 语言选择器
- [x] 语法高亮
- [x] 行号
- [x] 代码自动补全与折叠
- [x] 代码搜索与替换

> 组件本身不提供任何样式。
>
> 你需要自己编写 CSS 来为其设置样式。

# 用法

```typescript
import { defaultKeymap } from '@codemirror/commands'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { keymap } from '@codemirror/view'
import {
  codeBlockComponent,
  codeBlockConfig,
} from '@milkdown/components/code-block'
import { defaultValueCtx, Editor } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { basicSetup } from 'codemirror'

await Editor.make()
  .config((ctx) => {
    ctx.update(codeBlockConfig.key, (defaultConfig) => ({
      ...defaultConfig,
      languages,
      extensions: [basicSetup, oneDark, keymap.of(defaultKeymap)],
      renderLanguage: (language, selected) =>
        selected ? `✔ ${language}` : language,
    }))
  })
  .use(commonmark)
  .use(codeBlockComponent)
  .create()
```

::iframe{src="https://stackblitz.com/github/Milkdown/examples/tree/main/component-code-block"}

---

# 配置

你可以通过在 `editor.config` 中更新 `codeBlockConfig` ctx 来配置该组件。

## 配置项

| 选项                   | 类型                                                                                                                                                        | 默认值                             | 说明                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| `extensions`           | `Extension[]`                                                                                                                                               | `[]`                               | Codemirror 扩展                                                              |
| `languages`            | `LanguageDescription[]`                                                                                                                                     | `[]`                               | Codemirror 语言数据                                                          |
| `expandIcon`           | `string`                                                                                                                                                    | `'⬇'`                              | 展开语言选择器的图标                                                         |
| `searchIcon`           | `string`                                                                                                                                                    | `'🔍'`                             | 搜索图标                                                                     |
| `clearSearchIcon`      | `string`                                                                                                                                                    | `'⌫'`                              | 清除搜索输入框的图标                                                         |
| `searchPlaceholder`    | `string`                                                                                                                                                    | `'Search language'`                | 搜索输入框的占位文本                                                         |
| `noResultText`         | `string`                                                                                                                                                    | `'No result'`                      | 无匹配语言时显示的文本                                                       |
| `copyText`             | `string`                                                                                                                                                    | `'Copy'`                           | 复制按钮的文本                                                               |
| `copyIcon`             | `string`                                                                                                                                                    | `'📋'`                             | 复制按钮的图标                                                               |
| `onCopy`               | `(text: string) => void` (optional)                                                                                                                         | `() => {}`                         | 代码被复制时的回调                                                           |
| `renderLanguage`       | `(language: string, selected: boolean) => string`                                                                                                           | `(language) => language`           | 用于渲染语言选择器中某语言的函数（必须返回字符串）                           |
| `renderPreview`        | `renderPreview: (language: string, content: string, applyPreview: (value: null \| string \| HTMLElement) => void) => void \| null \| string \| HTMLElement` | `() => null`                       | 用于渲染预览的函数（返回 null 表示隐藏，返回 undefined 表示异步渲染）        |
| `previewToggleButton`  | `(previewOnlyMode: boolean) => string`                                                                                                                      | `(mode) => mode ? 'Edit' : 'Hide'` | 用于渲染预览切换按钮的函数（必须返回字符串）                                 |
| `previewLabel`         | `string`                                                                                                                                                    | `'Preview'`                        | 预览面板的标签                                                               |
| `previewOnlyByDefault` | `boolean`                                                                                                                                                   | `true` for `readonly`              | 是否默认仅显示预览                                                           |
| `previewLoading`       | `string \| HTMLElement`                                                                                                                                     | `'Loading...'`                     | 异步预览加载时显示的内容                                                     |

---

## `languages`

Codemirror 语言数据列表。你可以从 `@codemirror/language-data` 导入语言数据，或者提供自己的语言数据。

```typescript
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { codeBlockConfig } from '@milkdown/components/code-block'

const myLanguages = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['ecmascript', 'js', 'node'],
    extensions: ['js', 'mjs', 'cjs'],
    load() {
      return import('@codemirror/lang-javascript').then((m) => m.javascript())
    },
  }),
  LanguageDescription.of({
    name: 'CSS',
    extensions: ['css', 'pcss'],
    load() {
      return import('@codemirror/lang-css').then((m) => m.css())
    },
  }),
]

ctx.update(codeBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  languages: myLanguages,
}))
```

## `extensions`

Codemirror 扩展列表。
你可以使用 `basicSetup` 扩展来启用行号、语法高亮、主题等基础功能。

```typescript
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'
import { codeBlockConfig } from '@milkdown/components/code-block'
import { basicSetup } from 'codemirror'

ctx.update(codeBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  extensions: [
    keymap.of(defaultKeymap.concat(indentWithTab)),
    basicSetup,
    oneDark,
  ],
}))
```

## `renderLanguage`

用于在语言选择器中渲染语言列表项的函数。**必须返回字符串。**

```typescript
import { codeBlockConfig } from '@milkdown/components/code-block'

ctx.update(codeBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  renderLanguage: (language, selected) =>
    selected ? `✔ ${language}` : language,
}))
```

## `expandIcon`, `searchIcon`, `clearSearchIcon`, `copyIcon`, `copyText`, `searchPlaceholder`, `noResultText`, `previewLabel`

所有这些选项都是**字符串**。你可以使用任意字符串或 emoji。

```typescript
import { codeBlockConfig } from '@milkdown/components/code-block'

ctx.update(codeBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  expandIcon: '🔽',
  searchIcon: '🔍',
  clearSearchIcon: '❌',
  copyIcon: '📄',
  copyText: 'Copy code',
  searchPlaceholder: 'Find a language...',
  noResultText: 'No language found',
  previewLabel: 'Preview',
}))
```

## `onCopy`

当复制按钮被按下时调用的回调函数。

```typescript
import { codeBlockConfig } from '@milkdown/components/code-block'

ctx.update(codeBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  onCopy: (text) => {
    alert('Copied: ' + text)
  },
}))
```

## `renderPreview`

用于渲染代码块预览的函数。可以返回字符串、HTMLElement、null（隐藏预览）或 undefined（显示 `previewLoading` 并异步渲染预览）。

```typescript
import { codeBlockConfig } from '@milkdown/components/code-block'

ctx.update(codeBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  renderPreview: (language, content, applyPreview) => {
    // 同步
    if (language === 'latex' && content.length > 0) {
      return renderLatexToDOM(content)
    }

    // 异步
    if (language === 'JavaScript') {
      compileJs(content).then((res) => applyPreview(res))
      return
    }

    // 隐藏预览
    return null
  },
}))
```

## `previewToggleButton`

用于渲染预览切换按钮文本的函数。**必须返回字符串。**

```typescript
import { codeBlockConfig } from '@milkdown/components/code-block'

ctx.update(codeBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  previewToggleButton: (previewOnlyMode) =>
    previewOnlyMode ? 'Show code' : 'Hide code',
}))
```

## `previewOnlyByDefault`

是否默认仅显示预览。

```typescript
import { codeBlockConfig } from '@milkdown/components/code-block'

ctx.update(codeBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  previewOnlyByDefault: false,
}))
```

## `previewLoading`

异步预览加载时显示的内容。

```typescript
import { codeBlockConfig } from '@milkdown/components/code-block'

ctx.update(codeBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  previewLoading: '<div>Loading...</div>',
}))
```
