// Gutter 侧边条（v2 决策：编辑器右侧垂直标记条，零遮挡）
// 每个批注/校验违规在对应行右侧显示彩色小标记：
//   hover → 消息摘要浮窗；点击 → 滚动到位置 + 展开批注卡（连线到锚点）
// 数据：运行时批注（校验，service）+ 持久化批注（doc 中的 annotation 节点）
// 更新时机：批注变化订阅 / pane 滚动（rAF 节流）/ 窗口 resize / 编辑防抖（manager 装配）
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import { getRuntimeAnnotations, getPersistedAnnotations } from './service'
import type { Annotation } from './service'
import { openAnnotationAt, LEVEL_COLOR } from './card'

let gutterEl: HTMLElement | null = null
let paneEl: HTMLElement | null = null
let currentTabId = ''
let currentEditor: Editor | null = null
let summaryEl: HTMLElement | null = null

export function initGutter(pane: HTMLElement): void {
  if (gutterEl) return
  paneEl = pane
  gutterEl = document.createElement('div')
  gutterEl.className = 'annotation-gutter'
  paneEl.appendChild(gutterEl)

  summaryEl = document.createElement('div')
  summaryEl.className = 'annotation-gutter-summary'
  summaryEl.setAttribute('role', 'tooltip')
  document.body.appendChild(summaryEl)

  gutterEl.addEventListener('click', (e) => {
    const marker = (e.target as HTMLElement).closest?.('.annotation-gutter-marker') as HTMLElement | null
    if (!marker) return
    const pos = Number(marker.dataset.pos ?? -1)
    if (pos < 0) return
    const editor = currentEditor
    const tabId = currentTabId
    void (async () => {
      if (editor && tabId) {
        // 滚动到位置（复用 manager 的 scrollToPos）
        const { scrollToPos } = await import('../editor/manager')
        await scrollToPos(tabId, pos)
        await new Promise((r) => setTimeout(r, 150))
        openAnnotationAt(editor, pos)
      }
    })()
  })

  gutterEl.addEventListener('mouseover', (e) => {
    const marker = (e.target as HTMLElement).closest?.('.annotation-gutter-marker') as HTMLElement | null
    if (!marker || !summaryEl) return
    summaryEl.textContent = marker.dataset.content ?? ''
    summaryEl.classList.add('annotation-gutter-summary-visible')
    const rect = marker.getBoundingClientRect()
    summaryEl.style.left = `${Math.max(6, rect.left - 220)}px`
    summaryEl.style.top = `${rect.top - 4}px`
  })
  gutterEl.addEventListener('mouseout', () => {
    summaryEl?.classList.remove('annotation-gutter-summary-visible')
  })
}

/** 收集当前编辑器的全部批注位置（运行时 + 持久化） */
function collectAnnotations(
  tabId: string,
  editor: Editor
): Array<{ pos: number; level: Annotation['level']; content: string }> {
  const out: Array<{ pos: number; level: Annotation['level']; content: string }> = []
  for (const a of getRuntimeAnnotations(tabId)) {
    out.push({ pos: a.to > a.from ? a.from : a.from, level: a.level, content: a.content })
  }
  try {
    editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc
      for (const p of getPersistedAnnotations(doc)) {
        out.push({ pos: p.from, level: 'comment', content: p.content })
      }
    })
  } catch {
    /* 编辑器已销毁 */
  }
  return out
}

/** 重绘 gutter（滚动/批注变化时调用） */
export function updateGutter(tabId: string, editor: Editor): void {
  currentTabId = tabId
  currentEditor = editor
  if (!gutterEl || !paneEl) return
  const items = collectAnnotations(tabId, editor)
  // 清空重绘（数量少，直接重建）
  gutterEl.innerHTML = ''
  if (!items.length) return
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const paneRect = paneEl!.getBoundingClientRect()
    for (const it of items) {
      const coords = view.coordsAtPos(it.pos)
      const top = coords.top - paneRect.top + paneEl!.scrollTop
      const marker = document.createElement('div')
      marker.className = 'annotation-gutter-marker'
      marker.dataset.pos = String(it.pos)
      marker.dataset.content = it.content
      marker.dataset.level = it.level
      marker.style.top = `${Math.max(0, top - 3)}px`
      marker.style.background = LEVEL_COLOR[it.level]
      gutterEl!.appendChild(marker)
    }
  })
}

/** 编辑器销毁/切换时清理 */
export function disposeGutter(): void {
  gutterEl?.remove()
  gutterEl = null
  paneEl = null
  currentEditor = null
  currentTabId = ''
}
