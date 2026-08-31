// 图片粘贴落盘插件 + 相对路径图片显示代理
// 背景：Crepe 默认把粘贴图片以 base64 data URI 内嵌进 md（文件膨胀、图片不可复用）。
// 本插件在 paste 时拦截剪贴板中的 image/* 文件 → 按设置策略写盘为独立文件 →
// 文档中只保留相对路径引用 `![alt](images/xxx.png)`（策略含历史 inline 内嵌）。
// 显示侧：markdown 里的相对路径没法直接被 <img> 加载（页面 URL 不在仓库下），
// 通过 image-block / image-inline 的 proxyDomURL 钩子把仓库相对路径转 blob URL。
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Fragment } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { dirName, baseName } from '../fs/types'
import type { ImagePasteMode } from '../state/settings'

/** 图片落盘需要的最小文件系统能力 */
export interface ImagePasteFs {
  writeBinary(path: string, data: Uint8Array): Promise<void>
  /** 缺省（宿主不支持二进制）时返回 null，走 base64 内嵌兜底 */
  readBinary?(path: string): Promise<Uint8Array>
}

export interface ImagePasteCfg {
  fs: ImagePasteFs
  /** 当前正在编辑的文件相对路径（未保存新文件返回 null → 图片只能内嵌） */
  getHostPath: () => string | null
  /** 当前图片保存策略 */
  getMode: () => ImagePasteMode
  toast: (msg: string, kind?: 'success' | 'error' | 'info') => void
  /** 落盘成功后的刷新（文件树等） */
  onSaved?: (paths: string[]) => void
}

const key = new PluginKey('IMAGE_PASTE_FALLBACK')

/** milkdown 插件工厂：crepe.editor.use(imagePastePlugin(cfg))。经 $prose 惰性包装 */
export function imagePastePlugin(cfg: ImagePasteCfg) {
  return $prose(() =>
    new Plugin({
      key,
      props: {
        // 用 handleDOMEvents 而非 handlePaste：前者在 PM 监听回调的第一层判断执行
        // （runCustomHandler），不依赖 paste 文本解析/合成态分支，必然可达。
        // 返回 true → PM 不再走默认 paste 管线（避免图片以 blob/data URL 内嵌进文档）。
        handleDOMEvents: {
          paste: (view, event) => {
            if (!view.editable) return false
            const mode = cfg.getMode()
            if (mode === 'inline') return false // 内嵌策略走默认行为
            const files = event.clipboardData
              ? Array.from(event.clipboardData.files).filter((f) => f.type.startsWith('image/'))
              : []
            if (!files.length) return false
            // 吞掉默认行为（照片不会以 data URL 进文档）；异步写盘完成后替换插入。
            // 若写盘失败 → 把原图 base64 内嵌插入（尽力不丢图）。
            event.preventDefault()
            void handlePasteImages(view, files, cfg)
            return true
          },
        },
      },
    })
  )
}

async function handlePasteImages(
  view: EditorView,
  files: File[],
  cfg: ImagePasteCfg
): Promise<void> {
  const hostPath = cfg.getHostPath()
  const mode = cfg.getMode()
  const saved: string[] = []
  const fallbackDataUris: string[] = []
  let allInlined = false

  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      // 内嵌策略 / 新文件未保存 / 宿主无二进制能力 → base64 data URI 兜底
      const target = mode !== 'inline' && hostPath ? computeTargetPath(mode, hostPath, file) : ''
      const canWrite = !!target && !!cfg.fs.writeBinary && !!cfg.fs.readBinary
      if (!canWrite) {
        fallbackDataUris.push(bytesToDataUri(bytes, file.type))
        allInlined = true
        continue
      }
      await cfg.fs.writeBinary(target, bytes)
      saved.push(target)
    } catch {
      // 单张失败：内嵌兜底，不阻断其余图片
      try {
        fallbackDataUris.push(bytesToDataUri(new Uint8Array(await file.arrayBuffer()), file.type))
      } catch {
        /* 数据都读不出来就放弃这张 */
      }
      allInlined = true
    }
  }

  insertImages(view, saved, fallbackDataUris)
  if (!saved.length) {
    cfg.toast(allInlined ? '图片已内嵌保存（当前环境/策略不支持写盘）' : '图片保存失败', 'error')
  } else {
    cfg.toast(
      `已保存 ${saved.length} 张图片：${saved.join('、')}`,
      'success'
    )
    cfg.onSaved?.(saved)
  }
}

