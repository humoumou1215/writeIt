<script setup lang="ts">
// Git 面板（M11a）：仓库状态条 + 分支 / 工作区 / 历史 三区块
//  - 工作区文件点击 → 编辑区 diff（工作区 vs HEAD）
//  - 提交点击 → 展开变更文件列表 → 点文件 diff（commit vs 父提交）
//  - Shift+点击 → 范围对比（a..b）；顶部范围条 ✕ 清除
//  - 分支点击 → 过滤历史（v1 仅查看，切换 v1.5）
import { onMounted, ref, computed, watch } from 'vue'
import { state, toast } from '../state/store'
import { git, isGitAvailable } from '../git'
import type { GitCommit, GitFileStatus } from '../git'
import { openGitDiff } from '../editor/manager'
import { baseName } from '../fs/types'

const loading = ref(false)
const error = ref<string | null>(null)
const expandedCommit = ref<string | null>(null)

// ---------- 加载 ----------
async function loadAll() {
  if (!isGitAvailable()) {
    error.value = 'Git 功能仅在桌面应用中可用（当前为浏览器演示模式）'
    state.gitPanel.repo = null
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
      g.branches = []
      g.status = []
      g.log = []
      g.selectedCommit = null
      g.commitFiles = []
      g.range = null
      return
    }
    const [branches, status, log] = await Promise.all([
      git.branches(),
      git.status(),
      git.log(50, g.branchFilter ?? undefined),
    ])
    g.branches = branches
    g.status = status
    g.log = log
    // 默认展开 HEAD
    if (log.length > 0 && g.selectedCommit === null) {
      await selectCommit(log[0])
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

// ---------- 提交展开 / 范围对比 ----------
async function selectCommit(c: GitCommit) {
  const g = state.gitPanel
  if (g.selectedCommit === c.hash) {
    // 再次点击收起
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
    // 范围对比：Shift+点击 选两个提交
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

// ---------- 打开 diff ----------
function onWorktreeFile(f: GitFileStatus) {
  void openGitDiff(f.path, { from: null, to: 'HEAD', label: '工作区 vs HEAD' })
}

function onCommitFile(path: string) {
  const g = state.gitPanel
  if (g.range) {
    // 范围对比：a..b
    void openGitDiff(path, {
      from: g.range.a,
      to: g.range.b,
      label: `${g.range.a.slice(0, 7)}..${g.range.b.slice(0, 7)}`,
    })
    return
  }
  const sha = g.selectedCommit
  if (!sha) return
  // commit vs 父提交（首个提交的父 = --root，git 自动处理）
  void openGitDiff(path, {
    from: `${sha}^`,
    to: sha,
    label: `${sha.slice(0, 7)} ↔ 父提交`,
  })
}

// ---------- 分支 ----------
async function onBranchClick(name: string) {
  const g = state.gitPanel
  if (g.branchFilter === name) {
    g.branchFilter = null
  } else {
    g.branchFilter = name
  }
  g.selectedCommit = null
  g.commitFiles = []
  g.range = null
  try {
    g.log = await git.log(50, g.branchFilter ?? undefined)
    if (g.log.length > 0) await selectCommit(g.log[0])
  } catch (e) {
    toast(`加载分支历史失败: ${(e as Error).message}`, 'error')
  }
}

/** M11d：切换分支（危险操作，确认后 checkout + 关闭旧分支文件） */
function onBranchSwitch(name: string) {
  const g = state.gitPanel
  if (!g.repo?.isRepo || g.repo.branch === name) return
  void import('../editor/manager').then((m) => m.switchGitBranch(name))
}

// ---------- 格式化 ----------
function relTime(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`
  return new Date(ts * 1000).toLocaleDateString()
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  M: { label: 'M', cls: 'st-m' },
  A: { label: 'A', cls: 'st-a' },
  D: { label: 'D', cls: 'st-d' },
  '?': { label: '?', cls: 'st-u' },
  U: { label: 'U', cls: 'st-u' },
  R: { label: 'R', cls: 'st-r' },
  C: { label: 'C', cls: 'st-r' },
}

const uncommittedCount = computed(() => state.gitPanel.status.length)
const commitFileMeta = (st: string) => STATUS_META[st] ?? { label: st, cls: 'st-m' }
const fileBase = (p: string) => baseName(p.replace(/ → .*$/, ''))

onMounted(() => {
  void loadAll()
})

// M11d：还原/切换分支后自动刷新面板
watch(
  () => state.gitPanel.version,
  () => {
    if (state.gitPanel.tab === 'git') void loadAll()
  }
)

defineExpose({ loadAll })
</script>

<template>
  <div class="git-panel">
    <!-- 仓库状态条 -->
    <div class="git-head">
      <button class="mini" title="刷新" @click="loadAll">⟳</button>
      <span v-if="state.gitPanel.repo?.isRepo" class="repo-badge" :title="state.gitPanel.repo.headHash ?? ''">
        ⓘ {{ state.gitPanel.repo.branch ?? '(detached)' }}
      </span>
      <span v-if="uncommittedCount > 0" class="uncommitted">● {{ uncommittedCount }} 未提交</span>
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

    <!-- 分支区 -->
    <div v-if="state.gitPanel.repo?.isRepo" class="section">
      <div class="section-title">分支</div>
      <div
        v-for="b in state.gitPanel.branches"
        :key="b.name"
        class="branch"
        :class="{ current: b.isCurrent, filtered: state.gitPanel.branchFilter === b.name }"
        :title="b.remote ? `上游: ${b.remote}${b.aheadBehind ? ' ' + b.aheadBehind : ''}` : ''"
        @click="onBranchClick(b.name)"
      >
        <span class="branch-icon">{{ b.isCurrent ? '●' : b.name.startsWith('origin/') ? '⚑' : '○' }}</span>
        <span class="branch-name">{{ b.name }}</span>
        <span v-if="b.isCurrent" class="cur-tag">当前</span>
        <button
          v-if="!b.isCurrent && !b.name.startsWith('origin/')"
          class="branch-switch"
          title="切换到该分支"
          @click.stop="onBranchSwitch(b.name)"
        >
          ⇄
        </button>
      </div>
    </div>

    <!-- 工作区 -->
    <div v-if="state.gitPanel.repo?.isRepo" class="section">
      <div class="section-title">工作区</div>
      <div v-if="!state.gitPanel.status.length" class="section-empty">无未提交改动</div>
      <div
        v-for="f in state.gitPanel.status"
        :key="f.path"
        class="ws-file"
        :title="`${f.status === '?' ? '未跟踪' : '已跟踪'} · ${f.added >= 0 ? '+' + f.added + ' −' + f.deleted : ''}`"
        @click="onWorktreeFile(f)"
      >
        <span class="st" :class="commitFileMeta(f.status).cls">{{ commitFileMeta(f.status).label }}</span>
        <span class="ws-path">{{ fileBase(f.path) }}</span>
        <span v-if="f.added >= 0" class="ws-stats">
          <span class="stat-add">+{{ f.added }}</span>
          <span class="stat-del">−{{ f.deleted }}</span>
        </span>
      </div>
    </div>

    <!-- 历史 -->
    <div v-if="state.gitPanel.repo?.isRepo" class="section">
      <div class="section-title">
        历史
        <span v-if="state.gitPanel.branchFilter" class="filter-tag">
          {{ state.gitPanel.branchFilter }}
          <button class="mini" title="清除分支过滤" @click="onBranchClick(state.gitPanel.branchFilter)">✕</button>
        </span>
      </div>
      <div
        v-for="c in state.gitPanel.log"
        :key="c.hash"
        class="commit"
        :class="{ expanded: state.gitPanel.selectedCommit === c.hash }"
        @click="onCommitClick(c, $event)"
      >
        <div class="commit-row">
          <span class="commit-icon">🔒</span>
          <span class="commit-msg">{{ c.message }}</span>
          <span class="commit-date">{{ relTime(c.date) }}</span>
        </div>
        <div class="commit-sub">{{ c.hash.slice(0, 7) }} · {{ c.author }}</div>
        <!-- 变更文件列表 -->
        <div v-if="state.gitPanel.selectedCommit === c.hash" class="commit-files">
          <div v-if="!state.gitPanel.commitFiles.length" class="section-empty">无文件变更</div>
          <div
            v-for="f in state.gitPanel.commitFiles"
            :key="f.path"
            class="ws-file"
            @click.stop="onCommitFile(f.path)"
          >
            <span class="st" :class="commitFileMeta(f.status).cls">{{ commitFileMeta(f.status).label }}</span>
            <span class="ws-path">{{ f.path }}</span>
            <span v-if="f.added >= 0" class="ws-stats">
              <span class="stat-add">+{{ f.added }}</span>
              <span class="stat-del">−{{ f.deleted }}</span>
            </span>
          </div>
        </div>
      </div>
      <div v-if="!state.gitPanel.log.length" class="section-empty">暂无提交</div>
    </div>
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
  gap: 8px;
  padding: 4px 6px 8px;
}
.repo-badge {
  background: var(--chrome-selected);
  color: var(--chrome-primary);
  padding: 1px 8px;
  border-radius: 999px;
  font-weight: 600;
  font-size: 11px;
}
.uncommitted {
  color: var(--chrome-error, #ba1a1a);
  font-size: 11px;
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
.mini {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  padding: 2px 5px;
  border-radius: 5px;
  cursor: pointer;
  font-family: inherit;
}
.mini:hover {
  background: var(--chrome-hover);
  color: var(--chrome-on-background);
}
.section {
  margin-bottom: 10px;
}
.section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--chrome-on-surface-variant);
  padding: 4px 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.filter-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--chrome-selected);
  border-radius: 999px;
  padding: 0 4px 0 8px;
  font-weight: 400;
  color: var(--chrome-primary);
}
.section-empty {
  padding: 6px 10px;
  color: var(--chrome-on-surface-variant);
  font-size: 12px;
}
.branch {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.branch:hover {
  background: var(--chrome-hover);
}
.branch.current {
  background: var(--chrome-selected);
}
.branch.filtered {
  box-shadow: inset 0 0 0 1.5px var(--chrome-primary);
}
.branch-icon {
  width: 14px;
  text-align: center;
  color: var(--chrome-primary);
}
.branch-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cur-tag {
  font-size: 10px;
  color: var(--chrome-primary);
}
.branch-switch {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 5px;
  cursor: pointer;
  opacity: 0;
  font-family: inherit;
}
.branch:hover .branch-switch {
  opacity: 1;
}
.branch-switch:hover {
  background: var(--chrome-selected);
  color: var(--chrome-primary);
}
.ws-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.ws-file:hover {
  background: var(--chrome-hover);
}
.st {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.st-m {
  background: #f59f00;
  color: #fff;
}
.st-a {
  background: #2e7d32;
  color: #fff;
}
.st-d {
  background: var(--chrome-error, #ba1a1a);
  color: #fff;
}
.st-u {
  background: #6c757d;
  color: #fff;
}
.st-r {
  background: #7b5cd6;
  color: #fff;
}
.ws-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.ws-stats {
  font-size: 11px;
  flex-shrink: 0;
  display: flex;
  gap: 5px;
}
.stat-add {
  color: #2e7d32;
}
.stat-del {
  color: var(--chrome-error, #ba1a1a);
}
.commit {
  border-radius: 8px;
  padding: 5px 8px;
  cursor: pointer;
}
.commit:hover {
  background: var(--chrome-hover);
}
.commit.expanded {
  background: var(--chrome-selected);
}
.commit-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.commit-icon {
  font-size: 11px;
}
.commit-msg {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.commit-date {
  color: var(--chrome-on-surface-variant);
  font-size: 11px;
  flex-shrink: 0;
}
.commit-sub {
  font-size: 10.5px;
  color: var(--chrome-on-surface-variant);
  padding-left: 20px;
}
.commit-files {
  margin-top: 4px;
  border-top: 1px dashed var(--chrome-border);
  padding-top: 4px;
}
</style>
