<script setup lang="ts">
// M16 Git SCM 面板（复刻 VSCode「源代码管理」视图，见 docs/git-scm-redesign.md）
//  ① 状态条（分支=切换器 / ahead-behind / 同步 / ⋯菜单）
//  ② 提交输入框（Ctrl+Enter 提交）+ 提交按钮▾（提交/提交并推送/修改上一提交）
//  ④ Staged 区（indexStatus 有码） ⑤ Changes 区（worktreeStatus 有码或 ?）
//  ⑥ 历史（提交图 + 范围对比，保留既有实现）
//  Merge（冲突）区：任一码含 U ∪ (A,A)/(D,D)（R1-2）
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { state, toast, confirmDialog } from '../state/store'
import { git, isGitAvailable } from '../git'
import type { GitFileStatus, GitCommit } from '../git'
import { buildGraph } from '../git/graph'
import { buildChangeTree, type GitChangeNode } from '../git/change-tree'
import { applyGitMark, clearGitMark } from '../git/mark'
import { openGitDiff, openTab, saveTab, refreshGitPanel, refreshTree } from '../editor/manager'
import { revealInTree } from '../state/treeOps'
import { settings } from '../state/settings'
import { fs } from '../fs'
import { baseName } from '../fs/types'
import MenuIcon from './MenuIcon.vue'
import GitChangeTree from './GitChangeTree.vue'
import ScmFileRow from './ScmFileRow.vue'
import GitFileContextMenu from './GitFileContextMenu.vue'
import BranchPicker from './BranchPicker.vue'
import PromptDialog from './PromptDialog.vue'

const loading = ref(false)
const error = ref<string | null>(null)
const pickerOpen = ref(false)
const commitMenuOpen = ref(false)
const moreMenuOpen = ref(false)
const commitInputFocused = ref(false)
const busySyncing = ref(false)

// ---------- 区块折叠（localStorage 记忆） ----------
const SECTIONS_KEY = 'writeit.gitPanel.sections.v2'
const DEFAULT_SECTIONS = { staged: false, changes: false, history: false }
function loadSections(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY)
    if (raw) {
      const v = JSON.parse(raw)
      return { ...DEFAULT_SECTIONS, ...v }
    }
  } catch {
    /* 忽略损坏数据 */
  }
  return { ...DEFAULT_SECTIONS }
}
const sectionCollapsed = ref<Record<string, boolean>>(loadSections())
function toggleSection(name: string) {
  sectionCollapsed.value = { ...sectionCollapsed.value, [name]: !sectionCollapsed.value[name] }
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(sectionCollapsed.value))
  } catch {
    /* 忽略 */
  }
}

// ---------- 平铺/树形（localStorage 记忆） ----------
const VIEW_KEY = 'writeit.gitPanel.view.v1'
function loadViewMode(): 'flat' | 'tree' {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    if (v === 'tree' || v === 'flat') return v
  } catch {
    /* 忽略 */
  }
  return 'flat'
}
const viewMode = ref<'flat' | 'tree'>(loadViewMode())
function toggleViewMode() {
  viewMode.value = viewMode.value === 'flat' ? 'tree' : 'flat'
  try {
    localStorage.setItem(VIEW_KEY, viewMode.value)
  } catch {
    /* 忽略 */
  }
}

// ---------- 分区派生（R1-2 冲突判定：任一码含 U ∪ (A,A)/(D,D)） ----------
/** 后端是否返回 XY 双码（旧版 tauri 后端只有 path/status/added/deleted） */
function hasDualCodes(f: GitFileStatus): boolean {
  return typeof f.indexStatus === 'string' && typeof f.worktreeStatus === 'string'
}
function isMerge(f: GitFileStatus): boolean {
  const x = f.indexStatus ?? ' '
  const y = f.worktreeStatus ?? ' '
  return (
    x.includes('U') ||
    y.includes('U') ||
    (x === 'A' && y === 'A') ||
    (x === 'D' && y === 'D')
  )
}
const mergeFiles = computed(() => state.gitPanel.status.filter(isMerge))
const stagedFiles = computed(() =>
  state.gitPanel.status.filter((f) => hasDualCodes(f) && !isMerge(f) && f.indexStatus !== ' ' && f.indexStatus !== '?')
)
/** Changes 区：worktree 层有改动（含双态文件与未跟踪）；merge 冲突单独分区（R1-2）
 * 旧后端（无双码）→ 所有状态归入 Changes，staged 区为空 */
