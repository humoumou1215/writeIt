// 编辑器右键菜单 + 文件引用粘贴 集成插件（P0：依赖经 refConfigCtx 注入，插件包不 import app 模块）
// 每个编辑器实例独立生效（多标签下仅焦点编辑器响应）：
//   1. contextmenu（捕获阶段）：拦截默认菜单 → 弹出自定义菜单（粘贴组/编辑组/引用操作组/类型切换组）
//   2. paste（捕获阶段）：剪贴板含复制的文件/目录 → 拦截默认粘贴 → 光标处插入链接引用 [[path]]
//      与表格插件的 capture 监听共存：命中文件引用才接手，其余放行给 PM 默认管线
import { $prose } from '@milkdown/kit/utils'
import { editorCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Editor } from '@milkdown/kit/core'
import { refConfigCtx } from './config'
import { imagePathBySrc, openImagePreview } from '../image-paste'
import { baseName } from '../../fs/types'
import { showClickSpot } from '../click-spot'
import {
  insertRefs,
  extractClipItems,
  findRefAtPos,
  editorMenuState,
  getInternalClip,
  type InsertItems,
  type CopiedNode,
  type RefTargetType,
} from './clipboard-core'

/** 右键坐标 → ProseMirror 文档位置（posAtCoords 优先，DOM 映射兜底） */
function posFromEvent(view: EditorView, e: MouseEvent): number | null {
  const coords = view.posAtCoords({ left: e.clientX, top: e.clientY })
  if (coords) return coords.pos
  const t = e.target as HTMLElement
  try {
    return t.isConnected ? view.posAtDOM(t, 0) : null
  } catch {
    return null
  }
}

/** CopiedNode[] → 菜单粘贴项快照（内部剪贴板；contextmenu 无权限读系统剪贴板） */
function clipFromInternal(): InsertItems | null {
  const internal = getInternalClip()
  if (!internal || !internal.length) return null
  return splitCopied(internal)
}

function splitCopied(items: CopiedNode[]): InsertItems {
  return {
    files: items.filter((i) => i.kind === 'file').map((i) => i.path),
    dirs: items.filter((i) => i.kind === 'dir').map((i) => i.path),
  }
}

/** 无 resolveExternalPath 注入时的兜底（绝对路径 → 文件名） */
function fallbackResolveExternal(absPath: string): string {
  const p = absPath.replace(/\\/g, '/')
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
}

/** 按路径查找文档中的引用节点（DOM 兜底定位：NodeView 头部/只读块/chip 的 pos 可能落在区间外） */
function findRefByPath(
  view: EditorView,
  path: string
): { type: RefTargetType; path: string; readonly: boolean; from: number } | null {
  let hit: { type: RefTargetType; path: string; readonly: boolean; from: number } | null = null
  view.state.doc.descendants((node, from) => {
    const name = node.type.name
    if (
      (name === 'file_ref' || name === 'object_ref' || name === 'file_block') &&
      node.attrs.path === path
    ) {
      hit = { type: name, path: node.attrs.path as string, readonly: Boolean(node.attrs.readonly), from }
      return false
    }
    return true
  })
  return hit
}

/** 事件目标最近编辑器图片的信息（image-block / image-inline 内的 <img>） */
function imgInfoFromEvent(e: MouseEvent | Event): {
  src: string
  path?: string
  name: string
} | null {
  const target = (e.target as HTMLElement) ?? null
  if (!target) return null
  const img = target.closest?.('img')
  if (!img) return null
  if (!img.closest('.milkdown-image-block, .milkdown-image-inline')) return null
  const src = (img.getAttribute('src') || img.src || '').trim()
  if (!src) return null
  const path = imagePathBySrc(src) ?? undefined
  return { src, path, name: path ? baseName(path) : src.startsWith('data:') ? '内嵌图片' : '图片' }
}

// ---------- 图片悬停放大镜按钮 ----------
// 风格与 image-block 右上角 caption 图标（.operation-item）一致：32px 圆形、inverse 底（无阴影）、
// 同排显示在其「隔壁」左侧，间距 12px。挂 body（fixed）不能 append 进 contenteditable（会被 PM 回滚）。

const ZOOM_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>'

