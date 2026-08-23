// M3：文件树联动插件集（P0 依赖注入版：fs/toast/回调经 refConfigCtx 注入，插件包不 import app 模块）
//   1. refClickPlugin      —— file_ref chip 点击跳转；断链 chip 点击进入重选（openFile/reSelect 回调注入）
//   2. readonlyGuardPlugin —— 只读 file_block 事务守卫（过滤一切修改只读容器的事务）
//   3. brokenRefPlugin     —— 断链装饰（目标文件不存在 → 红色警告态），配合 refreshBrokenState 刷新
import { Plugin, PluginKey, type Plugin as PluginType } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import { getRefConfig, type RefConfig } from './config'

// ---------- 路径存在性检查（Obsidian 风格补扩展名）----------

const existsCache = new Map<string, boolean>()
export async function refPathExists(cfg: RefConfig, path: string): Promise<boolean> {
  if (existsCache.has(path)) return existsCache.get(path)!
  const candidates = [path, `${path}.md`, `${path}.markdown`, `${path}.txt`]
  for (const c of candidates) {
    try {
      await cfg.fs.readFile(c)
      existsCache.set(path, true)
      return true
    } catch {
      /* try next */
    }
  }
  existsCache.set(path, false)
  return false
}

/** 解析引用路径为真实文件路径（Obsidian 风格补扩展名） */
export async function resolveRefPath(cfg: RefConfig, path: string): Promise<string | null> {
  const candidates = [path, `${path}.md`, `${path}.markdown`, `${path}.txt`]
  for (const c of candidates) {
    try {
      await cfg.fs.readFile(c)
      return c
    } catch {
      /* try next */
    }
  }
  // Obsidian 风格：无目录前缀时搜索整个工作区（文件名匹配，取第一个命中）
  const base = path.split('/').pop() ?? path
  try {
    const tree = await cfg.fs.readTree(true)
    const found: string[] = []
    const walk = (list: import('../../fs/types').FsEntry[]) => {
      for (const n of list) {
        if (n.kind === 'file' && (n.name === base || n.name === `${base}.md` || n.name === `${base}.markdown` || n.name === `${base}.txt`)) {
          found.push(n.path)
        } else if (n.kind === 'dir' && n.children) walk(n.children)
      }
    }
    walk(tree)
    return found[0] ?? null
  } catch {
    return null
  }
}

// ---------- 1. 点击跳转 / 断链重选（工厂：回调经 cfg 注入，替换原全局桥）----------

export function createRefClickPlugin(cfg: RefConfig): Plugin {
  return new Plugin({
    key: new PluginKey('REF_CLICK'),
    props: {
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement | null
        // 对象引用（object_ref）→ 打开目标文件 + 按锚点标题跳转
        const objSpan = target?.closest?.('span.ref-object')
        if (objSpan) {
          const path = objSpan.getAttribute('data-path')
          if (path) {
            const fragment = objSpan.getAttribute('data-fragment')
            cfg.openFile(path, fragment)
            return true
          }
        }
        const a = target?.closest?.('a.ref-file')
        if (!a) return false
        const path = a.getAttribute('data-path')
        if (!path) return false
        // 断链 chip → 重选
        if (a.classList.contains('ref-broken')) {
          cfg.reSelect(path)
          return true
        }
        const fragment = a.getAttribute('data-fragment')
        cfg.openFile(path, fragment)
        return true
      },
    },
  })
}

// ---------- 2. 只读事务守卫 ----------

export const readonlyGuardPlugin = new Plugin({
  key: new PluginKey('READONLY_FILE_BLOCK_GUARD'),
  filterTransaction: (tr, state) => {
    if (!tr.docChanged) return true
    // 在旧文档上收集只读容器范围（步骤坐标基于旧文档）
    const ranges: Array<[number, number]> = []
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'file_block' && node.attrs.readonly) {
        ranges.push([pos, pos + node.nodeSize])
      }
      return true
    })
    if (!ranges.length) return true
    // 只有选区位于只读容器内时才拦截（用户直接编辑）；程序化物化等事务放行
    const selInside = (sel: import('@milkdown/kit/prose/state').Selection) =>
      ranges.some(([a, b]) => sel.from >= a && sel.to <= b)
    if (!selInside(tr.selection) && !selInside(state.selection)) return true
    for (const step of tr.steps) {
      const from = (step as { from?: number }).from ?? 0
      const to = (step as { to?: number }).to ?? from
      for (const [a, b] of ranges) {
        if (from >= b || to <= a) continue // 不触碰该只读块
        if (from <= a && to >= b) continue
        return false
      }
    }
    return true
  },
})

// ---------- 3. 断链装饰 ----------

const brokenPaths = new Set<string>()

/** 诊断探针：当前断链路径集合（引用健康指标） */
export function getBrokenPaths(): string[] {
  return [...brokenPaths]
}

export const brokenRefPlugin: PluginType = new Plugin({
  key: new PluginKey('BROKEN_REF'),
  state: {
    init: () => DecorationSet.empty,
    apply: (tr, _oldSet) => {
      // 总是重算：断链路径集可能在异步刷新后变化（空事务也会触发）
      const decos: Decoration[] = []
      tr.doc.descendants((node, pos) => {
        const isRef = node.type.name === 'file_ref' || node.type.name === 'file_block'
        if (isRef && brokenPaths.has(node.attrs.path as string)) {
          decos.push(
            Decoration.inline(pos, pos + node.nodeSize, {
              class: 'ref-broken',
              title: `文件不存在：${node.attrs.path}`,
            })
          )
        }
        return true
      })
      return DecorationSet.create(tr.doc, decos)
    },
  },
  props: {
    decorations: (state) => brokenRefPlugin.getState(state) ?? DecorationSet.empty,
  },
})

/** 异步刷新断链状态：收集引用 → 检查存在性 → 派发事务触发装饰重算 */
export async function refreshBrokenState(editor: Editor): Promise<void> {
  const cfg = getRefConfig(editor)
  if (!cfg) return
  try {
    existsCache.clear()
    const targets = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const out: string[] = []
      view.state.doc.descendants((n) => {
        if (n.type.name === 'file_ref' || n.type.name === 'file_block') {
          out.push(n.attrs.path as string)
        }
        return true
      })
      return [...new Set(out)]
    })
    brokenPaths.clear()
    for (const p of targets) {
      if (!(await refPathExists(cfg, p))) brokenPaths.add(p)
    }
    // 派发空事务触发 decorations 重算
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr)
    })
  } catch {
    /* 容错：断链检测失败不影响编辑 */
  }
}
