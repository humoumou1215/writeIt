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
const collapsed = ref<Record<string, boolean>>({}) // 卡 id → 折叠（折叠时不显示评论输入框）
let unsub: (() => void) | null = null

const activeTabId = computed(() => state.activeTabId)

async function refresh() {
  const tabId = state.activeTabId
  if (!tabId) {
    anns.value = []
    return
  }
  const { getActiveInstance } = await import('../editor/manager')
  const inst = getActiveInstance()
  if (!inst) return
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
})
onBeforeUnmount(() => {
  unsub?.()
  window.removeEventListener('resize', refresh)
})
watch(activeTabId, refresh)

const errorCount = computed(() => anns.value.filter((a) => a.level === 'error').length)
const warningCount = computed(() => anns.value.filter((a) => a.level === 'warning').length)
const commentCount = computed(() => anns.value.filter((a) => a.level === 'comment').length)

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
  if (ann.from >= 0) {
    const tabId = state.activeTabId
    if (tabId) {
      setActiveAnnotation(tabId, ann.id)
      const { scrollToPos } = await import('../editor/manager')
      await scrollToPos(tabId, ann.from)
    }
  } else {
    // 无锚点（如缺需求表整体违规）：仅激活 + 展开
    const tabId = state.activeTabId
    if (tabId) setActiveAnnotation(tabId, ann.id)
  }
  collapsed.value[ann.id] = !collapsed.value[ann.id]
}

/** 回复输入：Ctrl/Cmd+Enter 提交；Enter 换行；ESC 清空草稿 */
function onReplyKeydown(ann: Annotation, e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    void reply(ann)
  } else if (e.key === 'Escape') {
    draft.value[ann.id] = ''
  }
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

// ---------- 连线（抽屉左边缘 → 激活锚点） ----------
const connector = ref<SVGPathElement | null>(null)
const connectorSvg = ref<SVGSVGElement | null>(null)
const drawerEl = ref<HTMLDivElement | null>(null)

function drawConnector() {
  const svg = connectorSvg.value
  const path = connector.value
  const drawer = drawerEl.value
  const active = anns.value.find((a) => a.id === activeId.value)
  if (!svg || !path || !drawer || !active) {
    if (svg) svg.style.display = 'none'
    return
  }
  void (async () => {
    const m = await import('../editor/manager')
    const inst = m.getActiveInstance()
    if (!inst) return
    const { editorViewCtx } = await import('@milkdown/kit/core')
    inst.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      let anchorRect: DOMRect
      const dom = view.domAtPos(Math.min(active.from, view.state.doc.content.size))
      const el = (dom.node as HTMLElement)?.closest?.('mark.annotation, .annotation-dynamic') as HTMLElement | null
      if (el && el.getBoundingClientRect().width) {
        anchorRect = el.getBoundingClientRect()
      } else {
        const c = view.coordsAtPos(active.from)
        anchorRect = {
          left: c.left, right: c.right, top: c.top, bottom: c.bottom,
          width: c.right - c.left, height: c.bottom - c.top,
        } as DOMRect
      }
      const drawerRect = drawer.getBoundingClientRect()
      const x1 = drawerRect.left
      const y1 = drawerRect.top + drawerRect.height / 2
      const x2 = anchorRect.right
      const y2 = anchorRect.top + Math.min(anchorRect.height, 24) / 2
      const cx = (x1 + x2) / 2
      path.setAttribute('d', `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`)
      path.setAttribute('stroke', LEVEL_COLOR[active.level])
      svg.style.display = 'block'
      svg.classList.remove('annotation-connector-strong')
    })
  })()
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
      <span class="dot" :class="{ has: commentCount + errorCount + warningCount > 0 }"></span>
      <span>批注</span>
      <span v-if="commentCount + errorCount + warningCount > 0" class="badge">{{ commentCount + errorCount + warningCount }}</span>
    </button>

    <div v-else class="annotation-drawer-body" ref="drawerEl">
      <!-- 头部：计数 + 折叠 + 拖拽把手 -->
      <div class="annotation-drawer-head">
        <span class="ad-title">批注</span>
        <span class="ad-counts">
          <span v-if="commentCount" class="ok">{{ commentCount }}</span>
          <span v-if="warningCount" class="warn">{{ warningCount }}</span>
          <span v-if="errorCount" class="err">{{ errorCount }}</span>
        </span>
        <div class="ad-head-actions">
          <button class="ad-icon-btn refresh" title="重新校验" @click="revalidate">
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

        <!-- 校验违规卡（只读；点击卡片 = 定位） -->
        <div
          v-for="a in anns.filter(x => x.level !== 'comment')"
          :key="a.id"
          class="ad-card read-only"
          :class="{ active: a.id === activeId }"
          @mouseenter="onCardHover(true)"
          @mouseleave="onCardHover(false)"
          @click="locate(a)"
          :title="a.from >= 0 ? '点击定位到违规位置' : ''"
        >
          <div class="ad-card-head">
            <span class="ad-ic" :class="a.level">{{ a.level === 'error' ? '⛔' : '⚠️' }}</span>
            <span class="ad-card-title">校验提示</span>
          </div>
          <div class="ad-card-content">{{ a.thread[0]?.content }}</div>
        </div>

        <!-- 人工批注卡（评论线程；点击头部 = 定位 + 展开/折叠；折叠不显示输入框） -->
        <div
          v-for="a in anns.filter(x => x.level === 'comment')"
          :key="a.id"
          class="ad-card"
          :class="{ active: a.id === activeId, resolved: a.thread.every(c => c.resolved), collapsed: collapsed[a.id] }"
          @mouseenter="onCardHover(true)"
          @mouseleave="onCardHover(false)"
        >
          <div class="ad-card-head" :title="a.from >= 0 ? '点击定位到锚点' : ''" @click="locate(a)">
            <span class="ad-ic comment">💬</span>
            <span class="ad-anchor" :title="a.anchorText">{{ a.anchorText || '（无锚定文本）' }}</span>
            <span class="ad-comment-count">{{ a.thread.length }} 条</span>
            <span class="ad-fold">{{ collapsed[a.id] ? '▸' : '▾' }}</span>
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
            <!-- 回复输入（折叠时隐藏；Ctrl+Enter 提交 / Enter 换行 / ESC 清空） -->
            <div v-if="!collapsed[a.id]" class="ad-reply">
              <textarea
                v-model="draft[a.id]"
                rows="2"
                placeholder="回复…（Ctrl+Enter 发送，ESC 取消）"
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