function makeZoomButton(): { el: HTMLElement; clear: () => void; setPos: (img: HTMLElement) => void } {
  const el = document.createElement('button')
  el.className = 'writeit-img-zoom'
  el.title = '预览图片'
  el.innerHTML = ZOOM_SVG
  el.setAttribute('aria-label', '预览图片')
  // 挂 body（fixed）取不到 theme CSS 变量 → 颜色在 setPos 时从编辑器 DOM 解析成具体值写入，与 caption 图标同款。
  el.style.cssText =
    'position:fixed;width:32px;height:32px;padding:4px;border-radius:50%;display:flex;align-items:center;justify-content:center;' +
    'opacity:.6;border:none;cursor:pointer;z-index:90;transform:translate(-50%,-50%);'
  let boundImg: HTMLElement | null = null
  const setPos = (img: HTMLElement) => {
    boundImg = img
    const block = img.closest('.milkdown-image-block')
    // theme 色（按钮在 body 上取不到 CSS 变量）→ 从编辑器 DOM 解析具体色值，与 caption 图标同款
    const cs = getComputedStyle((block as HTMLElement) ?? img)
    el.style.backgroundColor = cs.getPropertyValue('--crepe-color-inverse').trim() || 'rgba(0,0,0,.55)'
    el.style.color = cs.getPropertyValue('--crepe-color-on-inverse').trim() || '#fff'
    // 与右上角 caption 图标（.operation-item）同排：放其「左侧隔壁」，间距与 operation 相同（12px）；inline 图 → 贴右上角内侧
    const opItem = block?.querySelector('.operation > .operation-item') as HTMLElement | null
    if (opItem && opItem.getBoundingClientRect().width > 0) {
      const r = opItem.getBoundingClientRect()
      el.style.left = `${Math.round(r.left - 12 - r.width / 2)}px` // 左侧 12px 间隙 + 自身半宽 16px
      el.style.top = `${Math.round(r.top + r.height / 2)}px`
    } else {
      const r = img.getBoundingClientRect()
      el.style.left = `${Math.round(r.right - 16)}px`
      el.style.top = `${Math.round(r.top + 16)}px`
    }
    if (!el.isConnected) document.body.appendChild(el)
  }
  const clear = () => {
    boundImg = null
    el.remove()
  }
  el.addEventListener('mousedown', (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
  })
  el.addEventListener('click', (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
    const img = boundImg
    clear()
    if (!img) return
    const src = (img.getAttribute('src') || img.src || '').trim()
    if (!src) return
    const path = imagePathBySrc(src) ?? undefined
    openImagePreview({ src, path, name: path ? baseName(path) : src.startsWith('data:') ? '内嵌图片' : '图片' })
  })
  return { el, clear, setPos }
}

// ---------- 图片点击光斑反馈 ----------
// 左键点击图片不再打开预览（预览走悬停放大镜 / 右键菜单）；仅显示一个淡黄色光斑标记点击位置。
// 实现见 ../click-spot（图片与 Mermaid 图表共用）。

