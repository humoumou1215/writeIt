<script setup lang="ts">
// 三级递进菜单（设计文档 §6.6 v2）：
//   第一级：文件树（逐级发现，Enter 展开目录 / Backspace 返回上级）
//   过滤模式：输入字符 → 全树搜索（扁平按路径匹配）
//   第二级：模板实体（懒加载，M4 suggest 服务填充）
// 保留 slash 视觉语言（tab-group 模式选择器 + menu-groups 列表 + 同款键盘交互）
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { Icon } from '@milkdown/kit/component'
import { isEditableFile } from '../../../fs/types'
import type { FsEntry } from '../../../fs/types'
import type { RefMode } from './index'

const props = defineProps<{
  menu: {
    select: (path: string, mode?: RefMode) => void
    selectFile: (path: string, mode: RefMode) => void
    selectEntity: (objectId: string) => void
    setMode: (mode: RefMode) => void
    hide: () => void
    enterDir: (dir: string) => void
    goUp: () => void
    closeEntities: () => void
    hasFocus: () => boolean
  }
  state: {
    visible: boolean
    mode: RefMode
    query: string
    tree: FsEntry[]
    currentDir: string
    selectedPath: string | null
    entities: { id: string; label: string }[]
  }
}>()

const MODES: Array<{ id: RefMode; label: string }> = [
  { id: 'link', label: '链接' },
  { id: 'embed', label: '嵌入' },
  { id: 'embed-ro', label: '嵌入只读' },
]

const strip = (p: string) => p.replace(/\.(md|markdown|txt)$/i, '')

// ---------- 第一级：当前视图条目 ----------

interface MenuEntry {
  key: string
  path: string
  label: string
  kind: 'dir' | 'file'
}

/** 树模式下 currentDir 的子项 */
const treeChildren = computed<MenuEntry[]>(() => {
  const walk = (list: FsEntry[], dir: string): FsEntry[] | null => {
    if (dir === '') return list
    for (const e of list) {
      if (e.kind === 'dir' && e.path === dir) return e.children ?? []
      if (e.kind === 'dir' && e.children) {
        const found = walk(e.children, dir)
        // 未命中必须返回 null（返回 [] 会被调用方当成"命中空目录"而短路）
        if (found !== null) return found
      }
    }
    return null
  }
  const list = walk(props.state.tree, props.state.currentDir) ?? []
  return list
    .map((e) =>
      e.kind === 'dir'
        ? { key: 'd:' + e.path, path: e.path, label: e.name, kind: 'dir' as const }
        : isEditableFile(e.name)
          ? { key: 'f:' + e.path, path: strip(e.path), label: strip(e.name), kind: 'file' as const }
          : null
    )
    .filter((x): x is MenuEntry => x !== null)
})

/** 过滤模式：全树搜索（目录 + 文件按路径匹配） */
const searchEntries = computed<MenuEntry[]>(() => {
  const q = props.state.query.trim().toLowerCase()
  if (!q) return []
  const out: MenuEntry[] = []
  const walk = (list: FsEntry[]) => {
    for (const e of list) {
      const path = e.path.toLowerCase()
      if (path.includes(q)) {
        if (e.kind === 'dir') {
          out.push({ key: 'd:' + e.path, path: e.path, label: e.path + '/', kind: 'dir' })
        } else if (isEditableFile(e.name)) {
          out.push({ key: 'f:' + e.path, path: strip(e.path), label: strip(e.path), kind: 'file' })
        }
      }
      if (e.kind === 'dir' && e.children) walk(e.children)
    }
  }
  walk(props.state.tree)
  // 目录优先
  out.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'dir' ? -1 : 1))
  return out
})

const entries = computed<MenuEntry[]>(() =>
  props.state.query.trim() ? searchEntries.value : treeChildren.value
)

const isFiltering = computed(() => !!props.state.query.trim())
const inEntity = computed(() => props.state.selectedPath != null)
const currentDirLabel = computed(() => {
  const dir = props.state.currentDir
  return dir ? `📁 ${dir}` : '文件'
})

// ---------- 导航 ----------

const host = ref<HTMLElement>()
const hoverIndex = ref(0)
const activeIndex = ref<number | null>(null)
const prevMousePosition = ref({ x: -999, y: -999 })

watch([entries, () => props.state.visible, inEntity], () => {
  hoverIndex.value = 0
})

function scrollToHover() {
  requestAnimationFrame(() => {
    const target = host.value?.querySelector<HTMLElement>('[data-index].hover')
    const root = host.value?.querySelector<HTMLElement>('.menu-groups')
    if (!target || !root) return
    root.scrollTop = target.offsetTop - root.offsetTop
  })
}

function onHover(i: number) {
  hoverIndex.value = i
  scrollToHover()
}

function onPointerMove(e: PointerEvent) {
  prevMousePosition.value = { x: e.x, y: e.y }
}

function getOnPointerEnter(index: number) {
  return (e: PointerEvent) => {
    const prev = prevMousePosition.value
    if (e.x === prev.x && e.y === prev.y) return
    onHover(index)
  }
}

function cycleMode(delta: number) {
  const idx = MODES.findIndex((m) => m.id === props.state.mode)
  props.menu.setMode(MODES[(idx + delta + MODES.length) % MODES.length].id)
}

function runEntry(entry: MenuEntry) {
  if (!entry) return
  if (entry.kind === 'dir') {
    // 过滤模式下 Enter 目录 → 进入该目录并清空过滤
    props.menu.enterDir(entry.path)
    return
  }
  // 文件：检查目标 doctype + suggest（M4）→ 命中进入实体级，否则按当前模式插入
  props.menu.selectFile(entry.path, props.state.mode)
}

