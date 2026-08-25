// embed-sync-composite-e2e —— registry 复合场景 + 边界回归
// ego-lite 驱动（【禁止 playwright】）运行：node tests/e2e/_run-one.js embed-sync-composite-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('embed-sync-composite-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const AP = '.editor-pane:not([style*="display: none"])'
const blockTexts = () => js(
  `[...document.querySelectorAll('${AP} .ref-file-block:not(.readonly):not(.is-collapsed) .ref-file-block-content')].map(e => e.textContent || '')`
)
const allBlocks = () => js(
  `[...document.querySelectorAll('${AP} .ref-file-block')].map(e => ({
     txt: (e.querySelector('.ref-file-block-content')?.textContent || ''),
     ro: e.classList.contains('readonly'),
     col: e.classList.contains('is-collapsed'),
     chain: e.getAttribute('data-chain') || null
   }))`
)
const diskOf = (p) => js(
  `(JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}').files[${L.J(p)}] || '')`
)
const toastTexts = () => js(`[...document.querySelectorAll('.toast')].map(t => t.textContent || '')`)
async function waitToastContaining(sub) {
  for (let i = 0; i < 40; i++) {
    if ((await toastTexts()).some((x) => x.includes(sub))) return true
    await L.waitMs(120)
  }
  return false
}
const tabDirty = (label) => js(`(() => {
  const el = [...document.querySelectorAll('.tab')].find(e => (e.textContent||'').includes(${L.J(label)}))
  return !!el && !!el.querySelector('.dot.dirty')
})()`)
const openTab = async (name, label) => {
  await L.clickText('.tree .name', name, { label })
  await L.waitMs(600)
}

const SEED = '数据库字段引用演示4444'
const SRC = '数据库字段引用.md'
const MK = 'milkdown-note-mock-fs-v2'

// 一次性种子：所有宿主/链/环在初始就绪
await js(`(() => {
  const fs = JSON.parse(localStorage.getItem(${L.J(MK)}) || '{}')
  fs.files['composite-a.md'] = '# 宿主A\\n\\n![[数据库字段引用]]\\n\\n![[数据库字段引用]]\\n\\n![[数据库字段引用|ro]]\\n\\n![[不存在源XYZ]]'
  fs.files['composite-b.md'] = '# 宿主B\\n\\n![[数据库字段引用]]'
  fs.files['composite-c.md'] = '# 宿主C\\n\\n![[数据库字段引用]]\\n\\n![[数据库字段引用]]'
  fs.files['base-chain.md'] = 'CHAIN-源文本\\n\\n第二行链'
  fs.files['l2.md'] = '# L2\\n\\n![[base-chain]]'
  fs.files['l1.md'] = '# L1\\n\\n![[l2]]'
  fs.files['cycA.md'] = '# 环A\\n\\n![[cycB]]'
  fs.files['cycB.md'] = '# 环B\\n\\n![[cycA]]'
  localStorage.setItem(${L.J(MK)}, JSON.stringify(fs))
})()`)
await L.reloadApp(2500)

// ================= 复合 CS1 + CS2：多宿主 + 源全开 =================
await openTab('数据库字段引用.md', '打开源')
await L.waitMs(2000)
await openTab('composite-a.md', '打开宿主A')
await L.waitMs(6000)
await openTab('composite-b.md', '打开宿主B')
await L.waitMs(5000)

// CS1：源未保存编辑 → 所有宿主块实时同步
await L.clickText('.tab', '数据库字段引用', { label: '切源' })
await L.waitMs(900)
await L.focusEditor()
await L.goEnd()
await L.waitMs(300)
await L.type('\n源复合编辑S1')
await L.waitMs(900)
await L.clickText('.tab', 'composite-a', { label: '切A' })
await L.waitMs(2000)
const ba = await blockTexts()
C.check('宿主A 块1/块2 实时同步源编辑', ba[0]?.includes('源复合编辑S1') && ba[1]?.includes('源复合编辑S1'))
C.check('宿主A 不脏（广播非用户编辑）', !(await tabDirty('composite-a')))
await L.clickText('.tab', 'composite-b', { label: '切B' })
await L.waitMs(2000)
C.check('宿主B 块实时同步源编辑', (await blockTexts())[0]?.includes('源复合编辑S1'))

// CS2：编辑宿主A 块1 → 兄弟块 + 宿主B 收敛；源tab 脏（有自身 S1 编辑）→ 不被覆盖（最后保存者胜）
await L.clickText('.tab', 'composite-a', { label: '切A编辑' })
await L.waitMs(900)
// composite-a 含 3 个 '数据库字段引用' 块（2 可编辑 + 1 只读）→ matches=3
const a1 = await js(`window.__editorBlockAppend('数据库字段引用', 'A块一改C2', 0)`)
C.check('A 块1 追加成功', a1 === 'inserted@3')
await L.waitMs(2200)
const ba2 = await blockTexts()
C.check('A 块1 含新内容', ba2[0]?.includes('A块一改C2'))
C.check('A 兄弟块收敛', ba2[1]?.includes('A块一改C2'))
await L.clickText('.tab', 'composite-b', { label: '切B(2)' })
await L.waitMs(1800)
C.check('宿主B 收敛 A 块1 编辑', (await blockTexts())[0]?.includes('A块一改C2'))
// 源tab 有自身 S1 编辑（未保存）→ A 块广播不覆盖它（保留源编辑）
await L.clickText('.tab', '数据库字段引用', { label: '切源(2)' })
await L.waitMs(1800)
const srcMd = await L.pageMd()
C.check('源tab 保留自身 S1 编辑（不被 A 块覆盖）', srcMd.includes('源复合编辑S1') && !srcMd.includes('A块一改C2'))