export const editorMenuPlugin = $prose((ctx) => {
  const key = new PluginKey('WRITEIT_EDITOR_MENU')
  return new Plugin({
    key,
    view(view) {
      const dom = view.dom as HTMLElement
      const getEditor = (): Editor | null => {
        try {
          return ctx.get(editorCtx)
        } catch {
          return null
        }
      }

      // ---------- contextmenu：自定义菜单（替代默认右键菜单） ----------
      const onContextMenu = (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const editor = getEditor()
        const cfg = ctx.get(refConfigCtx.key)
        const pos = posFromEvent(view, e)
        // 图片命中（含缓存 pending，兜底 mousedown 事件未被 PM 允许的情况）→ 图片专属菜单
        const img = imgInfoFromEvent(e)
        if (img) {
          clearPending()
          openImageMenu(img, e.clientX, e.clientY)
          return
        }
        if (pendingImg) {
          const p = pendingImg
          clearPending()
          openImageMenu(p, e.clientX, e.clientY)
          return
        }
        // pos 命中优先；右键 file_block 头部/只读块/chip 时 posAtCoords 可能落在区间外 → DOM 路径匹配兜底
        let hit: { type: RefTargetType; path: string; readonly: boolean; from: number } | null =
          pos != null ? findRefAtPos(view, pos) : null
        if (!hit) {
          const t = e.target as HTMLElement
          const domEl = t.closest?.('a.ref-file, span.ref-object, .ref-file-block') as HTMLElement | null
          const p = domEl?.getAttribute('data-path')
          if (p) hit = findRefByPath(view, p)
        }
        editorMenuState.editor = editor
        editorMenuState.view = view
        editorMenuState.cfg = cfg
        editorMenuState.target = hit
          ? { type: hit.type, path: hit.path, readonly: hit.readonly, pos: hit.from }
          : null
        editorMenuState.image = null
        editorMenuState.clip = clipFromInternal()
        editorMenuState.hasSelection = !view.state.selection.empty
        editorMenuState.x = Math.min(e.clientX, window.innerWidth - 210)
        editorMenuState.y = Math.min(e.clientY, window.innerHeight - 280)
        editorMenuState.visible = true
      }

      // ---------- 图片：左键=预览；右键=缓弹菜单（等 contextmenu 事件统一弹出） ----------
      // PM 对可选中 node（image-block）的 mousedown 会 preventDefault → 吞掉后续
      // click/contextmenu；因此在 capture 阶段接管左键。右键不能 mousedown 立即弹菜单：
      // 菜单遮挡右键坐标后，浏览器合成的 contextmenu 事件 target 命中菜单自身 →
      // onContextMenu 走普通分支把 image 清空 → 菜单闪烁消失。改为缓存 pending，
      // 由 contextmenu 事件（此时菜单未弹、target 仍是 img）统一弹菜单；
      // 若环境吞了 contextmenu（260ms 未到）→ 兜底弹出。
      type ImgInfo = { src: string; path?: string; name: string }
      const zoom = makeZoomButton()
      let pendingImg: (ImgInfo & { x: number; y: number }) | null = null
      let pendingTimer: ReturnType<typeof setTimeout> | null = null
      const openImageMenu = (img: ImgInfo, x: number, y: number) => {
        const editor = getEditor()
        const cfg = ctx.get(refConfigCtx.key)
        editorMenuState.editor = editor
        editorMenuState.view = view
        editorMenuState.cfg = cfg
        editorMenuState.target = null
        editorMenuState.image = img
        editorMenuState.clip = clipFromInternal()
        editorMenuState.hasSelection = !view.state.selection.empty
        editorMenuState.x = Math.min(x, window.innerWidth - 210)
        editorMenuState.y = Math.min(y, window.innerHeight - 240)
        editorMenuState.visible = true
      }
      const clearPending = () => {
        if (pendingTimer) {
          clearTimeout(pendingTimer)
          pendingTimer = null
        }
        pendingImg = null
      }
      const onImgMouseDown = (e: MouseEvent) => {
        const img = imgInfoFromEvent(e)
        if (!img) return
        e.preventDefault()
        e.stopPropagation()
        if (e.button === 2) {
          pendingImg = { ...img, x: e.clientX, y: e.clientY }
          clearTimeout(pendingTimer ?? undefined)
          pendingTimer = setTimeout(() => {
            if (pendingImg) {
              openImageMenu(pendingImg, pendingImg.x, pendingImg.y)
              pendingImg = null
            }
            pendingTimer = null
          }, 260)
          return
        }
        // 左键 → 不再打开预览（预览走悬停放大镜 / 右键菜单）：仅显示点击位置的光斑
        clearPending()
        showClickSpot(e.clientX, e.clientY)
        return
      }
      // ---------- 图片：悬停放大镜（mouseover 定位，mouseout 清除；移到按钮保留） ----------
      const onImgOver = (e: MouseEvent) => {
        const host = (e.target as HTMLElement | null)?.closest?.('img') as HTMLElement | null
        if (!host || !host.closest('.milkdown-image-block, .milkdown-image-inline')) return
        zoom.setPos(host)
      }
      const onImgOut = (e: MouseEvent) => {
        const t = (e.target as HTMLElement | null)?.closest?.('img') as HTMLElement | null
        if (!t) return
        const rt = e.relatedTarget as HTMLElement | null
        if (rt && (rt === zoom.el || zoom.el.contains(rt))) return
        zoom.clear()
      }

      // ---------- paste：剪贴板复制的文件/目录 → 插入链接引用 ----------
      const onPaste = (e: Event) => {
        const ce = e as ClipboardEvent
        if (!ce.clipboardData) return
        const cfg = ctx.get(refConfigCtx.key)
        if (!cfg) return
        const items = extractClipItems(ce, cfg.resolveExternalPath ?? fallbackResolveExternal)
        if (!items || (!items.files.length && !items.dirs.length)) return
        // 命中复制的文件/目录 → 接管默认粘贴
        e.preventDefault()
        e.stopPropagation()
        const editor = getEditor()
        if (editor) insertRefs(view, editor, items, 'link')
      }

      dom.addEventListener('contextmenu', onContextMenu, true)
      dom.addEventListener('paste', onPaste, true)
      // 图片交互走 capture mousedown（PM 会吞 click/contextmenu）
      dom.addEventListener('mousedown', onImgMouseDown, true)
      dom.addEventListener('mouseover', onImgOver, true)
      dom.addEventListener('mouseout', onImgOut, true)
      return {
        destroy() {
          dom.removeEventListener('contextmenu', onContextMenu, true)
          dom.removeEventListener('paste', onPaste, true)
          dom.removeEventListener('mousedown', onImgMouseDown, true)
          dom.removeEventListener('mouseover', onImgOver, true)
          dom.removeEventListener('mouseout', onImgOut, true)
          clearPending()
          zoom.clear()
          delete dom.dataset.writeitMenu
        },
      }
    },
  })
})