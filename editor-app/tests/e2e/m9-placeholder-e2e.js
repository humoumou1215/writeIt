// M9 占位符 e2e：{{}} 渲染为占位符效果（decoration，不改内容；代码块内保留字面）
const { chromium } = require('playwright')
let pass = 0, fail = 0
const check = (n, ok) => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${n}`) }

;(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('  [PAGEERR]', e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  [${m.type()}]`, m.text().slice(0, 200)) })
  await page.goto('http://localhost:5173/?backend=mock', { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(3000)

  const treeClick = async (path) => {
    await page.evaluate((p) => {
      const el = document.querySelector(`.tree [data-path="${p}"]`)
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }, path)
    await page.waitForTimeout(600)
  }

  // 当前可见编辑器（多 tab 时旧实例 DOM 隐藏但仍在——只统计可见 pane）
  const phCount = () =>
    page.evaluate(() => {
      const pane = Array.from(document.querySelectorAll('.editor-pane')).find((p) => getComputedStyle(p).display !== 'none')
      if (!pane) return 0
      const pm = pane.querySelector('.ProseMirror')
      return pm ? pm.querySelectorAll('.tpl-placeholder').length : 0
    })

  // ---- A: 模板文件占位符渲染（接口文档模板：正文多 {{}} + json 示例内的 {{field}} 应跳过）----
  await treeClick('.template')
  await treeClick('.template/接口文档')
  await treeClick('.template/接口文档/接口文档.md')
  await page.waitForTimeout(8000)
  const countA = await phCount()
  const preCount = await page.evaluate(() => {
    const pane = Array.from(document.querySelectorAll('.editor-pane')).find((p) => getComputedStyle(p).display !== 'none')
    return pane ? pane.querySelectorAll('pre .tpl-placeholder').length : 0
  })
  console.log('  -- 正文占位符:', countA, ' 代码块内占位符:', preCount)
  check('A1: 模板正文 {{}} 渲染为占位符', countA > 5)
  check('A2: 代码块(json 示例)内 {{}} 保留字面', preCount === 0)

  // ---- B: 点击占位符自动选中整个 {{...}}，输入整体替换（避免插成 {{下游111系统}}）----
  await page.locator('.ProseMirror .tpl-placeholder').first().click()
  await page.waitForTimeout(400)
  const selText = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  console.log('  -- 点击后选中文本:', JSON.stringify(selText))
  check('B0: 点击占位符自动选中整个 {{...}}', selText.startsWith('{{') && selText.endsWith('}}'))
  await page.keyboard.type('助贷放款申请')
  await page.waitForTimeout(800)
  const countB = await phCount()
  check('B1: 输入整体替换后占位符数量减少', countB < countA)
  const mdB = await page.evaluate(() => window.__editorGetMarkdown?.() ?? '')
  check('B2: 无 {{}} 残留（整体替换为实际内容）', mdB.includes('助贷放款申请') && !/\{\{助贷放款申请\}\}/.test(mdB))

  // ---- B3/B4: 键盘移入占位符 → 自动选中整个 → 输入整体替换 ----
  // 表格内方向键会被 milkdown table keymap 接管（不稳定），用正文标题（非表格）可靠验证 appendTransaction。
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await treeClick('.template')
  await treeClick('.template/接口文档')
  await treeClick('.template/接口文档/接口文档.md')
  await page.waitForTimeout(6000)
  const phT = page.locator('.ProseMirror .tpl-placeholder').first()
  console.log('  -- 键盘测试占位符:', await phT.textContent())
  await phT.click()
  await page.waitForTimeout(300)
  await page.keyboard.press('ArrowLeft')   // 光标到占位符开头
  await page.waitForTimeout(200)
  await page.keyboard.press('ArrowRight')  // 移入内部 → appendTransaction 选中整个
  await page.waitForTimeout(400)
  const selK = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  console.log('  -- 键盘移入后选中:', JSON.stringify(selK))
  check('B3: 键盘移入占位符自动选中整个 {{...}}', selK.startsWith('{{') && selK.endsWith('}}'))
  await page.keyboard.type('键盘替换')
  await page.waitForTimeout(600)
  const mdK = await page.evaluate(() => window.__editorGetMarkdown?.() ?? '')
  check('B4: 键盘输入整体替换（无 {{}} 残留）', mdK.includes('键盘替换') && !mdK.includes('{{键盘替换}}'))

  // ---- C: 普通文档（无 {{}}）不渲染 ----
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await treeClick('数据库')
  await treeClick('数据库/loan')
  await treeClick('数据库/loan/loan_apply.md')
  await page.waitForTimeout(6000)
  const countC = await phCount()
  check('C1: 普通文档无占位符渲染', countC === 0)

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
  await browser.close()
  process.exit(fail ? 1 : 0)
})()
