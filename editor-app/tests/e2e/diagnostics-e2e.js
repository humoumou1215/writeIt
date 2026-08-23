// diagnostics-e2e —— 问题诊断包（D1-D3）：Logger 安装 / 双入口 / 弹窗勾选 / 生成包完整性 /
//                    元素勾选联动（取消文档内容→无 07） / 全局异常自动提示+红点 / 复制要点
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js diagnostics-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('diagnostics-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock', 3800)

// ---- A: Logger + 入口 ----
const hasDiag = await js(`typeof window.__diag === 'object'`)
C.check('A1: __diag 已安装（logger 副作用启动）', hasDiag === true)
const logCount = await js(`window.__diag.logCount()`)
C.check('A2: 日志环非空（含 boot）', logCount >= 1)
const iconBtns = await js(`document.querySelectorAll('.icon-btn').length`)
C.check('A3: 图标列 7 按钮（新增 🩺）', iconBtns === 7)
const statusDiag = await js(`document.querySelector('.diag-entry') ? document.querySelector('.diag-entry').textContent.trim() : null`)
C.check('A4: 状态栏「诊断」入口', (statusDiag || '').includes('诊断'))

// ---- B: 弹窗与默认勾选 ----
await L.clickEl('.icon-btn', 6, { label: '打开诊断' })
await L.waitMs(700)
const modalH = await js(`document.querySelector('.diag-modal h3') ? document.querySelector('.diag-modal h3').textContent.trim() : null`)
C.check('B1: 弹窗打开（🩺 问题诊断）', (modalH || '').includes('诊断'))
const checks = await js(`[...document.querySelectorAll('.diag-modal .inc-item input')].map(i => i.checked).join(',')`)
C.check('B2: 截图/DOM/文档/路径 默认全勾', checks === 'true,true,true,true')
const lead = await js(`document.querySelector('.diag-modal .lead') ? document.querySelector('.diag-modal .lead').textContent : ''`)
C.check('B3: 引导语无门槛（无需描述细节）', (lead || '').includes('无需描述细节'))
await L.press('Escape')
await L.waitMs(400)

// ---- C: 打开文档（产生 tab:open 埋点）+ mermaid 预览（产生渲染埋点） ----
await L.treeClick('Mermaid 图表集.md')
await L.waitMs(2600)
const hasPreviewBtn = await js(`document.querySelectorAll('.preview-toggle-button').length`)
if (hasPreviewBtn > 0) {
  await L.clickEl('.preview-toggle-button', 0, { label: '开预览' })
  await L.waitMs(3200)
}
const timeline = await js(`window.__diag.timeline.map(e => e.type).join(',')`)
C.check('C1: 轨迹含 app:boot', (timeline || '').includes('app:boot'))
C.check('C2: 轨迹含 tab:open', (timeline || '').includes('tab:open'))
const hasMermaid = await js(`window.__diag.timeline.some(e => e.type === 'mermaid:render')`)
C.check('C3: mermaid 渲染埋点（成功路径）', hasMermaid === true)

// ---- D: 生成诊断包（默认全勾） ----
const gen = await js(`(async () => await window.__diagnostics.generate({ snapshot: true, dom: true, doc: true, paths: true }, '诊断 e2e：mermaid 没渲染'))()`)
C.check('D1: 生成 ok', !!gen && gen.ok === true)
C.check('D2: 11 文件（含 00-summary/06-snapshot/07/08-probes）', !!gen && gen.entryCount === 11 && gen.files.includes('06-snapshot.svg') && gen.files.includes('07-document.md') && gen.files.includes('08-probes.json') && gen.files.includes('00-summary.md'))
C.check('D3: manifest schemaVersion=2 + index 索引', !!gen && gen.manifest.schemaVersion === 2 && Array.isArray(gen.manifest.index) && gen.manifest.index.length >= 9)
const envOk = await js(`(async () => { const r = await window.__diagnostics.generate({ snapshot: false, dom: false, doc: false, paths: false }); return r })()`)
C.check('D4: 最小勾选 → 仅常备文件（无 06/07/08）', !!envOk && envOk.entryCount === 8 && !envOk.files.some(f => f.startsWith('06') || f.startsWith('07') || f.startsWith('08')))
const bootLogged = await js(`window.__diag.logs.some(l => (l.msg || '').includes('诊断服务启动'))`)
C.check('D5: 日志含 boot 事件', bootLogged === true)

