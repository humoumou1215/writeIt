# 列表项组件

`listItemBlock` 组件为有序/无序/待办列表项提供自定义渲染器。

> 组件本身不提供任何样式。
>
> 你需要自己编写 CSS 来为其设置样式。

# 用法

```typescript
import {
  listItemBlockComponent,
  listItemBlockConfig,
} from '@milkdown/components/list-item-block'
import { Editor } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'

await Editor.make()
  .use(commonmark)
  .use(gfm)
  .use(listItemBlockComponent)
  .create()
```

::iframe{src="https://stackblitz.com/github/Milkdown/examples/tree/main/component-list-item"}

---

# 自定义

你可以通过在 `editor.config` 中更新 `listItemBlockConfig` ctx 来编写自己的列表项渲染器。

## 配置项

| 选项        | 类型                                                                                            | 默认值  | 说明                                                       |
| ----------- | ----------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------- |
| `renderLabel` | `(props: { label: string; listType: string; readonly?: boolean; checked?: boolean }) => string` | 见下方  | 用于渲染每个列表项标签的函数。必须返回字符串。             |

**默认值：**

```typescript
;({ label, listType, checked }) => {
  const content =
    checked == null
      ? listType === 'bullet'
        ? '⦿'
        : label
      : checked
        ? '☑'
        : '□'
  return content
}
```

**示例：**

```typescript
import { listItemBlockConfig } from '@milkdown/components/list-item-block'

ctx.set(listItemBlockConfig.key, {
  renderLabel: ({ label, listType, checked, readonly }) => {
    if (checked == null) {
      if (listType === 'bullet') return '•'
      return label // 例如 '1.'、'2.'、...
    }
    return checked ? '[x]' : '[ ]'
  },
})
```
