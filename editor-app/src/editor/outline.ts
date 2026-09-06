// 大纲模块（Outline）：主文档与静态嵌入投影分别提取标题，再按嵌入块宿主位置合成。
import { reactive } from 'vue'
import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { Node as PMNode } from '@milkdown/kit/prose/model'

export interface OutlineItem {
  /** 稳定 id（主文档为 pos；投影项由 projectionId 进一步限定） */
  id: string
  level: number
  text: string
  /** 所在编辑器内的标题节点起始位置 */
  pos: number
  /** 非空表示该项属于嵌入投影，而非宿主编辑器 */
  projectionId?: string
}

export interface OutlineSnapshot {
  items: OutlineItem[]
  activeIndex: number
}

interface EmbeddedOutline {
  projectionId: string
  /** file_block 在其父编辑器中的位置（直接嵌入时即宿主位置） */
  hostPos: number
  snap: OutlineSnapshot
}

export const outlineStore = reactive<{
  tabs: Record<string, OutlineSnapshot>
  version: number
}>({ tabs: {}, version: 0 })

const mainSnapshots = new Map<string, OutlineSnapshot>()
const embeddedSnapshots = new Map<string, Map<string, EmbeddedOutline>>()

function rebuild(tabId: string): void {
  const main = mainSnapshots.get(tabId) ?? { items: [], activeIndex: -1 }
  const embedded = [...(embeddedSnapshots.get(tabId)?.values() ?? [])]
  const ordered = [
    ...main.items.map((item) => ({ item, order: item.pos, main: true })),
    ...embedded.flatMap((entry) => entry.snap.items.map((item, index) => ({
      item: { ...item, id: `${entry.projectionId}:${item.id}`, projectionId: entry.projectionId },
      // 同一嵌入内保持标题顺序；位于 file_block 后、下一个宿主节点前。
      order: entry.hostPos + 0.1 + index / 10_000,
      main: false,
    }))),
  ].sort((a, b) => a.order - b.order || Number(b.main) - Number(a.main))
  const activeMain = main.activeIndex >= 0 ? main.items[main.activeIndex] : null
  outlineStore.tabs[tabId] = {
    items: ordered.map((entry) => entry.item),
    activeIndex: activeMain ? ordered.findIndex((entry) => entry.main && entry.item.id === activeMain.id) : -1,
  }
  outlineStore.version++
}

/** 主编辑器快照更新。 */
export function setMainOutline(tabId: string, snap: OutlineSnapshot): void {
  mainSnapshots.set(tabId, snap)
  rebuild(tabId)
}

/** 嵌入投影快照更新；投影销毁时传 null 清理。 */
export function setEmbedOutline(
  tabId: string,
  projectionId: string,
  hostPos: number,
  snap: OutlineSnapshot | null,
): void {
  let entries = embeddedSnapshots.get(tabId)
  if (!entries && snap) embeddedSnapshots.set(tabId, (entries = new Map()))
  if (!entries) return
  if (snap) entries.set(projectionId, { projectionId, hostPos, snap })
  else entries.delete(projectionId)
  if (!entries.size) embeddedSnapshots.delete(tabId)
  rebuild(tabId)
}

export function clearOutline(tabId: string): void {
  mainSnapshots.delete(tabId)
  embeddedSnapshots.delete(tabId)
  if (outlineStore.tabs[tabId]) delete outlineStore.tabs[tabId]
  outlineStore.version++
}

function snapshotFromDoc(doc: PMNode, selFrom: number): OutlineSnapshot {
  const items: OutlineItem[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim()
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

function sigOf(snap: OutlineSnapshot): string {
  return `${snap.items.length}:${snap.activeIndex}:${snap.items.map((i) => `${i.level}:${i.pos}:${i.text}`).join(',')}`
}

/** 每个 Crepe（主编辑器或投影）注册一份。 */
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
        init: (_config, s) => { emit(fromState(s)); return null },
        apply: (tr, _prev, oldState, newState) => {
          if (tr.docChanged || !tr.selection.eq(oldState.selection)) schedule(fromState(newState))
          return null
        },
      },
    })
  })
}
