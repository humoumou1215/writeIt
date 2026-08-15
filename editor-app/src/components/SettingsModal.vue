<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import {
  settings,
  applyTheme,
  saveSettings,
  THEMES,
  SHORTCUT_DEFS,
  formatCombo,
} from '../state/settings'
import { fs } from '../fs'
import { refreshTree, openDirectory } from '../editor/manager'
import { toast } from '../state/store'

const emit = defineEmits<{ (e: 'close'): void }>()

const tab = ref<'general' | 'shortcuts'>('general')
const recording = ref<string | null>(null)
const recordEl = ref<HTMLInputElement | null>(null)

// ---------- 常规页 ----------
function onThemeChange() {
  applyTheme(settings.theme)
  saveSettings()
}
function onTemplateDirChange() {
  saveSettings()
  // 重新扫描模板注册表（已打开的编辑器菜单不刷新，重开标签生效）
  void import('../template/service').then((m) => m.templateService.rescan())
}
function onSettingChange() {
  saveSettings()
  refreshTree()
}
async function openLocalDir() {
  await openDirectory()
}

// ---------- 快捷键页 ----------
function startRecord(id: string) {
  recording.value = id
  // 输入框自带 autofocus，无需手动聚焦
}

function onRecordKey(e: KeyboardEvent) {
  if (!recording.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    recording.value = null
    return
  }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    settings.shortcuts[recording.value] = ''
    recording.value = null
    saveSettings()
    return
  }
  const combo = formatCombo(e)
  if (!combo) return
  const conflict = SHORTCUT_DEFS.find(
    (d) => d.id !== recording.value && settings.shortcuts[d.id] === combo
  )
  if (conflict) {
    toast(`快捷键冲突：已用于「${conflict.label}」`, 'error')
    return
  }
  settings.shortcuts[recording.value] = combo
  recording.value = null
  saveSettings()
}

function resetOne(id: string) {
  const def = SHORTCUT_DEFS.find((d) => d.id === id)
  if (def) {
    settings.shortcuts[id] = def.default
    saveSettings()
  }
}
function resetAll() {
  for (const def of SHORTCUT_DEFS) settings.shortcuts[def.id] = def.default
  saveSettings()
}

// ---------- 关闭（Esc）----------
function onModalKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !recording.value) emit('close')
}
onMounted(() => window.addEventListener('keydown', onModalKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onModalKey))
</script>

