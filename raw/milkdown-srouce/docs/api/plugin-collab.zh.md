# @milkdown/plugin-collab

该插件用于为 milkdown 提供协同编辑支持。

请查阅 [协同编辑指南](/docs/guide/collaborative-editing) 了解更多。

```typescript
import { collab, collabServiceCtx } from '@milkdown/plugin-collab'

async function setup() {
  const editor = await Editor.make().use(collab).create()

  const doc = new Doc()
  const wsProvider = new WebsocketProvider('<YOUR_WS_HOST>', 'milkdown', doc)

  editor.action((ctx) => {
    const collabService = ctx.get(collabServiceCtx)

    collabService
      // 绑定 doc 与 awareness
      .bindDoc(doc)
      .setAwareness(wsProvider.awareness)
      // 将 yjs 与 milkdown 连接
      .connect()
  })
}
```

## 插件

@collab
@CollabReady

## 服务

@collabServiceCtx
@CollabService
@CollabServiceOptions
