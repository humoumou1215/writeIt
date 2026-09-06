// 表格列宽回归：边界不闪烁、官方 resize 可用、自动列宽按钮只作用于活动编辑器。
const C = L.newChecker()
const task = await L.acquireTaskSpace('table-width-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock', 2500)
await js(`window.__editorOpenPath('数据库/loan/loan_apply.md')`)
await L.waitMs(4500)

const tableInfo = () => js(`(() => {
  const t = [...document.querySelectorAll('.milkdown table')].find(x => {
    const r = x.getBoundingClientRect()
    return x.rows?.[0]?.querySelector('th') && r.width > 0 && r.height > 0 && getComputedStyle(x).display !== 'none'
  })
  if (!t) return null
  const cell = t.rows[0].cells[0]
  const r = cell.getBoundingClientRect()
  return { x: r.right, y: r.top + r.height / 2, widths: [...t.querySelectorAll(':scope > colgroup > col')].map(c => c.getBoundingClientRect().width), custom: document.querySelectorAll('.tb-resize-handle').length }
})()`)

const before = await tableInfo()
C.check('列宽测试表格已加载', !!before)
if (before) {
  // 边界反复移动时不应再出现项目自建的第二条 resize 指示线。
  for (let i = 0; i < 12; i++) {
    await hover([before.x - 5, before.y], { label: 'hover table boundary' })
    await hover([before.x + 5, before.y], { label: 'leave table boundary' })
  }
  const stable = await tableInfo()
  C.check('表格边界不产生自建重复 resize handle', stable && stable.custom === 0)
  const sameWidths = stable && before.widths.length === stable.widths.length && before.widths.every((w, i) => Math.abs(w - stable.widths[i]) < 2)
  C.check('悬停列边界时实际列宽保持不变', sameWidths)

  // 点击边界本身不能先把表格恢复成等宽；这是用户现场报告的跳跃路径。
  await click([stable.x, stable.y], { label: 'click column boundary' })
  await L.waitMs(250)
  const afterClick = await tableInfo()
  const clickStable = afterClick && stable.widths.every((w, i) => Math.abs(w - afterClick.widths[i]) < 2)
  C.check('点击列边界后实际列宽保持不变', clickStable)

  // GFM/prosemirror-tables 的官方列宽句柄应接管拖拽。
  await hover([afterClick.x, afterClick.y], { label: 'activate column handle' })
  await dragMouse([[afterClick.x, afterClick.y], [afterClick.x + 60, afterClick.y]], { label: 'drag column boundary' })
  await L.waitMs(800)
  const after = await tableInfo()
  C.check('拖拽列边界后实际列宽发生变化', !!after && after.widths.length === before.widths.length && after.widths[0] > before.widths[0] + 8)

  // 自动按钮必须属于当前可见编辑器，并能重新计算当前表格。
  const p = await js(`(() => { const t = [...document.querySelectorAll('.milkdown table')].find(x => x.rows?.[0]?.querySelector('th')); const r=t.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+18} })()`)
  await hover([p.x, p.y], { label: 'show auto width button' })
  await L.waitMs(250)
  const buttons = await js(`([...document.querySelectorAll('.tb-auto-width')].filter(x => getComputedStyle(x).display !== 'none')).length`)
  C.check('当前表格只显示一个自动列宽按钮', buttons === 1)
}

cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
