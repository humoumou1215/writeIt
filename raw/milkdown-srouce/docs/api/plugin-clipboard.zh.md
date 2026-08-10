# @milkdown/plugin-clipboard

为 [milkdown](https://milkdown.dev/) 提供 Markdown 复制与粘贴支持。

```typescript
import { Editor } from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'

Editor.make().use(clipboard).create()
```

该插件支持以下功能：

1. 将编辑器中的内容以 Markdown 格式复制到剪贴板。
2. 将 Markdown 内容粘贴到编辑器中。
3. 将来自 VSCode、以代码块形式复制的内容粘贴进来。

@clipboard
