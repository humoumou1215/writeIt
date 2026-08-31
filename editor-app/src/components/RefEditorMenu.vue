<script setup lang="ts">
// 编辑器右键菜单（替代浏览器默认 contextmenu）
// 分组：① 剪贴板粘贴组（复制的文件 → 三种引用类型）② 常规编辑组 ③ 引用操作组 ④ 引用类型切换组
import { computed } from 'vue'
import { editorMenuState, closeEditorMenu } from '../editor/ref/clipboard-core'
import {
  menuPasteRef,
  menuPasteText,
  menuCopySelection,
  menuCutSelection,
  menuOpenRef,
  menuCopyRefSyntax,
  menuSetRefMode,
  copyImageToClipboard,
} from '../editor/ref/clipboard-core'
import type { RefMode } from '../editor/ref/core'
import { openImagePreview } from '../editor/image-paste'
import { fs } from '../fs'
import { toast } from '../state/store'

const st = editorMenuState

/** 当前引用类型（类型切换组的勾选） */
const currentMode = computed<RefMode>(() => {
  const t = st.target
  if (!t) return 'link'
  if (t.type === 'file_ref') return 'link'
  if (t.type === 'file_block') return t.readonly ? 'embed-ro' : 'embed'
  return 'link'
})

/** 是否为可切换类型的引用（object_ref 仅操作不开切换） */
const canSwitch = computed(() => st.target !== null && st.target.type !== 'object_ref')

const showPasteGroup = computed(() => {
  const c = st.clip
  return c !== null && (c.files.length > 0 || c.dirs.length > 0)
})
/** 只有目录（无文件）：粘贴路径文本 */
const showPasteDirText = computed(() => {
  const c = st.clip
  return c !== null && c.files.length === 0 && c.dirs.length > 0
})

function pasteDirText() {
  const c = st.clip
  const view = st.view
  if (!c || !view) return
  view.dispatch(view.state.tr.insertText(c.dirs.join('\n')).scrollIntoView())
  closeEditorMenu()
  view.focus()
}

// ---------- 图片右键菜单（图片上的 预览/定位/资源管理器） ----------

function previewImage() {
  if (!st.image) return
  openImagePreview(st.image)
  closeEditorMenu()
}

/** 复制图片到系统剪贴板（可粘贴到资源管理器 / 编辑器其他位置） */
async function copyImage() {
  if (!st.image) return
  closeEditorMenu()
  const ok = await copyImageToClipboard(st.image)
  toast(ok ? '图片已复制到剪贴板' : '复制图片失败', ok ? 'info' : 'error')
}

/** 在左侧文件树中定位该图片文件 */
async function revealImageInTree() {
  const p = st.image?.path
  if (!p) return
  closeEditorMenu()
  const { revealInTree } = await import('../state/treeOps')
  revealInTree(p)
}

