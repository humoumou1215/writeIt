<script setup lang="ts">
import { state } from '../state/store'
import { settings, applyTheme, saveSettings, THEMES } from '../state/settings'
import { fs } from '../fs'
import { refreshTree, openDirectory } from '../editor/manager'

function onThemeChange() {
  applyTheme(settings.theme)
  saveSettings()
}

function onSettingChange() {
  saveSettings()
  refreshTree()
}

async function openLocalDir() {
  await openDirectory()
}
</script>

<template>
  <div class="panel-wrap">
    <div class="panel">
      <h3>设置</h3>

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

      <div class="row">
        <span>文件系统</span>
        <span class="badge">{{ fs.kind }}</span>
      </div>

      <button class="btn full" @click="openLocalDir">📂 打开本地目录…</button>
      <p class="hint">
        {{ fs.kind === 'tauri'
          ? 'Tauri 原生文件访问（独立应用模式）。'
          : fs.kind === 'web'
            ? '浏览器 File System Access API（Chrome/Edge），可打开真实目录。'
            : '浏览器模拟文件系统（Demo），修改保存在 localStorage。' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.panel-wrap {
  position: relative;
}
.panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 260px;
  background: var(--chrome-surface, #fff);
  color: var(--chrome-on-surface, #1f2329);
  border: 1px solid var(--chrome-border, #e5e6eb);
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.16);
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
h3 {
  margin: 0;
  font-size: 14px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  gap: 8px;
}
select,
input[type='checkbox'] {
  accent-color: var(--chrome-primary, #f5b301);
}
select {
  border: 1px solid var(--chrome-border, #d0d3d9);
  background: var(--chrome-background, #fff);
  color: inherit;
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 12px;
  font-family: inherit;
}
.badge {
  font-size: 11px;
  background: var(--chrome-selected, #e8f3ff);
  color: var(--chrome-on-background, #1f2329);
  padding: 2px 8px;
  border-radius: 999px;
}
.btn {
  border: 1px solid var(--chrome-border, #d0d3d9);
  background: var(--chrome-background, #fff);
  color: inherit;
  border-radius: 7px;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
.btn:hover {
  background: var(--chrome-hover, #f2f3f5);
}
.btn.full {
  width: 100%;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--chrome-on-surface-variant, #8a8f99);
  line-height: 1.6;
}
</style>
