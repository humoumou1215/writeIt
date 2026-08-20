<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { state } from '../state/store'
import { mountEditor, unmountEditor } from '../editor/manager'
import DiffView from './DiffView.vue'

const props = defineProps<{ tabId: string; visible: boolean }>()

const rootEl = ref<HTMLDivElement | null>(null)

const tab = computed(() => state.tabs.find((t) => t.id === props.tabId))

onMounted(() => {
  if (rootEl.value) mountEditor(props.tabId, rootEl.value)
})

onBeforeUnmount(() => {
  unmountEditor(props.tabId)
})

// 可见性切换不销毁实例（保留撤销历史）；diff 模式隐藏 Crepe 容器（DiffView 接管）
watch(
  () => props.visible,
  () => {
    if (rootEl.value) applyDisplay()
  }
)

watch(
  () => tab.value?.viewMode,
  () => {
    if (rootEl.value) applyDisplay()
  }
)

/** 纯显示切换。滚动位置由 manager 在 activeTabId 切换点统一保存/恢复（见 manager.saveTabScroll），
 *  此处只负责 display——Vue watcher 执行时 DOM 已更新，scrollTop 已被清 0，不能在这里保存。 */
function applyDisplay() {
  if (!rootEl.value) return
  const showCrepe = props.visible && tab.value?.viewMode !== 'diff'
  rootEl.value.style.display = showCrepe ? 'block' : 'none'
}
</script>

<template>
  <div
    ref="rootEl"
    class="editor-pane"
    :class="{ 'source-mode': tab?.viewMode === 'source', 'diff-mode': tab?.viewMode === 'diff' }"
    :style="{ display: visible && tab?.viewMode !== 'diff' ? 'block' : 'none' }"
  ></div>
  <DiffView v-if="visible && tab?.viewMode === 'diff'" :tab-id="tabId" />
</template>

<style scoped>
.editor-pane {
  flex: 1;
  min-height: 0;
  overflow: auto;
  position: relative;  /* gutter 绝对定位基准 */
  /* 顶部无内边距：Crepe TopBar 紧贴标签栏，不留空隙 */
  padding: 0 4px 24px;
}

/* M7：源码模式 —— 容器不再滚动（textarea 自身滚动），去掉内边距 */
.editor-pane.source-mode {
  overflow: hidden;
  padding: 0;
}

/* 让 Crepe TopBar 与编辑器背景一致，活动标签 → 顶栏 → 正文连成一体 */
:deep(.milkdown .milkdown-top-bar) {
  background: var(--chrome-background, #fff);
}
</style>
