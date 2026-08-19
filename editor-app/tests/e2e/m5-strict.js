// m5-strict —— M5 strict 门禁：mode strict + error 违规 → 保存前确认
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m5-strict
const C = L.newChecker()

const task = await L.acquireTaskSpace('m5-strict')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

// 模板 rules mode 改 strict + 周报无版本章节（制造 error）
await js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  const rules = fs.files['.template/demo/demo.rules.ts'] || ''
  fs.files['.template/demo/demo.rules.ts'] = rules.replace("export const mode: 'hint' | 'strict' = 'hint'", "export const mode: 'hint' | 'strict' = 'strict'")
  fs.files['笔记/周报.md'] = fs.files['笔记/周报.md'].replace('## 版本\\n\\nv0.2.1\\n', '')
  localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
})()`)
await L.reloadApp(2500)
await L.clickText('.tree .node', '笔记')
await L.waitMs(400)
await L.clickText('.tree .name', '周报.md')
await L.waitMs(5000)

// 保存 → 应弹确认框
await L.press('Control+s')
await L.waitMs(2000)
const dlg = await L.q('.modal-mask')
C.check('strict 保存弹确认框', dlg > 0)
// 取消 → 不保存
if (await L.has('.modal-actions button', '取消')) {
  await L.clickText('.modal-actions button', '取消')
  await L.waitMs(800)
}
const saved = await js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  const f = fs.files['笔记/周报.md'] || ''
  return { len: f.length, hasVersion: f.includes('## 版本') }
})()`)
C.check('取消后未保存（仍缺版本）', !saved.hasVersion)
// 再保存一次 → 确认保存 → 应写入（但内容无版本）
await L.press('Control+s')
await L.waitMs(2000)
const dlg2 = await L.q('.modal-mask')
C.check('再次保存仍弹确认', dlg2 > 0)
if (dlg2 > 0) {
  await L.clickText('.modal-actions button', '仍然保存')
  await L.waitMs(1500)
}

cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
