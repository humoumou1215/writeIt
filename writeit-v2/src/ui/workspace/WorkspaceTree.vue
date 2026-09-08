<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import {
  createWorkspacePath,
  workspaceParent,
} from '../../core/workspace'
import type {
  WorkspacePath,
  WorkspaceTree,
} from '../../core/workspace'
import WorkspaceTreeNode from './WorkspaceTreeNode.vue'

defineOptions({ name: 'WorkspaceTree' })

const props = defineProps<{
  tree: WorkspaceTree
  selectedPath: WorkspacePath | null
  busy?: boolean
  /** Path whose ancestors should be expanded and whose row should be brought into view. */
  revealPath?: WorkspacePath | null
  /** Increment to repeat reveal for the same path. */
  revealVersion?: number
}>()

const emit = defineEmits<{
  (event: 'select', path: WorkspacePath): void
  (event: 'open', path: WorkspacePath): void
  (event: 'rename', path: WorkspacePath, name: string): void
  (event: 'delete', path: WorkspacePath): void
  (event: 'copy', path: WorkspacePath): void
  (event: 'contextmenu', path: WorkspacePath, x: number, y: number): void
  (event: 'move', source: WorkspacePath, destination: WorkspacePath): void
}>()

const expandedPaths = ref<Set<WorkspacePath>>(
  new Set<WorkspacePath>([props.tree.root.path]),
)

watch(
  () => props.tree.root.path,
  (rootPath) => {
    expandedPaths.value = new Set([rootPath])
  },
)

function reveal(path: WorkspacePath | null | undefined): void {
  if (path === null || path === undefined) return

  const normalizedPath = createWorkspacePath(path)
  const nextExpanded = new Set(expandedPaths.value)
  let current = workspaceParent(normalizedPath)
  while (true) {
    nextExpanded.add(current)
    if (current === props.tree.root.path) break
    const parent = workspaceParent(current)
    if (parent === current) break
    current = parent
  }
  expandedPaths.value = nextExpanded

  void nextTick(() => {
    const rows = document.querySelectorAll<HTMLElement>(
      '[data-workspace-path]',
    )
    const row = [...rows].find(
      (candidate) => candidate.dataset.workspacePath === normalizedPath,
    )
    row?.scrollIntoView?.({ block: 'nearest' })
  })
}

watch(
  () => [props.tree, props.revealPath, props.revealVersion] as const,
  ([, path]) => reveal(path),
  { immediate: true },
)

function toggle(path: WorkspacePath): void {
  const next = new Set(expandedPaths.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expandedPaths.value = next
}

function forwardRename(path: WorkspacePath, name: string): void {
  emit('rename', path, name)
}

function forwardMove(source: WorkspacePath, destination: WorkspacePath): void {
  emit('move', source, destination)
}

function forwardContextMenu(
  path: WorkspacePath,
  x: number,
  y: number,
): void {
  emit('contextmenu', path, x, y)
}
</script>

<template>
  <ul
    class="workspace-tree"
    role="tree"
    data-testid="workspace-tree"
  >
    <WorkspaceTreeNode
      :node="tree.root"
      :depth="0"
      is-root
      :selected-path="selectedPath"
      :expanded-paths="expandedPaths"
      :busy="busy"
      @select="emit('select', $event)"
      @open="emit('open', $event)"
      @toggle="toggle"
      @rename="forwardRename"
      @delete="emit('delete', $event)"
      @copy="emit('copy', $event)"
      @contextmenu="forwardContextMenu"
      @move="forwardMove"
    />
  </ul>
</template>
