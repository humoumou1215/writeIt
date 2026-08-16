<script setup lang="ts">
// 批注抽屉（v3）：右侧固定抽屉承载批注卡片（校验违规只读卡 + 人工批注评论线程卡）
//  - 统一折叠/展开；宽度拖拽 50-480（默认 300）
//  - 激活批注连线：抽屉左边缘 → 锚点（默认淡化，悬停卡或锚点突出）
//  - 评论不可删除、仅创建人可标记已解决（按用户名判断）
//  - 内容纯文本（v3 决策：不做 markdown 渲染）
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { state } from '../state/store'
import { settings } from '../state/settings'
import {
  subscribeAnnotations,
  getActiveAnnotationId,
  setActiveAnnotation,
  getAllAnnotations,
  addComment,
  setCommentResolved,
  parseThread,
  type Annotation,
  type Comment,
} from '../annotations/service'
import { LEVEL_COLOR } from '../annotations/card-color'

// ---------- 状态 ----------
const open = ref(true)
const width = ref(Math.max(50, Math.min(480, settings.annotationDrawerWidth)))
const anns = ref<Annotation[]>([])
const activeId = ref<string | null>(null)
const draft = ref<Record<string, string>>({}) // 卡 id → 回复草稿
// v6：当前展开的人工批注卡 id——默认全部收起，只有点击卡片时才展开（点击其他卡/外部收起）
const expandedId = ref<string | null>(null)
let unsub: (() => void) | null = null
let unsubMount: (() => void) | null = null

const activeTabId = computed(() => state.activeTabId)

// M14：编辑器挂载是异步的（openTab → mountEditor 几百 ms）——
// 切标签时 getActiveInstance 可能为 null → 200ms 轮询重试（去重），直到实例就绪
let refreshRetry: ReturnType<typeof setTimeout> | null = null

async function refresh() {
  const tabId = state.activeTabId
  if (!tabId) {
    anns.value = []
    return
  }
  // M14：diff 模式下只显示 diff 改动批注（运行时 source='diff'，定位在渲染 Crepe doc）
  const tab = state.tabs.find((t) => t.id === tabId)
  if (tab?.viewMode === 'diff') {
    const { getRuntimeAnnotations } = await import('../annotations/service')
    anns.value = getRuntimeAnnotations(tabId).filter((a) => a.source === 'diff')
    activeId.value = getActiveAnnotationId()
    return
  }
  const { getActiveInstance } = await import('../editor/manager')
  const inst = getActiveInstance()
  if (!inst) {
    // 新标签编辑器还在挂载 → 稍后重刷（避免抽屉残留上一个标签的批注）
    if (!refreshRetry) {
      refreshRetry = setTimeout(() => {
        refreshRetry = null
        void refresh()
      }, 200)
    }
    return
  }
  const { editorViewCtx } = await import('@milkdown/kit/core')
  inst.crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    anns.value = getAllAnnotations(doc, tabId)
    activeId.value = getActiveAnnotationId()
  })
}

onMounted(() => {
  unsub = subscribeAnnotations(refresh)
  refresh()
  window.addEventListener('resize', refresh)
  document.addEventListener('click', onDocClick, true)
  // M14：标签切换后新标签编辑器挂载完成 → 立即刷新（不残留上一标签批注）
  void import('../editor/manager').then((m) => {
    unsubMount = m.onEditorMounted(() => void refresh())
  })
})
onBeforeUnmount(() => {
  unsub?.()
  unsubMount?.()
  if (refreshRetry) clearTimeout(refreshRetry)
  window.removeEventListener('resize', refresh)
  document.removeEventListener('click', onDocClick, true)
})
watch(activeTabId, () => {
  expandedId.value = null // 切换标签：全部收起
  refresh()
})

// v6：只有被点击的卡片才展开——点击卡片外部（或切换到其他卡片）时收起当前展开的人工批注卡
function onDocClick(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  // M6：源码模式——点击 textarea 内 <mark data-note 文本 = 点击锚点（激活 + 滚动居中 + 选中）
  const ta = t?.closest?.('textarea[data-source-ta]') as HTMLTextAreaElement | null
  if (ta && state.activeTabId) activateSourceMark(ta)
  const card = t?.closest?.('.ad-card') as HTMLElement | null
  // 点击当前展开卡内部（评论/输入框/头部）→ 保持展开；头部展开/收起由 locate 处理
  if (card && expandedId.value === card.dataset.id) return
  expandedId.value = null
}