// ---- E: 取消「文档内容」「截图」→ 包内无 06/07 ----
const gen2 = await js(`(async () => await window.__diagnostics.generate({ snapshot: false, dom: true, doc: false, paths: true }, ''))()`)
C.check('E1: 取消后无 06/07', !!gen2 && !gen2.files.includes('06-snapshot.svg') && !gen2.files.includes('07-document.md'))
// ---- F: 全局异常 → toast + 图标/状态栏红点 → 打开弹窗后熄灭 ----
await js(`window.__diagnostics.throwError('diagnostics-e2e 注入异常')`)
await L.waitMs(700)
const toastTexts = await js(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')`)
C.check('F1: 异常 toast 提示（含「诊断」字眼）', (toastTexts || '').includes('诊断'))
const errLogged = await js(`window.__diag.logs.some(l => l.level === 'error' && l.area === 'window' && (l.msg || '').includes('注入异常'))`)
C.check('F2: error 日志捕获', errLogged === true)
const iconDot = await js(`document.querySelector('.icon-btn .diag-dot') ? true : false`)
const statusDot = await js(`document.querySelector('.diag-entry.dot') ? true : false`)
C.check('F3: 图标列红点亮起', iconDot === true)
C.check('F4: 状态栏红点亮起', statusDot === true)
await L.clickEl('.icon-btn', 6, { label: '打开诊断' })
await L.waitMs(600)
const dotAfter = await js(`document.querySelector('.diag-entry.dot') ? true : false`)
C.check('F5: 打开弹窗后红点熄灭', dotAfter === false)
await L.press('Escape')
await L.waitMs(300)

// ---- G: 复制要点（localhost 剪贴板能力；不回读——无头环境权限请求可能挂起） ----
const copyRes = await Promise.race([
  js(`(async () => {
    try {
      await navigator.clipboard.writeText('[WriteIt] 测试复制')
      return true
    } catch { return false }
  })()`),
  new Promise((r) => setTimeout(() => r('pending'), 3000)),
])
C.check('G1: 剪贴板可写（复制要点依赖能力）', copyRes === true)

// ---- H: 设置面板「诊断」组（无头下 Ctrl+, 不可靠 → 点设置图标） ----
await L.clickEl('.icon-btn', 3, { label: '设置' })
await L.waitMs(700)
const diagGroup = await js(`[...document.querySelectorAll('.settings-modal .group-title')].some(e => (e.textContent || '').includes('诊断'))`)
C.check('H1: 设置页含「诊断」组', diagGroup === true)
const diagBtnInSettings = await js(`[...document.querySelectorAll('.settings-modal button')].some(b => (b.textContent || '').includes('生成诊断包'))`)
C.check('H2: 设置页可打开诊断', diagBtnInSettings === true)
await L.press('Escape')
await L.waitMs(400)

// ---- I: 分层探针（08-probes.json：ui/diff/editor/compat/monitor） ----
const probes = await js(`window.__diagnostics.probes()`)
C.check('I1: compat.colorMix 已探测', probes && (probes.compat.colorMix === 'yes' || probes.compat.colorMix === 'no') && probes.compat.colorMixUsages > 0)
C.check('I2: editor 探针（实例数=1）', probes && probes.editor && probes.editor.tabs && probes.editor.tabs.count >= 1)
C.check('I3: monitor fps 采样字段存在', probes && probes.monitor && 'sampled' in probes.monitor.fps)
C.check('I4: ui 探针 editorPane 存在', probes && probes.ui && probes.ui.editorPane !== null && probes.ui.editorPane !== undefined)
C.check('I5: diff 探针结构（mermaid/text 字段）', probes && probes.diff && Array.isArray(probes.diff.mermaid.del) && 'trulyRedDels' in probes.diff)
// 摘要含关键结论
const sum = gen.summaryHead || ''
C.check('I6: AI 摘要含「关键结论」和「分层指标」', sum.includes('关键结论') && sum.includes('分层指标'))
const domLen = await js(`(() => { const r = window.__diag; return r.logs.filter(l => l.area === 'console' && (l.msg || '').includes('截图失败')).length })()`)
C.check('I7: 无截图链路报错（SVG 快照方案）', domLen === 0)

cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)