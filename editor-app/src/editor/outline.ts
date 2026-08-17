// 大纲模块（Outline）：
//  - 从 ProseMirror doc 提取标题（heading 节点，h1~h6），按文档顺序生成层级列表
//  - 跟随光标/选区变化，实时标记"当前所在小节"（最后一个起始位置 ≤ 选区起点 的标题）
//  - 数据写入响应式 outlineStore 供 OutlinePanel.vue 渲染（按 tabId 隔离）
//  - 编辑器挂载时注册插件（$prose），销毁时清理
import { reactive } from 'vue'
import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { Node as PMNode } from '@milkdown/kit/prose/model'

export interface OutlineItem {
  /** 稳定 id（tabId + pos 组合在外层） */
  id: string
  /** 标题级别 1-6 */
  level: number
  /** 标题文本（trim 后） */
  text: string
  /** 标题节点起始文档位置（供滚动定位） */
  pos: number
}

export interface OutlineSnapshot {
  items: OutlineItem[]
  /** 当前所在小节下标（无标题时 -1） */
  activeIndex: number
}

/** 响应式大纲数据：tabs[tabId] = {items, activeIndex}。 */
export const outlineStore = reactive<{
  tabs: Record<string, OutlineSnapshot>
  /** 递增版本号：面板订阅用（切换标签 / 文档变化时触达） */
  version: number
}>({
  tabs: {},
  version: 0,
})

export function clearOutline(tabId: string): void {
  if (outlineStore.tabs[tabId]) {
    delete outlineStore.tabs[tabId]
    outlineStore.version++
  }
}

/** 提取标题 + 计算当前小节（依据 doc 与选区）。 */
function snapshotFromDoc(doc: PMNode, selFrom: number): OutlineSnapshot {
  const items: OutlineItem[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim()
      // 空标题不进入大纲（标题里全空格/图片占位）
      if (text) items.push({ id: `${pos}`, level: node.attrs.level as number, text, pos: pos + 1 })
    }
    return true
  })
  let activeIndex = -1
  for (let i = 0; i < items.length; i++) {
    if (items[i].pos <= selFrom) activeIndex = i
    else break
  }
  return { items, activeIndex }
}

/** 快照签名：内容/小节变化才对外触发（同小节内光标移动不重算面板） */
function sigOf(snap: OutlineSnapshot): string {
  return `${snap.items.length}:${snap.activeIndex}:${snap.items.map((i) => i.level + i.pos).join(',')}`
}

/** 大纲插件工厂：每标签一个实例。onUpdate 接收最新快照。 */
export function outlinePlugin(onUpdate: (snap: OutlineSnapshot) => void) {
  const key = new PluginKey('WRITEIT_OUTLINE')
  return $prose(() => {
    let lastSig = ''
    let pending: ((s: OutlineSnapshot) => void) | null = null
    let raf = 0

    const emit = (snap: OutlineSnapshot) => {
      const sig = sigOf(snap)
      if (sig === lastSig) return
      lastSig = sig
      onUpdate(snap)
    }
    /** rAF 去重调度（apply 每事务触发，合并同帧多次） */
    const schedule = (snap: OutlineSnapshot) => {
      if (raf) cancelAnimationFrame(raf)
      pending = () => emit(snap)
      raf = requestAnimationFrame(() => {
        raf = 0
        const fn = pending
        pending = null
        fn?.()
      })
    }
    const fromState = (s: EditorState) => snapshotFromDoc(s.doc, s.selection.from)

    return new Plugin({
      key,
      state: {
        // 初始：编辑器创建完成即产出大纲（doc 就绪）
        init: (_config, s) => {
          emit(fromState(s))
          return null
        },
        apply: (tr, _prev, oldState, newState) => {
          // 文档结构或选区变化 → 重算（同帧合并）
          if (tr.docChanged || !tr.selection.eq(oldState.selection)) {
            schedule(fromState(newState))
          }
          return null
        },
      },
    })
  })
}