/** 源码模式：点击位置落在某个 <mark data-note 内 → 激活对应批注 + 滚动居中 + 选中高亮 */
function activateSourceMark(ta: HTMLTextAreaElement) {
  const offset = ta.selectionStart ?? 0
  const hit = findSourceMarks(ta).find((mk) => offset >= mk.tagStart && offset <= mk.tagEnd)
  if (!hit) return
  const ann = anns.value.find(
    (a) => a.level === 'comment' && a.persist && JSON.stringify(a.thread) === JSON.stringify(hit.thread)
  )
  if (!ann) return
  if (state.activeTabId) setActiveAnnotation(state.activeTabId, ann.id)
  scrollSourceToMark(ta, hit.contentStart, hit.contentEnd)
}

const errorCount = computed(() => anns.value.filter((a) => a.level === 'error').length)
const warningCount = computed(() => anns.value.filter((a) => a.level === 'warning').length)
const commentCount = computed(() => anns.value.filter((a) => a.level === 'comment').length)
/** M14：diff 改动说明卡计数（level=info + source=diff） */
const infoCount = computed(() => anns.value.filter((a) => a.source === 'diff' || a.level === 'info').length)

// ---------- 用户名（tauri git / 设置） ----------
const userName = ref(settings.annotationUsername || '我')
onMounted(async () => {
  try {
    const { resolveUserName } = await import('../annotations/user-name')
    const name = await resolveUserName()
    if (name) userName.value = name
  } catch {
    userName.value = settings.annotationUsername || '我'
  }
})

// ---------- 操作 ----------
async function reply(ann: Annotation) {
  const text = (draft.value[ann.id] || '').trim()
  if (!text) return
  const { getActiveInstance } = await import('../editor/manager')
  const inst = getActiveInstance()
  if (!inst) return
  const pos = annPos(ann, inst)
  if (pos < 0) return
  addComment(inst.crepe.editor, pos, text, userName.value)
  draft.value[ann.id] = ''
}

/** 运行时批注无固定 pos（decorations 映射）；持久化批注 pos 即节点位置 */
function annPos(ann: Annotation, inst: { crepe: { editor: unknown } }): number {
  if (ann.persist) return ann.from
  return ann.from
}

async function toggleResolved(ann: Annotation, c: Comment) {
  const { getActiveInstance } = await import('../editor/manager')
  const inst = getActiveInstance()
  if (!inst) return
  setCommentResolved(inst.crepe.editor as never, ann.from, c.id, !c.resolved, userName.value)
}

/** 点击批注卡 = 定位 + 激活（显示该卡连线）+ 展开/折叠 */
async function locate(ann: Annotation) {
  const tabId = state.activeTabId
  const tab = tabId ? state.tabs.find((t) => t.id === tabId) : null
  if (tab?.viewMode === 'diff') {
    // M14：diff 模式 → 渲染 Crepe doc 定位（滚动 .render-main + 激活）
    if (tabId) setActiveAnnotation(tabId, ann.id)
    if (ann.from >= 0) await locateDiff(ann)
  } else if (ann.from >= 0) {
    if (tabId) {
      setActiveAnnotation(tabId, ann.id)
      if (tab?.viewMode === 'source') {
        // M6：源码模式 → 直接滚动 textarea 到 <mark data-note（不切出源码视图）
        const { getSourceTextarea } = await import('../editor/manager')
        const ta = getSourceTextarea(tabId)
        const r = ta ? findSourceMarkRange(ta, ann.thread) : null
        if (r) scrollSourceToMark(ta!, r.start, r.end)
      } else {
        const { scrollToPos } = await import('../editor/manager')
        await scrollToPos(tabId, ann.from)
      }
    }
  } else {
    // 无锚点（如缺需求表整体违规）：仅激活 + 展开
    if (tabId) setActiveAnnotation(tabId, ann.id)
  }
  // v6：只有被点击的人工批注卡展开；再点收起（只读卡无展开概念）
  if (ann.level === 'comment') {
    expandedId.value = expandedId.value === ann.id ? null : ann.id
  }
}

/** M14：找到 diff 视图实际可滚动的容器——取溢出量最大的滚动祖先
 * （.render-main 自身 overflow:auto 但内容未溢出时，.diff-body 才是真正的滚动容器） */
function findDiffScrollContainer(): HTMLElement | null {
  const host = document.querySelector('.git-diff-view .render-host')
  if (!host) return null
  let best: HTMLElement | null = null
  let bestDiff = 0
  let cur = host.parentElement
  while (cur) {
    const cs = getComputedStyle(cur)
    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
      const diff = cur.scrollHeight - cur.clientHeight
      if (diff > bestDiff) {
        bestDiff = diff
        best = cur
      }
    }
    cur = cur.parentElement
  }
  return best
}