const changesFiles = computed(() =>
  state.gitPanel.status.filter((f) => !isMerge(f) && (hasDualCodes(f) ? f.worktreeStatus !== ' ' : true))
)

/** 树形模式：staged 树用 indexAdded/indexDeleted 作为行数（buildChangeTree 只认 added/deleted，R1 修复） */
const stagedTree = computed(() =>
  buildChangeTree(stagedFiles.value.map((f) => ({ path: f.path, status: f.status, added: f.indexAdded, deleted: f.indexDeleted })))
)
const changesTree = computed(() => buildChangeTree(changesFiles.value))
const collapsedDirs = ref(new Set<string>())

// ---------- 历史（提交图，保留既有实现） ----------
const graphRows = computed(() => buildGraph(state.gitPanel.log))

function relTime(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`
  return new Date(ts * 1000).toLocaleDateString()
}

async function selectCommit(c: GitCommit) {
  const g = state.gitPanel
  if (g.selectedCommit === c.hash) {
    g.selectedCommit = null
    g.commitFiles = []
    return
  }
  g.selectedCommit = c.hash
  g.commitFiles = []
  try {
    const show = await git.showCommit(c.hash)
    g.commitFiles = show.files
  } catch (e) {
    toast(`加载提交失败: ${(e as Error).message}`, 'error')
    g.selectedCommit = null
  }
}

function onCommitClick(c: GitCommit, e: MouseEvent) {
  if (e.shiftKey) {
    const g = state.gitPanel
    if (!g.range) {
      g.range = { a: c.hash, b: c.hash }
      toast(`范围起点：${c.hash.slice(0, 7)}（再 Shift+点击选终点）`, 'info')
    } else if (g.range.a === c.hash && g.range.b === c.hash) {
      g.range = null
      toast('已清除范围选择', 'info')
    } else {
      g.range = { ...g.range, b: c.hash }
      toast(`范围对比：${g.range.a.slice(0, 7)}..${c.hash.slice(0, 7)}（点击文件查看 diff）`, 'success')
    }
    return
  }
  if (state.gitPanel.range) {
    state.gitPanel.range = null
    toast('已清除范围选择（Shift+点击可重新选择）', 'info')
  }
  void selectCommit(c)
}

function onHistoryFile(n: GitChangeNode) {
  if (n.kind !== 'file') return
  const g = state.gitPanel
  if (g.range) {
    void openGitDiff(n.path, {
      kind: 'range',
      from: g.range.a,
      to: g.range.b,
      label: `${g.range.a.slice(0, 7)}..${g.range.b.slice(0, 7)}`,
    })
  } else if (g.selectedCommit) {
    const sha = g.selectedCommit
    void openGitDiff(n.path, {
      kind: 'range',
      from: `${sha}^`,
      to: sha,
      label: `${sha.slice(0, 7)} ↔ 父提交`,
    })
  }
}

// ---------- 加载 ----------
async function loadAll() {
  if (!isGitAvailable()) {
    error.value = 'Git 功能在当前模式不可用（桌面应用或演示模式可用）'
    state.gitPanel.repo = null
    clearGitMark()
    return
  }
  loading.value = true
  error.value = null
  const g = state.gitPanel
  try {
    const repo = await git.repoInfo()
    g.repo = repo
    if (!repo.isRepo) {
      error.value = '当前目录不是 Git 仓库'
      g.status = []
      g.log = []
      g.selectedCommit = null
      g.commitFiles = []
      g.range = null
      clearGitMark()
      return
    }
    const [status, log, aheadBehind, branches] = await Promise.all([
      git.status(),
      git.log(50),
      git.aheadBehind().catch(() => null),
      git.branches().catch(() => []),
    ])
    g.status = status
    g.log = log
    g.aheadBehind = aheadBehind
    g.hasRemote = aheadBehind !== null || branches.some((b) => b.remote || b.name.startsWith('origin/'))
    // 主文件树角标
    applyGitMark(status)
    collapsedDirs.value = new Set()
    // 默认展开 HEAD
    if (log.length > 0 && g.selectedCommit === null) {
      await selectCommit(log[0])
    }
  } catch (e) {
    error.value = (e as Error).message
    clearGitMark()
  } finally {
    loading.value = false
  }
}

/** R1-1：提交/amend 前保存全部 dirty tab（git 操作的是磁盘状态） */
async function saveAllDirty(): Promise<void> {
  for (const t of state.tabs) {
    if (t.dirty && t.viewMode !== 'diff') {
      await saveTab(t.id)
    }
  }
}

// ---------- 分区操作 ----------
function openDiffFor(f: GitFileStatus, section: 'staged' | 'changes' | 'merge') {
  if (section === 'staged') {
    void openGitDiff(f.path, { kind: 'staged', label: '暂存 HEAD..index' })
  } else {
    void openGitDiff(f.path, { kind: 'unstaged', label: '更改 index..worktree' })
  }
  revealInTree(f.path, 8000)
}

/** 树形模式下按 path 回查状态（找不到时构造轻量对象走路径） */
function statusByPath(path: string): GitFileStatus {
  const f = state.gitPanel.status.find((x) => x.path === path)
  if (f) return f
  const tree = buildChangeTree(state.gitPanel.status)
  let found: GitFileStatus | null = null
  const walk = (nodes: GitChangeNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'file' && n.path === path) {
        found = { path, status: n.status ?? 'M', indexStatus: ' ', worktreeStatus: n.status ?? 'M', added: n.added, deleted: n.deleted, indexAdded: -1, indexDeleted: -1 }
      }
      if (n.children) walk(n.children)
    }
  }
  walk(tree)
  return found ?? { path, status: 'M', indexStatus: ' ', worktreeStatus: 'M', added: -1, deleted: -1, indexAdded: -1, indexDeleted: -1 }
}

async function stagePaths(paths: string[]) {
  if (!paths.length) return
  try {
    await git.stage(paths)
    await reloadQuiet()
  } catch (e) {
    toast(`暂存失败: ${(e as Error).message}`, 'error')
  }
}
async function unstagePaths(paths: string[]) {
  if (!paths.length) return
  try {
    await git.unstage(paths)
    await reloadQuiet()
  } catch (e) {
    toast(`取消暂存失败: ${(e as Error).message}`, 'error')
  }
}
async function discardFile(f: GitFileStatus) {
  const ok = await confirmDialog({
    title: '放弃更改？',
    message: `将丢弃「${f.path}」的全部工作区改动，恢复到已暂存/HEAD 版本。\n\n此操作不可撤销。`,
    confirmText: '放弃更改',
    danger: true,
  })
  if (!ok) return
  try {
    await git.discardFile(f.path)
    toast('已放弃更改', 'success')
    await reloadQuiet()
  } catch (e) {
    toast(`放弃失败: ${(e as Error).message}`, 'error')
  }
}

/** 静默刷新（不动角标/展开态，仅刷状态与历史） */
async function reloadQuiet() {
  loading.value = true
  try {
    const [status, log, aheadBehind] = await Promise.all([
      git.status(),
      git.log(50),
      git.aheadBehind().catch(() => null),
    ])
    state.gitPanel.status = status
    state.gitPanel.log = log
    state.gitPanel.aheadBehind = aheadBehind
    applyGitMark(status)
    if (state.gitPanel.selectedCommit == null && log.length > 0) await selectCommit(log[0])
  } catch (e) {
    toast(`刷新失败: ${(e as Error).message}`, 'error')
  } finally {
    loading.value = false
  }
}

/** 操作后完整联动（面板 + 文件树 + 打开的 diff 失效） */
async function reloadAll() {
  state.treeVersion++
  await refreshTree()
  refreshGitPanel()
}

/** staged 区单文件「还原到 HEAD」：index 与 worktree 全部回到 HEAD（危险） */
async function revertFileToHead(f: GitFileStatus) {
  const ok = await confirmDialog({
    title: '还原到 HEAD？',
    message: `将丢弃「${f.path}」的暂存内容与工作区改动，恢复到 HEAD 版本。\n\n此操作不可撤销。`,
    confirmText: '还原到 HEAD',
    danger: true,
  })
  if (!ok) return
  try {
    await git.revertToHead([f.path])
    // 打开的编辑器标签与该文件同名 → 从磁盘刷新
    toast('已还原到 HEAD', 'success')
    await reloadQuiet()
    await reloadAll()
  } catch (e) {
    toast(`还原失败: ${(e as Error).message}`, 'error')
  }
}

// ---------- 提交 ----------
const commitMsg = computed({
  get: () => state.gitPanel.commitMessage,
  set: (v: string) => (state.gitPanel.commitMessage = v),
})

async function submitCommit(opts?: { push?: boolean; amend?: boolean }) {
  if (!isGitAvailable() || !state.gitPanel.repo?.isRepo) return
  const msg = commitMsg.value.trim()
  if (!msg) {
    toast('请输入提交消息', 'error')
    document.querySelector<HTMLTextAreaElement>('.scm-commit-input')?.focus()
    return
  }
  // R1-1：先保存所有 dirty tab
  await saveAllDirty()
  const hasStaged = stagedFiles.value.length > 0 || mergeFiles.value.length > 0
  const hasChanges = changesFiles.value.length > 0
  if (!hasStaged && !hasChanges) {
    toast('没有可提交的更改', 'error')
    return
  }
  let stageAll = false
  if (!hasStaged && hasChanges) {
    const ok = await confirmDialog({
      title: '没有暂存的更改',
      message: '是否暂存全部更改并提交？',
      confirmText: '全部暂存并提交',
    })
    if (!ok) return
    stageAll = true
  }
  if (opts?.amend) {
    const last = state.gitPanel.log[0]
    const pushed = (state.gitPanel.aheadBehind?.behind ?? 0) > 0 || state.gitPanel.aheadBehind !== null && last !== undefined
    const ok = await confirmDialog({
      title: '修改上一提交？',
      message: `将把当前全部暂存内容并入上一提交「${last?.message ?? ''}」，历史不可见地改写。${
        pushed ? '\n\n若该提交已推送到远程，后续推送将使用 force-with-lease（需确认）。' : ''
      }\n\n此操作不可撤销。`,
      confirmText: '修改提交',
      danger: true,
    })
    if (!ok) return
  }
  try {
    const res = await git.commit(msg, { amend: opts?.amend, stageAll })
    commitMsg.value = ''
    toast(`已提交 ${res.hash.slice(0, 7)}`, 'success')
    await reloadAll()
    await loadAll()
    if (opts?.push) {
      await runSync(true)
    }
  } catch (e) {
    const msgErr = (e as Error).message
    if (msgErr.includes('user.name') || msgErr.includes('user.email') || msgErr.includes('身份未配置') || msgErr.includes('Please tell me who you are')) {
      toast('请在 git 中配置 user.name/user.email（终端执行 git config）', 'error')
    } else {
      toast(`提交失败: ${msgErr}`, 'error')
    }
  }
}

function onPanelKeydown(e: KeyboardEvent) {
  // Ctrl/Cmd+Enter 提交（面板聚焦时）
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && commitInputFocused.value) {
    e.preventDefault()
    void submitCommit()
  }
}

// ---------- 同步（fetch/pull/push/ahead-behind） ----------
async function runSync(fromCommit?: boolean) {
  if (busySyncing.value) return
  busySyncing.value = true
  try {
    await git.pull()
    toast('已拉取更新', 'success')
  } catch (e) {
    toast(`拉取失败: ${(e as Error).message}（冲突可手动处理）`, 'error')
    busySyncing.value = false
    return
  }
  try {
    await git.push()
    toast('已推送', 'success')
  } catch (e) {
    toast(`推送失败: ${(e as Error).message}`, 'error')
  } finally {
    busySyncing.value = false
  }
  await reloadQuiet()
}

async function moreAction(action: 'fetch' | 'pull' | 'push') {
  moreMenuOpen.value = false
  try {
    if (action === 'fetch') {
      await git.fetch()
      toast('已获取远程更新', 'success')
    } else if (action === 'pull') {
      await git.pull()
      toast('已拉取更新', 'success')
    } else {
      await git.push()
      toast('已推送', 'success')
    }
    await reloadQuiet()
  } catch (e) {
    toast(`${action === 'fetch' ? '获取' : action === 'pull' ? '拉取' : '推送'}失败: ${(e as Error).message}`, 'error')
  }
}

/** SCM 行操作入口 */
function onRowContext(e: MouseEvent, file: GitFileStatus, section: 'staged' | 'changes' | 'merge') {
  state.scmMenu = { x: e.clientX, y: e.clientY, section, path: file.path }
}

/** 树形模式文件行右键/⋯：按 path 反查所在分区 */
function onTreeRowContext(e: MouseEvent, path: string) {
  const section: 'staged' | 'changes' | 'merge' = mergeFiles.value.some((f) => f.path === path)
    ? 'merge'
    : stagedFiles.value.some((f) => f.path === path)
      ? 'staged'
      : 'changes'
  state.scmMenu = { x: e.clientX, y: e.clientY, section, path }
}

function onScmMenuAction(action: string, section: 'staged' | 'changes' | 'merge', file: GitFileStatus) {
  switch (action) {
    case 'openFile':
      void openTab(file.path, undefined, 'git')
      break
    case 'openChange':
      openDiffFor(file, section)
      break
    case 'stage':
      void stagePaths([file.path])
      break
    case 'unstage':
      void unstagePaths([file.path])
      break
    case 'discard':
      void discardFile(file)
      break
    case 'ignore':
      void git
        .ignore(file.path)
        .then(async () => {
          toast('已加入 .gitignore', 'success')
          await reloadQuiet()
        })
        .catch((e) => toast(`忽略失败: ${(e as Error).message}`, 'error'))
      break
    case 'copyPath':
      void navigator.clipboard?.writeText(file.path)
      break
    case 'reveal':
      void fs.revealInExplorer(file.path).catch((e) => toast(`无法在文件管理器中显示: ${(e as Error).message}`, 'error'))
      break
    case 'revertToHead':
      void revertFileToHead(file)
      break
  }
}

// ---------- 生命周期 ----------
onMounted(() => {
  void loadAll()
  window.addEventListener('keydown', onPanelKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onPanelKeydown)
})

watch(
  () => state.gitPanel.version,
  () => {
    if (state.gitPanel.tab === 'git') void loadAll()
  }
)
watch(
  () => state.gitPanel.tab,
  () => {
    if (state.gitPanel.tab === 'git') {
      commitInputFocused.value = false
    }
  }
)

defineExpose({ loadAll })
</script>

<template>
  <div class="git-panel" @click="commitMenuOpen = false; moreMenuOpen = false">
    <!-- ① 状态条 -->
    <div class="git-head">
      <button class="mini" title="返回文件树" @click="state.gitPanel.tab = 'files'">← 文件</button>
      <button class="mini" title="刷新" @click="loadAll">
        <MenuIcon name="refresh" :set="settings.iconSet" :size="14" />
      </button>
      <button
        v-if="state.gitPanel.repo?.isRepo"
        class="branch-badge"
        :title="state.gitPanel.repo.headHash ?? ''"
        @click.stop="pickerOpen = !pickerOpen"
      >
        ⓘ {{ state.gitPanel.repo.branch ?? '(分离 HEAD)' }} <span class="caret">▾</span>
      </button>
      <span v-if="state.gitPanel.aheadBehind && (state.gitPanel.aheadBehind.ahead || state.gitPanel.aheadBehind.behind)" class="sync-count" :title="`领先 ${state.gitPanel.aheadBehind.ahead} / 落后 ${state.gitPanel.aheadBehind.behind}`">
        <template v-if="state.gitPanel.aheadBehind.ahead">↑{{ state.gitPanel.aheadBehind.ahead }}</template>
        <template v-if="state.gitPanel.aheadBehind.behind">↓{{ state.gitPanel.aheadBehind.behind }}</template>
      </span>
      <button
        v-if="state.gitPanel.hasRemote"
        class="mini"
        :class="{ spinning: busySyncing }"
        title="同步（拉取 + 推送）"
        @click.stop="runSync(false)"
      >
        ⟳⇅
      </button>
      <div class="more-wrap" @click.stop>
        <button class="mini" title="更多操作" @click="moreMenuOpen = !moreMenuOpen">⋯</button>
        <div v-if="moreMenuOpen" class="mini-menu">
          <button class="mini-menu-item" @click="moreAction('fetch')">获取 (fetch)</button>
          <button class="mini-menu-item" @click="moreAction('pull')">拉取 (pull)</button>
          <button class="mini-menu-item" @click="moreAction('push')">推送 (push)</button>
        </div>
      </div>
      <span v-if="loading" class="loading">加载中…</span>
    </div>
    <div v-if="error" class="git-error">{{ error }}</div>

    <!-- 范围对比条 -->
    <div v-if="state.gitPanel.range" class="range-bar">
      <span class="range-label">
        {{ state.gitPanel.range.a.slice(0, 7) }}..{{ state.gitPanel.range.b.slice(0, 7) }}
      </span>
      <button class="mini" title="清除范围选择" @click="state.gitPanel.range = null">✕</button>
    </div>

    <template v-if="state.gitPanel.repo?.isRepo">
      <!-- ② 提交输入框 + ③ 提交按钮 -->
      <div class="scm-commit">
        <textarea
          v-model="commitMsg"
          class="scm-commit-input"
          rows="1"
          placeholder="提交消息（Ctrl+Enter 提交）"
          spellcheck="false"
          @focus="commitInputFocused = true"
          @blur="commitInputFocused = false"
          @keydown.ctrl.enter.prevent="submitCommit()"
          @keydown.meta.enter.prevent="submitCommit()"
        ></textarea>
        <div class="commit-actions">
          <button class="commit-btn" @click="submitCommit()">✓ 提交</button>
          <div class="menu-wrap" @click.stop>
            <button class="commit-caret" title="更多提交选项" @click="commitMenuOpen = !commitMenuOpen">▾</button>
            <div v-if="commitMenuOpen" class="mini-menu">
              <button class="mini-menu-item" @click="commitMenuOpen = false; submitCommit({ push: true })">提交并推送</button>
              <button class="mini-menu-item" @click="commitMenuOpen = false; submitCommit({ amend: true })">修改上一提交</button>
            </div>
          </div>
          <button class="view-toggle" :title="viewMode === 'flat' ? '平铺' : '树形'" @click="toggleViewMode">
            {{ viewMode === 'flat' ? '≣ 平铺' : '⊞ 树形' }}
          </button>
        </div>
      </div>

      <!-- ④ Staged 区 -->
      <div v-if="stagedFiles.length" class="section">
        <div class="section-title" @click="toggleSection('staged')">
          <span class="chev" :class="{ open: !sectionCollapsed.staged }">▸</span>
          暂存的更改
          <span class="sec-count">· {{ stagedFiles.length }}</span>
          <button
            class="sec-action"
            title="全部取消暂存（保留工作区改动）"
            @click.stop="unstagePaths(stagedFiles.map((f) => f.path))"
          >−全部取消暂存</button>
        </div>
        <template v-if="!sectionCollapsed.staged">
          <template v-if="viewMode === 'flat'">
            <ScmFileRow
              v-for="f in stagedFiles"
              :key="'s' + f.path"
              :file="f"
              section="staged"
              @open="openDiffFor($event, 'staged')"
              @unstage="unstagePaths([$event.path])"
              @openFile="openTab($event.path, undefined, 'git')"
              @context="onRowContext($event, f, 'staged')"
              @menu="onRowContext($event, f, 'staged')"
            />
          </template>
          <template v-else>
            <GitChangeTree
              v-for="n in stagedTree"
              :key="n.path"
              :node="n"
              :depth="0"
              :collapsed="collapsedDirs"
              @open="(n2) => openDiffFor(statusByPath(n2.path), 'staged')"
              @context="onTreeRowContext"
            />
          </template>
        </template>
      </div>

      <!-- Merge 冲突区 -->
      <div v-if="mergeFiles.length" class="section">
        <div class="section-title merge-title" @click="toggleSection('merge')">
          <span class="chev" :class="{ open: !sectionCollapsed.merge }">▸</span>
          合并更改（冲突）
          <span class="sec-count">· {{ mergeFiles.length }}</span>
        </div>
        <template v-if="!sectionCollapsed.merge">
          <div class="merge-hint">冲突需手动解决：点击查看冲突，编辑后点 ✓ 标记为已解决。</div>
          <ScmFileRow
            v-for="f in mergeFiles"
            :key="'m' + f.path"
            :file="f"
            section="merge"
            @open="openDiffFor($event, 'merge')"
            @stage="stagePaths([$event.path])"
            @openFile="openTab($event.path, undefined, 'git')"
            @context="onRowContext($event, f, 'merge')"
            @menu="onRowContext($event, f, 'merge')"
          />
        </template>
      </div>

      <!-- ⑤ Changes 区 -->
      <div class="section">
        <div class="section-title" @click="toggleSection('changes')">
          <span class="chev" :class="{ open: !sectionCollapsed.changes }">▸</span>
          更改
          <span class="sec-count">· {{ changesFiles.length }}</span>
          <button
            v-if="changesFiles.length"
            class="sec-action"
            title="全部暂存"
            @click.stop="stagePaths(changesFiles.map((f) => f.path))"
          >＋全部暂存</button>
        </div>
        <template v-if="!sectionCollapsed.changes">
          <div v-if="!changesFiles.length" class="section-empty">无更改</div>
          <template v-if="viewMode === 'flat'">
            <ScmFileRow
              v-for="f in changesFiles"
              :key="'c' + f.path"
              :file="f"
              section="changes"
              @open="openDiffFor($event, 'changes')"
              @stage="stagePaths([$event.path])"
              @discard="discardFile($event)"
              @openFile="openTab($event.path, undefined, 'git')"
              @context="onRowContext($event, f, 'changes')"
              @menu="onRowContext($event, f, 'changes')"
            />
          </template>
          <template v-else>
            <GitChangeTree
              v-for="n in changesTree"
              :key="n.path"
              :node="n"
              :depth="0"
              :collapsed="collapsedDirs"
              @open="(n2) => openDiffFor(statusByPath(n2.path), 'changes')"
              @context="onTreeRowContext"
            />
          </template>
        </template>
      </div>

      <!-- ⑥ 历史 -->
      <div class="section">
        <div class="section-title" @click="toggleSection('history')">
          <span class="chev" :class="{ open: !sectionCollapsed.history }">▸</span>
          历史
          <span class="sec-count">· {{ state.gitPanel.log.length }}</span>
        </div>
        <template v-if="!sectionCollapsed.history">
          <div v-if="!state.gitPanel.log.length" class="section-empty">暂无提交</div>
          <div
            v-for="(c, ci) in state.gitPanel.log"
            :key="c.hash"
            class="commit"
            :class="{ expanded: state.gitPanel.selectedCommit === c.hash }"
          >
            <div class="commit-row" @click="onCommitClick(c, $event)">
              <span class="graph" aria-hidden="true">
                <template v-for="(ch, gi) in graphRows[ci]" :key="gi">{{ ch }}</template>
                <span v-if="!graphRows[ci]">o</span>
              </span>
              <div class="commit-main">
                <div class="commit-msg-row">
                  <span class="commit-msg" :class="{ merge: c.parents.length > 1 }">{{ c.message }}</span>
                  <span class="commit-date">{{ relTime(c.date) }}</span>
                </div>
                <div class="commit-sub">{{ c.hash.slice(0, 7) }} · {{ c.author }}</div>
              </div>
            </div>
            <div v-if="state.gitPanel.selectedCommit === c.hash" class="commit-files" @click.stop>
              <div v-if="!state.gitPanel.commitFiles.length" class="section-empty">无文件变更</div>
              <GitChangeTree
                v-for="n in buildChangeTree(state.gitPanel.commitFiles)"
                :key="n.path"
                :node="n"
                :depth="0"
                :collapsed="collapsedDirs"
                @open="onHistoryFile"
                @context="onTreeRowContext"
              />
            </div>
          </div>
          <div class="history-hint">点击提交展开变更；Shift+点击两提交 = 范围对比</div>
        </template>
      </div>
    </template>

    <!-- 分支切换器 / SCM 右键菜单 / 文本输入弹窗 -->
    <BranchPicker :open="pickerOpen" @close="pickerOpen = false" />
    <GitFileContextMenu @action="onScmMenuAction" />
    <PromptDialog />
  </div>
</template>

<style scoped>
.git-panel {
  flex: 1;
  overflow: auto;
  padding: 6px 6px 12px;
  font-size: 12.5px;
}
.git-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 8px;
  flex-wrap: wrap;
}
.branch-badge {
  border: none;
  background: var(--chrome-selected);
  color: var(--chrome-primary);
  padding: 2px 9px;
  border-radius: 999px;
  font-weight: 600;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}
.branch-badge:hover {
  opacity: 0.9;
}
.caret {
  font-size: 9px;
  opacity: 0.7;
}
.sync-count {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  color: var(--chrome-on-surface-variant);
}
.loading {
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
}
.git-error {
  padding: 10px;
  color: var(--chrome-error, #ba1a1a);
  font-size: 12px;
  background: color-mix(in srgb, var(--chrome-error, #ba1a1a), transparent 92%);
  border-radius: 8px;
  margin: 0 4px 8px;
}
.mini {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 12px;
  padding: 2px 5px;
  border-radius: 5px;
  cursor: pointer;
  font-family: inherit;
}
.mini:hover {
  background: var(--chrome-hover);
  color: var(--chrome-on-background);
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.more-wrap,
.menu-wrap {
  position: relative;
}
.mini-menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 60;
  min-width: 150px;
  background: var(--chrome-surface);
  color: var(--chrome-on-surface);
  border: 1px solid var(--chrome-border);
  border-radius: 8px;
  padding: 6px;
  box-shadow: var(--chrome-shadow-1);
  display: flex;
  flex-direction: column;
}
.mini-menu-item {
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 12.5px;
  cursor: pointer;
  font-family: inherit;
}
.mini-menu-item:hover {
  background: var(--chrome-hover);
}
.range-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  margin: 0 4px 8px;
  background: var(--chrome-selected);
  border: 1px solid var(--chrome-primary);
  border-radius: 8px;
}
.range-label {
  flex: 1;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  color: var(--chrome-primary);
}
/* ---- 提交 ---- */
.scm-commit {
  margin: 2px 4px 8px;
  border: 1px solid var(--chrome-border);
  border-radius: 10px;
  background: var(--chrome-surface);
  /* M16 修复：不能 overflow:hidden——会裁剪右上 ▾ 下拉菜单（absolute 定位） */
}
.scm-commit-input {
  width: 100%;
  box-sizing: border-box;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--chrome-on-background);
  font-family: inherit;
  font-size: 13px;
  padding: 8px 10px;
  line-height: 1.5;
  min-height: 32px;
  max-height: 96px;
  border-radius: 9px 9px 0 0;
}
.scm-commit-input:focus {
  box-shadow: inset 0 -2px 0 var(--chrome-primary);
}
.commit-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px 6px;
}
.commit-btn {
  flex: 1;
  border: none;
  background: var(--chrome-primary);
  color: var(--chrome-on-secondary, #fff);
  border-radius: 8px;
  padding: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.commit-btn:hover {
  opacity: 0.9;
}
.commit-caret {
  border: 1px solid var(--chrome-border);
  background: transparent;
  color: var(--chrome-on-surface-variant);
  border-radius: 8px;
  padding: 5px 8px;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}
.commit-caret:hover {
  background: var(--chrome-hover);
}
.view-toggle {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
}
.view-toggle:hover {
  background: var(--chrome-hover);
  color: var(--chrome-on-background);
}
/* ---- 区块 ---- */
.section {
  margin-bottom: 4px;
}
.section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--chrome-on-surface-variant);
  padding: 7px 8px;
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  border-radius: 6px;
  user-select: none;
}
.section-title:hover {
  background: var(--chrome-hover);
  color: var(--chrome-on-background);
}
.merge-title {
  color: var(--chrome-error, #ba1a1a);
}
.chev {
  font-size: 9px;
  transition: transform 0.12s;
  color: var(--chrome-on-surface-variant);
}
.chev.open {
  transform: rotate(90deg);
}
.sec-count {
  font-weight: 400;
  color: var(--chrome-on-surface-variant);
}
.sec-action {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 10.5px;
  padding: 2px 6px;
  border-radius: 5px;
  cursor: pointer;
  font-family: inherit;
  opacity: 0;
  transition: opacity 0.1s;
}
.section-title:hover .sec-action {
  opacity: 1;
}
.sec-action:hover {
  background: var(--chrome-selected);
  color: var(--chrome-on-background);
}
.section-empty {
  padding: 6px 10px;
  color: var(--chrome-on-surface-variant);
  font-size: 12px;
}
.merge-hint {
  padding: 2px 10px 6px;
  font-size: 10.5px;
  color: var(--chrome-error, #ba1a1a);
  opacity: 0.85;
}
/* ---- 历史 + 提交图（沿用 M15） ---- */
.commit {
  border-radius: 8px;
}
.commit-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  cursor: pointer;
  border-radius: 8px;
}
.commit-row:hover {
  background: var(--chrome-hover);
}
.commit.expanded .commit-row {
  background: var(--chrome-selected);
}
.graph {
  font-family: ui-monospace, Consolas, Menlo, monospace;
  font-size: 11px;
  line-height: 1.2;
  letter-spacing: 0;
  color: var(--chrome-primary);
  flex-shrink: 0;
  white-space: pre;
  user-select: none;
}
.commit-main {
  flex: 1;
  min-width: 0;
}
.commit-msg-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.commit-msg {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}
.commit-msg.merge {
  color: var(--chrome-primary);
  font-weight: 600;
}
.commit-date {
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  flex-shrink: 0;
}
.commit-sub {
  font-size: 10.5px;
  color: var(--chrome-on-surface-variant);
  font-family: ui-monospace, Consolas, monospace;
}
.commit-files {
  margin: 0 4px 6px 26px;
  border-left: 1px dashed var(--chrome-border);
  padding-left: 6px;
}
.history-hint {
  padding: 4px 10px 8px;
  font-size: 10.5px;
  color: var(--chrome-on-surface-variant);
  opacity: 0.7;
}
</style>