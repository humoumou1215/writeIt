# 表格块组件

`tableBlock` 组件为表格操作提供了大量功能。

它提供以下功能：

- [x] 行与列的拖拽
- [x] 行与列的插入与删除
- [x] 列内文本对齐

> 组件本身不提供任何样式。
>
> 你需要自己编写 CSS 来为其设置样式。

# 用法

```typescript
import { tableBlock, tableBlockConfig } from '@milkdown/components/table-block'
import { Editor } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'

await Editor.make().use(commonmark).use(gfm).use(tableBlock).create()
```

::iframe{src="https://stackblitz.com/github/Milkdown/examples/tree/main/component-table-block"}

---

# 配置

你可以通过在 `editor.config` 中更新 `tableBlockConfig` ctx 来配置该组件。

## 配置项

| 选项         | 类型                                 | 默认值  | 说明                                                       |
| ------------ | ------------------------------------ | ------- | ---------------------------------------------------------- |
| `renderButton` | `(renderType: RenderType) => string` | 见下方  | 用于渲染每个表格操作按钮的函数。必须返回字符串。         |

其中 `RenderType` 为以下之一：

- `'add_row'`
- `'add_col'`
- `'delete_row'`
- `'delete_col'`
- `'align_col_left'`
- `'align_col_center'`
- `'align_col_right'`
- `'col_drag_handle'`
- `'row_drag_handle'`

**默认值：**

```typescript
;(renderType) => {
  switch (renderType) {
    case 'add_row':
      return '+'
    case 'add_col':
      return '+'
    case 'delete_row':
      return '-'
    case 'delete_col':
      return '-'
    case 'align_col_left':
      return 'left'
    case 'align_col_center':
      return 'center'
    case 'align_col_right':
      return 'right'
    case 'col_drag_handle':
      return '='
    case 'row_drag_handle':
      return '='
  }
}
```

**示例：**

```typescript
import { tableBlockConfig } from '@milkdown/components/table-block'

ctx.update(tableBlockConfig.key, (defaultConfig) => ({
  ...defaultConfig,
  renderButton: (renderType) => {
    switch (renderType) {
      case 'add_row':
        return '➕ Row'
      case 'add_col':
        return '➕ Col'
      case 'delete_row':
        return '🗑️ Row'
      case 'delete_col':
        return '🗑️ Col'
      case 'align_col_left':
        return '⬅️'
      case 'align_col_center':
        return '↔️'
      case 'align_col_right':
        return '➡️'
      case 'col_drag_handle':
        return '||'
      case 'row_drag_handle':
        return '=='
    }
  },
}))
```
