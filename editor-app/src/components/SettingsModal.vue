<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import {
  settings,
  applyTheme,
  saveSettings,
  THEMES,
  ICON_SETS,
  SHORTCUT_DEFS,
  EDITOR_SHORTCUT_DEFS,
  IMAGE_PASTE_MODES,
  ANNOTATION_OPEN_MODES,
  formatCombo,
} from '../state/settings'
import { fs } from '../fs'
import { backendChoice, setBackendChoice } from '../dev-repo'
import { refreshTree, openDirectory } from '../editor/manager'
import { state, toast } from '../state/store'
import MenuIcon from './MenuIcon.vue'

// 图标列 6 个功能（与 App.vue 菜单栏顺序一致）
const iconNames = ['files', 'git', 'settings', 'shortcuts', 'export', 'diagnostics'] as const

const props = defineProps<{ initialTab?: 'general' | 'image' | 'shortcuts' | 'advanced' }>()
const emit = defineEmits<{ (e: 'close'): void }>()

// 打开时的初始页签（图标列「快捷键」入口传入 'shortcuts'）
const tab = ref<'general' | 'image' | 'shortcuts' | 'advanced'>(props.initialTab ?? 'general')
const recording = ref<string | null>(null)
const recordEl = ref<HTMLInputElement | null>(null)

/** M15：切换数据源（真实仓库 / Mock 演示）。对 dev server 立即重载生效 */
function onDataSource(kind: 'dev' | 'mock') {
  setBackendChoice(kind)
  toast(kind === 'dev' ? '已切换到真实仓库（重载中…）' : '已切换到 Mock 演示（重载中…）', 'info')
  window.location.reload()
}

// ---------- 常规页 ----------
function onThemeChange() {
  applyTheme(settings.theme)
  saveSettings()
}

// 数据源当前选择（设置页展示）
const ds = backendChoice()
function onTemplateDirChange() {
  saveSettings()
  // 重新扫描模板注册表（已打开的编辑器菜单不刷新，重开标签生效）
  void import('../template/service').then((m) => m.templateService.rescan())
}
function onSettingChange() {
  saveSettings()
  refreshTree()
}
/** 批注栏默认展开策略：仅持久化，无需刷新文件树 */
function onAnnotationModeChange() {
  saveSettings()
}
/** 图片页设置：无需刷新文件树，仅持久化 */
function onImageSettingChange() {
  saveSettings()
}
async function openLocalDir() {
  await openDirectory()
}

/** WebView2 启动参数：按设置拼参 → 存到 Rust 侧文件 → 重启应用（整进程重启才生效） */
async function applyWebviewArgsAndRestart() {
  const parts: string[] = []
  if (settings.gpuUnblock) parts.push('--ignore-gpu-blocklist')
  if (settings.webviewOcclusionOff) parts.push('--disable-features=CalculateNativeWinOcclusion')
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('save_webview_args', { args: parts.join(' ') })
    toast('WebView2 参数已保存，正在重启应用…', 'info')
    await new Promise((r) => setTimeout(r, 400))
    await invoke('restart_app')
  } catch (e) {
    toast('仅桌面版（Tauri）支持重启；当前环境不可用，参数变更需使用打包参数矩阵重组', 'error')
  }
}

/** mock 模式：从最新示例数据强制刷新本地缓存（恢复被删示例、更新内容） */
async function onRefreshMock() {
  const { refreshMockSamples } = await import('../fs/mock')
  const r = refreshMockSamples()
  await refreshTree()
  toast(`已刷新 Mock 示例数据（${r.files} 文件 / ${r.dirs} 目录，${r.updated} 个内容更新）`, 'success')
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
  const conflict = [...SHORTCUT_DEFS, ...EDITOR_SHORTCUT_DEFS].find(
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
  const def = [...SHORTCUT_DEFS, ...EDITOR_SHORTCUT_DEFS].find((d) => d.id === id)
  if (def) {
    settings.shortcuts[id] = def.default
    saveSettings()
  }
}
function resetAll() {
  for (const def of [...SHORTCUT_DEFS, ...EDITOR_SHORTCUT_DEFS]) settings.shortcuts[def.id] = def.default
  saveSettings()
}

// ---------- 调试通道（Agent）---------
const debugInfo = ref<{ mode: string; token: string; sessions: number; instanceId?: string; pid?: number; root?: string }>({ mode: 'off', token: '', sessions: 0 })

/** Tauri 环境下查询当前调试通道状态 */
async function queryDebugStatus() {
  if (fs.kind !== 'tauri') return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    debugInfo.value = await invoke('debug_server_status')
  } catch {
    /* 桌面未就绪时不处理 */
  }
}

