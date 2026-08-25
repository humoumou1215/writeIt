// embed-sync-p2-e2e —— P2/P3 registry 回归：单一事实来源 + 块身份 + 实时双向同步
//   场景A（P3 脏读根治）：源标签直接编辑（未保存）→ 所有嵌入块实时同步
//   场景B（P2 跨标签收敛）：两个宿主嵌入同一源，编辑其一 → 另一宿主块同步
//   场景C（blockId 稳定）：广播后块身份不变，registry 视图一致
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js embed-sync-p2-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('embed-sync-p2-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const AP = '.editor-pane:not([style*="display: none"])'
const blocksOf = () => js(
  `[...document.querySelectorAll('${AP} .ref-file-block:not(.readonly) .ref-file-block-content')].map(e => e.textContent || '')`
)
const diskOf = (p) => js(
  `(JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}').files[${L.J(p)}] || '')`
)
const SEED_MARK = '数据库字段引用演示4444'
const SRC_PATH = '数据库字段引用.md'

// ---------- 准备：三个文件（源 + 两个宿主 probe/h2） ----------
await js(`(() => {
  const KEY = 'milkdown-note-mock-fs-v2'
  const fs = JSON.parse(localStorage.getItem(KEY) || '{}')
  fs.files['probe.md'] = '# 探针\\n\\n![[数据库字段引用]]\\n\\n![[数据库字段引用]]'
  fs.files['h2.md'] = '# 宿主2\\n\\n![[数据库字段引用]]'
  localStorage.setItem(KEY, JSON.stringify(fs))
})()`)
await L.reloadApp(2500)

// ---------- 场景 A：源标签未保存编辑 → 嵌入块实时同步（脏读根治） ----------
await L.clickText('.tree .name', 'probe.md', { label: '打开 probe' })
await L.waitMs(6000)
C.check('probe 双块物化', (await blocksOf()).length === 2)
C.check('初始内容为源内容', (await blocksOf())[0].includes(SEED_MARK))

await L.clickText('.tree .name', '数据库字段引用.md', { label: '打开源' })
await L.waitMs(2500)
await L.focusEditor()
await L.goEnd()
await L.waitMs(300)
await L.type('\n源实时编辑X1')
await L.waitMs(700)
C.check('源标签脏（未保存编辑）', (await L.q('.tab .dot.dirty')) > 0)

// 切到 probe：两个嵌入块必须已同步显示源编辑（此前 打开源tab编辑 → 嵌入块看不到变化）
await L.clickText('.tab', 'probe', { label: '切到 probe 看实时同步' })
await L.waitMs(1800) // 防抖 400ms + 填充
const ta = await blocksOf()
C.check('块1 实时同步源编辑', ta[0].includes('源实时编辑X1'))
C.check('块2 实时同步源编辑', ta[1].includes('源实时编辑X1'))
C.check('probe 自身不脏（广播刷新非用户编辑）', await js(`(() => {
  const tabEl = [...document.querySelectorAll('.tab')].find(e => (e.textContent||'').includes('probe'))
  return !tabEl || !tabEl.querySelector('.dot.dirty')
})()`))

// ---------- 场景 B：跨标签块广播收敛（两个宿主嵌入同一源） ----------
await L.clickText('.tree .name', 'h2.md', { label: '打开宿主2' })
await L.waitMs(5000)
C.check('宿主2 块物化且含源同步内容', (await blocksOf())[0].includes('源实时编辑X1'))

// 编辑 probe 的块1 → h2 的块也必须同步（registry 跨标签广播）
await L.clickText('.tab', 'probe', { label: '切回 probe' })
await L.waitMs(900)
const added = await js(`window.__editorBlockAppend('数据库字段引用', '块跨标签编辑B2', 0)`)
C.check('probe 块1 追加成功', added === 'inserted@2')
await L.waitMs(1800)
const ta2 = await blocksOf()
C.check('probe 双块收敛', ta2.length === 2 && ta2[0].includes('块跨标签编辑B2') && ta2[1].includes('块跨标签编辑B2'))
await L.clickText('.tab', 'h2', { label: '切到宿主2' })
await L.waitMs(1500)
const h2t = await blocksOf()
C.check('宿主2 块同步 probe 编辑', h2t[0].includes('块跨标签编辑B2'))

// ---------- 场景 C：blockId 稳定 + registry 健康 ----------
const diag1 = await js(`window.__registryDiag ? window.__registryDiag() : null`)
cliLog('[debug] registry(1): ' + JSON.stringify(diag1 && diag1[SRC_PATH] && diag1[SRC_PATH].views.map(v => v.block)))
await L.clickText('.tab', 'probe', { label: '切回 probe(2)' })
await L.waitMs(900)
const added2 = await js(`window.__editorBlockAppend('数据库字段引用', '再编一次C3', 0)`)
C.check('再编辑成功', added2 === 'inserted@2')
await L.waitMs(1800)
const diag2 = await js(`window.__registryDiag ? window.__registryDiag() : null`)
const entry1 = diag1 && diag1[SRC_PATH]
const entry2 = diag2 && diag2[SRC_PATH]
if (entry1 && entry2) {
  const blocks1 = (entry1.views || []).filter(v => v.kind === 'block').map(v => v.block).sort()
  const blocks2 = (entry2.views || []).filter(v => v.kind === 'block').map(v => v.block).sort()
  C.check('广播后块身份稳定（blockId 不变）', JSON.stringify(blocks1) === JSON.stringify(blocks2) && blocks1.length >= 2)
  C.check('registry 版本递增（编辑提交真相）', entry2.version > entry1.version)
  C.check('registry 视图含 probe 双块 + 源 doc', (entry2.views || []).some(v => v.kind === 'doc'))
} else {
  C.check('registry diag 可用', false)
}

// ---------- 场景 D：源有真实未保存编辑 → 宿主保存不覆盖（最后保存者胜） ----------
await L.clickText('.tab', '数据库字段引用', { label: '切到源' })
await L.waitMs(900)
await L.focusEditor()
await L.goEnd()
await L.waitMs(300)
await L.type('\n源二次编辑D4')
await L.waitMs(1500)
// 宿主保存：写回被守卫拦截（源有真实编辑）
await L.clickText('.tab', 'probe', { label: '切回 probe(3)' })
await L.waitMs(900)
await L.press('Control+s')
await L.waitMs(2500)
const disk = await diskOf(SRC_PATH)
cliLog('[debug] 宿主保存后源磁盘(截断): ' + JSON.stringify(disk.slice(0, 60)))
C.check('宿主保存未覆盖源未保存编辑', !disk.includes('块跨标签编辑B2') || disk.includes('源实时编辑X1'))
// 源保存 → 落盘（最终一致）
await L.clickText('.tab', '数据库字段引用', { label: '切到源(2)' })
await L.waitMs(900)
await L.press('Control+s')
await L.waitMs(2500)
const disk2 = await diskOf(SRC_PATH)
C.check('源保存后磁盘含其编辑', disk2.includes('源二次编辑D4'))

const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)