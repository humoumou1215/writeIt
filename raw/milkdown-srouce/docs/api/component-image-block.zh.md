# 图片块组件

`imageBlock` 组件将图片渲染为一个块。
在 markdown 中，所有图片都以行内图片形式渲染。该组件允许你将图片以块的形式渲染。该组件提供以下功能：

- [x] 图片缩放手柄
- [x] 图片标题
- [x] 图片链接输入
- [x] 空白图片块占位符
- [x] 图片上传

> 组件本身不提供任何样式。
>
> 你需要自己编写 CSS 来为其设置样式。

# 用法

```typescript
import {
  imageBlockComponent,
  imageBlockConfig,
} from '@milkdown/components/image-block'
import { defaultValueCtx, Editor } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'

await Editor.make().use(commonmark).use(imageBlockComponent).create()
```

::iframe{src="https://stackblitz.com/github/Milkdown/examples/tree/main/component-image-block"}

---

# 配置

你可以通过在 `editor.config` 中更新 `imageBlockConfig` ctx 来配置该组件。

## 配置项

| 选项                   | 类型                                         | 默认值                                                 | 说明                                                                   |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `imageIcon`            | `string \| undefined`                        | `'🌌'`                                                 | 空白图片块占位符的图标                                                 |
| `captionIcon`          | `string \| undefined`                        | `'💬'`                                                 | 标题切换按钮的图标                                                     |
| `uploadButton`         | `string \| undefined`                        | `'Upload file'`                                        | 上传按钮的内容                                                         |
| `confirmButton`        | `string \| undefined`                        | `'Confirm ⏎'`                                          | 确认按钮的内容                                                         |
| `uploadPlaceholderText`| `string`                                     | `'or paste the image link ...'`                       | 图片块占位符的占位文本                                                 |
| `captionPlaceholderText`| `string`                                   | `'Image caption'`                                      | 标题输入框的占位文本                                                   |
| `onUpload`             | `(file: File) => Promise<string>`            | `(file) => Promise.resolve(URL.createObjectURL(file))` | 图片上传时调用的函数；必须返回一个包含图片 URL 的 Promise              |
| `proxyDomURL`          | `(url: string) => Promise<string> \| string` | `undefined`                                            | 用于代理图片 URL 的可选函数                                           |
| `onImageLoadError`     | `(event: Event) => void \| Promise<void>`    | `undefined`                                            | 图片加载失败时的可选回调（例如无效 URL 或网络错误）                   |
| `maxWidth`             | `number \| undefined`                        | `undefined`                                            | 图片可选的最大显示宽度（像素）                                         |
| `maxHeight`            | `number \| undefined`                        | `undefined`                                            | 图片可选的最大显示高度（像素）                                         |

---

## `onUpload`

当用户通过文件选择器选择图片时调用的函数。
你应该返回一个解析为已上传图片 URL 的 Promise。

```typescript
import { imageBlockConfig } from '@milkdown/components/image-block'

ctx.update(imageBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  onUpload: async (file: File) => {
    const url = await YourUploadAPI(file)
    return url
  },
}))
```

## `imageIcon`, `captionIcon`, `uploadButton`, `confirmButton`, `uploadPlaceholderText`, `captionPlaceholderText`

所有这些选项都是**字符串**。你可以使用任意字符串或 emoji。

```typescript
import { imageBlockConfig } from '@milkdown/components/image-block'

ctx.update(imageBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  imageIcon: '🖼️',
  captionIcon: '📝',
  uploadButton: 'Upload Image',
  confirmButton: 'Confirm',
  uploadPlaceholderText: 'or paste an image URL',
  captionPlaceholderText: 'Add a caption',
}))
```

## `proxyDomURL`

渲染时是否将图片链接代理到另一个 URL。该值应为一个返回字符串或字符串 Promise 的函数。

```typescript
import { imageBlockConfig } from '@milkdown/components/image-block'

ctx.update(imageBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  proxyDomURL: (originalURL: string) => {
    return `https://example.com/${originalURL}`
  },
}))

// 也支持 Promise
ctx.update(imageBlockConfig.key, (defaultConfig) => ({
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

## `onImageLoadError`

图片加载失败（无效 URL、CORS、404 等）时调用的可选回调。可用它显示提示、回退 UI 或上报错误。可以是同步或异步（`Promise<void>`）。

```typescript
import { imageBlockConfig } from '@milkdown/components/image-block'

ctx.update(imageBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  onImageLoadError: (event: Event) => {
    console.error('Image failed to load', event)
    // 例如显示 toast 或替换为占位图
  },
}))

// 也支持异步
ctx.update(imageBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  onImageLoadError: async (event: Event) => {
    await reportToAnalytics('image_load_error', event)
  },
}))
```

## `maxWidth` 与 `maxHeight`

显示图片的可选最大尺寸（像素）。超出这些边界的图片将在保持宽高比的同时被缩放。这些约束在拖拽调整大小时同样适用。

```typescript
import { imageBlockConfig } from '@milkdown/components/image-block'

ctx.update(imageBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  maxWidth: 800,
  maxHeight: 600,
}))
```
