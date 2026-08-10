# @milkdown/plugin-streaming

用于 [milkdown](https://milkdown.dev/) 的流式输入插件。将 markdown 内容逐令牌流式写入编辑器并进行渐进式渲染，适用于 AI 生成的内容。

## 用法

```typescript
import { Editor } from '@milkdown/kit/core'
import { streaming } from '@milkdown/kit/plugin/streaming'
import { commonmark } from '@milkdown/kit/preset/commonmark'

const editor = await Editor.make().use(commonmark).use(streaming).create()
```

### 配合 Crepe 使用

```typescript
import { Crepe } from '@milkdown/crepe'

const crepe = new Crepe({
  root: '#editor',
  features: {
    [Crepe.Feature.AI]: true, // 同时加载流式与差异插件
  },
})
await crepe.create()
```

## 流式内容

使用命令来控制流式生命周期：

```typescript
import { commandsCtx } from '@milkdown/kit/core'
import {
  startStreamingCmd,
  pushChunkCmd,
  endStreamingCmd,
  abortStreamingCmd,
} from '@milkdown/kit/plugin/streaming'

// 开始流式（替换模式——替换整个文档）
editor.action((ctx) => {
  ctx.get(commandsCtx).call(startStreamingCmd.key)
})

// 令牌到达时逐个推送
for await (const chunk of aiStream) {
  editor.action((ctx) => {
    ctx.get(commandsCtx).call(pushChunkCmd.key, chunk)
  })
}

// 结束流式
editor.action((ctx) => {
  ctx.get(commandsCtx).call(endStreamingCmd.key)
})
```

## 在光标处插入

除了替换整个文档，你还可以在当前光标位置插入流式内容：

```typescript
editor.action((ctx) => {
  ctx.get(commandsCtx).call(startStreamingCmd.key, { insertAt: 'cursor' })
})
```

你也可以传入一个具体的位置数字：

```typescript
editor.action((ctx) => {
  ctx.get(commandsCtx).call(startStreamingCmd.key, { insertAt: 42 })
})
```

### 按上下文的插入行为

插入策略取决于流式开始时光标所在的位置：

| 光标位置                 | 行为                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| 空段落                   | 用流式块替换空段落                                                       |
| 段落 / 标题 / 引用块     | 首行合并入当前块，其余行作为新块插入其后                                 |
| 列表项                   | 同上——首行合并，其余行插入列表之后                                       |
| 代码块                   | 所有内容作为纯文本插入，保留换行符                                       |
| 表格单元格               | 所有内容作为纯文本插入，换行符折叠为空格                                 |
| 块之间（depth 0）        | 完整 markdown 解析，作为块节点插入                                       |

## 替换选区

你可以用流式内容替换当前文本选区：

```typescript
editor.action((ctx) => {
  ctx.get(commandsCtx).call(startStreamingCmd.key, { insertAt: 'selection' })
})
```

当选区非空时，选中的范围会被到达的流式内容逐步替换。当选区 collapsed（为空）时，其行为与 `insertAt: 'cursor'` 一致。

插入策略根据 `selection.from` 处的位置解析。例如，如果选区起始于段落内部，则使用 `split-block` 策略；如果起始于代码块内部，则使用纯文本插入。

流式结束后，以 `keep: false` 中止会恢复包含所选文本的原始文档。差异审阅模式同样正常工作——差异会显示原始选区被替换的过程。

## 流式结束后的差异审阅

当差异插件同时被加载时（例如在 Crepe 中通过 `Crepe.Feature.AI`，或在独立编辑器上手动调用 `editor.use(diff)`），你可以在流式结束后交接进入差异审阅模式：

```typescript
// 结束流式并进入差异审阅
editor.action((ctx) => {
  ctx.get(commandsCtx).call(endStreamingCmd.key, { diffReview: true })
})
```

这会恢复原始文档，并将流式内容作为差异展示，供用户接受或拒绝。差异审阅相关命令请参见 [@milkdown/plugin-diff](./plugin-diff.md)。

你也可以在配置中默认启用差异审阅：

```typescript
import { streamingConfig } from '@milkdown/kit/plugin/streaming'

editor.config((ctx) => {
  ctx.update(streamingConfig.key, (prev) => ({
    ...prev,
    diffReviewOnEnd: true,
  }))
})
```

## 中止

```typescript
// 中止并恢复原始文档
editor.action((ctx) => {
  ctx.get(commandsCtx).call(abortStreamingCmd.key, { keep: false })
})

// 中止但保留部分内容
editor.action((ctx) => {
  ctx.get(commandsCtx).call(abortStreamingCmd.key, { keep: true })
})
```

## 插件配置

```typescript
import { streamingConfig } from '@milkdown/kit/plugin/streaming'

editor.config((ctx) => {
  ctx.update(streamingConfig.key, (prev) => ({
    ...prev,
    throttleMs: 100, // 刷新间隔（毫秒，默认值：100）
    scrollFollow: true, // 自动滚动以跟随内容（默认值：true）
    diffReviewOnEnd: false, // 结束时进入差异审阅（默认值：false）
  }))
})
```

## 自定义插入策略

你可以通过提供一个 `insertStrategy` 解析器，来自定义内容在不同光标位置下的插入方式：

```typescript
import {
  defaultInsertStrategy,
  streamingConfig,
} from '@milkdown/kit/plugin/streaming'

editor.config((ctx) => {
  ctx.update(streamingConfig.key, (prev) => ({
    ...prev,
    insertStrategy: (resolved) => {
      // 自定义：将 blockquote 当作纯文本处理
      for (let d = resolved.depth; d > 0; d--) {
        if (resolved.node(d).type.name === 'blockquote')
          return { type: 'plain-text', preserveNewlines: false }
      }
      // 其余情况回退到默认策略
      return defaultInsertStrategy(resolved)
    },
  }))
})
```

### 策略类型

| 类型                                                 | 说明                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `{ type: 'plain-text', preserveNewlines?: boolean }` | 作为纯文本插入。对代码块使用 `preserveNewlines: true`。                 |
| `{ type: 'split-block' }`                            | 首行作为文本合并入当前块，其余行作为 markdown 块解析。                   |
| `{ type: 'block' }`                                  | 将整个缓冲区作为 markdown 解析，并作为顶层块插入。                       |

## 插件

@streaming
@streamingPlugin
@streamingPluginKey
@streamingConfig

## 命令

@startStreamingCmd
@pushChunkCmd
@endStreamingCmd
@abortStreamingCmd

## 工具函数

@defaultInsertStrategy
@applyStreamingAction

## 类型

@StreamingState
@StreamingConfig
@StartStreamingOptions
@EndStreamingOptions
@AbortStreamingOptions
@InsertStrategy
@InsertStrategyResolver
@StreamingAction
