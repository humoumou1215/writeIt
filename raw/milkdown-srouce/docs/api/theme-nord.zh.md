# @milkdown/theme-nord

Nord 主题是一个轻量级主题，构建于 [Nord](https://www.nordtheme.com/) 和 [tailwindcss](https://tailwindcss.com/) 之上。

该主题设计用于 milkdown 的文档网站。如果你想在自己的项目中使用它，需要像下面这样使用：

```ts
/* Copyright 2021, Milkdown by Mirone. */
import { nord } from '@milkdown/theme-nord'
// 别忘了导入 css 文件。
import '@milkdown/theme-nord/style.css'

Editor.make()
  .config(nord)
  // ...
  .create()
```

@nord
你需要传给编辑器的主题配置。
