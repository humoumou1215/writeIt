<script setup lang="ts">
import { state } from '../state/store'

function onOk() {
  state.confirm?.resolve(true)
  state.confirm = null
}
function onCancel() {
  state.confirm?.resolve(false)
  state.confirm = null
}
</script>

<template>
  <Teleport to="body">
    <div v-if="state.confirm" class="modal-mask" @click.self="onCancel">
      <div class="modal" role="dialog" aria-modal="true">
        <h3>{{ state.confirm.title }}</h3>
        <p>{{ state.confirm.message }}</p>
        <div class="modal-actions">
          <button class="btn" @click="onCancel">取消</button>
          <button
            class="btn"
            :class="state.confirm.danger ? 'danger' : 'primary'"
            @click="onOk"
          >
            {{ state.confirm.confirmText ?? '确定' }}
          </button>
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
  margin: 0 0 8px;
  font-size: 16px;
  color: var(--chrome-on-surface);
}
.modal p {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--chrome-on-surface-variant);
  line-height: 1.6;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
.btn.primary:hover {
  opacity: 0.9;
}
.btn.danger {
  background: var(--chrome-error, #ba1a1a);
  color: var(--chrome-on-secondary, #fff);
  border-color: var(--chrome-error, #ba1a1a);
}
.btn.danger:hover {
  opacity: 0.9;
}
</style>