<template>
  <Teleport to="body">
    <div class="modal-mask" @click.self="emit('close')">
      <div class="settings-modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>设置</h3>
          <div class="tabs">
            <button class="tab-btn" :class="{ active: tab === 'general' }" @click="tab = 'general'">
              常规
            </button>
            <button class="tab-btn" :class="{ active: tab === 'shortcuts' }" @click="tab = 'shortcuts'">
              快捷键
            </button>
          </div>
          <button class="close" @click="emit('close')" title="关闭 (Esc)">×</button>
        </div>

        <!-- ===== 常规 ===== -->
        <div v-if="tab === 'general'" class="modal-body">
          <label class="row">
            <span>主题</span>
            <select v-model="settings.theme" @change="onThemeChange">
              <option v-for="t in THEMES" :key="t.id" :value="t.id">{{ t.label }}</option>
            </select>
          </label>

          <label class="row">
            <span>自动保存</span>
            <input type="checkbox" v-model="settings.autoSave" @change="onSettingChange" />
          </label>

          <label class="row" v-if="settings.autoSave">
            <span>自动保存延迟</span>
            <select v-model.number="settings.autoSaveDelay" @change="onSettingChange">
              <option :value="1000">1 秒</option>
              <option :value="2000">2 秒</option>
              <option :value="5000">5 秒</option>
              <option :value="10000">10 秒</option>
            </select>
          </label>

          <label class="row">
            <span>显示所有文件</span>
            <input type="checkbox" v-model="settings.showAllFiles" @change="onSettingChange" />
          </label>

          <label class="row">
            <span>固定侧边栏</span>
            <input type="checkbox" v-model="settings.sidebarPinned" @change="saveSettings" />
            <em class="hint-inline">固定后打开文件不自动收纳</em>
          </label>

          <label class="row">
            <span>全局模板目录</span>
            <input
              v-model="settings.templateDir"
              class="tpl-dir-input"
              placeholder="工作区外模板目录（v1 仅 Tauri 生效）"
              spellcheck="false"
              @change="onTemplateDirChange"
            />
          </label>
          <p class="hint">模板目录结构：template/&lt;名称&gt;/&lt;名称&gt;.md（首行 doctype:名称）</p>

          <div class="row">
            <span>文件系统</span>
            <span class="badge">{{ fs.kind }}</span>
          </div>

          <button class="btn full" @click="openLocalDir">📂 打开本地目录…</button>
          <p class="hint">
            {{
              fs.kind === 'tauri'
                ? 'Tauri 原生文件访问（独立应用模式）。'
                : fs.kind === 'web'
                  ? '浏览器 File System Access API（Chrome/Edge），可打开真实目录。'
                  : '浏览器模拟文件系统（Demo），修改保存在 localStorage。'
            }}
          </p>
        </div>

        <!-- ===== 快捷键 ===== -->
        <div v-else class="modal-body">
          <p class="hint" style="margin-top: 0">
            点击按键后按下新组合键；Backspace 清除；Esc 取消。
          </p>
          <div class="shortcut-list">
            <div v-for="def in SHORTCUT_DEFS" :key="def.id" class="shortcut-row">
              <span class="shortcut-label">{{ def.label }}</span>
              <input
                v-if="recording === def.id"
                ref="recordEl"
                class="keycapture"
                placeholder="按下新快捷键…"
                autofocus
                @keydown="onRecordKey"
                @blur="recording = null"
              />
              <button v-else class="keybtn" @click="startRecord(def.id)">
                {{ settings.shortcuts[def.id] || '未设置' }}
              </button>
              <button
                class="reset"
                title="恢复默认"
                :disabled="settings.shortcuts[def.id] === def.default"
                @click="resetOne(def.id)"
              >
                ↺
              </button>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn" @click="resetAll">恢复全部默认</button>
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
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.settings-modal {
  background: var(--chrome-surface);
  color: var(--chrome-on-surface);
  border: 1px solid var(--chrome-border);
  border-radius: 12px;
  width: min(560px, 92vw);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--chrome-shadow-2, 0 16px 48px rgba(0, 0, 0, 0.22));
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px 0;
}
.modal-head h3 {
  margin: 0;
  font-size: 15px;
  color: var(--chrome-on-surface);
}
.tabs {
  display: flex;
  gap: 4px;
  background: var(--chrome-hover);
  border-radius: 8px;
  padding: 3px;
}
.tab-btn {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  padding: 5px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
.tab-btn.active {
  background: var(--chrome-background);
  color: var(--chrome-on-background);
  box-shadow: var(--chrome-shadow-1, 0 1px 3px rgba(0, 0, 0, 0.12));
}
.close {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 20px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.close:hover {
  background: var(--chrome-hover);
  color: var(--chrome-on-background);
}
.modal-body {
  padding: 16px 18px 18px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.row > span:first-child {
  min-width: 96px;
  color: var(--chrome-on-surface);
}
.hint-inline {
  font-style: normal;
  font-size: 11px;
  color: var(--chrome-on-surface-variant);
}
select,
.tpl-dir-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--chrome-border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
  color: var(--chrome-on-surface);
  background: var(--chrome-background);
}
input[type='checkbox'] {
  accent-color: var(--chrome-primary);
}
select {
  border: 1px solid var(--chrome-border);
  background: var(--chrome-background);
  color: var(--chrome-on-surface);
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 12px;
  font-family: inherit;
}
.badge {
  font-size: 11px;
  background: var(--chrome-selected);
  color: var(--chrome-on-surface);
  padding: 2px 8px;
  border-radius: 999px;
}
.btn {
  border: 1px solid var(--chrome-border);
  background: var(--chrome-background);
  color: var(--chrome-on-surface);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
.btn:hover {
  background: var(--chrome-hover);
  border-color: var(--chrome-primary);
}
.btn.full {
  width: 100%;
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--chrome-on-surface-variant);
  line-height: 1.6;
}
.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.shortcut-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.shortcut-label {
  flex: 1;
  font-size: 13px;
  color: var(--chrome-on-surface);
}
.keybtn {
  min-width: 150px;
  border: 1px solid var(--chrome-border);
  background: var(--chrome-background);
  color: var(--chrome-on-surface);
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 12px;
  font-family: var(--chrome-font-code, monospace);
  cursor: pointer;
  text-align: center;
}
.keybtn:hover {
  border-color: var(--chrome-primary);
}
.keycapture {
  min-width: 150px;
  border: 1px solid var(--chrome-primary);
  background: var(--chrome-selected);
  color: var(--chrome-on-surface);
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 12px;
  font-family: inherit;
  outline: none;
}
.reset {
  border: none;
  background: transparent;
  color: var(--chrome-on-surface-variant);
  font-size: 15px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}
.reset:hover:not(:disabled) {
  background: var(--chrome-hover);
  color: var(--chrome-on-background);
}
.reset:disabled {
  opacity: 0.35;
  cursor: default;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
