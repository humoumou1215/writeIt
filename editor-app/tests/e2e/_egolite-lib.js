// ============================================================
// ego-lite 共享测试辅助库 —— 本项目 E2E/调试唯一允许的浏览器驱动方式
// ------------------------------------------------------------
// 本文件由 run-all.js / _run-one.js 拼接（prepend）进每个用例脚本后，
// 一起 pipe 给 `ego-browser nodejs` 执行（ego-browser 的 helper 进程会清洗环境变量，
// 因此不用 require/env 传路径，直接拼接源码最稳）。
// 运行器会在本文件之前注入：const __EGO_DIR = '<tests/e2e 绝对路径>'
// 依赖 ego-browser nodejs 预加载的全局 helper（js / click / wait / pressKey /
// typeText / fillInput / cdp / captureScreenshot / openOrReuseTab / …）。
// 【禁止 playwright】任何用例/调试脚本都不得 require('playwright')。
// 用例通过命名空间 L 使用本库（如 L.q('.x')、L.clickText(...)）。
// ============================================================

const path = (await import('node:path')).default
const fs = (await import('node:fs')).default

// ---- 浏览器下载（替代 playwright waitForEvent('download')）：CDP 下载到磁盘后读取 ----
const DOWNLOAD_DIR = '/tmp/egolite-downloads'
const setupDownloads = async () => {
  fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR, eventsEnabled: true }).catch(() => {})
  return DOWNLOAD_DIR
}
const latestDownload = async () => {
  const files = fs.readdirSync(DOWNLOAD_DIR).sort()
  if (!files.length) return null
  return DOWNLOAD_DIR + '/' + files[files.length - 1]
}
const headOf = (p, bytes) => fs.readFileSync(p).slice(0, bytes).toString('latin1')
const readAllText = (p) => fs.readFileSync(p, 'utf8')

// ---- 页内捕获导出 Blob（替代浏览器下载拦截）：patch <a download> click → fetch blob 存字节 ----
const BLOB_SRC = `(() => {
  if (window.__blobCapt) return true
  window.__blobCapt = true
  window.__exportBlobs = []
  const orig = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && this.href) {
      const name = this.download || ''
      fetch(this.href).then(r => r.arrayBuffer()).then(ab => {
        const bytes = new Uint8Array(ab)
        let bin = ''
        const chunk = 0x8000
        for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
        window.__exportBlobs.push({ name, size: bytes.length, b64: btoa(bin) })
      }).catch(() => {})
    }
    return orig.call(this)
  }
  return true
})()`
const installBlobCapture = async () => {
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: BLOB_SRC }).catch(() => {})
  await js(BLOB_SRC).catch(() => {})
}
const resetBlobs = () => js(`(window.__exportBlobs = [])`)
// 取最近一次导出 blob
const takeBlob = async (timeout = 8000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const b = await js(`(() => { const a = window.__exportBlobs || []; return a.length ? a[a.length-1] : null })()`)
    if (b && b.size != null) return b
    await waitMs(150)
  }
  return null
}

const J = (v) => JSON.stringify(v)

// 套件专用：每次运行用唯一命名空间（避免复用上次崩溃遗留的 user-held/非活跃空间导致硬停）。
// 内存堆积由运行器/手动清理兜底：run-all 末尾与 _cleanup-spaces.ego.js 会 complete 关闭释放。
// 用固定含义前缀便于识别（如 ref-e2e-12345）。
const acquireTaskSpace = async (name) => {
  const t = await useOrCreateTaskSpace(`${name}-${Date.now() % 100000}`)
  return t
}

