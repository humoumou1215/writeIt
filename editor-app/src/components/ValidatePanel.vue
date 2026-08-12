<script setup lang="ts">
// 校验聚合面板（设计文档 §5.2 通道②）：列出活动标签的全部违规，点击跳转到位置。
// 浮动在主区域右下角；空结果显示「✓ 无违规」；无 doctype 显示引导提示。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { state } from '../state/store'
import {
  getValidationResult,
  subscribeValidation,
  type ValidationResult,
} from '../validate/service'

const collapsed = ref(false)
const result = ref<ValidationResult | null>(null)

const activeTabId = computed(() => state.activeTabId)

function refresh() {
  const id = state.activeTabId
  result.value = id ? getValidationResult(id) : null
}

let unsub: (() => void) | null = null
onMounted(() => {
  unsub = subscribeValidation(() => {
    // 只刷新活动标签的结果（结果按 tabId 存储）
    const id = state.activeTabId
    result.value = id ? getValidationResult(id) : null
  })
  refresh()
})
onBeforeUnmount(() => unsub?.())

watch(activeTabId, refresh)

const errorCount = computed(
  () => result.value?.violations.filter((v) => v.level === 'error').length ?? 0
)
const warningCount = computed(
  () => result.value?.violations.filter((v) => v.level === 'warning').length ?? 0
)
const hasDoctype = computed(() => result.value?.doctype != null)
const failed = computed(() => result.value?.failed ?? false)

async function jump(pos: number) {
  if (!state.activeTabId) return
  const { scrollToPos } = await import('../editor/manager')
  scrollToPos(state.activeTabId, pos)
}

async function onRefresh() {
  const { refreshValidation } = await import('../editor/manager')
  await refreshValidation()
}

function levelIcon(level: string) {
  return level === 'error' ? '⛔' : '⚠'
}
</script>

<template>
  <div v-if="state.activeTabId" class="validate-panel" :class="{ collapsed }">
    <div class="vp-head" @click="collapsed = !collapsed" title="点击折叠/展开">
      <span class="vp-title">校验</span>
      <span v-if="result && !failed && hasDoctype" class="vp-counts">
        <span v-if="errorCount" class="err">{{ errorCount }} 错误</span>
        <span v-if="warningCount" class="warn">{{ warningCount }} 警告</span>
        <span v-if="!errorCount && !warningCount" class="ok">✓ 无违规</span>
      </span>
      <span v-if="result && !failed && !hasDoctype" class="vp-none">无 doctype</span>
      <span v-if="failed" class="err">服务异常</span>
      <button class="mini" title="重新校验" @click.stop="onRefresh">⟳</button>
      <span class="vp-arrow">{{ collapsed ? '▲' : '▼' }}</span>
    </div>
    <div v-show="!collapsed" class="vp-body">
      <template v-if="failed">
        <div class="vp-msg">校验服务异常，已降级（不影响编辑/保存）。</div>
      </template>
      <template v-else-if="!hasDoctype">
        <div class="vp-msg">
          当前文件无 doctype，未关联校验规则。
          <br />从模板新建文件即自动关联（如 周报 模板）。
        </div>
      </template>
      <template v-else-if="result && result.violations.length">
        <div class="vp-item" v-for="(v, i) in result.violations" :key="i" @click="v.pos != null && jump(v.pos)">
          <span class="vp-ic" :class="v.level">{{ levelIcon(v.level) }}</span>
          <span class="vp-text">
            {{ v.message }}
            <span class="vp-rule">{{ v.label }}</span>
          </span>
          <span v-if="v.pos != null" class="vp-jump">跳转 ›</span>
        </div>
      </template>
      <template v-else>
        <div class="vp-msg ok">✓ 未发现违规（模式：{{ result?.mode ?? 'hint' }}）</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.validate-panel {
  position: fixed;
  right: 14px;
  bottom: 30px;
  z-index: 50;
  max-width: 420px;
  min-width: 260px;
  border-radius: 8px;
  background: var(--chrome-panel-bg, #ffffff);
  border: 1px solid var(--chrome-border, #d0d0d0);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  font-size: 12px;
  overflow: hidden;
}
.vp-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  border-bottom: 1px solid var(--chrome-border, #d0d0d0);
  user-select: none;
}
.vp-title {
  font-weight: 600;
}
.vp-counts {
  display: flex;
  gap: 6px;
  margin-left: auto;
  font-weight: 600;
}
.err {
  color: #d9534f;
}
.warn {
  color: #e6a23c;
}
.ok {
  color: #4caf50;
}
.vp-none {
  margin-left: auto;
  color: #999;
}
.vp-head .mini {
  margin-left: auto;
  padding: 1px 5px;
  cursor: pointer;
}
.vp-arrow {
  font-size: 10px;
  color: #888;
}
.vp-body {
  max-height: 240px;
  overflow-y: auto;
}
.vp-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 5px 8px;
  cursor: pointer;
  border-bottom: 1px solid var(--chrome-border-light, #eee);
}
.vp-item:hover {
  background: var(--chrome-hover-bg, #f0f0f0);
}
.vp-ic {
  flex: none;
}
.vp-text {
  flex: 1;
  word-break: break-all;
}
.vp-rule {
  display: block;
  color: #888;
  font-size: 11px;
}
.vp-jump {
  flex: none;
  color: var(--chrome-accent, #3a6ea5);
  font-size: 11px;
}
.vp-msg {
  padding: 8px;
  color: #888;
  line-height: 1.5;
}
</style>