/** 切换调试通道模式（Tauri：控制 Rust TCP server；dev：vite 中继常开，仅提示） */
async function onDebugServerChange() {
  saveSettings()
  if (fs.kind === 'tauri') {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const r = await invoke('debug_server_control', { mode: settings.debugServer })
      debugInfo.value = r as { mode: string; token: string; sessions: number }
      if (settings.debugServer === 'local') {
        toast('调试通道已开启（仅本机）。Agent 可用 writeit-cli 连接：见调试信息', 'success')
      } else if (settings.debugServer === 'lan') {
        toast('调试通道已开启（内网）。请复制 token 给 Agent，且 exec 逃生舱已被禁用', 'warning')
      } else {
        toast('调试通道已关闭', 'info')
      }
    } catch (e) {
      toast('切换失败：' + (e instanceof Error ? e.message : String(e)), 'error')
      settings.debugServer = 'off'
      saveSettings()
    }
  } else if (settings.debugServer !== 'off') {
    toast('vite dev 模式下调试中继常开（仅 dev server 存在期），无需此开关', 'info')
  }
}

onMounted(queryDebugStatus)

/** 复制调试字段到剪贴板（instanceId / token） */
async function copyDebugField(field: 'instanceId' | 'token') {
  const v = debugInfo.value[field]
  if (!v) return
  try {
    await navigator.clipboard.writeText(String(v))
    toast(field === 'instanceId' ? '实例标识已复制，请发给 Agent' : 'token 已复制，请发给 Agent', 'success')
  } catch {
    toast('复制失败：剪贴板不可用（请手动复制）', 'error')
  }
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
            <button class="tab-btn" :class="{ active: tab === 'image' }" @click="tab = 'image'">
              图片
            </button>
            <button class="tab-btn" :class="{ active: tab === 'shortcuts' }" @click="tab = 'shortcuts'">
              快捷键
            </button>
            <button class="tab-btn" :class="{ active: tab === 'advanced' }" @click="tab = 'advanced'">
              高级
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
            <span>菜单栏图标</span>
            <select v-model="settings.iconSet" @change="onSettingChange">
              <option v-for="s in ICON_SETS" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
          </label>
          <div class="row icon-preview-row">
            <span></span>
            <span class="icon-preview" :title="ICON_SETS.find((s) => s.id === settings.iconSet)?.desc">
              <MenuIcon v-for="n in iconNames" :key="n" :name="n" :set="settings.iconSet" :size="22" />
            </span>
          </div>

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
            <span>固定侧边栏</span>
            <input type="checkbox" v-model="settings.sidebarPinned" @change="saveSettings" />
            <em class="hint-inline">固定后点击编辑区不自动收纳</em>
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

          <h4 class="group-title">💬 批注栏</h4>
          <label class="row">
            <span>默认展开（编辑器视图）</span>
            <select v-model="settings.annotationOpenMode" @change="onAnnotationModeChange">
              <option v-for="m in ANNOTATION_OPEN_MODES" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </label>
          <p class="hint">
            {{ ANNOTATION_OPEN_MODES.find((m) => m.id === settings.annotationOpenMode)?.desc }}；新打开标签时生效
          </p>
          <label class="row">
            <span>默认展开（Git 改动视图）</span>
            <select v-model="settings.annotationOpenModeDiff" @change="onAnnotationModeChange">
              <option v-for="m in ANNOTATION_OPEN_MODES" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </label>
          <p class="hint">
            {{ ANNOTATION_OPEN_MODES.find((m) => m.id === settings.annotationOpenModeDiff)?.desc }}；打开 Git 改动标签时生效
          </p>
        </div>

        <!-- ===== 图片 ===== -->
        <div v-else-if="tab === 'image'" class="modal-body">
          <h4 class="group-title" style="margin-top:0">🖼 粘贴图片保存位置</h4>
          <p class="hint" style="margin-top:8px">
            在编辑器中粘贴/截图插入图片时，图片默认<b>内嵌为 base64</b> 存进 md 文件（文件膨胀、无法复用）。
            选择下面的策略可把图片保存为独立文件，文档只记录相对路径引用。
          </p>
          <div class="img-mode-list">
            <label v-for="m in IMAGE_PASTE_MODES" :key="m.id" class="img-mode">
              <input
                type="radio"
                name="imagePaste"
                :value="m.id"
                v-model="settings.imagePaste"
                @change="onImageSettingChange"
              />
              <span class="img-mode-main">
                <span class="img-mode-label">{{ m.label }}</span>
                <span class="img-mode-desc">{{ m.desc }}</span>
                <code class="img-mode-example">{{ m.example }}</code>
              </span>
            </label>
          </div>
          <p class="hint">
            文件名形如 <code>Pasted-20260812-143502-8f2a.png</code>（创建时的时间戳 + 随机后缀，避免重名覆盖）。
            保存到目录的策略下，粘贴即可立即落盘；改动会自动反映到文件树。
          </p>
        </div>

        <!-- ===== 高级（性能 / 调试通道 / 诊断 / 数据源） ===== -->
        <div v-else-if="tab === 'advanced'" class="modal-body">
          <!-- 性能（低功耗）：VM / 软件渲染环境降低合成开销 -->
          <h4 class="group-title">⚡ 性能</h4>
          <label class="row">
            <span>低功耗模式</span>
            <input type="checkbox" v-model="settings.liteMode" @change="saveSettings" />
            <em class="hint-inline">虚拟机/无 GPU 环境：关闭动画与阴影、打开文件不自动聚焦，降低合成开销</em>
          </label>
          <label class="row">
            <span>忽略 GPU 黑名单</span>
            <input type="checkbox" v-model="settings.gpuUnblock" @change="saveSettings" />
            <em class="hint-inline">WebView2 参数 --ignore-gpu-blocklist（尝试解锁虚拟 GPU，重启后生效）</em>
          </label>
          <label class="row">
            <span>关闭窗口遮挡检测</span>
            <input type="checkbox" v-model="settings.webviewOcclusionOff" @change="saveSettings" />
            <em class="hint-inline">WebView2 参数 --disable-features=CalculateNativeWinOcclusion（省空闲 CPU，重启后生效）</em>
          </label>
          <label class="row">
            <span>应用 WebView2 参数</span>
            <button class="primary" style="width:auto;padding:2px 12px" @click="applyWebviewArgsAndRestart">保存并重启</button>
            <em class="hint-inline">WebView2 参数需整进程重启才生效（仅桌面版可用）</em>
          </label>

          <!-- 调试通道（Agent 现场勘查） -->
          <h4 class="group-title">🔌 调试通道</h4>
          <!-- 实例标识：用户照此告诉 Agent 看哪个实例 -->
          <template v-if="fs.kind === 'tauri'">
            <div class="row">
              <span>实例标识</span>
              <code class="token-code">{{ debugInfo.instanceId || '(获取中…)' }}</code>
              <button class="btn" style="width:auto;padding:2px 10px" @click="copyDebugField('instanceId')">复制</button>
            </div>
            <p class="hint">多实例并存时，把此标识发给 Agent，它会只连接这个窗口对应的实例（如：看 instance {{ debugInfo.instanceId || 'w123-abc…' }} 的状态）。pid={{ debugInfo.pid || '-' }}</p>
          </template>
          <div class="row">
            <span>模式</span>
            <span class="ds-radios">
              <label title="关闭调试通道"><input type="radio" name="debugServer" value="off" v-model="settings.debugServer" @change="onDebugServerChange" /> 关闭</label>
              <label title="仅本机 127.0.0.1，Agent 可 SSH 进本机后用 writeit-cli 连接"><input type="radio" name="debugServer" value="local" v-model="settings.debugServer" @change="onDebugServerChange" /> 仅本机</label>
              <label title="绑定 0.0.0.0，内网可达；强制 token 校验，且默认禁用 exec 任意 JS"><input type="radio" name="debugServer" value="lan" v-model="settings.debugServer" @change="onDebugServerChange" /> 内网</label>
            </span>
          </div>
          <p class="hint">Tauri 桌面版：本机 = 127.0.0.1 随机端口；内网 = 0.0.0.0 随机端口（需 token）。
            vite dev 模式下中继常开（Agent 与 vite 同机时直接可用），该开关仅桌面版生效。</p>
          <template v-if="fs.kind === 'tauri' && settings.debugServer !== 'off'">
            <div class="row">
              <span>Token</span>
              <code class="token-code">{{ debugInfo.token || '(获取中…)' }}</code>
              <button class="btn" style="width:auto;padding:2px 10px" @click="copyDebugField('token')">复制</button>
            </div>
            <p class="hint danger-hint">token 存于 {{ debugInfo.mode === 'lan' ? '内网' : '本机' }} TCP server，CLI 从发现文件自动读取。
              内网模式务必只发给自己信任的 Agent；复制前确认连接方可信。</p>
          </template>
          <label class="row" v-if="settings.debugServer === 'lan'">
            <span>禁用 exec 逃生舱</span>
            <input type="checkbox" v-model="settings.debugLanExecDisabled" @change="saveSettings" />
            <em class="hint-inline">内网模式下禁止 exec（页面上下文任意 JS）——安全默认开启</em>
          </label>

          <!-- 诊断（D2）：问题诊断取证开关 -->
          <h4 class="group-title">🩺 诊断</h4>
          <label class="row">
            <span>启用诊断功能</span>
            <input type="checkbox" v-model="settings.diagEnabled" @change="saveSettings" />
          </label>
          <label class="row">
            <span>自动异常提示</span>
            <input type="checkbox" v-model="settings.diagAutoPrompt" @change="saveSettings" />
            <em class="hint-inline">应用异常时 toast 提醒可生成诊断包</em>
          </label>
          <label class="row">
            <span>记录操作轨迹</span>
            <input type="checkbox" v-model="settings.diagTrackTimeline" @change="saveSettings" />
          </label>
          <button class="btn full" @click="state.diagOpen = true">🩺 打开诊断 / 生成诊断包…</button>
          <p class="hint">
            遇到渲染 / 动画异常时，生成诊断包发给开发者即可（含环境、日志、操作轨迹与可选截图/文档，生成时可逐项取消勾选）。
          </p>

          <!-- M15：数据源切换（Mock 演示 / 真实仓库），仅 vite dev 演示态 -->
          <div v-if="fs.kind === 'dev' || fs.kind === 'mock'" class="row ds-options">
            <span>数据源</span>
            <span class="ds-radios">
              <label title="内容库 + 真实 git CLI（Vite Node 中间件直连）">
                <input type="radio" name="ds" :checked="ds === 'dev'" @change="onDataSource('dev')" /> 真实仓库
              </label>
              <label title="内置 Git演示 假仓库（改内容不落盘）">
                <input type="radio" name="ds" :checked="ds === 'mock'" @change="onDataSource('mock')" /> Mock 演示
              </label>
            </span>
          </div>
          <p v-if="fs.kind === 'dev' || fs.kind === 'mock'" class="hint">
            vite dev 默认<b>真实仓库</b>（消金业务合作平台，走 Vite Node 中间件）；Mock 演示为内置示例数据。切换后自动重载。
          </p>

          <template v-if="fs.kind === 'mock'">
            <button class="btn full" @click="onRefreshMock">🔄 刷新 Mock 示例数据</button>
            <p class="hint">
              浏览器模拟文件系统（Demo），修改保存在 localStorage。点击按钮可从最新 demo 示例重新同步本地缓存：示例文件内容更新、被删除的示例文件恢复；你自己新建的文件保留。
            </p>
          </template>
          <template v-else-if="fs.kind === 'tauri' || fs.kind === 'web'">
            <button class="btn full" @click="openLocalDir">📂 打开本地目录…</button>
            <p class="hint">
              {{
                fs.kind === 'tauri'
                  ? 'Tauri 原生文件访问（独立应用模式）。'
                  : '浏览器 File System Access API（Chrome/Edge），可打开真实目录。'
              }}
            </p>
          </template>
        </div>

        <!-- ===== 快捷键 ===== -->
        <div v-else-if="tab === 'shortcuts'" class="modal-body">
          <p class="hint" style="margin-top: 0">
            点击按键后按下新组合键；Backspace 清除；Esc 取消。
          </p>
          <div class="shortcut-list">
            <div class="shortcut-group">编辑器快捷键</div>
            <div v-for="def in EDITOR_SHORTCUT_DEFS" :key="def.id" class="shortcut-row">
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
            <div class="shortcut-group">应用快捷键</div>
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
.icon-preview-row {
  align-items: flex-start;
}
.ds-options {
  align-items: flex-start;
}
.ds-radios {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
  color: var(--chrome-on-background);
}
.ds-radios label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.icon-preview-row > span:first-child {
  padding-top: 4px;
}
.icon-preview {
  flex: 1;
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--chrome-border);
  border-radius: 8px;
  background: var(--chrome-surface-low, var(--chrome-background));
  color: var(--chrome-on-surface-variant);
}
.icon-preview .mi {
  flex-shrink: 0;
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
/* 诊断分组标题 */
.group-title {
  margin: 10px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--chrome-primary);
  border-top: 1px solid var(--chrome-outline);
  padding-top: 10px;
}
/* 图片保存策略列表 */
.img-mode-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.img-mode {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--chrome-border);
  border-radius: 8px;
  background: var(--chrome-surface-low, var(--chrome-background));
  cursor: pointer;
  font-size: 13px;
  color: var(--chrome-on-surface);
}
.img-mode:hover {
  border-color: var(--chrome-primary);
}
.img-mode input[type='radio'] {
  margin-top: 3px;
  accent-color: var(--chrome-primary);
}
.img-mode-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.img-mode-label {
  font-weight: 600;
}
.img-mode-desc {
  font-size: 12px;
  color: var(--chrome-on-surface-variant);
  line-height: 1.5;
}
.img-mode-example {
  font-size: 11px;
  font-family: var(--chrome-font-code, monospace);
  color: var(--chrome-primary);
  background: var(--chrome-hover);
  padding: 1px 6px;
  border-radius: 4px;
  align-self: flex-start;
}
.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.shortcut-group {
  margin-top: 6px;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--chrome-border-light);
  font-size: 12px;
  color: var(--chrome-on-surface-variant);
  letter-spacing: 0.02em;
}
.shortcut-group:first-child {
  margin-top: 0;
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
