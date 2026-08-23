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
        editorMenuState.clip = clipFromInternal()
        editorMenuState.hasSelection = !view.state.selection.empty
        editorMenuState.x = Math.min(e.clientX, window.innerWidth - 210)
        editorMenuState.y = Math.min(e.clientY, window.innerHeight - 280)
        editorMenuState.visible = true
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
      return {
        destroy() {
          dom.removeEventListener('contextmenu', onContextMenu, true)
          dom.removeEventListener('paste', onPaste, true)
          delete dom.dataset.writeitMenu
        },
      }
    },
  })
})