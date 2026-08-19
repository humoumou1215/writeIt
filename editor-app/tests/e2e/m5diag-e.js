// m5diag-e —— M5 E 步诊断：partial 周报锚定高亮
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m5diag-e
const task = await L.acquireTaskSpace('m5diag-e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

await js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  const B = 'doctype:demo\\n\\n# 周报\\n\\n你好，本周完成了引用机制的三块里程碑。\\n\\n## 版本\\n\\nv0.2.1\\n\\n## 待办\\n\\n- [x] 引用语法\\n- [ ] 校验服务\\n'
  fs.files['笔记/周报.md'] = B + '\\n## 需求\\n\\n| 前置 | 后置 |\\n| --- | --- |\\n| A |  |\\n'
  localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
})()`)
await L.reloadApp(2500)
await L.clickText('.tree .node', '笔记')
await L.waitMs(400)
await L.clickText('.tree .name', '周报.md')
await L.waitMs(8000)
const state = await js(`(() => ({
  counts: document.querySelector('.annotation-drawer .ad-counts') ? document.querySelector('.annotation-drawer .ad-counts').textContent : '',
  cards: Array.from(document.querySelectorAll('.ad-card')).map(c => (c.textContent || '').slice(0, 100)),
  dyn: Array.from(document.querySelectorAll('tr.annotation-dynamic')).map(t => t.className),
  trs: Array.from(document.querySelectorAll('tr')).map(t => t.className).filter(Boolean),
}))()`)
cliLog('  -- ' + JSON.stringify(state))
const errs = await L.errors()
cliLog('  [PAGEERR/CONSOLE]')
cliLog(errs.length ? errs.join('\n') : '(无)')
await completeTaskSpace(task.id, { keep: false })
process.exit(0)
