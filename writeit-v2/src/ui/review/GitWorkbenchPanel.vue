<script setup lang="ts">
import type {
  GitCommit,
  GitDiffResult,
  GitDiffTarget,
  GitFileStatus,
  GitRepositoryInfo,
} from '../../application/git'

const props = withDefaults(defineProps<{
  info?: GitRepositoryInfo | null
  statuses?: readonly GitFileStatus[]
  diff?: GitDiffResult | null
  history?: readonly GitCommit[]
  selectedPath?: string | null
  layout?: 'unified' | 'split'
  loading?: boolean
  error?: string | null
}>(), {
  info: null,
  statuses: () => [],
  diff: null,
  history: () => [],
  selectedPath: null,
  layout: 'unified',
  loading: false,
  error: null,
})

const emit = defineEmits<{
  (event: 'refresh'): void
  (event: 'switch-branch', branch: string): void
  (event: 'select-path', path: string): void
  (event: 'select-target', target: GitDiffTarget): void
  (event: 'toggle-layout'): void
  (event: 'discard-file', path: string): void
  (event: 'discard-hunk', path: string, hunkId: string): void
}>()
</script>

<template>
  <section class="git-workbench" data-testid="git-workbench" aria-label="Git workbench">
    <header class="git-workbench__header">
      <div>
        <h3>Git workbench</h3>
        <p v-if="props.info?.isGitRepository" class="git-workbench__meta">
          <label>Branch
            <select :value="props.info.branch ?? ''" data-testid="git-branch" @change="emit('switch-branch', ($event.target as HTMLSelectElement).value)">
              <option v-for="branch in props.info.branches" :key="branch" :value="branch">{{ branch }}</option>
            </select>
          </label>
          · {{ props.info.head ?? 'unknown HEAD' }}
        </p>
      </div>
      <button type="button" data-testid="git-refresh" :disabled="props.loading" @click="emit('refresh')">Refresh</button>
    </header>

    <p v-if="props.loading" class="git-workbench__status">Loading repository…</p>
    <p v-else-if="props.error" class="git-workbench__error" data-testid="git-error">{{ props.error }}</p>
    <p v-else-if="!props.info?.isGitRepository" class="git-workbench__empty" data-testid="git-non-repository">
      This workspace is not a Git repository.
    </p>
    <template v-else>
      <div class="git-workbench__toolbar">
        <span>Compare</span>
        <button type="button" :class="{ 'git-workbench__toggle--active': props.layout === 'unified' }" data-testid="git-layout-unified" @click="props.layout === 'split' && emit('toggle-layout')">Unified</button>
        <button type="button" :class="{ 'git-workbench__toggle--active': props.layout === 'split' }" data-testid="git-layout-split" @click="props.layout === 'unified' && emit('toggle-layout')">Split</button>
      </div>
      <ul class="git-workbench__files" aria-label="Changed files">
        <li v-for="status in props.statuses" :key="status.path" :class="{ 'git-workbench__file--active': status.path === props.selectedPath }">
          <button type="button" :data-git-file="status.path" @click="emit('select-path', status.path)">
            <span>{{ status.status }}</span> {{ status.path }}
          </button>
          <button type="button" class="git-workbench__discard" :data-git-discard="status.path" @click.stop="emit('discard-file', status.path)">Discard</button>
        </li>
        <li v-if="props.statuses.length === 0" class="git-workbench__empty">No changed files.</li>
      </ul>
      <div v-if="props.diff" class="git-workbench__diff" data-testid="git-diff">
        <p class="git-workbench__diff-target">{{ props.diff.target.kind }} · {{ props.diff.rawChangeCount }} raw changes</p>
        <article v-for="hunk in props.diff.hunks" :key="hunk.id" class="git-workbench__hunk" :data-git-hunk="hunk.id">
          <header>@@ -{{ hunk.oldStart }},{{ hunk.oldCount }} +{{ hunk.newStart }},{{ hunk.newCount }} @@
            <button v-if="props.selectedPath" type="button" class="git-workbench__discard" @click="emit('discard-hunk', props.selectedPath, hunk.id)">Discard hunk</button>
          </header>
          <pre><code><span v-for="(line, index) in hunk.lines" :key="`${hunk.id}-${index}`" :class="`git-line--${line.kind}`">{{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ' }}{{ line.text }}
</span></code></pre>
        </article>
      </div>
      <p v-else class="git-workbench__empty">Select a changed file to compare Worktree ↔ HEAD.</p>
      <details class="git-workbench__history">
        <summary>File history ({{ props.history.length }})</summary>
        <ul>
          <li v-for="commit in props.history" :key="commit.id">
            <code>{{ commit.id.slice(0, 8) }}</code> {{ commit.summary }} · {{ commit.authorName }} · {{ commit.authorTime }}
          </li>
        </ul>
      </details>
    </template>
  </section>
</template>
