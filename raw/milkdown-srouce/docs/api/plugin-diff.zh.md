# @milkdown/plugin-diff

用于 [milkdown](https://milkdown.dev/) 的差异审阅插件。对比两份文档，并允许用户接受或拒绝每一项修改。

## 用法

```typescript
import { Editor } from '@milkdown/kit/core'
import { diff } from '@milkdown/kit/plugin/diff'
import { diffComponent } from '@milkdown/kit/component/diff'
import { commonmark } from '@milkdown/kit/preset/commonmark'

const editor = await Editor.make()
  .use(commonmark)
  .use(diff)
  .use(diffComponent)
  .create()
```

### 配合 Crepe 使用

```typescript
import { Crepe, CrepeFeature } from '@milkdown/crepe'

const crepe = new Crepe({
  root: '#editor',
  features: {
    [CrepeFeature.AI]: true,
  },
})
await crepe.create()
```

## 开始差异审阅

将修改后的 markdown 传给 `startDiffReviewCmd`。编辑器会展示差异，并锁定编辑，直到审阅完成。

```typescript
import { callCommand } from '@milkdown/kit/utils'
import { startDiffReviewCmd } from '@milkdown/kit/plugin/diff'

editor.action(
  callCommand(startDiffReviewCmd.key, '# Updated content\n\nNew paragraph.')
)
```

你也可以直接使用 `startDiffReviewFromDocCmd` 传入一个已解析的 ProseMirror `Node`，从而避免了序列化→解析的往返过程：

```typescript
import { startDiffReviewFromDocCmd } from '@milkdown/kit/plugin/diff'

editor.action(callCommand(startDiffReviewFromDocCmd.key, someDocNode))
```

## 接受与拒绝修改

用户可以在 UI 中点击每项修改上的“接受/拒绝”按钮。你也可以通过编程方式控制：

```typescript
import { callCommand } from '@milkdown/kit/utils'
import {
  acceptAllDiffsCmd,
  clearDiffReviewCmd,
  acceptDiffChunkCmd,
  rejectDiffChunkCmd,
} from '@milkdown/kit/plugin/diff'

// 接受所有剩余修改
editor.action(callCommand(acceptAllDiffsCmd.key))

// 清除审阅（丢弃剩余修改，保留已接受的）
editor.action(callCommand(clearDiffReviewCmd.key))

// 按索引接受/拒绝某一项具体修改
editor.action(callCommand(acceptDiffChunkCmd.key, 0))
editor.action(callCommand(rejectDiffChunkCmd.key, 0))
```

当所有修改都被处理后，差异审阅会自动停用并解锁编辑器。

## 插件配置

```typescript
import { diffConfig } from '@milkdown/kit/plugin/diff'

Editor.make()
  .config((ctx) => {
    ctx.update(diffConfig.key, (prev) => ({
      ...prev,
      ignoreAttrs: { heading: ['id'] }, // 差异比对时忽略这些属性（默认值：{ heading: ['id'] }）
    }))
  })
  .use(diff)
  .use(diffComponent)
  .create()
```

## 组件配置

差异组件负责修改的可视化渲染。它可以通过 `diffComponentConfig` 进行配置：

```typescript
import { diffComponentConfig } from '@milkdown/kit/component/diff'

Editor.make()
  .config((ctx) => {
    ctx.update(diffComponentConfig.key, (prev) => ({
      ...prev,
      acceptLabel: 'Apply', // 接受按钮文本（默认值：'Accept'）
      rejectLabel: 'Discard', // 拒绝按钮文本（默认值：'Reject'）
      customBlockTypes: [
        // 使用自定义节点视图的节点类型
        'table',
        'image-block',
        'code_block',
      ],
    }))
  })
  .use(diff)
  .use(diffComponent)
  .create()
```

### 自定义块类型

ProseMirror 的行内装饰无法穿透自定义节点视图。`customBlockTypes` 选项用于告诉差异组件哪些节点类型需要以块级替换的方式处理，而非使用行内装饰。

使用 Crepe 时，该项已预配置为 `['table', 'image-block', 'code_block']`。

## 样式

差异组件使用需要你自行设置样式的 CSS 类。使用 Crepe 时，样式会自动包含在主题 CSS 中。

在独立使用时，主要的 CSS 类如下：

| 类                               | 说明                               |
| -------------------------------- | ---------------------------------- |
| `.milkdown-diff-removed`         | 行内删除（删除线）                 |
| `.milkdown-diff-removed-block`   | 块级删除（节点覆盖层）             |
| `.milkdown-diff-added`           | 行内插入                           |
| `.milkdown-diff-added-block`     | 块级插入控件                       |
| `.milkdown-diff-controls`        | 行内“接受/拒绝”按钮容器            |
| `.milkdown-diff-controls-block`  | 块级“接受/拒绝”按钮容器            |
| `.milkdown-diff-accept`          | 接受按钮                           |
| `.milkdown-diff-reject`          | 拒绝按钮                           |

## 插件

@diff
@diffPlugin
@diffPluginKey
@diffConfig

## 命令

@startDiffReviewCmd
@startDiffReviewFromDocCmd
@acceptDiffChunkCmd
@rejectDiffChunkCmd
@acceptDiffRangeCmd
@rejectDiffRangeCmd
@acceptAllDiffsCmd
@clearDiffReviewCmd

## 工具函数

@computeDocDiff
@getPendingChanges
@isChangeRejected

## 类型

@DiffState
@DiffConfig
@DiffRange
@DiffAction
@ComputeDocDiffOptions
@ComputeDiffRange
@DiffIgnoreAttrs
