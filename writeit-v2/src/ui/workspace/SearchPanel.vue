<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SearchFileResult } from '../../core/search'

const props = withDefaults(defineProps<{
  results?: readonly SearchFileResult[]
  query?: string
  caseSensitive?: boolean
  error?: string | null
  replaceText?: string
}>(), { results: () => [], query: '', caseSensitive: false, error: null })

const emit = defineEmits<{
  (event: 'search', query: { text: string; caseSensitive: boolean; useRegex: boolean }): void
  (event: 'select', path: string, from: number, to: number): void
  (event: 'replace', path: string, from: number, to: number, replacement: string): void
  (event: 'replace-all', replacement: string): void
}>()

const text = ref(props.query)
const caseSensitive = ref(props.caseSensitive)
const useRegex = ref(false)
const replacement = ref(props.replaceText ?? '')
const matchCount = computed(() => props.results.reduce((count, file) => count + file.matches.length, 0))

function submit(): void {
  if (!text.value.trim()) return
  emit('search', { text: text.value, caseSensitive: caseSensitive.value, useRegex: useRegex.value })
}
</script>

<template>
  <section class="search-panel" data-testid="search-panel" aria-label="Search workspace">
    <form class="search-panel__form" @submit.prevent="submit">
      <label for="workspace-search-query">Find in workspace</label>
      <input id="workspace-search-query" v-model="text" data-testid="search-query" placeholder="Search Markdown" />
      <div class="search-panel__options">
        <label><input v-model="caseSensitive" type="checkbox" data-testid="search-case-sensitive" /> Case sensitive</label>
        <label><input v-model="useRegex" type="checkbox" data-testid="search-regex" /> Regex</label>
        <button type="submit" data-testid="search-submit">Search</button>
      </div>
    </form>
    <div class="search-panel__replace">
      <label for="workspace-search-replacement">Replace with</label>
      <input id="workspace-search-replacement" v-model="replacement" data-testid="search-replacement" placeholder="Replacement" />
      <button type="button" data-testid="search-replace-all" :disabled="matchCount === 0" @click="emit('replace-all', replacement)">Replace all</button>
    </div>
    <p v-if="props.error" class="search-panel__error" data-testid="search-error">{{ props.error }}</p>
    <p v-else class="search-panel__summary">{{ matchCount }} match{{ matchCount === 1 ? '' : 'es' }}</p>
    <ul class="search-panel__results" aria-label="Search results">
      <li v-for="file in props.results" :key="file.path">
        <strong>{{ file.path }}</strong>
        <div v-for="match in file.matches" :key="`${match.from}-${match.to}`" class="search-panel__match">
          <button type="button" :data-search-match="`${file.path}:${match.from}`" @click="emit('select', file.path, match.from, match.to)">
            {{ match.line }}:{{ match.column }} · {{ match.preview }}
          </button>
          <button type="button" data-testid="search-replace-one" @click="emit('replace', file.path, match.from, match.to, replacement)">Replace</button>
        </div>
      </li>
    </ul>
  </section>
</template>
