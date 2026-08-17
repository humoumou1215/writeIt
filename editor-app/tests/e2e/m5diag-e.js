// M5 E 步诊断：partial 周报锚定高亮
const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } })
  page.on('pageerror', (e) => console.log('  [PAGEERR]', e.message.slice(0, 250)))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  [ERR]`, m.text().slice(0, 250)) })
  await page.goto('http://localhost:5173/?backend=mock', { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(1200)
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
    const B = 'doctype:demo\n\n# 周报\n\n你好，本周完成了引用机制的三块里程碑。\n\n## 版本\n\nv0.2.1\n\n## 待办\n\n- [x] 引用语法\n- [ ] 校验服务\n'
    fs.files['笔记/周报.md'] = B + '\n## 需求\n\n| 前置 | 后置 |\n| --- | --- |\n| A |  |\n'
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.locator('.tree .node', { hasText: '笔记' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('.tree .name', { hasText: '周报.md' }).click()
  await page.waitForTimeout(8000)
  const state = await page.evaluate(() => ({
    counts: document.querySelector('.annotation-drawer .ad-counts')?.textContent ?? '',
    cards: Array.from(document.querySelectorAll('.ad-card')).map((c) => (c.textContent || '').slice(0, 100)),
    dyn: Array.from(document.querySelectorAll('tr.annotation-dynamic')).map((t) => t.className),
    trs: Array.from(document.querySelectorAll('tr')).map((t) => t.className).filter(Boolean),
  }))
  console.log('  --', JSON.stringify(state))
  await browser.close()
  process.exit(0)
})()