/** M14：diff 模式定位——渲染 Crepe coordsAtPos → 滚动实际滚动容器到锚点（与存量 scrollToPos 同公式） */
async function locateDiff(ann: Annotation) {
  const tabId = state.activeTabId
  if (!tabId || ann.from < 0) return
  const { getRenderInstance } = await import('../editor/manager')
  const crepe = getRenderInstance(tabId)
  if (!crepe) return
  const { editorViewCtx } = await import('@milkdown/kit/core')
  try {
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const pos = Math.min(ann.from, view.state.doc.content.size)
      const c = view.coordsAtPos(pos)
      const container = findDiffScrollContainer()
      if (container) {
        const cr = container.getBoundingClientRect()
        container.scrollTo({
          top: container.scrollTop + (c.top - cr.top) - container.clientHeight * 0.2,
          behavior: 'smooth',
        })
      }
    })
  } catch {
    /* 渲染编辑器已销毁 */
  }
}

/** 回复输入：Enter 提交；Shift+Enter 换行；ESC 清空草稿 */
function onReplyKeydown(ann: Annotation, e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void reply(ann)
  } else if (e.key === 'Escape') {
    draft.value[ann.id] = ''
  }
  // Shift+Enter：保留 textarea 默认换行
}

async function revalidate() {
  const { refreshValidation } = await import('../editor/manager')
  await refreshValidation()
}

function canResolve(c: Comment): boolean {
  return c.author === userName.value || c.author === ''
}

function fmtTime(t: number): string {
  if (!t) return ''
  const d = new Date(t)
  const now = Date.now()
  const diff = now - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function initials(name: string): string {
  return (name || '?').slice(0, 1).toUpperCase()
}

// ---------- 源码模式：锚点 = textarea 里的 <mark data-note 文本 ----------
// 视图切到源码后 .milkdown 被隐藏，coordsAtPos 返回左上角垃圾坐标；
// 改为在源码 textarea 里按等宽字体度量 mark 的屏幕位置（含折行估算）。
const SOURCE_MARK_RE = /<mark\s+data-note=(["'])((?:(?!\1).)*)\1[^>]*>/g

interface SourceMarkInfo {
  tagStart: number
  tagEnd: number
  contentStart: number
  contentEnd: number
  thread: Comment[]
}

/** 找出 textarea 中所有 <mark data-note> 标签（区间 + 解析后的线程） */
function findSourceMarks(ta: HTMLTextAreaElement): SourceMarkInfo[] {
  const value = ta.value
  const out: SourceMarkInfo[] = []
  SOURCE_MARK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SOURCE_MARK_RE.exec(value))) {
    const tagStart = m.index
    const contentStart = tagStart + m[0].length
    const close = value.indexOf('</mark>', contentStart)
    const contentEnd = close >= 0 ? close : contentStart
    const tagEnd = close >= 0 ? close + 7 : contentStart // '</mark>'.length = 7
    out.push({ tagStart, tagEnd, contentStart, contentEnd, thread: parseThread(m[2]) })
  }
  return out
}

/** 按线程匹配：找与某批注线程一致的 mark 内容区间 */
function findSourceMarkRange(ta: HTMLTextAreaElement, thread: Comment[]): { start: number; end: number } | null {
  const hit = findSourceMarks(ta).find((mk) => JSON.stringify(mk.thread) === JSON.stringify(thread))
  return hit ? { start: hit.contentStart, end: hit.contentEnd } : null
}

/** 等宽字符宽度（textarea 实际字体） */
function measureMonoChar(ta: HTMLTextAreaElement, cs: CSSStyleDeclaration): number {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return 0
    ctx.font = cs.font
    return ctx.measureText('0').width || 0
  } catch {
    return 0
  }
}

/** 源码 textarea 行度量：从文本开头到 offset 的「视觉行数」与当前行列像素偏移（含折行估算） */
function sourceLineMetrics(
  value: string,
  offset: number,
  charW: number,
  availW: number,
  tabSize: number
): { lines: number; col: number } {
  let lines = 0
  let col = 0
  const n = Math.min(offset, value.length)
  for (let i = 0; i < n; i++) {
    const ch = value[i]
    if (ch === '\n') {
      lines++
      col = 0
      continue
    }
    let w = charW
    if (ch === '\t') {
      const colChars = col / charW
      w = (tabSize - (colChars % tabSize)) * charW
    }
    if (col + w > availW && col > 0 && w <= availW) {
      lines++ // 折行：进入下一视觉行
      col = w
    } else {
      col += w
    }
  }
  return { lines, col }
}

