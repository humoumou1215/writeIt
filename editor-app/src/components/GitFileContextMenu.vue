<script setup lang="ts">
// M16 SCM 文件行右键/⋯ 菜单：按分区动态的单文件操作
//  - 打开文件 / 打开更改 / 暂存或取消暂存 / 放弃更改(Changes, danger) / 还原到 HEAD(Staged, danger)
//  - 忽略(?) / 复制路径 / 在文件管理器中显示
import { state } from '../state/store'
import type { GitFileStatus } from '../git'
import { baseName, isEditableFile } from '../fs/types'

const emit = defineEmits<{
  (e: 'action', action: string, section: 'staged' | 'changes' | 'merge', file: GitFileStatus): void
}>()

function run(action: string) {
  const m = state.scmMenu
  if (!m) return
  const file = state.gitPanel.status.find((s) => s.path === m.path)
  if (file) emit('action', action, m.section, file)
  state.scmMenu = null
}

function close() {
  state.scmMenu = null
}

function isNewFile(): boolean {
  const m = state.scmMenu
  if (!m) return false
  const file = state.gitPanel.status.find((s) => s.path === m.path)
  return !!file && (file.worktreeStatus === '?' || file.status === '?')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="state.scmMenu" class="menu-mask" @click="close" @contextmenu.prevent="close">
      <div class="menu" :style="{ left: state.scmMenu.x + 'px', top: state.scmMenu.y + 'px' }">
        <button v-if="isEditableFile(baseName(state.scmMenu.path))" class="menu-item" @click="run('openFile')">打开文件</button>
        <button class="menu-item" @click="run('openChange')">打开更改</button>

        <!-- Staged：取消暂存 / 还原到 HEAD -->
        <template v-if="state.scmMenu.section === 'staged'">
          <button class="menu-item" @click="run('unstage')">取消暂存</button>
          <button class="menu-item danger" @click="run('revertToHead')">还原到 HEAD（清空改动）</button>
        </template>
        <!-- Changes：暂存 / 放弃更改 / 忽略 -->
        <template v-else-if="state.scmMenu.section === 'changes'">
          <button class="menu-item" @click="run('stage')">暂存</button>
          <button class="menu-item danger" @click="run('discard')">放弃更改</button>
          <button v-if="isNewFile()" class="menu-item" @click="run('ignore')">忽略（加入 .gitignore）</button>
        </template>
        <!-- Merge：标记已解决 -->
        <template v-else>
          <button class="menu-item" @click="run('stage')">标记为已解决（暂存）</button>
        </template>

        <div class="menu-sep"></div>
        <button class="menu-item" @click="run('copyPath')">复制路径</button>
        <button class="menu-item" @click="run('reveal')">在文件管理器中显示</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.menu-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
}
.menu {
  position: fixed;
  min-width: 160px;
  background: var(--chrome-surface);
  color: var(--chrome-on-surface);
  border: 1px solid var(--chrome-border);
  border-radius: 8px;
  padding: 6px;
  box-shadow: var(--chrome-shadow-1);
  display: flex;
  flex-direction: column;
}
.menu-item {
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  padding: 7px 12px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
.menu-item:hover {
  background: var(--chrome-hover);
}
.menu-item.danger {
  color: var(--chrome-error, #ba1a1a);
}
.menu-sep {
  height: 1px;
  background: var(--chrome-border);
  margin: 4px 6px;
}
</style>