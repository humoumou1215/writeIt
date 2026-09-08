<script setup lang="ts">
import { ref } from 'vue'
import { createWorkspacePath } from '../../core/workspace'
import type {
  WorkspaceDirectoryNode,
  WorkspaceNode,
  WorkspacePath,
} from '../../core/workspace'

defineOptions({ name: 'WorkspaceTreeNode' })

const props = defineProps<{
  node: WorkspaceNode
  depth: number
  isRoot?: boolean
  selectedPath: WorkspacePath | null
  expandedPaths: ReadonlySet<WorkspacePath>
  busy?: boolean
}>()

const emit = defineEmits<{
  (event: 'select', path: WorkspacePath): void
  (event: 'open', path: WorkspacePath): void
  (event: 'toggle', path: WorkspacePath): void
  (event: 'rename', path: WorkspacePath, name: string): void
  (event: 'delete', path: WorkspacePath): void
  (event: 'copy', path: WorkspacePath): void
  (event: 'contextmenu', path: WorkspacePath, x: number, y: number): void
  (event: 'move', source: WorkspacePath, destination: WorkspacePath): void
}>()

const editing = ref(false)
const renameValue = ref('')

function isDirectory(node: WorkspaceNode): node is WorkspaceDirectoryNode {
  return node.kind === 'directory'
}

function startRename(event: MouseEvent): void {
  event.stopPropagation()
  renameValue.value = props.node.name
  editing.value = true
}

function cancelRename(): void {
  editing.value = false
  renameValue.value = ''
}

function submitRename(): void {
  const nextName = renameValue.value
  if (nextName.length === 0) return
  emit('rename', props.node.path, nextName)
  cancelRename()
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    submitRename()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
  }
}

function selectNode(): void {
  emit('select', props.node.path)
}

function activateNode(): void {
  selectNode()
  if (props.node.kind === 'file') emit('open', props.node.path)
}

function openContextMenu(event: MouseEvent): void {
  if (props.isRoot) return
  selectNode()
  emit('contextmenu', props.node.path, event.clientX, event.clientY)
}

function toggleNode(event: MouseEvent): void {
  event.stopPropagation()
  if (isDirectory(props.node)) emit('toggle', props.node.path)
}

function readDraggedPath(event: DragEvent): WorkspacePath | undefined {
  const value = event.dataTransfer?.getData('text/plain')
  if (!value) return undefined

  try {
    return createWorkspacePath(value)
  } catch {
    return undefined
  }
}

function handleDragStart(event: DragEvent): void {
  if (props.isRoot || !event.dataTransfer) return
  event.dataTransfer.setData('text/plain', props.node.path)
  event.dataTransfer.effectAllowed = 'move'
  selectNode()
}

function handleDrop(event: DragEvent): void {
  if (!isDirectory(props.node)) return
  const source = readDraggedPath(event)
  if (!source || source === props.node.path) return
  event.stopPropagation()
  emit('move', source, props.node.path)
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
  <li
    class="workspace-tree__item"
    role="treeitem"
    :aria-expanded="isDirectory(node) ? expandedPaths.has(node.path) : undefined"
    :aria-selected="selectedPath === node.path"
    :data-workspace-path="node.path"
    :data-workspace-kind="node.kind"
  >
    <div
      class="workspace-tree__row"
      :class="{
        'workspace-tree__row--selected': selectedPath === node.path,
        'workspace-tree__row--directory': isDirectory(node),
      }"
      :style="{ '--workspace-depth': depth }"
      :draggable="!isRoot"
      @click="activateNode"
      @contextmenu.prevent.stop="openContextMenu"
      @dragstart="handleDragStart"
      @dragover.prevent="isDirectory(node)"
      @drop.prevent="handleDrop"
    >
      <button
        v-if="isDirectory(node)"
        type="button"
        class="workspace-tree__twisty"
        :aria-label="expandedPaths.has(node.path) ? `Collapse ${node.name}` : `Expand ${node.name}`"
        @click="toggleNode"
      >
        {{ expandedPaths.has(node.path) ? '▾' : '▸' }}
      </button>
      <span v-else class="workspace-tree__twisty workspace-tree__twisty--empty" aria-hidden="true">·</span>

      <template v-if="editing">
        <input
          v-model="renameValue"
          class="workspace-tree__rename-input"
          :aria-label="`Rename ${node.name}`"
          @click.stop
          @keydown="handleKeydown"
          @blur="submitRename"
        />
      </template>
      <span v-else class="workspace-tree__name">
        <span aria-hidden="true">{{ isDirectory(node) ? '▰' : '▱' }}</span>
        {{ node.name }}
      </span>

      <span v-if="!isRoot" class="workspace-tree__actions">
        <button
          type="button"
          class="workspace-tree__action"
          :aria-label="`Rename ${node.name}`"
          :disabled="busy"
          @click="startRename"
        >
          Rename
        </button>
        <button
          type="button"
          class="workspace-tree__action workspace-tree__action--danger"
          :aria-label="`Delete ${node.name}`"
          :disabled="busy"
          @click.stop="emit('delete', node.path)"
        >
          Delete
        </button>
      </span>
    </div>

    <ul
      v-if="isDirectory(node) && expandedPaths.has(node.path)"
      class="workspace-tree__children"
      role="group"
    >
      <WorkspaceTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :selected-path="selectedPath"
        :expanded-paths="expandedPaths"
        :busy="busy"
        @select="emit('select', $event)"
        @open="emit('open', $event)"
        @toggle="emit('toggle', $event)"
        @rename="forwardRename"
        @delete="emit('delete', $event)"
        @copy="emit('copy', $event)"
        @contextmenu="forwardContextMenu"
        @move="forwardMove"
      />
    </ul>
  </li>
</template>
