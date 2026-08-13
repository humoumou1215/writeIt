<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { state } from '../state/store'
import { mountEditor, unmountEditor } from '../editor/manager'

const props = defineProps<{ tabId: string; visible: boolean }>()

const rootEl = ref<HTMLDivElement | null>(null)

onMounted(() => {
  if (rootEl.value) mountEditor(props.tabId, rootEl.value)
})

onBeforeUnmount(() => {
  unmountEditor(props.tabId)
})

// 可见性切换不销毁实例（保留撤销历史）
watch(
  () => props.visible,
  (v) => {
    if (rootEl.value) rootEl.value.style.display = v ? 'block' : 'none'
  }
)
</script>

<template>
  <div ref="rootEl" class="editor-pane" :style="{ display: visible ? 'block' : 'none' }"></div>
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

/* 让 Crepe TopBar 与编辑器背景一致，活动标签 → 顶栏 → 正文连成一体 */
:deep(.milkdown .milkdown-top-bar) {
  background: var(--chrome-background, #fff);
}
</style>
