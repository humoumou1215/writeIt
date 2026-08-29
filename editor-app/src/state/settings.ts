// 主题管理：6 套 crepe 主题 CSS 以 ?raw 打包进应用（离线可用），运行时注入 <style>
// 应用外壳（文件树/标签栏/工具栏）通过读取 .milkdown 的计算样式同步配色
import { reactive } from 'vue'

import frameCss from '@milkdown/crepe/theme/frame.css?raw'
import frameDarkCss from '@milkdown/crepe/theme/frame-dark.css?raw'
import classicCss from '@milkdown/crepe/theme/classic.css?raw'
import classicDarkCss from '@milkdown/crepe/theme/classic-dark.css?raw'
import nordCss from '@milkdown/crepe/theme/nord.css?raw'
import nordDarkCss from '@milkdown/crepe/theme/nord-dark.css?raw'

export const THEMES = [
  { id: 'frame', label: 'Frame 浅色', css: frameCss },
  { id: 'frame-dark', label: 'Frame 深色', css: frameDarkCss },
  { id: 'classic', label: 'Classic 浅色', css: classicCss },
  { id: 'classic-dark', label: 'Classic 深色', css: classicDarkCss },
  { id: 'nord', label: 'Nord 浅色', css: nordCss },
  { id: 'nord-dark', label: 'Nord 深色', css: nordDarkCss },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

// 菜单栏图标风格（三套，见 components/MenuIcon.vue）
export type IconSetId = 'line' | 'soft' | 'gradient'
export const ICON_SETS: { id: IconSetId; label: string; desc: string }[] = [
  { id: 'line', label: '细线', desc: '1.7px 圆角描边，简洁克制，随主题变色' },
  { id: 'soft', label: '圆润双色', desc: '主色 + 柔和底色，亲和饱满' },
  { id: 'gradient', label: '多彩渐变', desc: '每图标独立渐变，活泼有品牌感' },
]

const SETTINGS_KEY = 'milkdown-note-settings-v1'

// ---------- 快捷键 ----------

export interface ShortcutDef {
  id: string
  label: string
  default: string
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'save', label: '保存当前文件', default: 'Ctrl+S' },
  { id: 'openDirectory', label: '打开目录', default: 'Ctrl+O' },
  { id: 'newFile', label: '新建文件', default: 'Ctrl+N' },
  { id: 'closeTab', label: '关闭当前标签', default: 'Ctrl+W' },
  { id: 'nextTab', label: '下一个标签', default: 'Ctrl+Tab' },
  { id: 'prevTab', label: '上一个标签', default: 'Ctrl+Shift+Tab' },
  { id: 'prevFile', label: '上一个文件', default: 'Alt+ArrowUp' },
  { id: 'nextFile', label: '下一个文件', default: 'Alt+ArrowDown' },
  { id: 'toggleSidebar', label: '收纳/展开侧边栏', default: 'Ctrl+B' },
  { id: 'toggleSource', label: '切换源码/编辑模式', default: 'Ctrl+E' },
  { id: 'gitDiff', label: '打开当前文件 Git 改动', default: 'Ctrl+Shift+D' },
  { id: 'search', label: '全局搜索（打开/关闭侧栏搜索面板）', default: 'Ctrl+Shift+F' },
  { id: 'settings', label: '打开设置', default: 'Ctrl+,' },
]

/** 编辑器内快捷键（经 milkdown keymap 在编辑器中生效，不在全局 onKeydown 拦截）——
 *  目前仅表格：「在下方新增一行」默认 Shift+Enter。设置面板会列出并允许录制与冲突检测。 */
export const EDITOR_SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'tableAddRowBelow', label: '表格：在下方新增一行', default: 'Shift+Enter' },
]

const defaultShortcuts: Record<string, string> = Object.fromEntries(
  [...SHORTCUT_DEFS, ...EDITOR_SHORTCUT_DEFS].map((s) => [s.id, s.default])
)

/** 把按键事件格式化为 "Ctrl+Shift+X" 形式；纯修饰键返回空串 */
export function formatCombo(e: KeyboardEvent): string {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return ''
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let key = e.key
  if (key === ' ') key = 'Space'
  parts.push(key.length === 1 ? key.toUpperCase() : key)
  return parts.join('+')
}

export function parseCombo(
  combo: string
): { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string } | null {
  const parts = combo.split('+').map((p) => p.trim())
  if (!parts.length) return null
  const key = parts.pop()!.toLowerCase()
  const mods = { ctrl: false, alt: false, shift: false, meta: false }
  for (const p of parts) {
    const l = p.toLowerCase()
    if (l === 'ctrl' || l === 'cmd') mods.ctrl = true
    else if (l === 'alt' || l === 'option') mods.alt = true
    else if (l === 'shift') mods.shift = true
    else if (l === 'meta' || l === 'win') mods.meta = true
    else return null
  }
  return { ...mods, key: key === 'space' ? ' ' : key }
}

