// m9-placeholder-e2e —— M9 占位符：{{}} 渲染为占位符 decoration（代码块内保留字面）
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m9-placeholder-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('m9-placeholder-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock', 3000)

// 当前可见编辑器占位符数
const phCount = () => js(`(() => {
  const pane = Array.from(document.querySelectorAll('.editor-pane')).find(p => getComputedStyle(p).display !== 'none')
  if (!pane) return 0
  const pm = pane.querySelector('.ProseMirror')
  return pm ? pm.querySelectorAll('.tpl-placeholder').length : 0
})()`)

// ---- A: 模板文件占位符渲染（代码块 json 示例内 {{field}} 跳过）----
await L.treeClick('.template')
await L.treeClick('.template/接口文档')
await L.treeClick('.template/接口文档/接口文档.md')
await L.waitMs(8000)
const countA = await phCount()
const preCount = await js(`(() => {
  const pane = Array.from(document.querySelectorAll('.editor-pane')).find(p => getComputedStyle(p).display !== 'none')
  return pane ? pane.querySelectorAll('pre .tpl-placeholder').length : 0
})()`)
cliLog('  -- 正文占位符: ' + countA + '  代码块内占位符: ' + preCount)
C.check('A1: 模板正文 {{}} 渲染为占位符', countA > 5)
C.check('A2: 代码块(json 示例)内 {{}} 保留字面', preCount === 0)

// ---- B: 点击占位符自动选中整个 {{...}}，输入整体替换 ----
await L.clickEl('.ProseMirror .tpl-placeholder', 0, { label: '点占位符' })
await L.waitMs(400)
const selText = await js(`window.getSelection() ? window.getSelection().toString() : ''`)
cliLog('  -- 点击后选中文本: ' + JSON.stringify(selText))
C.check('B0: 点击占位符自动选中整个 {{...}}', selText.startsWith('{{') && selText.endsWith('}}'))
await L.type('助贷放款申请')
await L.waitMs(800)
const countB = await phCount()
C.check('B1: 输入整体替换后占位符数量减少', countB < countA)
const mdB = await L.pageMd()
C.check('B2: 无 {{}} 残留（整体替换为实际内容）', mdB.includes('助贷放款申请') && !/\{\{助贷放款申请\}\}/.test(mdB))

// ---- B3/B4: 键盘移入占位符 → 自动选中整个 → 输入整体替换 ----
await L.reloadApp(2500)
await L.treeClick('.template')
await L.treeClick('.template/接口文档')
await L.treeClick('.template/接口文档/接口文档.md')
await L.waitMs(6000)
cliLog('  -- 键盘测试占位符: ' + JSON.stringify(await L.txt('.ProseMirror .tpl-placeholder')))
await L.clickEl('.ProseMirror .tpl-placeholder', 0, { label: '点占位符' })
await L.waitMs(300)
await L.press('ArrowLeft')   // 光标到占位符开头
await L.waitMs(200)
await L.press('ArrowRight')  // 移入内部 → appendTransaction 选中整个
await L.waitMs(400)
const selK = await js(`window.getSelection() ? window.getSelection().toString() : ''`)
cliLog('  -- 键盘移入后选中: ' + JSON.stringify(selK))
C.check('B3: 键盘移入占位符自动选中整个 {{...}}', selK.startsWith('{{') && selK.endsWith('}}'))
await L.type('键盘替换')
await L.waitMs(600)
const mdK = await L.pageMd()
C.check('B4: 键盘输入整体替换（无 {{}} 残留）', mdK.includes('键盘替换') && !mdK.includes('{{键盘替换}}'))

// ---- C: 普通文档（无 {{}}）不渲染 ----
await L.press('Escape')
await L.waitMs(300)
await L.treeClick('数据库')
await L.treeClick('数据库/loan')
await L.treeClick('数据库/loan/loan_apply.md')
await L.waitMs(6000)
const countC = await phCount()
C.check('C1: 普通文档无占位符渲染', countC === 0)

cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
