<script setup lang="ts">
// 基于模板新建：选择模板（TemplateService 注册表），随后进入文件名输入
import { ref } from 'vue'
import { templateService } from '../template/service'
import type { Template } from '../template/types'

const emit = defineEmits<{
  (e: 'pick', doctype: string): void
  (e: 'close'): void
}>()

const templates = ref<Template[]>(templateService.list())

function pick(tpl: Template) {
  // 目标目录由 App.onTemplatePicked 读取并清除
  emit('pick', tpl.doctype)
}

function close() {
  state.templatePick = null
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="tpl-mask" @click.self="close">
      <div class="tpl-picker" role="dialog" aria-modal="true">
        <div class="tpl-head">
          <h3>基于模板新建</h3>
          <button class="close" @click="close" title="关闭 (Esc)">×</button>
        </div>
        <p class="tpl-hint">选择模板：新文件将继承模板内容与 doctype（关联校验/联想规则）</p>
        <div class="tpl-list">
          <button
            v-for="tpl in templates"
            :key="tpl.doctype"
            class="tpl-item"
            @click="pick(tpl)"
          >
            <span class="tpl-name">{{ tpl.name }}</span>
            <span class="tpl-meta">{{ tpl.domain === 'global' ? '全局' : '工作区' }} · {{ tpl.doctype }}</span>
          </button>
        </div>
        <div v-if="!templates.length" class="tpl-empty">
          暂无模板 —— 在工作区创建 <code>template/&lt;名称&gt;/&lt;名称&gt;.md</code>（首行 doctype:名称）
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tpl-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}
.tpl-picker {
  width: 380px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--chrome-surface, #fff);
  color: var(--chrome-on-surface, #1f2329);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  padding: 16px;
}
.tpl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tpl-head h3 {
  margin: 0;
  font-size: 16px;
}
.close {
  border: none;
  background: transparent;
  font-size: 20px;
  cursor: pointer;
  color: var(--chrome-on-surface-variant, #8a8f99);
}
.tpl-hint {
  margin: 8px 0 12px;
  font-size: 12px;
  color: var(--chrome-on-surface-variant, #8a8f99);
}
.tpl-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}
.tpl-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid var(--chrome-border, #e5e6eb);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.tpl-item:hover {
  background: var(--chrome-hover, #f2f3f5);
}
.tpl-name {
  font-size: 14px;
  font-weight: 500;
}
.tpl-meta {
  font-size: 11px;
  color: var(--chrome-on-surface-variant, #8a8f99);
}
.tpl-empty {
  padding: 20px;
  font-size: 12px;
  color: var(--chrome-on-surface-variant, #8a8f99);
  text-align: center;
}
code {
  background: var(--chrome-inline-code, rgba(0, 0, 0, 0.06));
  padding: 1px 5px;
  border-radius: 4px;
}
</style>
