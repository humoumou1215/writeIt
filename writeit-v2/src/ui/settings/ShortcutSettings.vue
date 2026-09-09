<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  formatKeybindingInput,
  type KeybindingConflict,
} from '../../application/commands'
import type { ShortcutSettingsEntry } from '../../application/commands/shortcut-settings'

defineOptions({ name: 'ShortcutSettings' })

const props = defineProps<{
  entries: readonly ShortcutSettingsEntry[]
  error?: string | null
  conflicts?: readonly KeybindingConflict[]
}>()

const emit = defineEmits<{
  (event: 'set', commandId: string, keybinding: string | null): void
  (event: 'reset', commandId: string): void
  (event: 'reset-all'): void
}>()

const search = ref('')
const recordingCommandId = ref<string | null>(null)

function normalizedSearch(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim()
}

const visibleEntries = computed(() => {
  const query = normalizedSearch(search.value)
  if (query.length === 0) return props.entries

  return props.entries.filter((entry) =>
    normalizedSearch(
      [
        entry.commandId,
        entry.label,
        entry.group,
        entry.description ?? '',
        ...entry.keywords,
      ].join(' '),
    ).includes(query),
  )
})

const groups = computed(() => {
  const grouped = new Map<string, ShortcutSettingsEntry[]>()
  for (const entry of visibleEntries.value) {
    const entries = grouped.get(entry.group) ?? []
    entries.push(entry)
    grouped.set(entry.group, entries)
  }
  return [...grouped].map(([name, entries]) => ({
    name,
    entries,
  }))
})

function beginRecording(commandId: string): void {
  recordingCommandId.value = commandId
}

function stopRecording(): void {
  recordingCommandId.value = null
}

function recordKeydown(commandId: string, event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()

  if (event.key === 'Escape') {
    stopRecording()
    return
  }

  const keybinding = formatKeybindingInput(event)
  if (keybinding === undefined) return

  emit('set', commandId, keybinding)
  stopRecording()
}

function clearBinding(commandId: string): void {
  stopRecording()
  emit('set', commandId, null)
}

function resetBinding(commandId: string): void {
  stopRecording()
  emit('reset', commandId)
}
</script>

<template>
  <section class="shortcut-settings" data-testid="shortcut-settings" aria-labelledby="shortcut-settings-title">
    <div class="shortcut-settings__header">
      <div>
        <p class="workspace-eyebrow">快捷键</p>
        <h3 id="shortcut-settings-title">快捷键设置</h3>
      </div>
      <button
        type="button"
        class="shortcut-settings__reset-all"
        data-testid="shortcut-reset-all"
        @click="emit('reset-all')"
      >
        恢复默认
      </button>
    </div>

    <p class="shortcut-settings__description">
      自定义命令不会修改 Markdown 文档；发生快捷键冲突时，整次修改会被拒绝。
    </p>

    <label class="shortcut-settings__search" for="shortcut-search">
      <span>筛选命令</span>
      <input
        id="shortcut-search"
        v-model="search"
        type="search"
        data-testid="shortcut-search"
        placeholder="搜索命令"
      />
    </label>

    <p v-if="props.error" class="shortcut-settings__error" data-testid="shortcut-error" role="alert">
      {{ props.error }}
    </p>
    <ul v-if="props.conflicts && props.conflicts.length > 0" class="shortcut-settings__conflicts" data-testid="shortcut-conflicts">
      <li v-for="conflict in props.conflicts" :key="conflict.keybinding">
        {{ conflict.keybinding }}: {{ conflict.commandIds.join(', ') }}
      </li>
    </ul>

    <p v-if="groups.length === 0" class="shortcut-settings__empty" data-testid="shortcut-empty">
      没有匹配的命令。
    </p>
    <div v-else class="shortcut-settings__groups">
      <section
        v-for="group in groups"
        :key="group.name"
        class="shortcut-settings__group"
        :aria-labelledby="`shortcut-group-${group.name}`"
      >
        <h4 :id="`shortcut-group-${group.name}`">{{ group.name }}</h4>
        <div
          v-for="entry in group.entries"
          :key="entry.commandId"
          class="shortcut-row"
          :data-shortcut-command="entry.commandId"
        >
          <div class="shortcut-row__details">
            <strong>{{ entry.label }}</strong>
            <span>{{ entry.description }}</span>
            <code>{{ entry.commandId }}</code>
          </div>
          <div class="shortcut-row__controls">
            <kbd
              class="shortcut-row__binding"
              :class="{ 'shortcut-row__binding--empty': !entry.keybinding }"
              data-testid="shortcut-current"
            >{{ entry.keybinding ?? '未分配' }}</kbd>
            <button
              type="button"
              class="shortcut-row__record"
              :class="{ 'shortcut-row__record--recording': recordingCommandId === entry.commandId }"
              :aria-pressed="recordingCommandId === entry.commandId"
              :aria-label="recordingCommandId === entry.commandId ? `正在录制${entry.label}的快捷键` : `录制${entry.label}的快捷键`"
              data-testid="shortcut-record"
              @click="recordingCommandId === entry.commandId ? stopRecording() : beginRecording(entry.commandId)"
              @keydown="recordKeydown(entry.commandId, $event)"
            >
              {{ recordingCommandId === entry.commandId ? '请按下按键…' : '录制' }}
            </button>
            <button
              type="button"
              class="shortcut-row__action"
              :aria-label="`清除${entry.label}的快捷键`"
              data-testid="shortcut-clear"
              :disabled="!entry.keybinding"
              @click="clearBinding(entry.commandId)"
            >
              清除
            </button>
            <button
              type="button"
              class="shortcut-row__action"
              :aria-label="`恢复${entry.label}的默认快捷键`"
              data-testid="shortcut-reset"
              :disabled="!entry.customized"
              @click="resetBinding(entry.commandId)"
            >
              重置
            </button>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>
