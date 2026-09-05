// 表格剪贴板回归：Excel 双 MIME、TSV 引号/换行、逐格内容与普通结构。
const C = L.newChecker()
const task = await L.acquireTaskSpace('table-clipboard-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock', 2500)
await js(`window.__editorOpenPath('数据库/loan/loan_apply.md')`)
await L.waitMs(4500)

const focusFirstDataCell = async () => {
  const p = await js(`(() => { const t=[...document.querySelectorAll('.milkdown table')].find(x=>x.rows?.[0]?.querySelector('th')); const c=t?.rows?.[1]?.cells?.[0]; if(!c)return null; c.scrollIntoView({block:'center'}); const r=c.getBoundingClientRect(); return {x:r.x+12,y:r.y+10} })()`)
  if (p) { await click([p.x, p.y], { label: 'focus table cell' }); await L.waitMs(250) }
  return p
}

const paste = async (html, text) => js(`(() => {
  const dt = new DataTransfer()
  ${html ? `dt.setData('text/html', ${JSON.stringify(html)})` : ''}
  dt.setData('text/plain', ${JSON.stringify(text)})
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  document.querySelector('.ProseMirror').dispatchEvent(ev)
  return ev.defaultPrevented
})()`)

if (await focusFirstDataCell()) {
  const prevented = await paste('<html><body><!--StartFragment--><table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><!--EndFragment--></body></html>', 'A\tB\r\nC\tD\r\n')
  await L.waitMs(900)
  const grid = await js(`(() => { const t=[...document.querySelectorAll('.milkdown table')].find(x=>x.rows?.[0]?.querySelector('th')); return [...t.rows].slice(1,3).map(r=>[...r.cells].slice(0,2).map(c=>c.innerText)) })()`)
  C.check('Excel HTML+TSV 粘贴被拦截并逐格写入', prevented && JSON.stringify(grid) === JSON.stringify([['A','B'],['C','D']]))
}

await L.freshApp('http://localhost:5173/?backend=mock', 1800)
await js(`window.__editorOpenPath('数据库/loan/loan_apply.md')`)
await L.waitMs(4000)
if (await focusFirstDataCell()) {
  const prevented = await paste('', '"多行\r\n文本"\t00123\r\n空\t值\r\n')
  await L.waitMs(900)
  const grid = await js(`(() => { const t=[...document.querySelectorAll('.milkdown table')].find(x=>x.rows?.[0]?.querySelector('th')); return [...t.rows].slice(1,3).map(r=>[...r.cells].slice(0,2).map(c=>c.innerText)) })()`)
  C.check('纯 TSV 支持引号、格内换行和前导零', prevented && grid?.[0]?.[0].includes('多行') && grid?.[0]?.[0].includes('文本') && grid?.[0]?.[0] !== '多行文本' && grid?.[0]?.[1] === '00123')
}

cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
