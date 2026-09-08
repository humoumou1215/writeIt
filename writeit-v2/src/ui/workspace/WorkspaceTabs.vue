<script setup lang="ts">
import type { DocumentId } from '../../core/document'

export interface WorkspaceTabView {
  readonly documentId: DocumentId
  readonly path: string
  readonly name: string
  readonly dirty: boolean
  readonly persistenceStatus: string
}

defineOptions({ name: 'WorkspaceTabs' })

const props = defineProps<{
  tabs: readonly WorkspaceTabView[]
  activeDocumentId: DocumentId | null
}>()

const emit = defineEmits<{
  (event: 'select', documentId: DocumentId): void
  (event: 'close', documentId: DocumentId): void
}>()
</script>

<template>
  <nav class="workspace-tabs" data-testid="workspace-tabs" aria-label="Open documents">
    <div class="workspace-tabs__list" role="tablist" aria-label="Open documents">
      <span v-if="props.tabs.length === 0" class="workspace-tabs__empty">
        No open documents
      </span>
      <div
        v-for="tab in props.tabs"
        :key="tab.documentId"
        class="workspace-tab-shell"
        :class="{ 'workspace-tab-shell--active': tab.documentId === props.activeDocumentId }"
        role="presentation"
      >
        <button
          type="button"
          class="workspace-tab"
          :class="{ 'workspace-tab--active': tab.documentId === props.activeDocumentId, 'workspace-tab--dirty': tab.dirty, [`workspace-tab--${tab.persistenceStatus}`]: true }"
          role="tab"
          :aria-selected="tab.documentId === props.activeDocumentId"
          :aria-label="`${tab.name}${tab.dirty ? ' (unsaved changes)' : ''}${tab.persistenceStatus === 'conflict' ? ' (save conflict)' : ''}`"
          :title="tab.path"
          :data-workspace-tab-path="tab.path"
          :data-workspace-tab-id="tab.documentId"
          @click="emit('select', tab.documentId)"
        >
          <span
            class="workspace-tab__dirty"
            :class="{ 'workspace-tab__dirty--visible': tab.dirty }"
            :aria-hidden="!tab.dirty"
            title="Unsaved changes"
          >●</span>
          <span class="workspace-tab__name">{{ tab.name }}</span>
          <span
            v-if="tab.persistenceStatus === 'conflict' || tab.persistenceStatus === 'external-change'"
            class="workspace-tab__external"
            :title="tab.persistenceStatus === 'conflict' ? 'External file conflict' : 'External file changed'"
          >!</span>
        </button>
        <button
          type="button"
          class="workspace-tab__close"
          :aria-label="`Close ${tab.name}`"
          :title="`Close ${tab.name}`"
          :data-workspace-tab-close="tab.path"
          @click="emit('close', tab.documentId)"
        >
          ×
        </button>
      </div>
    </div>
  </nav>
</template>