// 演示截图目录（editor-app/demo-shots，gitignore；旧用例里的 /media/writeIt/... 是本机不存在的 Linux 路径）
const demoShotsDir = path.join(__EGO_DIR, '..', '..', 'demo-shots')
const clearDemoShots = () => {
  fs.mkdirSync(demoShotsDir, { recursive: true })
  for (const f of fs.readdirSync(demoShotsDir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(demoShotsDir, f))
}

// ---------------- 时间（ego-browser 的 wait 单位是秒） ----------------
const waitMs = (ms) => wait(ms / 1000)

// ---------------- DOM 查询（全部走浏览器侧 js()，一次返回） ----------------
// 元素数量
const q = (sel) => js(`document.querySelectorAll(${J(sel)}).length`)
// 是否存在「选择器 + 文本」匹配的元素（替代 playwright hasText）
const has = (sel, text) => js(
  `(() => { const e = [...document.querySelectorAll(${J(sel)})].find(x => (x.textContent||'').includes(${J(text)})); return !!e })()`
)
// 「选择器 + 文本」匹配的元素数量（替代 playwright count + hasText）
const qText = (sel, text) => js(
  `[...document.querySelectorAll(${J(sel)})].filter(x => (x.textContent||'').includes(${J(text)})).length`
)
// 第 i 个元素 textContent
const txt = (sel, i = 0) => js(
  `(() => { const e = document.querySelectorAll(${J(sel)})[${i}]; return e ? (e.textContent||'') : '' })()`
)
// 全部元素 textContent 数组
const txtAll = (sel) => js(`[...document.querySelectorAll(${J(sel)})].map(e => e.textContent || '')`)
// 第 i 个元素属性
const attr = (sel, name, i = 0) => js(
  `(() => { const e = document.querySelectorAll(${J(sel)})[${i}]; return e ? e.getAttribute(${J(name)}) : null })()`
)
// 是否可见（替代 playwright isVisible；Crepe 内容用 rect 判断，不用 offsetParent）
const vis = (sel) => js(
  `(() => { const e = document.querySelector(${J(sel)}); return !!e && e.getClientRects().length > 0 })()`
)
// 第 i 个元素 bounding rect（含中心点 cx/cy），不存在返回 null。
// 先滚动进视口再测量（等价 playwright 点击前自动 scrollIntoView）。
const box = (sel, i = 0) => js(
  `(() => { const e = document.querySelectorAll(${J(sel)})[${i}]; if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width/2, cy: r.y + r.height/2 } })()`
)
// 文本匹配元素的 bounding rect（替代 playwright hasText 定位），先滚动进视口
const boxText = (sel, text) => js(
  `(() => { const e = [...document.querySelectorAll(${J(sel)})].find(x => (x.textContent||'').includes(${J(text)})); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width/2, cy: r.y + r.height/2 } })()`
)
// 第 i 个 input/textarea 的 value
const val = (sel, i = 0) => js(
  `(() => { const e = document.querySelectorAll(${J(sel)})[${i}]; return e ? e.value : null })()`
)
// 把元素滚入可视区（替代 scrollIntoViewIfNeeded）
const scrollIntoView = (sel, i = 0) => js(
  `(() => { const e = document.querySelectorAll(${J(sel)})[${i}]; if (e) e.scrollIntoView({ block: 'center' }); return !!e })()`
)
// 树节点点击（按 data-path 精确命中，dispatchEvent 单击；绕过遮挡），替代 playwright 树定位
const treeClick = async (path, waitms = 600) => {
  await js(`(() => { const el = document.querySelector(${J('.tree [data-path="' + path + '"]')}); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el })()`)
  await waitMs(waitms)
}

// ---------------- 鼠标动作 ----------------
// 点击第 i 个元素中心；opts: { label, dx, dy }（dx/dy 为元素左上角偏移，替代 position）
const clickEl = async (sel, i = 0, opts = {}) => {
  if (opts.dx != null) {
    await click({ selector: sel, x: opts.dx, y: opts.dy != null ? opts.dy : opts.dx }, opts.label ? { label: opts.label } : undefined)
    return
  }
  const b = await box(sel, i)
  if (!b) throw new Error(`clickEl: not found ${sel} [${i}]`)
  await click([b.cx, b.cy], opts.label ? { label: opts.label } : undefined)
}
// 点击「选择器 + 文本」匹配的元素（替代 playwright hasText click）
const clickText = async (sel, text, opts = {}) => {
  const b = await boxText(sel, text)
  if (!b) throw new Error(`clickText: not found ${sel} ~ ${text}`)
  await click([b.cx, b.cy], opts.label ? { label: opts.label } : undefined)
}
// 右键（CDP 真实右键，弹出应用原生 contextmenu 菜单）
const rightClick = async (sel, i = 0) => {
  const b = await box(sel, i)
  if (!b) throw new Error(`rightClick: not found ${sel} [${i}]`)
  const x = Math.round(b.cx), y = Math.round(b.cy)
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 })
}
// 右键「选择器 + 文本」匹配的元素
const rightClickText = async (sel, text) => {
  const b = await boxText(sel, text)
  if (!b) throw new Error(`rightClickText: not found ${sel} ~ ${text}`)
  const x = Math.round(b.cx), y = Math.round(b.cy)
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 })
}
// 中键点击（关闭标签等）
const middleClick = async (sel, i = 0) => {
  const b = await box(sel, i)
  if (!b) throw new Error(`middleClick: not found ${sel} [${i}]`)
  const x = Math.round(b.cx), y = Math.round(b.cy)
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'middle', clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'middle', clickCount: 1 })
}
// 中键点击「选择器 + 文本」匹配的元素
const middleClickText = async (sel, text) => {
  const b = await boxText(sel, text)
  if (!b) throw new Error(`middleClickText: not found ${sel} ~ ${text}`)
  const x = Math.round(b.cx), y = Math.round(b.cy)
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'middle', clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'middle', clickCount: 1 })
}
// 双击
const dblClickEl = async (sel, i = 0) => {
  const b = await box(sel, i)
  if (!b) throw new Error(`dblClickEl: not found ${sel} [${i}]`)
  await doubleClick([b.cx, b.cy])
}
// 悬停（hover 是 ego-browser 预加载全局名，这里改名 hoverEl）
const hoverEl = async (sel, i = 0) => {
  const b = await box(sel, i)
  if (!b) throw new Error(`hoverEl: not found ${sel} [${i}]`)
  await hover([b.cx, b.cy])
}
// 悬停文本匹配元素
const hoverText = async (sel, text) => {
  const b = await boxText(sel, text)
  if (!b) throw new Error(`hoverText: not found ${sel} ~ ${text}`)
  await hover([b.cx, b.cy])
}
// 框选「选择器 + 文本」段落：从 (x+fromDx, 行中) 拖到 (x+toDx, 行中)，返回选区文本（替代 playwright mouse 拖选）
const selectText = async (sel, text, fromDx = 10, toDx = 240) => {
  const b = await boxText(sel, text)
  if (!b) throw new Error(`selectText: not found ${sel} ~ ${text}`)
  const cy = b.y + b.h / 2
  await dragMouse([[b.x + fromDx, cy], [b.x + toDx, cy]], { label: 'select text' })
  return js(`(() => { const s = window.getSelection(); return s ? s.toString() : '' })()`)
}