/** 在系统文件浏览器中打开并选中（仅 Tauri 桌面版） */
async function revealImageInExplorer() {
  const p = st.image?.path
  if (!p) return
  closeEditorMenu()
  if (fs.kind !== 'tauri') {
    toast('该功能仅在桌面应用中可用', 'info')
    return
  }
  fs.revealInExplorer(p).catch((e: unknown) => {
    toast((e as Error)?.message || '打开文件管理器失败', 'error')
  })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="st.visible" class="rm-mask" @click="closeEditorMenu" @contextmenu.prevent="closeEditorMenu">
      <div
        class="rm-menu"
        :style="{ left: st.x + 'px', top: st.y + 'px' }"
        @click.stop
        @contextmenu.stop.prevent
      >
        <!-- ⑨ 图片组：右键图片（image-block / image-inline）上的操作 -->
        <template v-if="st.image">
          <div class="rm-group-title">图片</div>
          <button class="rm-item" title="全屏预览该图片" @click="previewImage">
            <span class="rm-ico">🔍</span>预览图片
          </button>
          <button class="rm-item" title="复制图片到系统剪贴板（可粘贴到资源管理器/编辑器其他位置）" @click="copyImage">
            <span class="rm-ico">🖼</span>复制图片
          </button>
          <button v-if="st.image.path" class="rm-item" title="在左侧文件树中定位该文件" @click="revealImageInTree">
            <span class="rm-ico">📌</span>在文件树中定位
          </button>
          <button v-if="st.image.path" class="rm-item" title="在系统文件浏览器中打开并选中该文件（桌面版）" @click="revealImageInExplorer">
            <span class="rm-ico">📂</span>在文件浏览器中打开
          </button>
          <div class="rm-sep"></div>
        </template>

        <!-- ① 粘贴组：复制的文件 → 三种引用类型 -->
        <template v-if="showPasteGroup && st.clip && st.clip.files.length">
          <div class="rm-group-title">粘贴为引用</div>
          <button class="rm-item" title="[[path]] 链接引用（Ctrl+V 默认）" @click="menuPasteRef('link')">
            <span class="rm-ico">📄</span>粘贴为链接引用
          </button>
          <button class="rm-item" title="![[path]] 块嵌入（可编辑）" @click="menuPasteRef('embed')">
            <span class="rm-ico">⧉</span>粘贴为块嵌入
          </button>
          <button class="rm-item" title="![[path|ro]] 块嵌入（只读）" @click="menuPasteRef('embed-ro')">
            <span class="rm-ico">🔒</span>粘贴为只读嵌入
          </button>
          <div class="rm-sep"></div>
        </template>
        <!-- 只有目录：粘贴路径文本 -->
        <template v-if="showPasteDirText">
          <button class="rm-item" title="目录不作为引用，粘贴其路径文本" @click="pasteDirText">
            <span class="rm-ico">📁</span>粘贴目录路径
          </button>
          <div class="rm-sep"></div>
        </template>

        <!-- ② 常规编辑组 -->
        <button class="rm-item" title="Ctrl+V" @click="menuPasteText">
          <span class="rm-ico">📋</span>粘贴<span class="rm-kbd">Ctrl+V</span>
        </button>
        <button class="rm-item" :disabled="!st.hasSelection" title="Ctrl+X" @click="menuCutSelection()">
          <span class="rm-ico">✂</span>剪切<span class="rm-kbd">Ctrl+X</span>
        </button>
        <button class="rm-item" :disabled="!st.hasSelection" title="Ctrl+C" @click="menuCopySelection()">
          <span class="rm-ico">⧉</span>复制<span class="rm-kbd">Ctrl+C</span>
        </button>
        <div v-if="st.target" class="rm-sep"></div>

        <!-- ③ 引用操作组（右键在引用节点上） -->
        <template v-if="st.target">
          <button class="rm-item" title="打开该引用指向的文件" @click="menuOpenRef">
            <span class="rm-ico">↗</span>打开引用
          </button>
          <button class="rm-item" title="复制 [[path]]，可直接粘贴为引用" @click="menuCopyRefSyntax()">
            <span class="rm-ico">⧉</span>复制引用 <code class="rm-code">[[{{ st.target.path }}]]</code>
          </button>
        </template>

        <!-- ④ 引用类型切换组 -->
        <template v-if="canSwitch">
          <div class="rm-sep"></div>
          <button
            class="rm-item"
            :class="{ active: currentMode === 'link' }"
            @click="menuSetRefMode('link')"
          >
            <span class="rm-check">{{ currentMode === 'link' ? '✓' : '' }}</span>链接引用
            <code class="rm-code">[[path]]</code>
          </button>
          <button
            class="rm-item"
            :class="{ active: currentMode === 'embed' }"
            @click="menuSetRefMode('embed')"
          >
            <span class="rm-check">{{ currentMode === 'embed' ? '✓' : '' }}</span>块嵌入（可编辑）
            <code class="rm-code">![[path]]</code>
          </button>
          <button
            class="rm-item"
            :class="{ active: currentMode === 'embed-ro' }"
            @click="menuSetRefMode('embed-ro')"
          >
            <span class="rm-check">{{ currentMode === 'embed-ro' ? '✓' : '' }}</span>只读嵌入
            <code class="rm-code">![[path|ro]]</code>
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rm-mask {
  position: fixed;
  inset: 0;
  z-index: 120;
}
.rm-menu {
  position: fixed;
  min-width: 190px;
  max-width: 320px;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  background: var(--chrome-surface);
  color: var(--chrome-on-surface);
  border: 1px solid var(--chrome-border);
  border-radius: 8px;
  padding: 6px;
  box-shadow: var(--chrome-shadow-1);
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.rm-group-title {
  padding: 5px 12px 3px;
  font-size: 11px;
  color: var(--chrome-on-surface-variant);
  letter-spacing: 0.4px;
}
.rm-item {
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  padding: 7px 12px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.rm-item:hover:not(:disabled) {
  background: var(--chrome-hover);
}
.rm-item:disabled {
  opacity: 0.42;
  cursor: default;
}
.rm-item.active {
  color: var(--chrome-primary);
}
.rm-ico {
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}
.rm-check {
  width: 14px;
  flex-shrink: 0;
  color: var(--chrome-primary);
  font-weight: 700;
}
.rm-kbd {
  margin-left: auto;
  font-size: 11px;
  color: var(--chrome-on-surface-variant);
  padding-left: 10px;
}
.rm-code {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  color: var(--chrome-on-surface-variant);
  background: color-mix(in srgb, var(--chrome-on-surface-variant) 12%, transparent);
  border-radius: 4px;
  padding: 1px 4px;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 130px;
}
.rm-sep {
  height: 1px;
  background: var(--chrome-border-light, var(--chrome-border));
  margin: 4px 8px;
}
</style>