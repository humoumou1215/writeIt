<script setup lang="ts">
// 剪贴板授权申请弹窗（D2「复制要点」被浏览器/WebView 拦截时弹出）
//  ①「授权并复制」→ 新用户手势内重试 Async Clipboard API（触发系统授权询问）
//  ②「复制选中文本」→ 对已选中的 textarea 走 execCommand('copy')（无需授权路径）
//  ③ 文本默认全选 → 兜底 Ctrl/Cmd + C 手动复制
import { ref, watch, nextTick } from 'vue'
import { state, toast, closeClipboardAuth } from '../state/store'
import { writeClipboardText, clipboardWritePermission } from '../clipboard'

const textRef = ref<HTMLTextAreaElement | null>(null)
const busy = ref(false)
const failed = ref(false)
const permState = ref<PermissionState | null>(null)

watch(
  () => state.clipboardAuth,
  async (req) => {
    if (!req) return
    failed.value = false
    busy.value = false
    permState.value = await clipboardWritePermission()
    await nextTick()
    const ta = textRef.value
    if (ta) {
      ta.focus()
      ta.select()
      ta.setSelectionRange(0, req.text.length)
    }
  }
)

/** 新用户手势内重试标准 API → 浏览器/WebView 会弹出剪贴板授权询问 */
async function doAuthorizeCopy() {
  const req = state.clipboardAuth
  if (!req || busy.value) return
  busy.value = true
  failed.value = false
  const ok = await writeClipboardText(req.text)
  busy.value = false
  if (ok) {
    toast('诊断要点已复制到剪贴板', 'success')
    closeClipboardAuth(true)
  } else {
    failed.value = true
  }
}

/** 对已全选的 textarea 走旧式 execCommand 复制（不依赖 async clipboard 授权） */
function doLegacyCopy() {
  const req = state.clipboardAuth
  const ta = textRef.value
  if (!req || !ta) return
  ta.focus()
  ta.select()
  ta.setSelectionRange(0, req.text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  if (ok) {
    toast('诊断要点已复制到剪贴板', 'success')
    closeClipboardAuth(true)
  } else {
    failed.value = true
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="state.clipboardAuth" class="clip-mask" @click.self="closeClipboardAuth(false)">
      <div class="clip-modal" role="dialog" aria-modal="true">
        <h3>🔐 剪贴板授权申请</h3>
        <p class="lead">
          浏览器/系统未授权剪贴板写入，「复制要点」被拦截。
          点击「授权并复制」会再次发起系统授权询问；授权通过后即可直接复制到剪贴板。
        </p>
        <p v-if="permState === 'denied'" class="hint warn">
          剪贴板权限此前已被拒绝：请点击浏览器地址栏的权限图标（或浏览器设置）允许本应用写入剪贴板后重试。
        </p>
        <textarea
          ref="textRef"
          readonly
          class="payload"
          spellcheck="false"
          :value="state.clipboardAuth.text"
        ></textarea>
        <p class="hint">下方文本已全选 —— 也可以直接按 Ctrl/Cmd + C 手动复制。</p>
        <p v-if="failed" class="hint warn">
          仍被拦截：请使用下方已选中的文本手动 Ctrl/Cmd + C 复制；或直接「生成诊断包」发送完整现场。
        </p>
        <div class="actions">
          <button class="btn" @click="closeClipboardAuth(false)">关闭</button>
          <button class="btn" :disabled="busy" @click="doLegacyCopy">复制选中文本</button>
          <button class="btn primary" :disabled="busy" @click="doAuthorizeCopy">
            {{ busy ? '请稍候…' : '授权并复制' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.clip-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1300;
}
.clip-modal {
  background: var(--chrome-surface, #fff);
  color: var(--chrome-on-surface, #1a1a1a);
  border: 1px solid var(--chrome-border, #ddd);
  border-radius: 12px;
  padding: 18px 22px;
  width: min(520px, 90vw);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.clip-modal h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--chrome-on-surface-variant, #555);
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--chrome-on-surface-variant, #666);
}
.hint.warn {
  color: var(--chrome-error, #ba1a1a);
}
.payload {
  width: 100%;
  box-sizing: border-box;
  min-height: 120px;
  max-height: 40vh;
  border: 1px solid var(--chrome-border, #ccc);
  background: var(--chrome-background, #fafafa);
  color: inherit;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  font-family: ui-monospace, monospace;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.btn {
  border: 1px solid var(--chrome-border, #ccc);
  background: var(--chrome-background, #fafafa);
  color: inherit;
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
.btn:hover:not(:disabled) {
  background: var(--chrome-hover, #eee);
}
.btn.primary {
  background: var(--chrome-primary, #6750a4);
  color: var(--chrome-on-primary, #fff);
  border-color: transparent;
  font-weight: 600;
}
.btn.primary:hover:not(:disabled) {
  filter: brightness(1.08);
}
.btn:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
