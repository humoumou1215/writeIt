<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'

const props = defineProps<{ placeholder?: string }>()
const emit = defineEmits<{
  (e: 'commit', value: string): void
  (e: 'cancel'): void
}>()

const el = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  await nextTick()
  el.value?.focus()
})

function commit(e: Event) {
  emit('commit', (e.target as HTMLInputElement).value)
}
</script>

<template>
  <input
    ref="el"
    class="rename-input"
    :placeholder="props.placeholder"
    spellcheck="false"
    @keydown.enter.prevent="commit"
    @keydown.esc.prevent="emit('cancel')"
    @blur="commit"
  />
</template>

<style scoped>
.rename-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--chrome-primary);
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 13px;
  font-family: inherit;
  color: var(--chrome-on-surface);
  background: var(--chrome-background);
  outline: none;
}
</style>
