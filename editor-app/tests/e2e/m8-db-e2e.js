// M8 数据库 e2e：数据库模板 objectsFor（字段对象 resolve）+ rules（表清单↔字段表一致性等）
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

  // ---- A: 数据库字段对象 resolve（接口文档字段在数据库模板同样可引用）----
  await page.locator('.tree .name', { hasText: '数据库字段引用.md' }).click({ force: true })
  await page.waitForTimeout(12000)
  const refs = await page.evaluate(() => Array.from(document.querySelectorAll('[data-object-ref]')).map((e) => ({
    obj: e.getAttribute('data-object') || '', text: e.getAttribute('data-text') || '',
  })))
  console.log('  -- object_refs:', JSON.stringify(refs))
  check('A1: amount resolve 含「类型:decimal(18,2)」', refs.some((o) => o.obj === 'amount' && o.text.includes('类型:decimal(18,2)')))
  check('A2: amount resolve 含「约束:非空」', refs.some((o) => o.obj === 'amount' && o.text.includes('约束:非空')))
  check('A3: apply_no resolve 含「类型:varchar(32)」', refs.some((o) => o.obj === 'apply_no' && o.text.includes('类型:varchar(32)')))
  check('A4: customer.id resolve 含「约束:PK 自增」', refs.some((o) => o.obj === 'id' && o.text.includes('约束:PK 自增')))

  // ---- B: 违规样例 rules ----
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await treeClick('数据库')
  await treeClick('数据库/loan')
  await treeClick('数据库/loan/loan_apply-违规.md')
  await page.waitForTimeout(8000)
  const warn = await page.evaluate(() => document.querySelector('.annotation-drawer .ad-counts .warn')?.textContent ?? '')
  console.log('  -- 违规 warn:', warn)
  check('B1: 违规样例产生 warning', /\d/.test(warn) && parseInt(warn) > 0)
  const cards = await page.evaluate(() => Array.from(document.querySelectorAll('.ad-card .ad-card-content')).map((c) => c.textContent || ''))
  console.log('  -- 违规 cards:', JSON.stringify(cards).slice(0, 400))
  check('B2: 检出版本号格式违规', cards.some((c) => c.includes('版本号') && c.includes('vX.Y.Z')))
  check('B3: 检出表名含空格违规', cards.some((c) => c.includes('表名') && c.includes('loan apply')))
  check('B4: 检出缺「类型」列', cards.some((c) => c.includes('缺少「类型」列')))
  check('B5: 检出字段名 apply no 违规', cards.some((c) => c.includes('apply no')))

  // ---- C: 合规样例 ----
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await treeClick('数据库/loan/loan_apply.md')
  await page.waitForTimeout(8000)
  const cardsC = await page.evaluate(() => Array.from(document.querySelectorAll('.ad-card .ad-card-content')).map((c) => c.textContent || ''))
  console.log('  -- 合规 cards:', JSON.stringify(cardsC).slice(0, 300))
  check('C1: 合规样例无违规', cardsC.length === 0)

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
  await browser.close()
  process.exit(fail ? 1 : 0)
})()
