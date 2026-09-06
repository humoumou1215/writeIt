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
      // E2E 已从 blob 读取并校验字节，不再触发真实浏览器下载。真实下载会打开
      // ego-lite 权限/确认 UI，造成假“人工接管”并阻塞整个自动化批次。
      return
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

// 每个 worker 固定复用一个测试空间。ego-lite 的 closeTaskSpace 会弹出原生
// “删除这个空间？”确认框；大量短套件逐个创建/删除空间会堆积确认框和 renderer。
// 因此 E2E 只保留有限 lane，套件间用 freshApp 隔离状态，不走空间删除路径。
let activeTaskSpace = null
let exitInProgress = false
const realProcessExit = process.exit.bind(process)
const nativeCompleteTaskSpace = globalThis.completeTaskSpace
class E2ESuiteExit extends Error {
  constructor(code) {
    super(`E2E suite exit ${code}`)
    this.code = Number(code) || 0
    this.__e2eSuiteExit = true
  }
}

// 兼容现有套件末尾的 completeTaskSpace(..., { keep:false })：在 E2E lane 内将其
// 解释为“本套件已完成但保留 lane”。非当前 lane 仍调用 ego-browser 原生实现。
globalThis.completeTaskSpace = async (nameOrId, options) => {
  const task = activeTaskSpace
  if (task && (nameOrId === task.id || nameOrId === task.name || nameOrId === task.taskId)) {
    return { done: true, preserved: true }
  }
  return nativeCompleteTaskSpace(nameOrId, options)
}

const releaseActiveTaskSpace = async () => {
  // lane 由后续套件复用；进程退出不删除、不关闭最后一个 tab。
  activeTaskSpace = null
}

const shutdownWithCleanup = async (code) => {
  if (exitInProgress) return
  exitInProgress = true
  await releaseActiveTaskSpace()
  realProcessExit(code)
}

// 批次模式用异常结束当前套件但保留 Node/Chromium 会话；单套件模式正常退出进程。
process.exit = (code = 0) => {
  if (typeof __EGO_BATCH !== 'undefined' && __EGO_BATCH) throw new E2ESuiteExit(code)
  void shutdownWithCleanup(code)
}
process.on('uncaughtException', (err) => {
  cliLog(`❌ 未捕获异常: ${err?.stack || err}`)
  void shutdownWithCleanup(1)
})
process.on('unhandledRejection', (reason) => {
  cliLog(`❌ 未处理 Promise 异常: ${reason?.stack || reason}`)
  void shutdownWithCleanup(1)
})
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { void shutdownWithCleanup(128 + (signal === 'SIGINT' ? 2 : 15)) })
}

const acquireTaskSpace = async (name) => {
  if (activeTaskSpace) return activeTaskSpace
  const lane = typeof __EGO_LANE === 'string' && __EGO_LANE ? __EGO_LANE : `adhoc-${name}`
  const spaceName = `writeIt-e2e:${lane}`
  const existing = (await listTaskSpaces()).find((s) => s.name === spaceName || s.taskId === spaceName)
  let t
  if (existing?.ownership === 'user') {
    t = await claimTaskSpace(existing.id)
  } else {
    t = await useOrCreateTaskSpace(spaceName)
    // 本项目全量回归无人操作这些专用 lane；该状态只可能来自 ego-lite 的弹窗误接管。
    if (existing?.ownership === 'agentDelegatedToUser') await takeOverTaskSpace(existing.id)
  }
  activeTaskSpace = t
  return t
}

// 演示截图目录（editor-app/demo-shots，gitignore；旧用例里的 /media/writeIt/... 是本机不存在的 Linux 路径）
const demoShotsDir = path.join(__EGO_DIR, '..', '..', 'demo-shots')
const clearDemoShots = () => {
  fs.mkdirSync(demoShotsDir, { recursive: true })
  for (const f of fs.readdirSync(demoShotsDir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(demoShotsDir, f))
}

// ---------------- 时间（ego-browser 的 wait 单位是秒） ----------------
const exactWaitMs = (ms) => wait(ms / 1000)

// 长等待以“页面状态连续稳定”为完成条件，原毫秒数只作为上限。保留至少 500ms
// 观察窗，覆盖 esbuild/Crepe/Mermaid 首次异步初始化；短等待保持精确语义。
const appStateSignature = () => js(`(() => {
  const hash = (s) => {
    let h = 2166136261
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
    return h >>> 0
  }
  const body = document.body?.innerText || ''
  const md = window.__editorGetMarkdown ? String(window.__editorGetMarkdown() || '') : ''
  const mock = localStorage.getItem('milkdown-note-mock-fs-v2') || ''
  return [document.readyState, document.querySelectorAll('.ProseMirror').length,
    document.querySelectorAll('.ref-file-block').length, document.querySelectorAll('[data-ref-menu] .menu-group li').length,
    document.querySelectorAll('.modal-mask').length, body.length, hash(body), md.length, hash(md), mock.length, hash(mock)].join(':')
})()`)
const waitForAppStable = async (timeoutMs, minMs = 250, stableMs = 100) => {
  const started = Date.now()
  await exactWaitMs(Math.min(minMs, timeoutMs))
  let previous = null
  let stableSince = Date.now()
  while (Date.now() - started < timeoutMs) {
    const current = await appStateSignature()
    if (current !== previous) {
      previous = current
      stableSince = Date.now()
    } else if (Date.now() - stableSince >= stableMs) {
      return true
    }
    await exactWaitMs(100)
  }
  return false
}
const waitFor = async (predicate, timeoutMs = 5000, intervalMs = 100) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await exactWaitMs(intervalMs)
  }
  return false
}
const waitMs = (ms) => ms > 1000 ? waitForAppStable(ms) : exactWaitMs(ms)

