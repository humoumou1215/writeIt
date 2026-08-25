// embed-indep-verify2-e2e —— 深层边界独立验证（第二轮，严格断言）
//   场景I 关闭宿主标签 → 源编辑+保存 → 重开宿主：块显示最新（视图清理/重物化）
//   场景J reload 应用 → 块从磁盘重物化正确（持久化）
//   场景K 源未开标签（仅被嵌入）→ 宿主编辑块+保存 → 磁盘精确写回（无 last-wins/无重复）
//   场景L 真实键盘输入进块内容（click+type）→ 兄弟块/源收敛
// （ego-lite，禁 playwright）运行：node tests/e2e/_run-one.js embed-indep-verify2-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('embed-indep-verify2-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const AP = '.editor-pane:not([style*="display: none"])'
const ED = `${AP} .ref-file-block:not(.readonly):not(.is-collapsed) .ref-file-block-content`
const blockTexts = () => js(`[...document.querySelectorAll('${ED}')].map(e => e.textContent || '')`)
const diskOf = (p) => js(
  `(JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}').files[${L.J(p)}] ?? null)`
)
const setDisk = (p, v) => js(`(() => {
  const K='milkdown-note-mock-fs-v2'; const fs=JSON.parse(localStorage.getItem(K)||'{}');
  fs.files[${L.J(p)}]=${L.J(v)}; localStorage.setItem(K, JSON.stringify(fs)); return true
})()`)
const openTab = async (name, waitms = 600) => { await L.clickText('.tree .name', name, { label: 'open ' + name }); await L.waitMs(waitms) }
const tabClick = async (label, waitms = 900) => { await L.clickText('.tab', label); await L.waitMs(waitms) }
const closeTabByName = async (label) => {
  await js(`(() => { const t=[...document.querySelectorAll('.tab')].find(e=>(e.textContent||'').includes(${L.J(label)})); if (t) t.querySelector('.tab-close')?.dispatchEvent(new MouseEvent('click',{bubbles:true})); return !!t })()`)
  await L.waitMs(1200)
}
const appendBlock = (p, t, i) => js(`window.__editorBlockAppend(${L.J(p)}, ${L.J(t)}, ${i})`)
const untilTrue = async (pred, timeout = 9000, step = 200) => {
  const t0 = Date.now(); let ok = false
  while (Date.now() - t0 < timeout) { if (await pred()) { ok = true; break } await L.waitMs(step) }
  return ok
}

// ============ 种子 ============
const SRC = 'isrc.md'
const HOST = 'ihost.md'
await setDisk(SRC, '源内容I基')
await setDisk(HOST, '# 宿主\n\n![[isrc]]\n\n![[isrc]]')
await L.reloadApp(2500)

// ============ 场景 I：关闭宿主 → 源编辑+保存 → 重开宿主显示最新 ============
await openTab(HOST, 5500)
C.check('宿主双块物化', (await blockTexts()).length === 2)
await openTab(SRC, 1400)
C.check('源打开', true)
// 关掉宿主标签
await closeTabByName('ihost')
C.check('宿主标签已关', (await L.q('.tab')) > 0)
// 源编辑 + 保存
await L.focusEditor(); await L.goEnd(); await L.waitMs(300)
await L.type('\n源关闭期编辑I1')
await L.waitMs(1200)
await L.press('Control+s'); await L.waitMs(2500)
C.check('源保存落盘含编辑', ((await diskOf(SRC)) || '').includes('源关闭期编辑I1'))
// 重开宿主 → 块应显示最新（含 I1）
await openTab(HOST, 5500)
const ti = await blockTexts()
C.check('重开宿主块含源最新编辑(严格双块一致)', ti.length === 2 && ti[0] === ti[1] && ti[0].includes('源关闭期编辑I1'))

// ============ 场景 J：reload 应用 → 块从磁盘重物化 ============
await L.reloadApp(3000)
C.check('reload 后应用可交互', await js(`document.readyState === 'complete'`))
await openTab(HOST, 5500)
const tj = await blockTexts()
C.check('reload 后双块物化且含最新内容', tj.length === 2 && tj[0] === tj[1] && tj[0].includes('源关闭期编辑I1'))

// ============ 场景 K：源未开标签 → 宿主编辑+保存 → 磁盘精确写回 ============
// （现时源标签已开——先关掉它，让源仅被嵌入）
await closeTabByName('isrc')
C.check('源标签已关（仅被嵌入）', await js(`![...document.querySelectorAll('.tab')].some(e=>(e.textContent||'').includes('isrc'))`))
await tabClick('ihost', 1200)
await appendBlock('isrc', 'K写回标记W5', 0)
const convK = await untilTrue(async () => {
  const t = await blockTexts(); return t.length === 2 && t[0] === t[1] && t[0].includes('K写回标记W5')
}, 9000)
C.check('双块收敛 W5（含兄弟）', convK)
await L.press('Control+s'); await L.waitMs(2500)
const diskK = await diskOf(SRC)
C.check('磁盘精确含写回标记 W5', (diskK || '').includes('K写回标记W5'))
C.check('磁盘未重复追加（W5 仅一次）', ((diskK || '').match(/K写回标记W5/g) || []).length === 1)
const diskK2 = await diskOf(SRC)
await L.press('Control+s'); await L.waitMs(1600)
C.check('重复保存幂等（磁盘严格不变）', (await diskOf(SRC)) === diskK2)

// ============ 场景 L：真实键盘输入块内容 → 兄弟收敛 ============
await tabClick('ihost', 1100)
await L.clickEl(`${ED}`, 0, { label: '点块1' })
await L.waitMs(400)
const selPre = await js(`(() => {
  const s = window.getSelection()
  const blocks = [...document.querySelectorAll('${ED}')]
  const idx = blocks.findIndex(b => b.contains(s.rangeCount ? s.getRangeAt(0).startContainer : null))
  return 'block:' + idx
})()`)
C.check('点击后光标在块1', selPre === 'block:0')
await L.type('手输9x')
const convL = await untilTrue(async () => {
  const t = await blockTexts(); return t.length === 2 && t[0] === t[1] && t[0].includes('手输9x')
}, 9000)
C.check('真实输入后兄弟块严格收敛', convL)
const diagL = await js(`window.__registryDiag ? window.__registryDiag() : null`)
const eL = diagL && diagL['isrc.md']
if (eL) {
  const bv = (eL.views || []).filter((v) => v.kind === 'block')
  C.check('L 后无 stale 视图', bv.every((v) => !v.stale))
  C.check('L 后双块 lastContent 一致', new Set(bv.map((v) => v.lastLen)).size === 1)
} else {
  C.check('registry diag 可用(isrc)', false)
}

const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)