<script setup lang="ts">
// 诊断对话框（D2）：图标列 🩺 / 状态栏入口
// 用户只做三件事：可选填描述 → 勾选包含项（默认全开，取消即排除）→ 生成诊断包
// 「复制要点」次要按钮：环境摘要 + 最近异常 + 当前文件 → 剪贴板（微信先文字沟通）
import { ref, onBeforeUnmount } from 'vue'
import { generateDiagnosticPack, copyDiagnosticPoints, defaultDiagOptions, rememberDiagOptions, getLastDiagnosticResult, type GeneratePackOptions } from '../diagnostics'
import type { DiagnosticPackResult } from '../diagnostics/pack'

const emit = defineEmits<{ (e: 'close'): void }>()

const opts = ref<GeneratePackOptions>(defaultDiagOptions())
const notes = ref('我在 ____________ 时遇到 ____________，预期 ____________，实际 ____________')
/** 复制要点是否附带当前文档全文（默认关：要点应紧凑，全文体积大） */
const copyDoc = ref(false)
const busy = ref(false)
const stage = ref('')
const pct = ref(0)
const result = ref<DiagnosticPackResult | null>(getLastDiagnosticResult())

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && !busy.value) {
    emit('close')
  }
}
window.addEventListener('keydown', onKeydown, true)
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))

async function doGenerate() {
  if (busy.value) return
  busy.value = true
  result.value = null
  rememberDiagOptions(opts.value)
  const r = await generateDiagnosticPack(opts.value, notes.value, (s, p) => {
    stage.value = s
    pct.value = p
  })
  result.value = r
  busy.value = false
}

let copying = false
async function doCopy() {
  if (copying) return
  copying = true
  await copyDiagnosticPoints(opts.value, notes.value, copyDoc.value)
  copying = false
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-mask" @click.self="emit('close')">
      <div class="diag-modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>🩺 问题诊断</h3>
          <button class="close" @click="emit('close')" title="关闭 (Esc)">×</button>
        </div>

        <div class="modal-body">
          <p class="lead">
            遇到渲染 / 动画异常？点一下「生成诊断包」，应用会自动收集现场证据，发给开发者即可。
            <span class="sub">无需描述细节——证据会自动取证。</span>
          </p>

          <label class="field-label">问题描述（可选，便于开发者理解）</label>
          <textarea
            v-model="notes"
            class="notes"
            rows="2"
            spellcheck="false"
            placeholder="描述遇到的问题…"
          ></textarea>

          <div class="inc-head">将包含（取消勾选即不打包）</div>
          <div class="inc-list">
            <label class="inc-item">
              <input type="checkbox" v-model="opts.snapshot" />
              <span>📷 截图（当前界面）</span>
            </label>
            <label class="inc-item">
              <input type="checkbox" v-model="opts.dom" />
              <span>🧩 界面结构快照（渲染/动画状态）</span>
            </label>
            <label class="inc-item">
              <input type="checkbox" v-model="opts.doc" />
              <span>📄 当前文档内容</span>
            </label>
            <label class="inc-item">
              <input type="checkbox" v-model="opts.paths" />
              <span>📁 完整文件路径<span class="sub">（取消则文件名脱敏）</span></span>
            </label>
            <div class="inc-item locked">
              <span>🧭 操作轨迹 + ◆ 环境 / 设置 / 事件日志（恒包含，无害）</span>
            </div>
          </div>
        </div>

        <div class="modal-foot">
          <div class="foot-left">
            <label class="copy-doc-opt" title="复制要点时附带当前文档的 Markdown 全文（较长，仅按需勾选）">
              <input type="checkbox" v-model="copyDoc" />
              <span>复制要点附当前文档全文</span>
            </label>
            <p v-if="busy" class="progress">
              <span class="stage">{{ stage }}…</span>
              <span class="bar"><i :style="{ width: pct + '%' }"></i></span>
              {{ pct }}%
            </p>
            <p v-else-if="result?.ok" class="ok-line">
              ✅ 已生成：{{ result.filename }}<template v-if="result.savedPath"> → {{ result.savedPath }}</template>
            </p>
            <p v-else-if="result && !result.ok && result.error !== 'cancelled'" class="err-line">
              ❌ 生成失败：{{ result.error }}（可重试）
            </p>
          </div>
          <div class="foot-right">
            <button class="secondary" :disabled="busy" @click="doCopy">复制要点</button>
            <button class="primary" :disabled="busy" @click="doGenerate">
              {{ busy ? '生成中…' : '⚡ 生成诊断包' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  font-family: system-ui, sans-serif;
}
.diag-modal {
  width: 560px;
  max-width: 92vw;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--chrome-surface, #fff);
  color: var(--chrome-on-surface, #1a1a1a);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.35);
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--chrome-outline, #ddd);
}
.modal-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.close {
  border: none;
  background: none;
  font-size: 18px;
  cursor: pointer;
  color: inherit;
  opacity: 0.6;
  padding: 2px 8px;
  border-radius: 6px;
}
.close:hover { opacity: 1; background: var(--chrome-hover, #eee); }
.modal-body {
  padding: 14px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lead { margin: 0; font-size: 13px; line-height: 1.55; }
.sub { color: var(--chrome-on-surface-variant, #666); font-size: 12px; }
.field-label { font-size: 12px; color: var(--chrome-on-surface-variant, #666); }
.notes {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--chrome-outline, #ccc);
  background: var(--chrome-background, #fafafa);
  color: inherit;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
}
.inc-head { font-size: 12px; font-weight: 600; margin-top: 2px; }
.inc-list { display: flex; flex-direction: column; gap: 4px; }
.inc-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}
.inc-item:hover { background: var(--chrome-hover, #eee); }
.inc-item input { margin: 0; accent-color: var(--chrome-primary, #6750a4); }
.inc-item.locked { cursor: default; color: var(--chrome-on-surface-variant, #666); }
.inc-item.locked:hover { background: none; }
.modal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--chrome-outline, #ddd);
}
.foot-left { min-width: 0; flex: 1; }
.copy-doc-opt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--chrome-on-surface-variant, #666);
  cursor: pointer;
  user-select: none;
  margin-bottom: 4px;
}
.copy-doc-opt input { margin: 0; accent-color: var(--chrome-primary, #6750a4); }
.progress { margin: 0; font-size: 12px; display: flex; align-items: center; gap: 8px; }
.progress .stage { color: var(--chrome-on-surface-variant, #666); }
.progress .bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--chrome-hover, #eee);
  overflow: hidden;
  min-width: 60px;
}
.progress .bar i { display: block; height: 100%; background: var(--chrome-primary, #6750a4); transition: width 0.2s; }
.ok-line { margin: 0; font-size: 12px; color: #2e7d32; word-break: break-all; }
.err-line { margin: 0; font-size: 12px; color: var(--chrome-error, #ba1a1a); }
.foot-right { display: flex; gap: 8px; }
button {
  border-radius: 8px;
  border: 1px solid var(--chrome-outline, #ccc);
  background: var(--chrome-background, #fafafa);
  color: inherit;
  font-size: 13px;
  padding: 7px 14px;
  cursor: pointer;
}
button:hover:not(:disabled) { background: var(--chrome-hover, #eee); }
button.primary {
  background: var(--chrome-primary, #6750a4);
  border-color: transparent;
  color: var(--chrome-on-primary, #fff);
  font-weight: 600;
}
button.primary:hover:not(:disabled) { filter: brightness(1.08); }
button:disabled { opacity: 0.55; cursor: default; }
</style>