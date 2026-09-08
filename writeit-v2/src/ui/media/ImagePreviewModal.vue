<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import type { WorkspacePath } from '../../core/workspace'
import type { ImageProjectionResource } from '../../editor/preview'

const props = defineProps<{
  image: ImageProjectionResource | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'copy', image: ImageProjectionResource): void
  (event: 'reveal', path: WorkspacePath): void
}>()

function close(): void {
  emit('close')
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || props.image === null) return
  event.preventDefault()
  event.stopPropagation()
  close()
}

function handleBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) close()
}

onMounted(() => window.addEventListener('keydown', handleKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="image"
      class="image-preview-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      data-testid="image-preview-modal"
      @click="handleBackdropClick"
    >
      <div class="image-preview-modal__surface">
        <div class="image-preview-modal__toolbar">
          <div class="image-preview-modal__heading">
            <strong>{{ image.name }}</strong>
            <span v-if="image.path" class="image-preview-modal__path">{{ image.path }}</span>
          </div>
          <div class="image-preview-modal__actions">
            <button
              v-if="image.bytes"
              type="button"
              data-testid="image-preview-copy"
              aria-label="Copy image"
              @click="emit('copy', image)"
            >
              Copy image
            </button>
            <button
              v-if="image.path"
              type="button"
              data-testid="image-preview-reveal"
              aria-label="Locate image in workspace"
              @click="emit('reveal', image.path)"
            >
              Locate in workspace
            </button>
            <button
              type="button"
              data-testid="image-preview-close"
              aria-label="Close image preview"
              @click="close"
            >
              ×
            </button>
          </div>
        </div>
        <div class="image-preview-modal__viewport">
          <img
            v-if="image.url"
            :src="image.url"
            :alt="image.alt"
            class="image-preview-modal__image"
            data-testid="image-preview-image"
            draggable="false"
          />
          <p v-else class="image-preview-modal__error" role="status">
            {{ image.error ?? 'Image is unavailable.' }}
          </p>
        </div>
      </div>
    </div>
  </Teleport>
</template>
