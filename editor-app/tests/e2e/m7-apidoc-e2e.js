// M7 接口文档 e2e：动态对象 objectsFor resolve + findCodeBlocks 字段一致性校验
const { chromium } = require('playwright')
let pass = 0, fail = 0
const check = (n, ok) => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${n}`) }

;(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('  [PAGEERR]', e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  [${m.type()}]`, m.text().slice(0, 200)) })
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(3000)

  // 树点击 helper：dispatchEvent click（绕遮挡/actionability）+ 等子节点
  const treeClick = async (path) => {
    await page.evaluate((p) => {
      const el = document.querySelector(`.tree [data-path="${p}"]`)
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      else console.log('[treeClick] not found:', p)
    }, path)
    await page.waitForTimeout(600)
  }

  // ---- A: 动态字段对象 resolve ----
  await page.locator('.tree .name', { hasText: '接口字段引用.md' }).click({ force: true })
  await page.waitForTimeout(12000)
  const refs = await page.evaluate(() => Array.from(document.querySelectorAll('[data-object-ref]')).map((e) => ({
    obj: e.getAttribute('data-object') || '', text: e.getAttribute('data-text') || '',
  })))
  console.log('  -- object_refs:', JSON.stringify(refs))
  check('A1: amount resolve 含「类型:bigint」', refs.some((o) => o.obj === 'amount' && o.text.includes('类型:bigint')))
  check('A2: amount resolve 含「高风险:是」', refs.some((o) => o.obj === 'amount' && o.text.includes('高风险:是')))
  check('A3: amount resolve 含「来源:数据库/loan/表结构#amount」', refs.some((o) => o.obj === 'amount' && o.text.includes('来源:数据库/loan/表结构#amount')))
  check('A4: applyNo resolve 含「类型:string」', refs.some((o) => o.obj === 'applyNo' && o.text.includes('类型:string')))

  // ---- B: 违规样例 rules ----
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await treeClick('接口文档')
  await treeClick('接口文档/助贷')
  await treeClick('接口文档/助贷/助贷接口-违规.md')
  await page.waitForTimeout(8000)
  const warn = await page.evaluate(() => document.querySelector('.annotation-drawer .ad-counts .warn')?.textContent ?? '')
  console.log('  -- 违规 warn:', warn)
  check('B1: 违规样例产生 warning', /\d/.test(warn) && parseInt(warn) > 0)
  const cards = await page.evaluate(() => Array.from(document.querySelectorAll('.ad-card .ad-card-content')).map((c) => c.textContent || ''))
  console.log('  -- 违规 cards:', JSON.stringify(cards).slice(0, 400))
  check('B2: 检出 extraField 未登记', cards.some((c) => c.includes('extraField') && c.includes('未登记')))
  check('B3: 检出 status 未出现', cards.some((c) => c.includes('status') && c.includes('未出现')))

  // ---- C: 合规样例 ----
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await treeClick('接口文档/助贷/助贷接口.md')
  await page.waitForTimeout(8000)
  const cardsC = await page.evaluate(() => Array.from(document.querySelectorAll('.ad-card .ad-card-content')).map((c) => c.textContent || ''))
  console.log('  -- 合规 cards:', JSON.stringify(cardsC).slice(0, 300))
  check('C1: 合规样例无字段一致性违规', !cardsC.some((c) => c.includes('未登记') || c.includes('未出现')))

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
  await browser.close()
  process.exit(fail ? 1 : 0)
})()
