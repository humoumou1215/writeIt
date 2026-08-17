<script setup lang="ts">
// Git 面板（M11a / M15）：仓库状态条 + 工作区 / 分支 / 历史 三区块
//  M15：区块顺序调整为 工作区→分支→历史；三区可折叠收纳（localStorage 记忆）；
//       分支支持搜索过滤（大仓库）；工作区/提交变更列表树形化（GitChangeTree）；
//       历史区渲染提交图（buildGraph：分叉/合并线）；打开 diff 联动主文件树 reveal 定位。
//  - 工作区文件点击 → 编辑区 diff（工作区 vs HEAD）
//  - 提交点击 → 展开变更文件树 → 点文件 diff（commit vs 父提交）
//  - Shift+点击 → 范围对比（a..b）；顶部范围条 ✕ 清除
//  - 分支点击 → 过滤历史；⇄ = 切换分支（危险确认）
import { onMounted, ref, computed, watch } from 'vue'
import { state, toast } from '../state/store'
import { git, isGitAvailable } from '../git'
import type { GitCommit } from '../git'
import { buildGraph } from '../git/graph'
import { buildChangeTree, type GitChangeNode } from '../git/change-tree'
import { applyGitMark, clearGitMark } from '../git/mark'
import { openGitDiff } from '../editor/manager'
import { revealInTree } from '../state/treeOps'
import { settings } from '../state/settings'
import MenuIcon from './MenuIcon.vue'
import GitChangeTree from './GitChangeTree.vue'

const loading = ref(false)
const error = ref<string | null>(null)

// ---------- 区块折叠（localStorage 记忆） ----------
const SECTIONS_KEY = 'writeit.gitPanel.sections.v1'
const DEFAULT_SECTIONS = { worktree: false, branches: false, history: false }
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

// ---------- 分支搜索 ----------
const branchQuery = ref('')
const filteredBranches = computed(() => {
  const q = branchQuery.value.trim().toLowerCase()
  if (!q) return state.gitPanel.branches
  return state.gitPanel.branches.filter((b) => b.name.toLowerCase().includes(q))
})