export function comboMatches(e: KeyboardEvent, combo: string): boolean {
  const parsed = parseCombo(combo)
  if (!parsed) return false
  const pressed = e.key.toLowerCase()
  return (
    parsed.ctrl === (e.ctrlKey || e.metaKey) &&
    parsed.alt === e.altKey &&
    parsed.shift === e.shiftKey &&
    parsed.key === pressed
  )
}

// ---------- 应用设置 ----------

export interface AppSettings {
  theme: ThemeId
  /** 菜单栏图标风格 */
  iconSet: IconSetId
  autoSave: boolean
  autoSaveDelay: number // ms
  /** 侧边栏内容列宽度（px） */
  sidebarWidth: number
  /** 侧边栏是否固定（固定后点击编辑区不自动收纳；打开文件本就永不收纳） */
  sidebarPinned: boolean
  /** 全局模板目录（真实文件系统：外部目录；mock：忽略，用内置示例） */
  templateDir: string
  /** 上次打开的工作目录（Tauri 桌面应用下次启动自动恢复；空 = 未记录，兜底用 app 所在目录） */
  lastDir: string
  /** 批注用户名（web/mock 无 git 时使用；Tauri 下优先 git user.name） */
  annotationUsername: string
  /** 批注抽屉默认宽度（px） */
  annotationDrawerWidth: number
  /** 大纲面板默认宽度（px） */
  outlineWidth: number
  /** 大纲面板是否展开 */
  outlineOpen: boolean
  /** 大纲自适应宽度（按文字内容，上限 = 编辑器 1/3；手动拖拽时自动关闭） */
  outlineAutoFit: boolean
  /** 低功耗模式（虚拟机/软件渲染环境）：关动画/降阴影/打开文件不自动聚焦 */
  liteMode: boolean
  /** WebView2 参数：忽略 GPU 黑名单（尝试解锁虚拟 GPU，整进程重启后生效） */
  gpuUnblock: boolean
  /** WebView2 参数：关闭窗口遮挡检测（省空闲 CPU，整进程重启后生效） */
  webviewOcclusionOff: boolean
  /** 快捷键映射：actionId → "Ctrl+Shift+X" */
  shortcuts: Record<string, string>

  // ---------- 诊断（Diagnostics）----------
  /** 诊断功能总开关（关闭后入口隐藏） */
  diagEnabled: boolean
  /** 全局异常自动 toast 提示 */
  diagAutoPrompt: boolean
  /** 操作轨迹记录（timeline） */
  diagTrackTimeline: boolean
  /* —— 生成弹窗的「上次选择」记忆（默认全开，用户可取消）—— */
  diagIncludeSnapshot: boolean // 截图
  diagIncludeDom: boolean // DOM 快照
  diagIncludeDoc: boolean // 文档内容
  diagIncludePaths: boolean // 完整路径（false → basename 脱敏）

  // ---------- 调试通道（Agent）----------
  /** 调试通道模式：off=关闭 / local=仅本机 TCP / lan=内网 TCP（Tauri 桌面版） */
  debugServer: 'off' | 'local' | 'lan'
  /** lan 模式强制禁用 exec（任意 JS 逃生舱） */
  debugLanExecDisabled: boolean
}

const defaultSettings: AppSettings = {
  theme: 'frame',
  iconSet: 'gradient',
  autoSave: false,
  autoSaveDelay: 2000,
  sidebarWidth: 250,
  sidebarPinned: false,
  templateDir: '',
  lastDir: '',
  annotationUsername: '我',
  annotationDrawerWidth: 300,
  outlineWidth: 180,
  outlineOpen: true,
  outlineAutoFit: true,
  // 低功耗模式（虚拟机/软件渲染环境）：关动画、降阴影、打开文件不自动聚焦
  liteMode: false,
  // WebView2 启动参数（默认同历史 combo2：省 CPU + 尝试解锁虚拟 GPU，重启生效）
  gpuUnblock: true,
  webviewOcclusionOff: true,
  shortcuts: { ...defaultShortcuts },
  // 诊断
  diagEnabled: true,
  diagAutoPrompt: true,
  diagTrackTimeline: true,
  diagIncludeSnapshot: true,
  diagIncludeDom: true,
  diagIncludeDoc: true,
  diagIncludePaths: true,
  // 调试通道
  debugServer: 'off',
  debugLanExecDisabled: true,
}

export const settings = reactive<AppSettings>(loadSettings())