// ---------------- 键盘 / 输入 ----------------
// 修饰符位（CDP Input.dispatchKeyEvent）
const CDP_MOD = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }
// 常见按键虚拟键码
const VK = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, ' ': 32 }
// 按键：无修饰符组合直接用 pressKey；含 '+' 的（如 Control+e / Control+Shift+f）→
// 用 CDP 发真实修饰符+键（pressKey('Control+e') 会被当成单一键名，应用收不到 ctrlKey）
const press = async (combo) => {
  if (!combo.includes('+')) return pressKey(combo)
  const parts = String(combo).split('+')
  let modifiers = 0, key = ''
  for (const p of parts) {
    if (CDP_MOD[p]) { modifiers |= CDP_MOD[p]; continue }
    key = p
  }
  const isEnter = /^enter$/i.test(key)
  const baseKey = isEnter ? 'Enter' : key
  const code = isEnter ? 'Enter' : (VK[key] ? key : 'Key' + key.toUpperCase())
  const vk = VK[key] || key.toUpperCase().charCodeAt(0)
  const opts = { key: baseKey, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
  await cdp('Input.dispatchKeyEvent', { ...opts, type: 'keyDown' })
  await cdp('Input.dispatchKeyEvent', { ...opts, type: 'keyUp' })
}
const type = (text) => typeText(text)
// 清空并可填入输入框（focus+全选+逐键输入，触发真实 beforeinput/input，适配 Vue v-model；
// 比直接设 value 更可靠）。替代 playwright locator.fill。
const fill = async (sel, value) => {
  const ok = await js(`(() => { const e = document.querySelector(${J(sel)}); if (!e) return false; e.focus(); e.select(); return true })()`)
  if (!ok) throw new Error(`fill: not found ${sel}`)
  if (value) {
    await pressKey('Backspace')
    await typeText(value)
  }
  return true
}

// ---------------- 错误收集（PAGEERROR / CONSOLE error） ----------------
// 通过 Page.addScriptToEvaluateOnNewDocument 注入（跨 reload 生效）+ 当前页立即安装
const ERROR_HOOK_SRC = `(() => {
  if (window.__egErr) return true
  window.__egErr = []
  window.addEventListener('error', e => window.__egErr.push('PAGEERROR: ' + e.message))
  window.addEventListener('unhandledrejection', e => window.__egErr.push('UNHANDLED: ' + String((e.reason && e.reason.message) || e.reason)))
  const orig = console.error.bind(console)
  console.error = (...a) => { window.__egErr.push('CONSOLE: ' + a.map(String).join(' ')); orig(...a) }
  return true
})()`
const installErrors = async () => {
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: ERROR_HOOK_SRC }).catch(() => {})
  await js(ERROR_HOOK_SRC).catch(() => {})
}
const errors = () => js(`(window.__egErr || []).slice()`)

