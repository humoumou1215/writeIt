<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Annotation } from '../../core/annotation'

const props = withDefaults(defineProps<{
  annotations: readonly Annotation[]
  activeId?: string | null
  open?: boolean
  width?: number
}>(), { activeId: null, open: true, width: 360 })

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'select', id: string): void
  (event: 'reply', id: string, body: string): void
  (event: 'resolve', id: string, resolved: boolean): void
  (event: 'resize', width: number): void
}>()

const drafts = ref<Record<string, string>>({})
const cardElements = new Map<string, HTMLElement>()
const connectorLines = ref<readonly { x1: number; y1: number; x2: number; y2: number; id: string }[]>([])
const root = ref<HTMLElement | null>(null)
const dragging = ref(false)

const visibleAnnotations = computed(() => props.annotations)

function setCardRef(id: string, element: Element | null): void {
  if (element instanceof HTMLElement) cardElements.set(id, element)
  else cardElements.delete(id)
}

function submitReply(annotation: Annotation, draftValue?: string): void {
  const body = (draftValue ?? drafts.value[annotation.id])?.trim()
  if (!body) return
  emit('reply', annotation.id, body)
  drafts.value = { ...drafts.value, [annotation.id]: '' }
}

function onReplyKeydown(event: KeyboardEvent, annotation: Annotation): void {
  if (event.isComposing) return
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submitReply(annotation, (event.currentTarget as HTMLTextAreaElement | null)?.value)
  }
}

function onResizePointerDown(event: PointerEvent): void {
  event.preventDefault()
  dragging.value = true
  const startX = event.clientX
  const startWidth = props.width ?? 360
  const move = (next: PointerEvent) => emit('resize', Math.max(280, Math.min(560, startWidth + startX - next.clientX)))
  const end = () => {
    dragging.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
}

function updateConnectors(): void {
  if (!props.open) {
    connectorLines.value = []
    return
  }
  const lines = visibleAnnotations.value.flatMap((annotation) => {
    if (annotation.anchorResolution.status !== 'resolved') return []
    const mark = document.querySelector<HTMLElement>(`[data-annotation-id="${annotation.id}"]`)
    const card = cardElements.get(annotation.id)
    if (!mark || !card) return []
    const sourceRect = mark.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    return [{ id: annotation.id, x1: sourceRect.right, y1: sourceRect.top + sourceRect.height / 2, x2: cardRect.left, y2: cardRect.top + cardRect.height / 2 }]
  })
  connectorLines.value = lines
}

function scheduleConnectors(): void {
  void nextTick(updateConnectors)
}

watch(() => [props.annotations, props.activeId, props.open, props.width], scheduleConnectors, { deep: true })
onMounted(() => {
  window.addEventListener('scroll', scheduleConnectors, true)
  window.addEventListener('resize', scheduleConnectors)
  scheduleConnectors()
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', scheduleConnectors, true)
  window.removeEventListener('resize', scheduleConnectors)
})
</script>

<template>
  <aside
    v-if="props.open"
    ref="root"
    class="annotation-drawer"
    data-testid="annotation-drawer"
    :style="{ width: `${props.width}px` }"
    aria-label="Annotations"
  >
    <div class="annotation-drawer__header">
      <h2>Annotations</h2>
      <span class="annotation-drawer__count">{{ visibleAnnotations.length }}</span>
      <button type="button" class="annotation-drawer__close" data-testid="annotation-drawer-close" aria-label="Close annotations" @click="emit('close')">×</button>
    </div>
    <div class="annotation-drawer__body">
      <article
        v-for="annotation in visibleAnnotations"
        :key="annotation.id"
        :ref="(element) => setCardRef(annotation.id, element as Element | null)"
        class="annotation-card"
        :class="{ 'annotation-card--active': annotation.id === props.activeId, 'annotation-card--resolved': annotation.thread.resolved === 'resolved' }"
        :data-annotation-card="annotation.id"
        tabindex="0"
        @click="emit('select', annotation.id)"
      >
        <header class="annotation-card__header">
          <span>{{ annotation.thread.comments[0]?.author }}</span>
          <span v-if="annotation.thread.resolved === 'resolved'" class="annotation-card__status">Resolved</span>
          <span v-else-if="annotation.anchorResolution.status !== 'resolved'" class="annotation-card__status annotation-card__status--error">Cannot locate range</span>
          <button type="button" class="annotation-card__resolve" :data-annotation-resolve="annotation.id" @click.stop="emit('resolve', annotation.id, annotation.thread.resolved !== 'resolved')">
            {{ annotation.thread.resolved === 'resolved' ? 'Unresolve' : 'Resolve' }}
          </button>
        </header>
        <p class="annotation-card__anchor">{{ annotation.anchor.selectedText }}</p>
        <div class="annotation-card__comments">
          <p v-for="comment in annotation.thread.comments" :key="comment.id" class="annotation-card__comment">
            <strong>{{ comment.author }}</strong> {{ comment.body }}
          </p>
        </div>
        <textarea
          v-model="drafts[annotation.id]"
          class="annotation-card__reply"
          :data-annotation-reply="annotation.id"
          :placeholder="annotation.thread.resolved === 'resolved' ? 'Unresolve to reply' : 'Reply…'"
          :disabled="annotation.thread.resolved === 'resolved'"
          @keydown="onReplyKeydown($event, annotation)"
        />
      </article>
      <p v-if="visibleAnnotations.length === 0" class="annotation-drawer__empty">Select text and choose Add annotation.</p>
    </div>
    <span class="annotation-drawer__resize" data-testid="annotation-drawer-resize" role="separator" aria-label="Resize annotation drawer" @pointerdown="onResizePointerDown"></span>
    <svg v-if="connectorLines.length" class="annotation-connectors" aria-hidden="true">
      <line v-for="line in connectorLines" :key="line.id" :x1="line.x1" :y1="line.y1" :x2="line.x2" :y2="line.y2" />
    </svg>
  </aside>
</template>
