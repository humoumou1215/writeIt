# @milkdown/plugin-upload

拖拽时上传并创建图片（或任何你喜欢的文件类型）。

```typescript
import { Editor } from '@milkdown/kit/core'
import { upload } from '@milkdown/kit/plugin/upload'

Editor.make().use(upload).create()
```

@upload

---

## 上传配置

默认情况下，该插件会将图片转换为 base64，并忽略其他文件类型。如果你希望上传文件并处理生成的块，你需要配置 uploader。

```typescript
import { upload, uploadConfig, Uploader } from '@milkdown/kit/plugin/upload'
import type { Node } from '@milkdown/kit/prose/model'

const uploader: Uploader = async (files, schema) => {
  const images: File[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files.item(i)
    if (!file) {
      continue
    }

    // 你可以处理任何你需要的文件类型，这里我们只处理图片。
    if (!file.type.includes('image')) {
      continue
    }

    images.push(file)
  }

  const nodes: Node[] = await Promise.all(
    images.map(async (image) => {
      const src = await YourUploadAPI(image)
      const alt = image.name
      return schema.nodes.image.createAndFill({
        src,
        alt,
      }) as Node
    })
  )

  return nodes
}

Editor.make()
  .config((ctx) => {
    ctx.update(uploadConfig.key, (prev) => ({
      ...prev,
      uploader,
    }))
  })
  .use(upload)
  .create()
```

@uploadPlugin

@uploadConfig
@UploadOptions

---

## 工具函数

@defaultUploader

@readImageAsBase64