// ================= 边界 B1：只读块不参与、不被污染 =================
await L.clickText('.tab', 'composite-a', { label: '切A只读' })
await L.waitMs(1200)
const ab = await allBlocks()
const roB = ab.find((x) => x.ro)
const dead = ab.find((x) => !x.ro && !x.col && x.txt === '')
C.check('只读块存在且可编辑块已变', !!roB)
C.check('只读块未被广播污染（仍为源原始种子）', roB ? !roB.txt.includes('A块一改C2') && roB.txt.includes(SEED) : false)
C.check('断链块未物化（空内容）', !!dead)

// ================= 复合 CS3：链式嵌套级联 =================
await openTab('l1.md', '打开链L1')
await L.waitMs(6000)
C.check('L1 物化出 L2 内容', (await blockTexts())[0]?.includes('CHAIN-源文本'))
await openTab('base-chain.md', '打开链源')
await L.waitMs(1500)
await L.focusEditor()
await L.goEnd()
await L.waitMs(300)
await L.type('\n链源编辑级联X')
await L.waitMs(3000)
await L.clickText('.tab', 'l1', { label: '切链L1(2)' })
await L.waitMs(2200)
C.check('链式级联：L1 块含链源新内容', (await blockTexts())[0]?.includes('链源编辑级联X'))

// ================= 边界 B3：环形嵌套 → 环折叠 =================
await openTab('cycA.md', '打开环A')
await L.waitMs(6000)
const cyc = await allBlocks()
C.check('环 A→B→A 触发折叠卡', cyc.some((x) => x.col && (x.chain || '').includes('cycB')))
C.check('折叠块无物化内容', cyc.filter((x) => x.col).every((x) => x.txt === ''))
// 编辑别处，折叠块不被广播展开
await L.clickText('.tab', 'composite-b', { label: '切B编辑' })
await L.waitMs(900)
await js(`window.__editorBlockAppend('数据库字段引用', '无关编辑Z9', 0)`)
await L.waitMs(1800)
await L.clickText('.tab', 'cycA', { label: '切环A(2)' })
await L.waitMs(1500)
const cyc2 = await allBlocks()
C.check('环折叠块未被广播展开', cyc2.some((x) => x.col))

// ================= 复合 CS4 + B4：保存写回 / 未打开宿主收敛 =================
// 先把源tab 保存（脏灭）→ 后续宿主保存才能写回
await L.clickText('.tab', '数据库字段引用', { label: '切源保存' })
await L.waitMs(900)
await L.press('Control+s')
await L.waitMs(2500)
await L.clickText('.tab', 'composite-b', { label: '切B(3)' })
await L.waitMs(900)
await js(`window.__editorBlockAppend('数据库字段引用', 'B写回标记W', 0)`)
await L.waitMs(1800)
await L.press('Control+s')
await L.waitMs(3000)
C.check('保存 B 后源磁盘含 B 写回标记', (await diskOf(SRC)).includes('B写回标记W'))
await L.clickText('.tab', 'composite-a', { label: '切A(3)' })
await L.waitMs(1800)
C.check('宿主A 块刷新为 B 写回内容', (await blockTexts())[0]?.includes('B写回标记W'))

// ================= 边界 B5：源有真实未保存编辑 → 宿主保存不覆盖 =================
await L.clickText('.tab', '数据库字段引用', { label: '切源(3)' })
await L.waitMs(900)
await L.focusEditor()
await L.goEnd()
await L.waitMs(300)
await L.type('\n源私有编辑PY')
await L.waitMs(600)
C.check('源脏（真实编辑）', await tabDirty('数据库字段引用'))
await L.clickText('.tab', 'composite-a', { label: '切A(4)' })
await L.waitMs(900)
await js(`window.__editorBlockAppend('数据库字段引用', 'A宿主要覆盖X', 0)`)
await L.waitMs(2800)
const toastProbe = toastTexts() // 保存前先抓现有 toast，便于区分新增
await L.press('Control+s')
await L.waitMs(900)
const dws = await diskOf(SRC)
C.check('宿主保存未覆盖源未保存编辑', !dws.includes('A宿主要覆盖X') && !dws.includes('A块一改C2'))
C.check('写回跳过提示 toast', await waitToastContaining('跳过'))

// ================= 边界 B6：同源多块并发编辑内容不同 → 暂停 + 保存跳过 =================
await openTab('composite-c.md', '打开宿主C')
await L.waitMs(6000)
// 先让两块收敛为相同（编辑块1 → 兄弟收敛）
await js(`window.__editorBlockAppend('数据库字段引用', 'C基线AB', 0)`)
await L.waitMs(1800)
// 同一防抖窗口内对两块分别追加不同文本（模拟并发编辑）
const c1 = await js(`window.__editorBlockAppend('数据库字段引用', '并发块1AAA', 0)`)
const c2 = await js(`window.__editorBlockAppend('数据库字段引用', '并发块2BBB', 1)`)
C.check('C 双块追加成功', c1?.startsWith('inserted') && c2?.startsWith('inserted'))
await L.waitMs(1500)
const cc = await blockTexts()
cliLog('[debug] 并发后C块: ' + JSON.stringify(cc.map((x) => x.slice(-20))))
C.check('并发歧义：两块内容不同（未强制覆盖）', cc.length === 2 && cc[0] !== cc[1])
await L.press('Control+s')
await L.waitMs(900)
const dconf = await diskOf(SRC)
C.check('并发歧义保存未单块覆盖源', !dconf.includes('并发块1AAA') || !dconf.includes('并发块2BBB'))
C.check('写回不一致 toast', (await waitToastContaining('不一致')) || (await waitToastContaining('跳过')))

const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)
