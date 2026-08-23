<script setup lang="ts">
// M16：单行文本输入弹窗（PromptDialog）——分支名等（复用 ConfirmDialog 骨架）
import { ref, nextTick, watch } from 'vue'
import { state } from '../state/store'

const value = ref('')

function onOk() {
  const v = value.value.trim()
  state.prompt?.resolve(v || null)
  state.prompt = null
}
function onCancel() {
  state.prompt?.resolve(null)
  state.prompt = null
}

// 每次打开预填 + 聚焦 + 全选
watch(
  () => state.prompt,
  async (v) => {
    if (!v) return
    value.value = v.value ?? ''
    await nextTick()
    const el = document.querySelector<HTMLInputElement>('.prompt-input')
    if (!el) return
    el.focus()
    if (value.value) el.select()
  }
)
</script>

<template>
  <Teleport to="body">
    <div v-if="state.prompt" class="modal-mask" @click.self="onCancel">
      <div class="modal" role="dialog" aria-modal="true">
        <h3>{{ state.prompt.title }}</h3>
        <input
          v-model="value"
          class="prompt-input"
          type="text"
          :placeholder="state.prompt.placeholder ?? ''"
          spellcheck="false"
          @keydown.enter.prevent="onOk"
          @keydown.esc.prevent="onCancel"
        />
        <div class="modal-actions">
          <button class="btn" @click="onCancel">取消</button>
          <button class="btn primary" @click="onOk">确定</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  background: var(--chrome-surface);
  color: var(--chrome-on-surface);
  border: 1px solid var(--chrome-border);
  border-radius: 12px;
  padding: 20px 24px;
  width: min(420px, 90vw);
  box-shadow: var(--chrome-shadow-2, 0 12px 40px rgba(0, 0, 0, 0.2));
}
.modal h3 {
  margin: 0 0 10px;
  font-size: 16px;
}
.prompt-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--chrome-border);
  background: var(--chrome-background);
  color: var(--chrome-on-surface);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.prompt-input:focus {
  border-color: var(--chrome-primary);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.btn {
  border: 1px solid var(--chrome-border);
  background: var(--chrome-background);
  color: var(--chrome-on-surface);
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
.btn:hover {
  background: var(--chrome-hover);
}
.btn.primary {
  background: var(--chrome-primary);
  color: var(--chrome-on-secondary, #fff);
  border-color: var(--chrome-primary);
}
</style>