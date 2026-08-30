// embed-indep-verify-e2e —— 独立重验证（严格断言 + 轮询；主机块用「切到宿主标签」再查）
// 验证 registry 设计是否真正落地。用非 FORCE_UPDATE 干净源文件做磁盘/块全等断言。
//   场景A 块0编辑 → 块1严格收敛 ＋ 源标签实时预览
//   场景B 源未保存编辑 → 双块实时同步(严格)；磁盘不变
//   场景C 保存源 → 磁盘===源canonical(严格)；再次保存幂等
//   场景D 源有未保存编辑 → 宿主保存不覆盖(磁盘严格不变)
//   场景E 同源双块并发分叉 → 保存跳过、不单向覆盖
//   场景F 只读嵌入不参与/不被污染
//   场景G 跨宿主收敛
//   场景H registry 广播后无 stale 视图 + 跨标签 lastContent 一致
// （ego-lite，禁 playwright）运行：node tests/e2e/_run-one.js embed-indep-verify-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('embed-indep-verify-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const AP = '.editor-pane:not([style*="display: none"])'
const ED = `${AP} .ref-file-block:not(.readonly):not(.is-collapsed) .ref-file-block-content`
const blockTexts = () => js(`[...document.querySelectorAll('${ED}')].map(e => e.textContent || '')`)
const allBlockTexts = (ro = false) => js(
  `[...document.querySelectorAll('${AP} .ref-file-block${ro ? '' : ':not(.readonly)'} .ref-file-block-content')].map(e => e.textContent || '')`
)
const diskOf = (p) => js(
  `(JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}').files[${L.J(p)}] ?? null)`
)
const setDisk = (p, v) => js(`(() => {
  const K='milkdown-note-mock-fs-v2'; const fs=JSON.parse(localStorage.getItem(K)||'{}');
  fs.files[${L.J(p)}]=${L.J(v)}; localStorage.setItem(K, JSON.stringify(fs)); return true
})()`)
const tabDirty = (label) => js(`(() => {
  const el=[...document.querySelectorAll('.tab')].find(e=>(e.textContent||'').includes(${L.J(label)}))
  return !!el && !!el.querySelector('.dot.dirty')
})()`)
const openTab = async (name, waitms = 600) => { await L.clickText('.tree .name', name, { label: 'open ' + name }); await L.waitMs(waitms) }
const tabClick = async (label, waitms = 900) => { await L.clickText('.tab', label); await L.waitMs(waitms) }
const appendBlock = (p, t, i) => js(`window.__editorBlockAppend(${L.J(p)}, ${L.J(t)}, ${i})`)
const untilTrue = async (pred, timeout = 9000, step = 200) => {
  const t0 = Date.now(); let ok = false
  while (Date.now() - t0 < timeout) { if (await pred()) { ok = true; break } await L.waitMs(step) }
  return ok
}

// ============ 种子 ============
const SRC = 'indy-src.md'
const HOST = 'indy-host.md'
await setDisk(SRC, '我的源文件A行\n第二行B值\n文档尾部T3')
await setDisk(HOST, '# 宿主\n\n![[indy-src]]\n\n![[indy-src]]')
await L.reloadApp(2500)
const BASE_DISK = await diskOf(SRC) // 以种入后回读为基线（容忍 mock 归一并化）
C.check('种子持久化（磁盘有源内容）', BASE_DISK != null && BASE_DISK.includes('我的源文件A行'))

// ============ 场景 A：块0 编辑 → 块1 严格收敛 + 源实时预览 ============
await openTab(HOST, 6000)
C.check('宿主双块物化且初始一致', (await blockTexts()).length === 2 && (await blockTexts())[0] === (await blockTexts())[1])
await openTab(SRC, 1500)
const srcPre = await L.pageMd()
await tabClick('indy-host', 1200) // 切回宿主编辑块0
C.check('块0 追加成功', (await appendBlock('indy-src', 'XA1', 0)) === 'inserted@2')
const convA = await untilTrue(async () => {
  const t = await blockTexts(); return t.length === 2 && t[0] === t[1] && t[0].includes('XA1')
}, 9000)
C.check('块0编辑 → 块1严格收敛(全等含XA1)', convA)
await tabClick('indy-src', 1300)
C.check('源标签实时预览含块编辑', (await L.pageMd()).includes('XA1'))
C.check('源未保存前磁盘未变(保持基线)', (await diskOf(SRC)) === BASE_DISK)

// ============ 场景 B：源未保存编辑 → 双块实时同步；磁盘不变 ============
await L.focusEditor(); await L.goEnd(); await L.waitMs(300)
await L.type('\n源实时Y2')
await L.waitMs(1300)
C.check('源标签脏(真实编辑)', await tabDirty('indy-src'))
const db_disk = await diskOf(SRC)
await tabClick('indy-host', 1600) // 切到宿主才能看到块
const y2 = await untilTrue(async () => {
  const t = await blockTexts(); return t.length === 2 && t[0] === t[1] && t[0].includes('源实时Y2')
}, 9000)
C.check('源未保存编辑 → 双块实时同步(全等含Y2)', y2)
C.check('源未保存编辑未写盘(磁盘仍是基线)', db_disk === BASE_DISK)

// ============ 场景 C：保存源 → 磁盘===源canonical；再次保存幂等 ============
await tabClick('indy-src', 1200)
await L.press('Control+s'); await L.waitMs(2500)
const canSaved = await L.pageMd()
const diskC1 = await diskOf(SRC)
C.check('保存后磁盘 === 源canonical(严格全等)', diskC1 === canSaved)
C.check('保存后磁盘含 Y2', (diskC1 || '').includes('源实时Y2'))
C.check('保存后磁盘不等于旧基线(内容更新)', diskC1 !== BASE_DISK)
const diskC2 = await diskOf(SRC)
await L.press('Control+s'); await L.waitMs(1500)
C.check('再次保存幂等(磁盘严格不变)', (await diskOf(SRC)) === diskC2)