// ---------------- 导航 ----------------
// 视口兕底：egobrowser 任务空间窗口有时为 0x0（pageInfo w/h=0），坐标点击/截图全部失效。
// 用 CDP Emulation.setDeviceMetricsOverride 固定视口（skill 文档：viewport metrics 修复路径），
// 同一 target 上 reload 后仍保持。
const ensureViewport = async () => {
  try {
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  } catch { /* 无该能力时忽略 */ }
}
const openApp = async (url, settleMs = 2500) => {
  await openOrReuseTab(url, { wait: true, timeout: 60 })
  await ensureViewport()
  await waitMs(settleMs)
}
// 清空 mock 文件系统并重新加载（防止测试残留新文件/被改文件串扰下一个套件）
const resetMockFs = async (settleMs = 3500) => {
  await js(`localStorage.removeItem('milkdown-note-mock-fs-v2'); location.reload()`)
  await waitMs(settleMs)
}
// 打开新会话：开应用 + 强制重置 mock，保证每个套件从同一份基线开始
const freshApp = async (url, settleMs = 2500) => {
  await openApp(url, settleMs)
  await resetMockFs()
}
const reloadApp = async (settleMs = 2500) => {
  await js(`location.reload()`)
  await waitMs(settleMs)
}

// ---------------- 编辑器调试钩子（见 src/editor/manager.ts） ----------------
const pageMd = () => js(`window.__editorGetMarkdown ? window.__editorGetMarkdown() : ''`)
const goEnd = () => js(`window.__editorGoEnd ? (window.__editorGoEnd(), true) : false`)
const focusEditor = () => js(
  `(() => { const p = document.querySelector('.milkdown .ProseMirror'); if (p) p.focus(); return !!p })()`
)

// ---------------- 截图 ----------------
const shot = (p) => captureScreenshot(p)
// 截图到 demo-shots/（文件名相对路径即可）
const shotTo = async (name) => {
  fs.mkdirSync(demoShotsDir, { recursive: true })
  const p = path.join(demoShotsDir, name)
  await captureScreenshot(p)
  return p
}
// 元素特写截图（clip 包围盒 + 内边距），替代 playwright locator.screenshot
const shotEl = async (sel, name, pad = 40, i = 0) => {
  const b = await box(sel, i)
  if (!b) return false
  fs.mkdirSync(demoShotsDir, { recursive: true })
  const p = path.join(demoShotsDir, name)
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad)
  await captureScreenshot(p, { clip: { x, y, width: b.w + pad * 2, height: b.h + pad * 2 } })
  return true
}

// ---------------- 断言计数 ----------------
const newChecker = () => {
  let pass = 0, fail = 0
  const check = (name, cond) => { cond ? pass++ : (fail++, cliLog('❌ ' + name)) }
  const summary = () => `结果: ${pass} 通过 / ${fail} 失败`
  return { get pass() { return pass }, get fail() { return fail }, check, summary }
}

// ---------------- 命名空间（用例统一用 L.xxx 访问） ----------------
const L = {
  J, waitMs, acquireTaskSpace, demoShotsDir, clearDemoShots, setupDownloads, latestDownload, headOf, readAllText, installBlobCapture, resetBlobs, takeBlob,
  q, has, qText, txt, txtAll, attr, vis, box, boxText, val, scrollIntoView, treeClick,
  clickEl, clickText, rightClick, rightClickText, middleClick, middleClickText, dblClickEl, hoverEl, hoverText, selectText,
  press, type, fill,
  installErrors, errors,
  openApp, freshApp, resetMockFs, reloadApp,
  pageMd, goEnd, focusEditor,
  shot, shotTo, shotEl,
  newChecker,
}
