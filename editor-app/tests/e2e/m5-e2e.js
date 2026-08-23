// M5 ValidateService e2e：三通道（decorations / 面板 / 报告）+ strict 门禁
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m5-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('m5-e2e')
await L.installErrors()

// 把 kind 内联进浏览器侧 js，重置 笔记/周报.md 后 reload
const seed = async (kind) => {
  await L.openApp('http://localhost:5173/?backend=mock', 1200)
  await js(`(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
    const B = 'doctype:demo\\n\\n# 周报\\n\\n你好，本周完成了引用机制的三块里程碑。\\n\\n## 版本\\n\\nv0.2.1\\n\\n## 待办\\n\\n- [x] 引用语法\\n- [ ] 校验服务\\n'
    let z = B
    if (${JSON.stringify(kind)} === 'table') z = B + '\\n## 需求\\n\\n| 前置 | 后置 |\\n| --- | --- |\\n| A | B |\\n'
    else if (${JSON.stringify(kind)} === 'noversion') z = B.replace('## 版本\\n\\nv0.2.1\\n', '')
    else if (${JSON.stringify(kind)} === 'partial') z = B + '\\n## 需求\\n\\n| 前置 | 后置 |\\n| --- | --- |\\n| A |  |\\n'
    fs.files['笔记/周报.md'] = z
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
  })()`)
  await L.reloadApp(2500)
  await L.clickText('.tree .node', '笔记')
  await L.waitMs(400)
  await L.clickText('.tree .name', '周报.md')
  await L.waitMs(8000)
  // 抽屉默认收纳：读取批注前先展开
  await js(`document.querySelector('.annotation-open-btn')?.click()`)
  await L.waitMs(400)
}

// A: 原始周报（无需求表）→ 1 warning
await seed('base')
const warnA = await js(`(() => { const e = document.querySelector('.annotation-drawer .ad-counts .warn'); return e ? (e.textContent || '') : '' })()`)
C.check('A: 周报 1 警告（缺需求表）', (warnA || '').includes('1'))

// B: 补需求表 → 无违规
await seed('table')
const cardsB = await L.q('.ad-card')
C.check('B: 补需求表后无违规（无校验卡）', cardsB === 0)

// C: 删除版本章节 → error + 面板列出
await seed('noversion')
const errC = await js(`(() => { const e = document.querySelector('.annotation-drawer .ad-counts .err'); return e ? (e.textContent || '') : '' })()`)
C.check('C: 缺版本章节 error 出现', (errC || '').length > 0)

// E: 需求表部分填写（后置空）→ 校验违规转批注：锚定行高亮 + 点击出批注卡（M6）
await seed('partial')
C.check('E: 违规锚定行高亮（annotation-dynamic）', (await L.q('tr.annotation-dynamic')) > 0)
const markLevel = await L.attr('tr.annotation-dynamic', 'class')
C.check('E: 高亮 level=warning', (markLevel || '').includes('annotation-level-warning'))
await js(`(() => {
  const tr = document.querySelector('tr.annotation-dynamic')
  if (tr) tr.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
})()`)
await L.waitMs(800)
const markMsg = await js(`(() => {
  const card = document.querySelector('.ad-card.read-only.active .ad-card-content')
  return card ? card.textContent : ''
})()`)
C.check('E: 抽屉校验卡提示 = 后置不能为空', (markMsg || '').includes('后置不能为空'))
const beforeE = await js(`(() => {
  const pane = Array.from(document.querySelectorAll('.editor-pane')).find(p => getComputedStyle(p).display !== 'none')
  return pane ? pane.scrollTop : -1
})()`)
await L.clickEl('.ad-card.read-only', 0, { label: '点校验卡' })
await L.waitMs(1500)
const afterE = await js(`(() => {
  const pane = Array.from(document.querySelectorAll('.editor-pane')).find(p => getComputedStyle(p).display !== 'none')
  return pane ? pane.scrollTop : -1
})()`)
C.check('E: 抽屉定位滚动', afterE !== beforeE)

// D: 报告落盘 + hint 模式保存不被阻止
await seed('base')
const report = await js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  const r = fs.files && fs.files['.validate/report.md']
  return r ? { ok: r.includes('校验报告'), hasWarn: r.includes('warning') } : null
})()`)
C.check('D: 报告落盘 .validate/report.md', report && report.ok && report.hasWarn)
await L.press('Control+s')
await L.waitMs(1500)
const saved = await js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  return (fs.files['笔记/周报.md'] || '').length
})()`)
C.check('D: hint 模式保存不被阻止', saved > 60 && saved < 10000)

cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