function onKeydown(e: KeyboardEvent) {
  console.log('[menu-key]', e.key, 'visible=', props.state.visible, 'focus=', props.menu.hasFocus())
  if (!props.state.visible) return
  // 多标签时多个菜单实例共享 window 监听：
  // 仅「本编辑器持有焦点 且 本容器可见」的实例处理，避免 Enter 双重触发（展开目录+插入文件）
  if (!props.menu.hasFocus()) return
  const shown = host.value?.closest('[data-show]')?.getAttribute('data-show')
  if (shown === 'false') return
  if (inEntity.value) {
    // 第二级：实体模式（M4 填充），←→/Esc/Backspace 返回文件级
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation()
      props.menu.closeEntities()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const n = props.state.entities.length
      if (n) hoverIndex.value = (hoverIndex.value + delta + n) % n
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation()
      const obj = props.state.entities[hoverIndex.value]
      if (obj) props.menu.selectEntity(obj.id)
    }
    return
  }

  if (e.key === 'Escape') {
    e.preventDefault(); e.stopPropagation()
    props.menu.hide()
    return
  }
  if (e.key === 'Backspace') {
    // 过滤模式下放行（删除文档字符 → shouldShow 更新过滤词）；树模式返回上级
    if (isFiltering.value) return
    e.preventDefault(); e.stopPropagation()
    props.menu.goUp()
    hoverIndex.value = 0
    return
  }
  if (e.key === 'Tab') {
    e.preventDefault(); e.stopPropagation()
    cycleMode(1)
    return
  }
  if (e.key === 'ArrowLeft') {
    // ←：过滤模式清空过滤词回树；树模式返回上级目录
    e.preventDefault(); e.stopPropagation()
    props.menu.back()
    hoverIndex.value = 0
    return
  }
  if (e.key === 'ArrowRight') {
    // →：进入 hover 的目录（文件无下级，无操作）
    e.preventDefault(); e.stopPropagation()
    const entry = entries.value[hoverIndex.value]
    if (entry && entry.kind === 'dir') {
      props.menu.enterDir(entry.path)
      hoverIndex.value = 0
    }
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault(); e.stopPropagation()
    if (hoverIndex.value < entries.value.length - 1) onHover(hoverIndex.value + 1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation()
    if (hoverIndex.value > 0) onHover(hoverIndex.value - 1)
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault(); e.stopPropagation()
    const entry = entries.value[hoverIndex.value]
    if (entry) runEntry(entry)
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown, { capture: true }))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, { capture: true }))
</script>

<template>
  <div v-if="state.visible" ref="host" @pointerdown.prevent>
    <!-- 模式选择器（tab-group 视觉） -->
    <nav v-if="!inEntity" class="tab-group">
      <ul>
        <li
          v-for="m in MODES"
          :key="m.id"
          :class="{ selected: state.mode === m.id }"
          @pointerdown="menu.setMode(m.id)"
        >
          {{ m.label }}
        </li>
      </ul>
    </nav>

    <!-- 第一级：文件树 / 过滤 -->
    <div v-if="!inEntity" class="menu-groups" @pointermove="onPointerMove">
      <div class="menu-group">
        <h6>{{ isFiltering ? `搜索：${state.query}` : currentDirLabel }}</h6>
        <ul>
          <li
            v-for="(entry, i) in entries"
            :key="entry.key"
            :data-index="i"
            :class="{ hover: hoverIndex === i, active: activeIndex === i }"
            @pointerenter="getOnPointerEnter(i)"
            @pointerdown="activeIndex = i"
            @pointerup="activeIndex = null; runEntry(entry)"
          >
            <Icon :icon="entry.kind === 'dir' ? dirSvg : fileSvg" />
            <span>{{ entry.label }}</span>
            <span v-if="entry.kind === 'dir'" class="ref-dir-arrow">▸</span>
          </li>
        </ul>
        <div v-if="!entries.length" class="ref-menu-empty">无匹配</div>
      </div>
    </div>

    <!-- 第二级：模板实体（M4 suggest 服务填充） -->
    <div v-else class="menu-groups">
      <div class="menu-group">
        <h6>📄 {{ state.selectedPath }} · 模板对象</h6>
        <ul>
          <li
            v-for="(obj, i) in state.entities"
            :key="obj.id"
            :data-index="i"
            :class="{ hover: hoverIndex === i }"
            @pointerenter="getOnPointerEnter(i)"
            @pointerdown="activeIndex = i"
            @pointerup="activeIndex = null; menu.selectEntity(obj.id)"
          >
            <Icon :icon="objSvg" />
            <span>{{ obj.label }}</span>
          </li>
        </ul>
        <div v-if="!state.entities.length" class="ref-menu-empty">无模板对象</div>
      </div>
    </div>
  </div>
</template>

<style>
/* 容器由 SlashProvider 定位；class 与 crepe / 菜单一致，主题 CSS 直接生效 */
.milkdown-ref-menu {
  /* fixed 由 SlashProvider strategy:'fixed' 决定（视口定位，随光标准确） */
  position: fixed;
  z-index: 10;
}
.milkdown-ref-menu[data-show='false'] {
  display: none;
}
</style>

<style scoped>
.ref-menu-empty {
  padding: 14px;
  text-align: center;
  color: var(--chrome-on-surface-variant, #8a8f99);
  font-size: 12px;
}
.ref-dir-arrow {
  margin-left: auto;
  font-size: 11px;
  color: var(--chrome-on-surface-variant, #8a8f99);
}
</style>

<script lang="ts">
// 图标（与 crepe 一致的 SVG 字符串）
const dirSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`
const fileSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`
const objSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V5h14v14zM9 7H7v2h2V7zm4 0h-2v2h2V7zm4 0h-2v2h2V7zM9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zM9 15H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/></svg>`
</script>
