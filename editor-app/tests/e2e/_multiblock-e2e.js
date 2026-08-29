// _multiblock-e2e —— M4b 多块/跨界编辑收敛验证（临时套件，不进 run-all）
// 目标：证明「一次事务跨两块」的编辑走模型（commitMultiBlockCanonical：逐受影块
// 序列化 → replaceFromCanonical → 源模型 rev++ + dispatcher 分发），不依赖旧
// propagateBlockEdits（m4diag.propagateBlockEdits Δ==0 即证明）。
// 注：跨块「删除」在 PM 层会合并/移除块节点（旧架构同样近似），故用可确定语义的
// 「跨块加粗（AddMarkStep 单步跨界）」为主证明；辅以整块删除源不变、链式基线。
// 运行：node tests/e2e/_run-one.js _multiblock-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('_multiblock-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const AP = '.editor-pane:not([style*="display: none"])'
const blockTexts = () => js(
  `[...document.querySelectorAll('${AP} .ref-file-block:not(.readonly):not(.is-collapsed) .ref-file-block-content')].map(e => (e.textContent || '').trim())`
)
const diskOf = (p) => js(
  `(JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}').files[${L.J(p)}] || '')`
)
const m4 = () => js(`(window.__m4diag ? window.__m4diag() : null)`)
const modelRev = (p) => js(`(() => {
  const m = (window.__docstoreInspect ? __docstoreInspect().models : [])
  const x = m.find(y => y.realPath === ${L.J(p)})
  return x ? x.rev : -1
})()`)
const openTab = async (name, label, waitms = 600) => {
  await L.clickText('.tree .name', name, { label })
  await L.waitMs(waitms)
}

const MK = 'milkdown-note-mock-fs-v2'
await js(`(() => {
  const fs = JSON.parse(localStorage.getItem(${L.J(MK)}) || '{}')
  fs.files['sA1.md'] = 'AAA-111'
  fs.files['sB1.md'] = 'BBB-222'
  fs.files['sA2.md'] = 'AAA-111'
  fs.files['sB2.md'] = 'BBB-222'
  fs.files['sS.md'] = 'SSS-999'
  fs.files['probeB.md'] = '# MB加粗\\n\\n![[sA2]]\\n\\n![[sB2]]'
  fs.files['probeSyncA.md'] = '# MB联调A\\n\\n![[sA2]]\\n\\n![[sA2]]'
  fs.files['probeDel.md'] = '# MB整块删除\\n\\n![[sA1]]\\n\\n![[sB1]]'
  fs.files['base-chain.md'] = '链底文本一\\n\\n链底文本二'
  fs.files['l2.md'] = '# L2\\n\\n![[base-chain]]'
  fs.files['l1.md'] = '# L1\\n\\n![[l2]]'
  localStorage.setItem(${L.J(MK)}, JSON.stringify(fs))
})()`)
await L.reloadApp(2500)

// ============ 场景 1：跨两块加粗（单个 AddMarkStep 跨界，blockEdits.size===0） ============
await openTab('sA2.md', '打开源A2')
await L.waitMs(1200)
await openTab('sB2.md', '打开源B2')
await L.waitMs(1200)
await openTab('probeB.md', '打开 probeB')
await L.waitMs(6000)
C.check('probeB 双块物化', (await blockTexts()).length === 2)
const pre1 = await m4()
const op1 = await js(`window.__editorCrossEdit('bold', 'sA2', 0, '', 'sB2', 0, '222')`)
cliLog('[debug] 跨界加粗 op: ' + String(op1))
await L.waitMs(2400)
const d1 = await m4()
cliLog('[debug] 加粗 m4diag Δ: ' + JSON.stringify({ multi: (d1?.commitMultiOk ?? 0) - (pre1?.commitMultiOk ?? 0), prop: (d1?.propagateBlockEdits ?? 0) - (pre1?.propagateBlockEdits ?? 0), single: (d1?.commitBlockStepsOk ?? 0) - (pre1?.commitBlockStepsOk ?? 0) }))
C.check('加粗走多块路径（commitMultiOk +2）', (d1?.commitMultiOk ?? 0) > (pre1?.commitMultiOk ?? 0) + 1)
C.check('加粗未走 propagateBlockEdits 旧路', (d1?.propagateBlockEdits ?? 0) === (pre1?.propagateBlockEdits ?? 0))
C.check('加粗未走单块精映射（跨界不入单块路径）', (d1?.commitBlockStepsOk ?? 0) === (pre1?.commitBlockStepsOk ?? 0))
await js(`window.__saveActiveTab()`)
await L.waitMs(3000)
const diskA2 = await diskOf('sA2.md')
const diskB2 = await diskOf('sB2.md')
cliLog('[debug] 加粗保存后 sA2: ' + JSON.stringify(diskA2.slice(0, 30)) + ' sB2: ' + JSON.stringify(diskB2.slice(0, 30)))
C.check('加粗后 sA2 磁盘含 **', diskA2.includes('**') && diskA2.includes('AAA'))
C.check('加粗后 sB2 磁盘含 **', diskB2.includes('**') && diskB2.includes('BBB'))
// 第三方宿主（两块 sA2）经 dispatcher canonical 对齐
await openTab('probeSyncA.md', '打开 probeSyncA')
await L.waitMs(4500)
const syncTxt = await blockTexts()
const strongCount = await js(`[...document.querySelectorAll('${AP} .ref-file-block-content strong')].length`)
cliLog('[debug] probeSyncA 块: ' + JSON.stringify(syncTxt) + ' strong=' + strongCount)
C.check('第三方宿主两块被 dispatcher 对齐（内容一致 + 加粗 mark 也同步）', syncTxt.length >= 2 && syncTxt.every((t) => t.includes('AAA-111')) && strongCount >= 2)

