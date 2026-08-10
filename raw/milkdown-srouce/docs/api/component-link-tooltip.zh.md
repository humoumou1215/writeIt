# 链接提示组件

`linkTooltip` 组件提供了一个用于编辑和预览链接的提示框。

它提供以下功能：

- [x] 编辑链接
- [x] 预览链接
- [x] 复制链接
- [x] 编程式链接 API
  - [x] addLink
  - [x] editLink
  - [x] removeLink

> 组件本身不提供任何样式。
>
> 你需要自己编写 CSS 来为其设置样式。

# 用法

```typescript
import {
  configureLinkTooltip,
  linkTooltipPlugin,
  linkTooltipConfig,
} from '@milkdown/components/link-tooltip'
import { defaultValueCtx, Editor } from '@milkdown/kit/core'
import { commonmark, linkSchema } from '@milkdown/kit/preset/commonmark'

const editor = await Editor.make()
  .config(configureLinkTooltip)
  .use(commonmark)
  .use(linkTooltipPlugin)
  .create()
```

::iframe{src="https://stackblitz.com/github/Milkdown/examples/tree/main/component-link-tooltip"}

# 配置

你可以通过在 `editor.config` 中更新 `linkTooltipConfig` ctx 来配置该组件。

## 配置项

| 选项             | 类型                     | 默认值           | 说明                                         |
| ---------------- | ------------------------ | ---------------- | -------------------------------------------- |
| `linkIcon`       | `string`                 | `'🔗'`           | 链接预览的图标（点击复制链接）               |
| `editButton`     | `string`                 | `'✎'`            | 编辑按钮的图标/文本                          |
| `removeButton`   | `string`                 | `'⌫'`            | 移除按钮的图标/文本                          |
| `confirmButton`  | `string`                 | `'Confirm ⏎'`    | 链接编辑器中确认按钮的图标/文本              |
| `onCopyLink`     | `(link: string) => void` | `() => {}`       | 链接被复制时触发的回调                       |
| `inputPlaceholder`| `string`                | `'Paste link...'` | 链接编辑器输入框的占位文本                   |

---

## `linkIcon`, `editButton`, `removeButton`, `confirmButton`, `inputPlaceholder`

所有这些选项都是**字符串**。你可以使用任意字符串或 emoji。

```typescript
import { linkTooltipConfig } from '@milkdown/components/link-tooltip'

ctx.update(linkTooltipConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  linkIcon: '🔗',
  editButton: '✎',
  removeButton: '❌',
  confirmButton: '✔️',
  inputPlaceholder: 'Paste link here',
}))
```

## `onCopyLink`

链接被复制时触发的回调函数。

```typescript
import { linkTooltipConfig } from '@milkdown/components/link-tooltip'

ctx.update(linkTooltipConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  onCopyLink: (link: string) => {
    console.log('Link copied:', link)
    toast('Link copied')
  },
}))
```

# API

`linkTooltip` 组件提供以下 API：

### `insertLink`

在指定范围插入一个链接。

> 以下示例只是一个简单实现，你可以根据需要进行自定义。

```typescript
import {
  linkTooltipAPI,
  linkTooltipState,
} from '@milkdown/components/link-tooltip'
import { editorViewCtx } from '@milkdown/kit/core'

function addLink(ctx: Ctx) {
  const view = ctx.get(editorViewCtx)
  const { selection, doc } = view.state

  // 已处于编辑模式
  if (ctx.get(linkTooltipState.key).mode === 'edit') return

  const has = doc.rangeHasMark(
    selection.from,
    selection.to,
    linkSchema.type(ctx)
  )
  // 该范围已包含链接
  if (has) return

  ctx.get(linkTooltipAPI.key).addLink(selection.from, selection.to)
}
```

### `editLink`

在指定范围和标记处编辑链接。

> 以下示例只是一个简单实现，你可以根据需要进行自定义。

```typescript
import {
  linkTooltipAPI,
  linkTooltipState,
} from '@milkdown/components/link-tooltip'
import { editorViewCtx } from '@milkdown/kit/core'

function editLink(ctx: Ctx) {
  const view = ctx.get(editorViewCtx)
  const { selection, doc } = view.state

  const node = view.state.doc.nodeAt(selection.from)

  if (!node) return

  const mark = node.marks.find(
    (mark) => mark.type === linkSchema.mark.type(ctx)
  )
  if (!mark) return

  ctx.get(linkTooltipAPI.key).editLink(mark, selection.from, selection.to)
}
```

### `removeLink`

移除指定范围内的链接。

> 以下示例只是一个简单实现，你可以根据需要进行自定义。

```typescript
import {
  linkTooltipAPI,
  linkTooltipState,
} from '@milkdown/components/link-tooltip'
import { editorViewCtx } from '@milkdown/kit/core'

function removeLink(ctx: Ctx) {
  const view = ctx.get(editorViewCtx)
  const { selection, doc } = view.state

  ctx.get(linkTooltipAPI.key).removeLink(selection.from, selection.to)
}
```