/** 源码模式：批注 mark 在 textarea 内的屏幕矩形（等宽 + 折行估算） */
function sourceMarkRect(
  ta: HTMLTextAreaElement,
  ann: Annotation
): { left: number; right: number; top: number; bottom: number; height: number } | null {
  const range = findSourceMarkRange(ta, ann.thread)
  if (!range) return null
  const cs = getComputedStyle(ta)
  const lineHeight = parseFloat(cs.lineHeight) || 20.8
  const padTop = parseFloat(cs.paddingTop) || 12
  const padLeft = parseFloat(cs.paddingLeft) || 16
  const padRight = parseFloat(cs.paddingRight) || 16
  const tabSize = parseFloat(cs.tabSize) || 2
  const availW = Math.max(ta.clientWidth - padLeft - padRight, 1)
  const charW = measureMonoChar(ta, cs) || 7.8
  const { lines, col } = sourceLineMetrics(ta.value, range.start, charW, availW, tabSize)
  // mark 内容宽度（同度量累加，遇换行截断）
  let markW = 0
  for (let i = range.start; i < range.end; i++) {
    const ch = ta.value[i]
    if (ch === '\n') break
    markW += ch === '\t' ? tabSize * charW : charW
  }
  const tr = ta.getBoundingClientRect()
  const y = tr.top + padTop + lines * lineHeight - ta.scrollTop + lineHeight / 2
  const xLeft = tr.left + padLeft + col - ta.scrollLeft
  const xRight = xLeft + markW
  return {
    left: xLeft,
    right: xRight,
    top: y - lineHeight / 2,
    bottom: y + lineHeight / 2,
    height: lineHeight,
  }
}

/** 源码模式：把 textarea 滚动到 mark 所在行居中（不改变选区） */
function scrollSourceLine(ta: HTMLTextAreaElement, contentStart: number) {
  const cs = getComputedStyle(ta)
  const lineHeight = parseFloat(cs.lineHeight) || 20.8
  const padLeft = parseFloat(cs.paddingLeft) || 16
  const padRight = parseFloat(cs.paddingRight) || 16
  const tabSize = parseFloat(cs.tabSize) || 2
  const availW = Math.max(ta.clientWidth - padLeft - padRight, 1)
  const charW = measureMonoChar(ta, cs) || 7.8
  const { lines } = sourceLineMetrics(ta.value, contentStart, charW, availW, tabSize)
  const target = lines * lineHeight - ta.clientHeight / 2 + lineHeight / 2
  ta.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
}

/** 源码模式：滚动到 mark 所在行居中，并选中 mark 内容（点击锚点反馈） */
function scrollSourceToMark(ta: HTMLTextAreaElement, contentStart: number, contentEnd: number) {
  scrollSourceLine(ta, contentStart)
  ta.setSelectionRange(contentStart, contentEnd)
}

// ---------- 连线（抽屉左边缘 → 激活锚点） ----------
const connector = ref<SVGPathElement | null>(null)
const connectorSvg = ref<SVGSVGElement | null>(null)
const drawerEl = ref<HTMLDivElement | null>(null)

function drawConnector() {
  const svg = connectorSvg.value
  const path = connector.value
  const drawer = drawerEl.value
  const active = anns.value.find((a) => a.id === activeId.value)
  if (!svg || !path || !drawer || !active || active.from < 0) {
    if (svg) svg.style.display = 'none'
    return
  }
  void (async () => {
    const m = await import('../editor/manager')
    const tabId = state.activeTabId
    const tab = tabId ? state.tabs.find((t) => t.id === tabId) : null
    // M6：源码模式 → 锚点 = textarea 里的 <mark data-note 文本（等宽度量定位），
    // 不再用隐藏 Crepe 的 coordsAtPos（切视图后返回左上角垃圾坐标）
    if (tab?.viewMode === 'source') {
      const ta = m.getSourceTextarea(tabId ?? '')
      const rect = ta ? sourceMarkRect(ta, active) : null
      if (rect) drawConnectorPath(rect, drawer, active)
      else svg.style.display = 'none'
      return
    }
    // M14：diff 模式下用渲染 Crepe（doc = 组合 md）；否则主编辑器
    const crepe =
      tab?.viewMode === 'diff'
        ? m.getRenderInstance(tabId ?? '')
        : m.getActiveInstance()?.crepe ?? null
    if (!crepe) return
    const { editorViewCtx } = await import('@milkdown/kit/core')
    try {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        let anchorRect: DOMRect
        const pos = Math.min(active.from, view.state.doc.content.size)
        const dom = view.domAtPos(pos)
        const el = (dom.node as HTMLElement)?.closest?.(
          'mark.annotation, .annotation-dynamic, .diff-del, .diff-ins'
        ) as HTMLElement | null
        if (el && el.getBoundingClientRect().width) {
          anchorRect = el.getBoundingClientRect()
        } else {
          const c = view.coordsAtPos(pos)
          anchorRect = {
            left: c.left, right: c.right, top: c.top, bottom: c.bottom,
            width: c.right - c.left, height: c.bottom - c.top,
          } as DOMRect
        }
        drawConnectorPath(anchorRect, drawer, active)
      })
    } catch {
      /* 编辑器已销毁 */
    }
  })()
}

