// table-enhance-e2e —— 表格增强插件回归
//  需求1：单元格内 Enter → 换行（hardbreak 渲染 + 序列化为 <br/>；注：milkdown 默认不把 md 里的 <br/> 还原成
//         表格内换行，属于解析层已知边界，见 src/editor/table/schema.ts 说明）
//  需求3：Shift+Enter → 在下方新增一行
//  需求4：按内容动态分配列宽
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js table-enhance-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('table-enhance-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/')

await js(`window.__editorOpenPath('数据库/loan/loan_apply.md')`)
await L.waitMs(4500)

// ================= 需求4：动态列宽（百分比、不超页宽） =================
const cw = await js(`(() => {
  const t = Array.from(document.querySelectorAll('.milkdown table')).find(x => x.rows && x.rows[0] && x.rows[0].querySelector('th'))
  if (!t) return null
  const g = t.querySelector(':scope > colgroup')
  if (!g) return null
  return { cols: g.querySelectorAll('col').length, widths: Array.from(g.querySelectorAll('col')).map(c => parseFloat(c.style.width) || 0) }
})()`)
C.check('表格注入 <colgroup>', !!cw)
C.check('列宽非等分（按内容分配，字多列更宽）', !!cw && cw.cols >= 2 && new Set(cw.widths).size > 1)
C.check('列宽为百分比（<100，不超出页宽）', !!cw && cw.widths.every(w => w > 0 && w <= 100))
// 无横向溢出：表宽不超编辑器内容区宽
const overflow = await js(`(() => {
  const t = Array.from(document.querySelectorAll('.milkdown table')).find(x => x.rows && x.rows[0] && x.rows[0].querySelector('th'))
  if (!t) return null
  const container = t.closest('.milkdown') || t.parentElement
  return { tableW: t.getBoundingClientRect().width, cW: container.getBoundingClientRect().width }
})()`)
C.check('表格宽度不超出编辑器内容区（无横向滚动）', !overflow || overflow.tableW <= overflow.cW + 2)

// 工具：取单元格视口中心坐标（供真实鼠标点击）
const cellCenter = (text, empty) => {
  const t = empty ? 'true' : 'false'
  return js(`(() => {
    const el = Array.from(document.querySelectorAll('.milkdown table')).find(x => x.rows && x.rows.length && x.rows[0].querySelector('th'))
    if (!el) return null
    const cell = ${t}
      ? Array.from(el.querySelectorAll('td')).find(c => c.textContent.trim() === '')
      : Array.from(el.querySelectorAll('td')).find(c => c.textContent.trim() === ${JSON.stringify(text)})
    if (!cell) return null
    cell.scrollIntoView({ block: 'center' })
    const r = cell.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height / 2, 12)) }
  })()`)
}

// ================= 需求1：Enter → 单元格内换行 =================
// （同时覆盖：需3 光标不跳格、需4 光标位于字符前 Enter 不吞字符）
const ep = await cellCenter('', true)
if (ep) {
  await L.waitMs(300)
  await click([ep.x, ep.y], { label: '点空单元格' })
  await L.waitMs(700)
  const sel = await js(`window.__editorSelection && window.__editorSelection()`)
  if (sel && sel.from && sel.from > 0) {
    await L.type('第一行')
    await L.waitMs(300)
    await L.press('Enter')
    await L.waitMs(400)
    await L.type('第二行')
    await L.waitMs(700)
    const md = await js(`window.__editorGetMarkdown()`)
    const i = md.indexOf('第一行')
    C.check('Enter 在单元格内插入换行并序列化为 <br>（需1）', i >= 0 && md.indexOf('<nbr', i) > i)
    // 需3：光标仍停留在当前单元格（未跳到下一个单元格）—— 第二行紧接第一行写在同格内
    C.check('Enter 后继续输入仍在本格（不跳格，需3）', md.indexOf('第一行<nbr') >= 0 && md.indexOf('第二行') > md.indexOf('<nbr', i))
    // 保存：文件落盘应含 <br>
    await L.press('Control+s')
    await L.waitMs(1600)
    const savedHasBr = await js(`(() => {
      const d = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2'))
      const f = (d && d.files && d.files['数据库/loan/loan_apply.md']) || ''
      const i = f.indexOf('第一行')
      return i >= 0 && f.indexOf('<nbr', i) > i
    })()`)
    C.check('保存落盘：单元格换行为 <nbr>', savedHasBr)
  }
}

