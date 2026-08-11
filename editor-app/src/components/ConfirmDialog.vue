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
  background: var(--chrome-surface, #fff);
  color: var(--chrome-on-surface, #1f2329);
  border: 1px solid var(--chrome-border, #e5e6eb);
  border-radius: 12px;
  padding: 20px 24px;
  width: min(420px, 90vw);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}
.modal h3 {
  margin: 0 0 8px;
  font-size: 16px;
}
.modal p {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--chrome-on-surface-variant, #4e5969);
  line-height: 1.6;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