/** 从抽屉内激活卡片左缘中点 → 锚点矩形，绘制三次贝塞尔 S 形平滑连线 */
function drawConnectorPath(
  anchorRect: { left: number; right: number; top: number; bottom: number; height: number },
  drawer: HTMLElement,
  active: Annotation
) {
  const path = connector.value
  const svg = connectorSvg.value
  if (!path || !svg) return
  const drawerRect = drawer.getBoundingClientRect()
  // 起点：优先吸附到抽屉内激活卡片左缘中点（连线指向具体批注卡而非抽屉中线）；
  // 卡片滚出可视区时钳制在列表可视范围内，避免连线悬空；无卡片时回退抽屉左缘中点
  let y1 = drawerRect.top + drawerRect.height / 2
  const card = drawer.querySelector('.ad-card.active') as HTMLElement | null
  if (card) {
    const cr = card.getBoundingClientRect()
    y1 = cr.top + cr.height / 2
    const list = drawer.querySelector('.annotation-drawer-list') as HTMLElement | null
    if (list) {
      const lr = list.getBoundingClientRect()
      y1 = Math.min(Math.max(y1, lr.top + 4), lr.bottom - 4)
    }
  }
  const x1 = drawerRect.left
  const x2 = anchorRect.right
  const y2 = anchorRect.top + Math.min(anchorRect.height, 24) / 2
  // 三次贝塞尔 S 形：两端保持水平切线（左缘竖边/锚点横条），控制点水平外扩量随间距自适应，
  // 并轻微向中点预瞄 → 远近都平滑，不僵硬、不外溢
  const gap = Math.max(x1 - x2, 0)
  const pull = Math.min(Math.max(gap * 0.5, 28), 140)
  const dy = y2 - y1
  const c1x = x1 - pull
  const c1y = y1 + dy * 0.12
  const c2x = x2 + pull
  const c2y = y2 - dy * 0.12
  path.setAttribute(
    'd',
    `M ${Math.round(x1)} ${Math.round(y1)} C ${Math.round(c1x)} ${Math.round(c1y)}, ${Math.round(c2x)} ${Math.round(c2y)}, ${Math.round(x2)} ${Math.round(y2)}`
  )
  path.setAttribute('stroke', LEVEL_COLOR[active.level])
  svg.style.display = 'block'
  svg.classList.remove('annotation-connector-strong')
}

watch(activeId, (id) => {
  if (id) open.value = true // 点击锚点自动展开抽屉
  requestAnimationFrame(drawConnector)
})
watch([() => anns.value.length, open], () => {
  requestAnimationFrame(drawConnector)
})
watch(open, (v) => {
  if (!v) connectorSvg.value?.style && (connectorSvg.value.style.display = 'none')
})
// M6：视图切换（wysiwyg/source/diff）后重绘连线（源码模式下 Crepe 隐藏、坐标失效）；
// 切到源码且存在激活批注时，先把 textarea 滚到批注 mark 所在行（连线附着到可见锚点）
watch(
  () => state.tabs.find((t) => t.id === state.activeTabId)?.viewMode,
  () => {
    requestAnimationFrame(() => {
      const tabId = state.activeTabId
      const tab = tabId ? state.tabs.find((t) => t.id === tabId) : null
      if (tab?.viewMode === 'source') {
        const active = anns.value.find((a) => a.id === activeId.value)
        if (active && active.persist) {
          void import('../editor/manager').then((m) => {
            const ta = m.getSourceTextarea(tabId ?? '')
            if (ta) {
              const r = findSourceMarkRange(ta, active.thread)
              if (r) scrollSourceLine(ta, r.start)
            }
          })
        }
      }
      drawConnector()
    })
  }
)
onMounted(() => {
  window.addEventListener('scroll', scheduleConnector, true)
})
function scheduleConnector() {
  if (open.value) requestAnimationFrame(drawConnector)
}