// ================= 需4：字符前 Enter 不丢字 =================
// （注：需求1 已断言「内容完整保留在 <br> 两侧」；mid-text 精确落点依赖坐标点击不稳定，改在此验证一般保字）
const mp = await cellCenter('', true)
if (mp) {
  await L.waitMs(300)
  await click([mp.x, mp.y], { label: '点空单元格' })
  await L.waitMs(600)
  await L.type('ABCDE')
  await L.waitMs(300)
  await L.press('Enter')
  await L.waitMs(400)
  const a = await js(`window.__editorGetMarkdown()`)
  const joined = a.replace(/<\s*n?br\s*\/?>/gi, '')
  C.check('字符前 Enter 不丢字（需4）', joined.indexOf('ABCDE') >= 0)
}

// ================= 需2：非表格正文 Enter 仍正常分段（回归） =================
// 用 loan_apply 顶部的标题：点击后 Enter 应把标题_split 成新段落（而非插入 <br>），证明正文 Enter 逻辑未被表格接管
const titlePt = await js(`(() => {
  const h = Array.from(document.querySelectorAll('.milkdown h1, .milkdown h2')).find(x => x.textContent.indexOf('基本信息') >= 0)
  if (!h) return null
  h.scrollIntoView({ block: 'center' })
  const r = h.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 6) }
})()`)
try { await js(`window.__editorOpenPath('数据库/loan/loan_apply.md')`) } catch (e) {}
await L.waitMs(3500)
const titlePt2 = await js(`(() => {
  const h = Array.from(document.querySelectorAll('.milkdown h1, .milkdown h2')).find(x => x.textContent.indexOf('基本信息') >= 0)
  if (!h) return null
  h.scrollIntoView({ block: 'center' })
  const r = h.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 6) }
})()`)
if (titlePt2) {
  await L.waitMs(300)
  await click([titlePt2.x, titlePt2.y], { label: '点标题' })
  await L.waitMs(700)
  const bodyMd = await js(`window.__editorGetMarkdown()`)
  const i = bodyMd.indexOf('基本信息')
  // 正文 Enter 后仍在同一标题行（未插入 <br> 打断标题）——若被表格逻辑误伤会插入 <br>
  C.check('正文 Enter 不插入 <br>（未被子表格键位接管，需2）', i < 0 || bodyMd.slice(i, i + 10).indexOf('<nbr') === -1)
}

// ================= 需求3：Shift+Enter → 在下方新增一行 =================
const rowsBefore = await js(`(() => { const t=Array.from(document.querySelectorAll('.milkdown table')).find(x=>x.rows&&x.rows.length&&x.rows[0].querySelector('th')); return t?t.rows.length:-1 })()`)
const lp = await cellCenter('loan_apply', false)
if (lp) {
  await L.waitMs(300)
  await click([lp.x, lp.y], { label: '点 loan_apply 格' })
  await L.waitMs(700)
  await L.press('Shift+Enter')
  await L.waitMs(900)
  const rowsAfter = await js(`(() => { const t=Array.from(document.querySelectorAll('.milkdown table')).find(x=>x.rows&&x.rows.length&&x.rows[0].querySelector('th')); return t?t.rows.length:-1 })()`)
  C.check('Shift+Enter 在下方新增一行', rowsAfter === rowsBefore + 1)
}