function loadSettings(): AppSettings {
  const base: AppSettings = {
    ...defaultSettings,
    shortcuts: { ...defaultSettings.shortcuts },
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppSettings>
      return {
        ...base,
        ...saved,
        shortcuts: { ...base.shortcuts, ...(saved.shortcuts ?? {}) },
      }
    }
  } catch {
    /* ignore */
  }
  return base
}

export function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

// ---------- 主题注入 ----------

let themeStyleEl: HTMLStyleElement | null = null

export function applyTheme(theme: ThemeId) {
  const t = THEMES.find((x) => x.id === theme) ?? THEMES[0]
  if (!themeStyleEl) {
    themeStyleEl = document.createElement('style')
    themeStyleEl.setAttribute('data-theme-style', '')
    document.head.appendChild(themeStyleEl)
  }
  themeStyleEl.textContent = t.css
  syncChromeTheme()
  saveSettings()
}

// ---------- 外壳配色同步 ----------
// crepe 主题把变量定义在 .milkdown 上；我们把关键色映射到 :root 的 --chrome-*，
// 供文件树/标签栏/工具栏使用，保证整体观感与编辑器一致

const CHROME_MAP: Array<[string, string]> = [
  // ---- 颜色（基础） ----
  ['--chrome-background', '--crepe-color-background'],
  ['--chrome-on-background', '--crepe-color-on-background'],
  ['--chrome-surface', '--crepe-color-surface'],
  ['--chrome-surface-low', '--crepe-color-surface-low'],
  ['--chrome-on-surface', '--crepe-color-on-surface'],
  ['--chrome-on-surface-variant', '--crepe-color-on-surface-variant'],
  ['--chrome-outline', '--crepe-color-outline'],
  ['--chrome-primary', '--crepe-color-primary'],
  ['--chrome-secondary', '--crepe-color-secondary'],
  ['--chrome-hover', '--crepe-color-hover'],
  ['--chrome-selected', '--crepe-color-selected'],
  ['--chrome-inline-code', '--crepe-color-inline-code'],
  ['--chrome-error', '--crepe-color-error'],
  ['--chrome-inverse', '--crepe-color-inverse'],
  ['--chrome-on-inverse', '--crepe-color-on-inverse'],
  ['--chrome-on-secondary', '--crepe-color-on-secondary'],
  ['--chrome-inline-area', '--crepe-color-inline-area'],
  // ---- 字体 ----
  ['--chrome-font-default', '--crepe-font-default'],
  ['--chrome-font-title', '--crepe-font-title'],
  ['--chrome-font-code', '--crepe-font-code'],
  // ---- 阴影 ----
  ['--chrome-shadow-1', '--crepe-shadow-1'],
  ['--chrome-shadow-2', '--crepe-shadow-2'],
]

// 派生变量（需要从基础色计算）
const CHROME_DERIVED: Array<[string, string, string]> = [
  // [chrome变量, 基础 crepe 变量, 后缀/变换]
  ['--chrome-border', '--crepe-color-outline', '55'],
  ['--chrome-border-light', '--crepe-color-outline', '33'],
  ['--chrome-accent', '--crepe-color-primary', ''],
  ['--chrome-panel-bg', '--crepe-color-surface', ''],
  ['--chrome-text', '--crepe-color-on-surface', ''],
  ['--chrome-input-bg', '--crepe-color-background', ''],
  ['--chrome-reveal', '--crepe-color-secondary', '44'],
  ['--chrome-reveal-ring', '--crepe-color-primary', ''],
  // 语义色（warning 不在 crepe 基础色中，用 outline 混合）
  ['--chrome-warning', '--crepe-color-on-surface-variant', ''],
]

export function syncChromeTheme() {
  // 用一个离屏探针元素读取主题变量（不依赖编辑器是否打开）
  let probe = document.getElementById('crepe-theme-probe') as HTMLElement | null
  if (!probe) {
    probe = document.createElement('div')
    probe.id = 'crepe-theme-probe'
    probe.className = 'milkdown'
    probe.setAttribute('aria-hidden', 'true')
    Object.assign(probe.style, {
      position: 'fixed',
      left: '-9999px',
      top: '0',
      width: '1px',
      height: '1px',
      pointerEvents: 'none',
    })
    document.body.appendChild(probe)
  }
  const cs = getComputedStyle(probe)
  const root = document.documentElement

  // 基础映射
  for (const [chromeVar, crepeVar] of CHROME_MAP) {
    const v = cs.getPropertyValue(crepeVar).trim()
    if (v) root.style.setProperty(chromeVar, v)
  }

  // 派生变量
  for (const [chromeVar, crepeVar, suffix] of CHROME_DERIVED) {
    const v = cs.getPropertyValue(crepeVar).trim()
    if (v) root.style.setProperty(chromeVar, suffix ? v + suffix : v)
  }
}
