<script setup lang="ts">
// M16 分支切换器（BranchPicker）：分支功能唯一入口（Teleport 弹层）
//  - 顶部搜索框（防抖 150ms，Esc 清空）
//  - 本地分支（当前 ● 高亮，hover ⇄ 切换）
//  - 远程分支（origin/*，⚑；点击 = checkout 短名 DWIM）
//  - 底部固定操作行：＋ 新建分支（PromptDialog，从当前 HEAD 创建并切换）
//  - 行尾：重命名 ✎ / 删除 🗑（非当前分支；删除 danger confirm）
import { ref, computed, onMounted, watch } from 'vue'
import { state, toast, confirmDialog, promptDialog } from '../state/store'
import { git } from '../git'
import type { GitBranch } from '../git'
import { switchGitBranch } from '../editor/manager'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const loading = ref(false)
const branches = ref<GitBranch[]>([])
const query = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const current = computed(() => state.gitPanel.repo?.branch ?? null)

const localBranches = computed(() => {
  const q = query.value.trim().toLowerCase()
  return branches.value
    .filter((b) => !b.name.startsWith('origin/'))
    .filter((b) => !q || b.name.toLowerCase().includes(q))
})
const remoteBranches = computed(() => {
  const q = query.value.trim().toLowerCase()
  return branches.value
    .filter((b) => b.name.startsWith('origin/'))
    .map((b) => ({ ...b, short: b.name.slice('origin/'.length) }))
    .filter((b) => !q || b.name.toLowerCase().includes(q) || b.short.toLowerCase().includes(q))
})

async function load() {
  loading.value = true
  try {
    branches.value = await git.branches()
  } catch (e) {
    toast(`加载分支失败: ${(e as Error).message}`, 'error')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      query.value = ''
      void load()
      setTimeout(() => {
        document.querySelector<HTMLInputElement>('.bp-search')?.focus()
      }, 30)
    }
  }
)

function onSwitch(name: string) {
  if (name === current.value) return
  void switchGitBranch(name).finally(() => {
    emit('close')
    void reload()
  })
}

/** 远程分支：取短名 DWIM（git checkout 自动建跟踪分支） */
function onRemoteSwitch(short: string) {
  void switchGitBranch(short).finally(() => {
    emit('close')
    void reload()
  })
}

async function onCreate() {
  const name = await promptDialog({ title: '新建分支', placeholder: '分支名（如 feat/xxx）' })
  if (!name) return
  try {
    await git.createBranch(name)
    await git.checkoutBranch(name)
    toast(`已创建并切换到分支 ${name}`, 'success')
    emit('close')
    void reload()
  } catch (e) {
    toast(`新建分支失败: ${(e as Error).message}`, 'error')
  }
}

async function onRename(b: GitBranch) {
  const name = await promptDialog({ title: `重命名分支「${b.name}」`, value: b.name })
  if (!name || name === b.name) return
  try {
    await git.renameBranch(b.name, name)
    toast(`已重命名为 ${name}`, 'success')
    void load()
  } catch (e) {
    toast(`重命名失败: ${(e as Error).message}`, 'error')
  }
}

async function onDelete(b: GitBranch) {
  const ok = await confirmDialog({
    title: `删除分支「${b.name}」？`,
    message: '删除分支的提交将不再出现在分支列表中（不可撤销）。',
    confirmText: '删除分支',
    danger: true,
  })
  if (!ok) return
  try {
    await git.deleteBranch(b.name)
    toast(`已删除分支 ${b.name}`, 'success')
    void load()
  } catch (e) {
    toast(`删除失败: ${(e as Error).message}`, 'error')
  }
}

/** 面板联动刷新（分支切换后由 GitPanel 的 version watch 处理；这里也触发一次） */
async function reload() {
  const { refreshGitPanel, refreshTree } = await import('../editor/manager')
  const { clearGitMark, applyGitMark } = await import('../git/mark')
  refreshGitPanel()
  state.treeVersion++
  try {
    const s = await git.status()
    applyGitMark(s)
  } catch {
    clearGitMark()
  }
  void refreshTree()
}

