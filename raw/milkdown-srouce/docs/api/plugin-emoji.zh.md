# @milkdown/plugin-emoji

通过 [shortcuts](https://www.webfx.com/tools/emoji-cheat-sheet/) 添加 emoji 支持。

由 [twemoji](https://github.com/twitter/twemoji) 渲染。

## 用法

```typescript
import { Editor } from '@milkdown/core'
import { emoji } from '@milkdown/plugin-emoji'

Editor.make().use(emoji).create()
```

@emoji

## 插件

@emojiAttr
@emojiSchema

@insertEmojiInputRule

@remarkEmojiPlugin
@remarkTwemojiPlugin