// Application navigation used to pay a fixed 2.5–3.5s delay on every suite,
// even when Vite/Milkdown had already finished.  Poll the same observable
// readiness signal the tests use (the editor API, a mounted ProseMirror, and
// a populated file tree), and keep a short stability window so this does not
// turn a partially mounted
// editor into a false positive.  The old delay remains the timeout fallback.
const waitForEditorReady = async (fallbackMs = 2500, timeoutMs = 10000) => {
  const started = Date.now()
  let readySince = 0
  while (Date.now() - started < timeoutMs) {
    const ready = await js(`(() => document.readyState === 'complete' && !!window.__editorGetMarkdown && !!document.querySelector('.milkdown .ProseMirror') && document.querySelectorAll('.tree .name').length > 0)()`)
    if (ready) {
      if (!readySince) readySince = Date.now()
      if (Date.now() - readySince >= 150) return true
    } else {
      readySince = 0
    }
    await exactWaitMs(100)
  }
  // Preserve the previous minimum timing contract when the app is genuinely
  // not ready (or a future test page does not expose the editor marker),
  // without adding fallbackMs on top of the polling timeout.
  const remaining = fallbackMs - (Date.now() - started)
  if (remaining > 0) await waitMs(remaining)
  return false
}

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
  const selector = `.tree [data-path="${path}"]`
  await waitFor(async () => (await q(selector)) > 0, 5000)
  await js(`(() => { const el = document.querySelector(${J(selector)}); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el })()`)
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
  if (!combo.includes('+') && !VK[combo]) return pressKey(combo)
  const parts = String(combo).split('+')
  let modifiers = 0, key = ''
  for (const p of parts) {
    if (CDP_MOD[p]) { modifiers |= CDP_MOD[p]; continue }
    key = p
  }
  const isEnter = /^enter$/i.test(key)
  const shiftedLetter = (modifiers & CDP_MOD.Shift) && /^[a-z]$/i.test(key)
  const baseKey = isEnter ? 'Enter' : shiftedLetter ? key.toUpperCase() : key
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
const errors = () => js(`(window.__egErr || []).filter((e) => !/ResizeObserver loop completed with undelivered notifications/.test(e))`)

// ---------------- 导航 ----------------
// 视口兕底：egobrowser 任务空间窗口有时为 0x0（pageInfo w/h=0），坐标点击/截图全部失效。
// 用 CDP Emulation.setDeviceMetricsOverride 固定视口（skill 文档：viewport metrics 修复路径），
// 同一 target 上 reload 后仍保持。
const ensureViewport = async () => {
  try {
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  } catch { /* 无该能力时忽略 */ }
}
// ego-lite 的 task space 共用浏览器 profile，同源 localStorage 也会互相影响。
// 每个 lane 使用独立 *.localhost origin，隔离 mock FS 与应用状态，同时仍访问同一 Vite 服务。
const laneUrl = (rawUrl) => {
  if (typeof __EGO_LANE !== 'string' || !__EGO_LANE) return rawUrl
  const u = new URL(rawUrl)
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
    u.hostname = `${__EGO_LANE.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.localhost`
  }
  return u.href
}
const openApp = async (url, settleMs) => {
  const targetUrl = laneUrl(url)
  await openOrReuseTab(targetUrl, { wait: true, timeout: 60 })
  // URL 查询串不同会让 openOrReuseTab 新建标签；旧应用标签仍会监听 storage/HMR。
  // 只保留当前标签，关闭其余标签时当前标签仍存在，不会走“删除最后标签/空间”路径。
  const current = await currentTab()
  const tabs = await listTabs()
  for (const tab of tabs) {
    const id = tab.targetId ?? tab.id
    const currentId = current?.targetId ?? current?.id
    if (id && id !== currentId) await closeTab(id).catch(() => {})
  }
  await ensureViewport()
  if (settleMs == null) await waitForEditorReady(2500)
  else await waitMs(settleMs)
}
// 清空当前 lane 的全部浏览器状态并重新加载。固定 lane 会跨套件复用，除 mock FS
// 外，抽屉/快捷键/设置等 localStorage 状态也必须隔离；sessionStorage 同理。
const resetMockFs = async (settleMs) => {
  await js(`localStorage.clear(); sessionStorage.clear(); location.reload()`)
  if (settleMs == null) await waitForEditorReady(3500)
  else await waitMs(settleMs)
}
// 打开新会话：开应用 + 强制重置 mock，保证每个套件从同一份基线开始
const freshApp = async (url, settleMs) => {
  await openApp(url, settleMs)
  await resetMockFs()
  // reload 后旧 DOM 可能短暂残留；确认新 document 已完成挂载，再交给套件操作。
  await waitForEditorReady(3500, 15000)
}
const reloadApp = async (settleMs) => {
  await js(`location.reload()`)
  if (settleMs == null) await waitForEditorReady(2500)
  else await waitMs(settleMs)
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
  J, waitMs, exactWaitMs, waitFor, waitForAppStable, waitForEditorReady, acquireTaskSpace, demoShotsDir, clearDemoShots, setupDownloads, latestDownload, headOf, readAllText, installBlobCapture, resetBlobs, takeBlob,
  q, has, qText, txt, txtAll, attr, vis, box, boxText, val, scrollIntoView, treeClick,
  clickEl, clickText, rightClick, rightClickText, middleClick, middleClickText, dblClickEl, hoverEl, hoverText, selectText,
  press, type, fill,
  installErrors, errors,
  openApp, freshApp, resetMockFs, reloadApp,
  pageMd, goEnd, focusEditor,
  shot, shotTo, shotEl,
  newChecker,
}