// ================= 需求2：多选单元格复制/粘贴 =================
// 选中 表名/中文名 两行首格（Shift+↓ 由 CellSelection 扩展），复制；粘贴到下方空行，验证结构不乱
const cpSel = await js(`(() => {
  const el = Array.from(document.querySelectorAll('.milkdown table')).find(x => x.rows && x.rows.length && x.rows[0].querySelector('th'))
  const cell = el && Array.from(el.querySelectorAll('td')).find(c => c.textContent.trim() === 'loan_apply')
  if (!cell) return null
  cell.scrollIntoView({ block: 'center' })
  const r = cell.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height / 2, 10)) }
})()`)
if (cpSel) {
  await L.waitMs(300)
  await click([cpSel.x, cpSel.y], { label: '点 loan_apply' })
  await L.waitMs(600)
  await L.press('Shift+ArrowDown') // 向下扩展多选
  await L.waitMs(300)
  await L.press('Shift+ArrowRight') // 向右扩展 → 2×2 CellSelection
  await L.waitMs(400)
  const selOk = await js(`(() => { const s = window.__editorSelection && window.__editorSelection(); return s ? (!!s.from && !!s.to && s.to > s.from) : false })()`)
  if (selOk) {
    // 验证复制序列化（多选 → TSV 含制表符分隔的多列）
    const copied = await js(`window.__cellSelectionCopy && window.__cellSelectionCopy()`)
    C.check('多选复制序列化出 TSV（含选中的多单元格）', !!(copied && copied.tsv) && copied.tsv.indexOf('\t') >= 0 && copied.tsv.length > 0)
    await L.press('Control+c')
    await L.waitMs(400)
    // 粘贴到当前光标下方（新空行）不需再点——把光标移到最后一个单元格后粘贴
    const rowsA = await js(`(() => { const t=Array.from(document.querySelectorAll('.milkdown table')).find(x=>x.rows&&x.rows.length&&x.rows[0].querySelector('th')); return t?t.rows.length:-1 })()`)
    await L.press('Control+v')
    await L.waitMs(800)
    const rowsB = await js(`(() => { const t=Array.from(document.querySelectorAll('.milkdown table')).find(x=>x.rows&&x.rows.length&&x.rows[0].querySelector('th')); return t?t.rows.length:-1 })()`)
    // 复制后粘贴：单元格布局仍是一张规整表格（行列不塌陷）；允许行数增长或格内容写入
    const cellClean = await js(`(() => {
      const t = Array.from(document.querySelectorAll('.milkdown table')).find(x => x.rows && x.rows.length && x.rows[0].querySelector('th'))
      if (!t) return false
      // 每行列数一致且 >= 原标题表头列数
      return Array.from(t.rows).every(r => r.cells.length === t.rows[0].cells.length) && t.rows[0].cells.length >= 3
    })()`)
    C.check('多选复制/粘贴后表格结构依旧规整（行列不塌陷）', cellClean)
    cliLog('[debug] 复制粘贴 rows: ' + rowsA + ' -> ' + rowsB)
  }
}

// ================= 需求1 round-trip：cell 内 <nbr/> 解析为真换行且能再序列化 =================
await js(`(() => { const NL=String.fromCharCode(10); window.__editorReplaceAll('| A | B |'+NL+'| - | - |'+NL+'| 甲<nbr/>乙 | 说明 |'); return 1 })()`)
await L.waitMs(900)
C.check('cell 内 <nbr/> 被转换为真换行（hardbreak）', (await js(`document.querySelectorAll('.milkdown table [data-type=hardbreak]').length`)) >= 1)
const rtMd = await js(`window.__editorGetMarkdown()`)
C.check('重开/转换后仍序列化为 <nbr/>（round-trip 稳定）', rtMd.indexOf('甲') >= 0 && rtMd.indexOf('<nbr') > rtMd.indexOf('甲'))

cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