// ---------- 拖拽宽度 ----------
let dragging = false
function onDragStart(e: MouseEvent) {
  e.preventDefault()
  dragging = true
  const startX = e.clientX
  const startW = width.value
  const onMove = (ev: MouseEvent) => {
    if (!dragging) return
    const w = startW + (startX - ev.clientX)
    width.value = Math.max(50, Math.min(480, Math.round(w)))
  }
  const onUp = () => {
    dragging = false
    settings.annotationDrawerWidth = width.value
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// 悬停突出
function onCardHover(strong: boolean) {
  connectorSvg.value?.classList.toggle('annotation-connector-strong', strong)
}
function onAnchorHover(strong: boolean) {
  connectorSvg.value?.classList.toggle('annotation-connector-strong', strong)
}
</script>

<template>
  <div v-if="state.activeTabId" class="annotation-drawer" :class="{ open }" :style="{ width: open ? width + 'px' : '0px' }">
    <!-- 折叠态：右下角小胶囊按钮（不占布局空间，不再是一整条竖栏） -->
    <button v-if="!open" class="annotation-open-btn" title="展开批注抽屉" @click="open = true">
      <span class="dot" :class="{ has: commentCount + errorCount + warningCount + infoCount > 0 }"></span>
      <span>批注</span>
      <span v-if="commentCount + errorCount + warningCount + infoCount > 0" class="badge">{{ commentCount + errorCount + warningCount + infoCount }}</span>
    </button>

    <div v-else class="annotation-drawer-body" ref="drawerEl">
      <!-- 头部：计数 + 折叠 + 拖拽把手 -->
      <div class="annotation-drawer-head">
        <span class="ad-title">批注</span>
        <span class="ad-counts">
          <span v-if="commentCount" class="ok">{{ commentCount }}</span>
          <span v-if="warningCount" class="warn">{{ warningCount }}</span>
          <span v-if="errorCount" class="err">{{ errorCount }}</span>
          <span v-if="infoCount" class="info">📝{{ infoCount }}</span>
        </span>
        <div class="ad-head-actions">
          <button
            v-if="state.activeTabId && state.tabs.find(t => t.id === state.activeTabId)?.viewMode !== 'diff'"
            class="ad-icon-btn refresh"
            title="重新校验"
            @click="revalidate"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
          </button>
          <button class="ad-icon-btn" title="折叠抽屉" @click="open = false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="13 17 18 12 13 7"></polyline><polyline points="6 17 11 12 6 7"></polyline></svg>
          </button>
        </div>
      </div>
      <div class="annotation-drawer-resizer" title="拖拽调整宽度" @mousedown="onDragStart"></div>

      <!-- 列表 -->
      <div class="annotation-drawer-list">
        <div v-if="!anns.length" class="ad-empty">
          暂无批注。<br />选中文本后使用工具栏「添加批注」，或从模板文件触发校验。
        </div>

        <!-- 只读卡（校验违规 / M14 diff 改动说明；点击卡片 = 定位） -->
        <div
          v-for="a in anns.filter(x => x.level !== 'comment')"
          :key="a.id"
          class="ad-card read-only"
          :class="{ active: a.id === activeId }"
          @mouseenter="onCardHover(true)"
          @mouseleave="onCardHover(false)"
          @click="locate(a)"
          :title="a.from >= 0 ? (a.source === 'diff' ? '点击定位到改动位置' : '点击定位到违规位置') : ''"
        >
          <div class="ad-card-head">
            <template v-if="a.source === 'diff'">
              <span class="ad-ic info">📝</span>
              <span class="ad-card-title">改动说明</span>
            </template>
            <template v-else>
              <span class="ad-ic" :class="a.level">{{ a.level === 'error' ? '⛔' : '⚠️' }}</span>
              <span class="ad-card-title">校验提示</span>
            </template>
          </div>
          <div class="ad-card-content">{{ a.thread[0]?.content }}</div>
        </div>

        <!-- 人工批注卡（评论线程；点击头部 = 定位 + 展开/折叠；折叠不显示输入框） -->
        <div
          v-for="a in anns.filter(x => x.level === 'comment')"
          :key="a.id"
          class="ad-card"
          :data-id="a.id"
          :class="{ active: a.id === activeId, resolved: a.thread.every(c => c.resolved), collapsed: expandedId !== a.id }"
          @mouseenter="onCardHover(true)"
          @mouseleave="onCardHover(false)"
        >
          <div class="ad-card-head" :title="a.from >= 0 ? '点击定位到锚点' : ''" @click="locate(a)">
            <span class="ad-ic comment">💬</span>
            <span class="ad-anchor" :title="a.anchorText">{{ a.anchorText || '（无锚定文本）' }}</span>
            <span class="ad-comment-count">{{ a.thread.length }} 条</span>
            <span class="ad-fold">{{ expandedId === a.id ? '▾' : '▸' }}</span>
          </div>
          <div class="ad-thread">
              <div v-for="c in a.thread" :key="c.id" class="ad-comment" :class="{ resolved: c.resolved }">
                <span class="ad-avatar" :style="{ background: LEVEL_COLOR[a.level] }">{{ initials(c.author) }}</span>
                <div class="ad-comment-main">
                  <div class="ad-comment-meta">
                    <span class="ad-author">{{ c.author || '未知' }}</span>
                    <span class="ad-time">{{ fmtTime(c.createdAt) }}</span>
                    <!-- 已解决状态圆：空圆=未解决，✔圆=已解决；仅创建人可点击切换 -->
                    <span
                      class="ad-resolve-dot"
                      :class="{ resolved: c.resolved, mine: canResolve(c) }"
                      :title="canResolve(c) ? (c.resolved ? '点击重新打开' : '点击标记已解决') : ''"
                      @click.stop="toggleResolved(a, c)"
                    >{{ c.resolved ? '✔' : '' }}</span>
                  </div>
                  <div class="ad-comment-content" :class="{ struck: c.resolved }">{{ c.content }}</div>
                </div>
              </div>
            </div>
            <!-- 回复输入（v6：仅点击展开时显示；Enter 提交 / Shift+Enter 换行 / ESC 清空） -->
            <div v-if="expandedId === a.id" class="ad-reply">
              <textarea
                v-model="draft[a.id]"
                rows="2"
                placeholder="回复…（Enter 发送，Shift+Enter 换行，ESC 取消）"
                @keydown="onReplyKeydown(a, $event)"
              ></textarea>
              <div class="ad-reply-actions">
                <button class="mini primary" @click="reply(a)">发送</button>
              </div>
            </div>
        </div>
      </div>
    </div>

    <!-- 连线（SVG 全屏） -->
    <svg ref="connectorSvg" class="annotation-connector" aria-hidden="true">
      <path ref="connector" class="annotation-connector-path" />
    </svg>
  </div>
</template>

<style scoped>
.annotation-drawer {
  /* 与主编辑区同层：作为工作区 .workspace（row flex）中的一列，占据独立宽度，不压住编辑内容 */
  flex: none;
  display: flex;
  height: 100%;
  min-width: 0;
}
.annotation-drawer.open {
  border-left: 1px solid var(--chrome-border);
  background: var(--chrome-surface);
}
.annotation-drawer-body {
  /* 撑满抽屉宽度：flex-basis 为 0 避免按内容 max-content 收缩（短内容时右边空出） */
  flex: 1;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  height: 100%;
  font-size: 12px;
}
.annotation-open-btn {
  /* 折叠态展开按钮：右下角悬浮小胶囊，不占布局空间，也不遮挡编辑区主体 */
  position: fixed;
  right: 16px;
  bottom: 42px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--chrome-border);
  border-radius: 999px;
  background: var(--chrome-surface);
  color: var(--chrome-on-surface);
  font-size: 12px;
  cursor: pointer;
  box-shadow: var(--chrome-shadow-1);
  z-index: 80;
  user-select: none;
}
.annotation-open-btn:hover {
  background: var(--chrome-hover);
  border-color: var(--chrome-primary);
}
.annotation-open-btn .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--chrome-outline);
  flex: none;
}
.annotation-open-btn .dot.has {
  background: var(--chrome-primary);
}
.annotation-open-btn .badge {
  background: var(--chrome-primary);
  color: var(--chrome-on-secondary, #fff);
  border-radius: 999px;
  font-size: 10px;
  line-height: 16px;
  min-width: 16px;
  padding: 0 5px;
  text-align: center;
  font-weight: 600;
}
.annotation-drawer-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--chrome-border-light);
  flex: none;
}
.ad-title {
  font-weight: 600;
  color: var(--chrome-on-surface);
}
.ad-counts {
  display: flex;
  gap: 4px;
  margin-left: auto;
  font-weight: 600;
}
.ad-counts .err { color: var(--chrome-error, #ba1a1a); }
.ad-counts .warn { color: #e6a23c; }
.ad-counts .ok { color: var(--chrome-primary, #4caf50); }
.ad-counts .info { color: #8a8a8a; font-size: 11px; }
/* 头部图标按钮组（刷新/折叠）——融入主题：颜色/悬停/强调色全部来自 --chrome-* */
.ad-head-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 4px;
}
.ad-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
}
.ad-icon-btn:hover {
  background: var(--chrome-hover);
  color: var(--chrome-primary);
}
.ad-icon-btn:active {
  transform: scale(0.9);
}
.ad-icon-btn svg {
  width: 14px;
  height: 14px;
}
/* 刷新按钮 hover：图标旋转提示 */
.ad-icon-btn.refresh:hover svg {
  transform: rotate(180deg);
  transition: transform 0.4s ease;
}
.annotation-drawer-resizer {
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 5;
}
.annotation-drawer-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ad-empty {
  color: var(--chrome-on-surface-variant);
  line-height: 1.6;
  text-align: center;
  padding: 24px 8px;
}
.ad-card {
  border: 1px solid var(--chrome-border-light);
  border-radius: 8px;
  background: var(--chrome-background);
  overflow: hidden;
}
.ad-card.active {
  border-color: var(--chrome-primary);
  box-shadow: 0 0 0 1px var(--chrome-primary);
}
.ad-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: var(--chrome-surface-low, var(--chrome-hover));
  border-bottom: 1px solid var(--chrome-border-light);
}
.ad-ic { font-size: 12px; }
.ad-ic.error { color: var(--chrome-error, #ba1a1a); }
.ad-ic.warning { color: #e6a23c; }
.ad-ic.info { color: #8a8a8a; }
.ad-card-title {
  font-weight: 600;
  color: var(--chrome-on-surface);
}
.ad-anchor {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--chrome-on-surface);
  font-size: 11px;
}
.ad-card-content {
  padding: 8px;
  line-height: 1.5;
  color: var(--chrome-on-surface);
  white-space: pre-wrap;
  word-break: break-word;
}
.ad-thread {
  padding: 4px 8px;
}
.ad-comment {
  display: flex;
  gap: 6px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--chrome-border-light);
}
.ad-comment:last-child { border-bottom: none; }
.ad-avatar {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: var(--chrome-on-secondary, #fff);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
}
.ad-comment-main { flex: 1; min-width: 0; }
.ad-comment-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ad-author { font-weight: 600; color: var(--chrome-on-surface); }
.ad-time { color: var(--chrome-on-surface-variant); font-size: 11px; }
.ad-comment-content {
  margin-top: 2px;
  line-height: 1.5;
  color: var(--chrome-on-surface);
  white-space: pre-wrap;
  word-break: break-word;
}
.ad-comment-content.struck {
  opacity: 0.55;
  text-decoration: line-through;
}
/* 已解决状态圆：空圆=未解决；✔绿圆=已解决；仅创建人（mine）可点击 */
.ad-resolve-dot {
  margin-left: auto;
  flex: none;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 1.5px solid var(--chrome-outline);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--chrome-on-secondary, #fff);
  line-height: 1;
  opacity: 0.45;
  user-select: none;
}
.ad-resolve-dot.mine {
  opacity: 1;
  cursor: pointer;
}
.ad-resolve-dot.mine:hover {
  border-color: var(--chrome-primary);
}
.ad-resolve-dot.resolved {
  background: #4caf50;
  border-color: #4caf50;
}
.ad-resolve-dot.resolved:not(.mine) {
  opacity: 0.7;
}
/* 评论计数 + 折叠箭头 */
.ad-comment-count {
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  margin-left: auto;
}
.ad-fold {
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  margin-left: 4px;
}
.ad-card.collapsed .ad-card-head {
  border-bottom: none;
}
.ad-reply {
  padding: 6px 8px;
  border-top: 1px solid var(--chrome-border-light);
}
.ad-reply textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--chrome-border);
  border-radius: 6px;
  padding: 4px 6px;
  font: inherit;
  resize: vertical;
  background: var(--chrome-background);
  color: var(--chrome-on-surface);
}
.ad-reply-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 5px;
}
.mini.danger { color: var(--chrome-error, #ba1a1a); }
</style>