onMounted(() => {
  if (props.open) void load()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open" class="bp-mask" @click.self="emit('close')" @keydown.esc="emit('close')" tabindex="-1">
      <div class="bp-panel" @click.stop>
        <div class="bp-head">
          <input
            v-model="query"
            class="bp-search"
            type="text"
            placeholder="搜索分支…"
            spellcheck="false"
            @keydown.esc.prevent="query = ''"
          />
        </div>
        <div v-if="!current" class="bp-detached">(分离 HEAD · 点击分支切换)</div>
        <div class="bp-groups">
          <div class="bp-group">
            <div class="bp-group-title">本地分支</div>
            <div v-if="!localBranches.length" class="bp-empty">无匹配分支</div>
            <div
              v-for="b in localBranches"
              :key="b.name"
              class="bp-row"
              :class="{ current: b.name === current }"
              :title="b.remote ? `上游: ${b.remote}${b.aheadBehind ? ' ' + b.aheadBehind : ''}` : ''"
              @click="onSwitch(b.name)"
            >
              <span class="bp-dot">{{ b.name === current ? '●' : '○' }}</span>
              <span class="bp-name">{{ b.name }}</span>
              <span v-if="b.name === current" class="bp-tag">当前</span>
              <span class="bp-ops" @click.stop>
                <button
                  v-if="b.name !== current"
                  class="bp-op"
                  title="重命名"
                  @click="onRename(b)"
                >✎</button>
                <button
                  v-if="b.name !== current"
                  class="bp-op danger"
                  title="删除分支"
                  @click="onDelete(b)"
                >🗑</button>
              </span>
            </div>
          </div>
          <div class="bp-group">
            <div class="bp-group-title">远程分支</div>
            <div v-if="!remoteBranches.length" class="bp-empty">无远程分支</div>
            <div
              v-for="b in remoteBranches"
              :key="b.name"
              class="bp-row"
              @click="onRemoteSwitch(b.short)"
            >
              <span class="bp-dot">⚑</span>
              <span class="bp-name">{{ b.short }}</span>
              <span v-if="b.short === current" class="bp-tag">当前</span>
            </div>
          </div>
        </div>
        <div class="bp-footer">
          <button class="bp-new" @click="onCreate">＋ 新建分支…</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.bp-mask {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 60px;
  outline: none;
}
.bp-panel {
  width: min(320px, 90vw);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--chrome-surface);
  color: var(--chrome-on-surface);
  border: 1px solid var(--chrome-border);
  border-radius: 12px;
  box-shadow: var(--chrome-shadow-2, 0 12px 40px rgba(0, 0, 0, 0.25));
  overflow: hidden;
}
.bp-head {
  padding: 10px 12px 6px;
}
.bp-search {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--chrome-border);
  background: var(--chrome-background);
  color: var(--chrome-on-background);
  border-radius: 8px;
  font-size: 13px;
  padding: 7px 10px;
  font-family: inherit;
  outline: none;
}
.bp-search:focus {
  border-color: var(--chrome-primary);
}
.bp-detached {
  padding: 4px 14px;
  font-size: 11px;
  color: var(--chrome-on-surface-variant);
}
.bp-groups {
  overflow-y: auto;
  padding: 2px 6px 8px;
}
.bp-group-title {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--chrome-on-surface-variant);
  padding: 6px 8px 3px;
}
.bp-empty {
  padding: 4px 10px 6px;
  font-size: 12px;
  color: var(--chrome-on-surface-variant);
}
.bp-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.bp-row:hover {
  background: var(--chrome-hover);
}
.bp-row.current {
  background: var(--chrome-selected);
}
.bp-dot {
  width: 14px;
  text-align: center;
  color: var(--chrome-primary);
  flex-shrink: 0;
}
.bp-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bp-tag {
  font-size: 10px;
  color: var(--chrome-primary);
  flex-shrink: 0;
}
.bp-ops {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.bp-row:hover .bp-ops {
  display: flex;
}
.bp-op {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
}
.bp-op:hover {
  background: var(--chrome-selected);
  color: var(--chrome-on-background);
}
.bp-op.danger:hover {
  color: var(--chrome-error, #ba1a1a);
}
.bp-footer {
  border-top: 1px solid var(--chrome-border);
  padding: 8px 12px;
}
.bp-new {
  width: 100%;
  border: none;
  background: var(--chrome-selected);
  color: var(--chrome-primary);
  border-radius: 8px;
  padding: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.bp-new:hover {
  opacity: 0.9;
}
</style>