// ---------- 变更树（工作区 / 提交 files） ----------
const wsTree = computed(() => buildChangeTree(state.gitPanel.status))
const cmTree = computed(() => buildChangeTree(state.gitPanel.commitFiles))
/** 折叠的目录路径集合（空 = 全部展开） */
const wsCollapsed = ref(new Set<string>())
const cmCollapsed = ref(new Set<string>())
function onWsNode(n: GitChangeNode) {
  if (n.kind !== 'file') return
  void openGitDiff(n.path, { from: null, to: 'HEAD', label: '工作区 vs HEAD' })
  revealInTree(n.path, 8000)
}
function onCmNode(n: GitChangeNode) {
  if (n.kind !== 'file') return
  const g = state.gitPanel
  if (g.range) {
    // 范围对比：a..b
    void openGitDiff(n.path, {
      from: g.range.a,
      to: g.range.b,
      label: `${g.range.a.slice(0, 7)}..${g.range.b.slice(0, 7)}`,
    })
    revealInTree(n.path, 8000)
    return
  }
  const sha = g.selectedCommit
  if (!sha) return
  // commit vs 父提交（首个提交的父 = --root，git 自动处理）
  void openGitDiff(n.path, {
    from: `${sha}^`,
    to: sha,
    label: `${sha.slice(0, 7)} ↔ 父提交`,
  })
  revealInTree(n.path, 8000)
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
      g.branches = []
      g.status = []
      g.log = []
      g.selectedCommit = null
      g.commitFiles = []
      g.range = null
      clearGitMark()
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
    // 主文件树角标数据
    applyGitMark(status)
    // 展开状态重置（默认全展开）
    wsCollapsed.value = new Set()
    cmCollapsed.value = new Set()
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
  cmCollapsed.value = new Set()
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

// ---------- 提交图 ----------
const graphRows = computed(() => buildGraph(state.gitPanel.log))

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

const uncommittedCount = computed(() => state.gitPanel.status.length)

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
      <button class="mini" title="返回文件树" @click="state.gitPanel.tab = 'files'">← 文件</button>
      <button class="mini" title="刷新" @click="loadAll">
        <MenuIcon name="refresh" :set="settings.iconSet" :size="14" />
      </button>
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

    <template v-if="state.gitPanel.repo?.isRepo">
      <!-- ===== 工作区（M15：树形 + 目录聚合） ===== -->
      <div class="section">
        <div class="section-title" @click="toggleSection('worktree')">
          <span class="chev" :class="{ open: !sectionCollapsed.worktree }">▸</span>
          工作区
          <span v-if="!sectionCollapsed.worktree && uncommittedCount" class="sec-count">· {{ uncommittedCount }}</span>
        </div>
        <div v-if="!sectionCollapsed.worktree">
          <div v-if="!state.gitPanel.status.length" class="section-empty">无未提交改动</div>
          <GitChangeTree
            v-for="n in wsTree"
            :key="n.path"
            :node="n"
            :depth="0"
            :collapsed="wsCollapsed"
            @open="onWsNode"
          />
        </div>
      </div>

      <!-- ===== 分支（M15：搜索过滤） ===== -->
      <div class="section">
        <div class="section-title" @click="toggleSection('branches')">
          <span class="chev" :class="{ open: !sectionCollapsed.branches }">▸</span>
          分支
          <span v-if="!sectionCollapsed.branches" class="sec-count">· {{ state.gitPanel.branches.length }}</span>
        </div>
        <div v-if="!sectionCollapsed.branches">
          <div class="branch-search">
            <input
              v-model="branchQuery"
              class="search-input"
              type="text"
              placeholder="搜索分支…"
              spellcheck="false"
              @click.stop
              @keydown.esc.prevent="branchQuery = ''"
            />
          </div>
          <div v-if="!filteredBranches.length" class="section-empty">无匹配分支</div>
          <div
            v-for="b in filteredBranches"
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
      </div>

      <!-- ===== 历史（M15：提交图 + 变更文件树） ===== -->
      <div class="section">
        <div class="section-title" @click="toggleSection('history')">
          <span class="chev" :class="{ open: !sectionCollapsed.history }">▸</span>
          历史
          <span v-if="!sectionCollapsed.history" class="sec-count">· {{ state.gitPanel.log.length }}</span>
          <span v-if="state.gitPanel.branchFilter" class="filter-tag" @click.stop>
            {{ state.gitPanel.branchFilter }}
            <button class="mini" title="清除分支过滤" @click="onBranchClick(state.gitPanel.branchFilter!)">✕</button>
          </span>
        </div>
        <div v-if="!sectionCollapsed.history">
          <div v-if="!state.gitPanel.log.length" class="section-empty">暂无提交</div>
          <div
            v-for="(c, ci) in state.gitPanel.log"
            :key="c.hash"
            class="commit"
            :class="{ expanded: state.gitPanel.selectedCommit === c.hash }"
          >
            <div
              class="commit-row"
              @click="onCommitClick(c, $event)"
            >
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
            <!-- 变更文件树 -->
            <div v-if="state.gitPanel.selectedCommit === c.hash" class="commit-files" @click.stop>
              <div v-if="!state.gitPanel.commitFiles.length" class="section-empty">无文件变更</div>
              <GitChangeTree
                v-for="n in cmTree"
                :key="n.path"
                :node="n"
                :depth="0"
                :collapsed="cmCollapsed"
                @open="onCmNode"
              />
            </div>
          </div>
          <div class="history-hint">Shift+点击两个提交 = 范围对比</div>
        </div>
      </div>
    </template>
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
.filter-tag .mini {
  padding: 0 3px;
}
.section-empty {
  padding: 6px 10px;
  color: var(--chrome-on-surface-variant);
  font-size: 12px;
}
/* ---- 分支 ---- */
.branch-search {
  padding: 0 8px 6px;
}
.search-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--chrome-border);
  background: var(--chrome-background);
  color: var(--chrome-on-background);
  border-radius: 6px;
  font-size: 12px;
  padding: 4px 8px;
  font-family: inherit;
  outline: none;
}
.search-input:focus {
  border-color: var(--chrome-primary);
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
/* ---- 历史 + 提交图 ---- */
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
.commit-row.expanded {
  background: var(--chrome-selected);
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