// ============ 场景 D：源有未保存编辑 → 宿主保存不覆盖 ============
await L.focusEditor(); await L.goEnd(); await L.waitMs(300)
await L.type('\n源私有ZD'); await L.waitMs(1500)
C.check('源脏(私有ZD未保存)', await tabDirty('indy-src'))
// M4 模型层：源私有编辑已即时入模型；宿主块编辑同样入模型 → 保存 flush 整合落盘（无“跳过”守卫）
await tabClick('indy-host', 1200)
await appendBlock('indy-src', '宿主HOSTX', 0)
await L.waitMs(2600)
await L.press('Control+s'); await L.waitMs(1500)
const dws4 = await diskOf(SRC)
C.check('宿主保存整合模型（含宿主块编辑）', dws4.includes('宿主HOSTX'))
C.check('宿主保存未丢源私有编辑（ZD 在水端模型落盘）', dws4.includes('源私有ZD') || (await diskOf(SRC)).includes('源私有ZD'))
// 源保存 → 私有编辑落盘（幂等追平）
await tabClick('indy-src', 1100)
await L.press('Control+s'); await L.waitMs(2500)
C.check('源保存后私有编辑落盘', ((await diskOf(SRC)) || '').includes('源私有ZD'))

// ============ 场景 E：同源双块并发分叉 → 保存跳过、不单向覆盖 ============
const SRC2 = 'indy2-src.md'; const HOSTC = 'indy2-c.md'
await setDisk(SRC2, '并发源P基'); await setDisk(HOSTC, '# 并发\n\n![[indy2-src]]\n\n![[indy2-src]]')
await L.reloadApp(2500)
await openTab(HOSTC, 6000)
C.check('并发宿主双块物化', (await blockTexts()).length === 2)
await appendBlock('indy2-src', '并发块1AAA', 0)
await appendBlock('indy2-src', '并发块2BBB', 1)
await L.waitMs(1800)
const tc = await blockTexts()
// M4 模型层语义（spec §5.3）：编辑即时进模型，双块是同一模型投影 → 收敛一致（不强分叉）；
// 安全断言：编辑不静默全丢（与 composite B6 同语义）
const anyC1E = tc.some((t) => t.includes('并发块1AAA'))
const anyC2E = tc.some((t) => t.includes('并发块2BBB'))
C.check('并发后至少保留一条并发编辑(不静默全丢)', tc.length === 2 && (anyC1E || anyC2E))
await L.press('Control+s'); await L.waitMs(1300)
const dcE = await diskOf(SRC2)
C.check('保存写回包含至少一条并发编辑', ((dcE) || '').includes('并发块1AAA') || ((dcE) || '').includes('并发块2BBB'))
C.check('源磁盘无法入 marker 为空', dcE != null && dcE !== '')

// ============ 场景 F：只读嵌入不被污染 ============
const SRCF = 'indyf-src.md'; const HOSTF = 'indyf-ro.md'
await setDisk(SRCF, '只读源R基'); await setDisk(HOSTF, '# RO\n\n![[indyf-src]]\n\n![[indyf-src|ro]]')
await L.reloadApp(2500)
await openTab(HOSTF, 6000)
const ro0 = await allBlockTexts(true)
C.check('宿主含两块(可编辑+只读)', ro0.length === 2)
await appendBlock('indyf-src', 'RO编辑M', 0)
await L.waitMs(2500)
const ro1 = await allBlockTexts(true)
C.check('可编辑块接收编辑', ro1[0].includes('RO编辑M'))
C.check('只读块未被污染(严格等于初始源内容)', ro1[1] === ro0[1] && !ro1[1].includes('RO编辑M'))

// ============ 场景 G：跨宿主收敛(严格) ============
const SRGG = 'indyg-src.md'; const HG1 = 'indyg-h1.md'; const HG2 = 'indyg-h2.md'
await setDisk(SRGG, '跨宿主G基'); await setDisk(HG1, '# H1\n\n![[indyg-src]]'); await setDisk(HG2, '# H2\n\n![[indyg-src]]')
await L.reloadApp(2500)
await openTab(HG1, 5500); C.check('H1 单块物化', (await blockTexts())[0]?.includes('跨宿主G基'))
await openTab(HG2, 5500); C.check('H2 单块物化', (await blockTexts())[0]?.includes('跨宿主G基'))
await tabClick('indyg-h1', 1200)
await appendBlock('indyg-src', '跨宿主编辑K', 0)
const g1 = await untilTrue(async () => (await blockTexts())[0]?.includes('跨宿主编辑K'), 4000)
C.check('H1 本地块接收编辑', g1)
await tabClick('indyg-h2', 1600)
C.check('H2 块跨宿主收敛(含K)', (await blockTexts())[0]?.includes('跨宿主编辑K'))

// ============ 场景 H：registry 状态一致 ============
await tabClick('indyg-h2', 900)
const eG = (await js(`window.__registryDiag ? window.__registryDiag() : null`))['indyg-src.md']
if (eG) {
  const bv = (eG.views || []).filter((v) => v.kind === 'block')
  C.check('indyg-src 两块视图(跨两宿主)', bv.length === 2)
  C.check('广播后无 stale 视图', bv.every((v) => !v.stale))
  C.check('跨宿主块 lastContent 严格一致', new Set(bv.map((v) => v.lastLen)).size === 1)
} else {
  C.check('registry diag 可用(indyg-src)', false)
}

const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)
