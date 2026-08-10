# 行内图片组件

`imageInline` 组件为行内图片提供占位符与上传功能。

- [x] 图片占位符
- [x] 图片上传
- [x] 图片链接输入

> 组件本身不提供任何样式。
>
> 你需要自己编写 CSS 来为其设置样式。

# 用法

```typescript
import {
  imageInlineComponent,
  inlineImageConfig,
} from '@milkdown/components/image-inline'
import { defaultValueCtx, Editor } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'

await Editor.make().use(commonmark).use(imageInlineComponent).create()
```

::iframe{src="https://stackblitz.com/github/Milkdown/examples/tree/main/component-image-inline"}

---

# 配置

你可以通过在 `editor.config` 中更新 `inlineImageConfig` ctx 来配置该组件。

## 配置项

| 选项                  | 类型                                         | 默认值                                                 | 说明                                                                   |
| --------------------- | -------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `imageIcon`           | `string \| undefined`                        | `'🌌'`                                                 | 空白行内图片占位符的图标                                               |
| `uploadButton`        | `string \| undefined`                        | `'Upload'`                                             | 上传按钮的文本                                                         |
| `confirmButton`       | `string \| undefined`                        | `'⏎'`                                                  | 确认按钮的文本                                                         |
| `uploadPlaceholderText`| `string`                                    | `'/Paste'`                                             | 上传按钮的占位文本                                                     |
| `onUpload`            | `(file: File) => Promise<string>`            | `(file) => Promise.resolve(URL.createObjectURL(file))` | 图片上传时调用的函数；必须返回一个包含图片 URL 的 Promise              |
| `proxyDomURL`         | `(url: string) => Promise<string> \| string` | `undefined`                                            | 用于代理图片 URL 的可选函数                                           |

---

## `onUpload`

当用户通过文件选择器选择图片时调用的函数。
你应该返回一个解析为已上传图片 URL 的 Promise。

```typescript
import { inlineImageConfig } from '@milkdown/components/image-inline'

ctx.update(inlineImageConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  onUpload: async (file: File) => {
    const url = await YourUploadAPI(file)
    return url
  },
}))
```

## `imageIcon`, `uploadButton`, `confirmButton`, `uploadPlaceholderText`

所有这些选项都是**字符串**。你可以使用任意字符串或 emoji。

```typescript
import { inlineImageConfig } from '@milkdown/components/image-inline'

ctx.update(inlineImageConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  imageIcon: '🖼️',
  uploadButton: 'Upload',
  confirmButton: 'Confirm',
  uploadPlaceholderText: 'Paste URL',
}))
```

## `proxyDomURL`

渲染时是否将图片链接代理到另一个 URL。该值应为一个返回字符串或字符串 Promise 的函数。

```typescript
import { inlineImageConfig } from '@milkdown/components/image-inline'

ctx.update(inlineImageConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  proxyDomURL: (originalURL: string) => {
    return `https://example.com/${originalURL}`
  },
}))

// 也支持 Promise
ctx.update(inlineImageConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  proxyDomURL: async (originalURL: string) => {
    const response = await fetch(
      `https://api.example.com/proxy?url=${originalURL}`
    )
    const url = await response.text()
    return url
  },
}))
```