/** 按策略计算图片落盘路径（相对仓库根），同时作为文档中的引用路径 */
function computeTargetPath(mode: ImagePasteMode, hostPath: string, file: File): string {
  const name = fileNameFor(file)
  const fileDir = dirName(hostPath)
  switch (mode) {
    case 'same-dir':
      return fileDir ? `${fileDir}/${name}` : name
    case 'root-images':
      return `images/${name}`
    case 'file-images':
      return fileDir ? `${fileDir}/images/${name}` : `images/${name}`
    default:
      return '' // inline：不落盘
  }
}

function fileNameFor(file: File): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const rand = Math.random().toString(36).slice(2, 6)
  const ext = extForMime(file.type)
  return `Pasted-${stamp}-${rand}.${ext}`
}

function extForMime(mime: string): string {
  const m: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/avif': 'avif',
  }
  return m[mime] ?? 'png'
}

function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime || 'image/png'};base64,${btoa(bin)}`
}

/** 在光标处插入图片：落盘的用相对路径；失败的内嵌 data URI。每张图独立成块（image-block）。 */
function insertImages(view: EditorView, savedPaths: string[], inlineDataUris: string[]): void {
  const schema = view.state.schema
  const nodes = [...savedPaths, ...inlineDataUris].map((src) => {
    const block = schema.nodes.image_block
    if (block) {
      return block.create({ src, caption: '', ratio: 1 })
    }
    // 无 image_block（极少数配置）→ 行内 image 节点段落
    const img = schema.nodes.image.create({ src, alt: '' })
    return schema.nodes.paragraph.create(null, img)
  })
  if (!nodes.length) return

  const from = view.state.selection.from
  const $from = view.state.doc.resolve(from)
  const parent = $from.parent
  const tr = view.state.tr
  const fragment = Fragment.from(nodes)

  if (parent.isTextblock && parent.content.size > 0) {
    tr.split(from)
    tr.insert(from, fragment)
  } else if (parent.isTextblock) {
    tr.replaceWith($from.before(), $from.after(), fragment)
  } else {
    tr.insert(from, fragment)
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

// ---------- 相对路径图片显示代理（proxyDomURL） ----------
// markdown 内保存的是仓库相对路径（images/xxx.png），<img> 在页面协议下无法直接加载。
// 这里读出文件字节 → Blob URL。带 LRU 缓存避免反复读盘；data:/http(s):/blob: 原样透传。

const blobCache = new Map<string, string>()
const BLOB_CACHE_MAX = 64

/** blob URL → 仓库相对路径（右键定位/资源管理器打开时反查用） */
const blobUrlToPath = new Map<string, string>()

/** 通过图片 DOM 的 src（blob:）反查仓库相对路径；非仓库图（data/外链）返回 null */
export function imagePathBySrc(src: string): string | null {
  return blobUrlToPath.get(src) ?? null
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
}

export function mimeForPath(path: string): string {
  const ext = baseName(path).split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'image/png'
}

/** 仓库相对路径 → 可加载 URL（异步：跨宿主读字节）。非仓库 URL 原样返回。 */
export function resolveImageSrc(
  fs: ImagePasteFs,
  src: string
): string | Promise<string> {
  if (!src) return src
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('blob:')) {
    return src
  }
  const cached = blobCache.get(src)
  if (cached) return cached
  if (!fs.readBinary) return src
  return fs
    .readBinary(src)
    .then((bytes) => {
      if (blobCache.has(src)) return blobCache.get(src)!
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeForPath(src) }))
      blobUrlToPath.set(url, src)
      if (blobCache.size >= BLOB_CACHE_MAX) {
        const oldest = blobCache.keys().next().value
        if (oldest != null) {
          const oldUrl = blobCache.get(oldest)
          if (oldUrl) {
            blobUrlToPath.delete(oldUrl)
            URL.revokeObjectURL(oldUrl)
          }
          blobCache.delete(oldest)
        }
      }
      blobCache.set(src, url)
      return url
    })
    .catch(() => src) // 文件不存在/读失败 → 原样（展示破图但保留路径）
}

/** mock 等键值后端的 dirName/baseName 重导出（供 features 装配层使用） */
export { dirName, baseName }

// ---------- 全屏预览入口（点击图片 / 悬停放大镜 / 右键菜单共用） ----------

import { state } from '../state/store'

export interface ImagePreviewInfo {
  src: string
  path?: string
  name: string
}

/** 打开图片全屏预览弹层（ImagePreviewModal.vue 监听 state.imagePreview 渲染） */
export function openImagePreview(info: ImagePreviewInfo): void {
  state.imagePreview = { src: info.src, path: info.path, name: info.name }
}