// ============ 场景 2：整体移除嵌入块 → 源不变（删除嵌入标记≠删源文件） ============
await openTab('sA1.md', '打开源A1')
await L.waitMs(1200)
await openTab('probeDel.md', '打开 probeDel')
await L.waitMs(6000)
C.check('probeDel 双块物化', (await blockTexts()).length === 2)
const pre2 = await m4()
const rA = await modelRev('sA1.md')
// 整体删除第一块（移除 ![[sA1]] 嵌入标记）
const op2 = await js(`window.__editorRemoveBlock('sA1', 0)`)
cliLog('[debug] 移除嵌入块 op: ' + String(op2))
await L.waitMs(2200)
const d2 = await m4()
const rA2 = await modelRev('sA1.md')
// 模型内容不交叉污染（修复验证：旧坐标序列化 bug 曾把 B 内容写进 sA1 模型）
const d2Model = await js(`(() => {
  const m = __docstoreInspect?.()?.models ?? []
  const x = m.find(y => y.realPath === 'sA1.md')
  return x ? { rev: x.rev, preview: x.blocks.map(b => b.textPreview) } : null
})()`)
cliLog('[debug] 移除嵌入块 m4diag Δ: ' + JSON.stringify({ multi: (d2?.commitMultiOk ?? 0) - (pre2?.commitMultiOk ?? 0), prop: (d2?.propagateBlockEdits ?? 0) - (pre2?.propagateBlockEdits ?? 0) }) + ' sA1 rev ' + rA + ' -> ' + rA2 + ' model=' + JSON.stringify(d2Model))
C.check('移除嵌入块后源 sA1 模型未被污染', d2Model?.rev === rA && d2Model?.preview?.length === 1 && d2Model.preview[0] === 'AAA-111')
await js(`window.__saveActiveTab()`)
await L.waitMs(2500)
const diskA1 = await diskOf('sA1.md')
cliLog('[debug] 移除嵌入块后 sA1 磁盘: ' + JSON.stringify(diskA1.slice(0, 60)))
C.check('移除嵌入块保存后 sA1 磁盘仍为原始', diskA1.includes('AAA-111'))

// ============ 场景 3：单块追加（M3a 精映射回归，保绿） ============
await openTab('sB1.md', '打开源B1')
await L.waitMs(1200)
await openTab('probeB.md', '切回 probeB 单块追加')
await L.waitMs(900)
const pre3 = await m4()
await js(`window.__editorBlockAppend('sB2', ' 单块追加T', 0)`)
await L.waitMs(2200)
const d3 = await m4()
cliLog('[debug] 单块追加 m4diag Δ: ' + JSON.stringify({ single: (d3?.commitBlockStepsOk ?? 0) - (pre3?.commitBlockStepsOk ?? 0), multi: (d3?.commitMultiOk ?? 0) - (pre3?.commitMultiOk ?? 0), prop: (d3?.propagateBlockEdits ?? 0) - (pre3?.propagateBlockEdits ?? 0) }))
C.check('单块追加走 M3a 精映射（commitBlockStepsOk +1）', (d3?.commitBlockStepsOk ?? 0) > (pre3?.commitBlockStepsOk ?? 0))
C.check('单块追加未走旧路', (d3?.propagateBlockEdits ?? 0) === (pre3?.propagateBlockEdits ?? 0))
C.check('单块追加落进该块（idx1=sB2 块）', (await blockTexts())[1]?.includes('单块追加T'))

// ============ 场景 4：链式级联基线（l1→l2→base） ============
await openTab('l1.md', '打开链L1')
await L.waitMs(6000)
C.check('L1 物化出 L2 内容', (await blockTexts())[0]?.includes('链底'))
await openTab('base-chain.md', '打开链底')
await L.waitMs(1500)
await L.focusEditor()
await L.goEnd()
await L.waitMs(300)
await L.type('\n链底编辑X')
await L.waitMs(3200)
await openTab('l1.md', '切回 L1')
await L.waitMs(2500)
C.check('链式级联：L1 块含链底新内容', (await blockTexts())[0]?.includes('链底编辑X'))

const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)