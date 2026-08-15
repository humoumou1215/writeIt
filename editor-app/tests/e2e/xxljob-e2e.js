// M7 xxljob e2e：一文件一任务模板校验 + 基本信息属性对象引用
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

  const treeClick = async (path) => {
    await page.evaluate((p) => {
      const el = document.querySelector(`.tree [data-path="${p}"]`)
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      else console.log('[treeClick] not found:', p)
    }, path)
    await page.waitForTimeout(600)
  }

  // ---- A: 合规 job（无违规 + 跨文件对象引用 resolve）----
  await treeClick('xxljob')
  await treeClick('xxljob/notify-executor')
  await treeClick('xxljob/notify-executor/下游机构通知.md')
  await page.waitForTimeout(12000)
  const refs = await page.evaluate(() => Array.from(document.querySelectorAll('[data-object-ref]')).map((e) => ({
    obj: e.getAttribute('data-object') || '', text: e.getAttribute('data-text') || '',
  })))
  console.log('  -- object_refs:', JSON.stringify(refs))
  check('A1: 引用接口文档 applyNo 对象 resolve 含「类型:string」', refs.some((o) => o.obj === 'applyNo' && o.text.includes('类型:string')))
  const cardsA = await page.evaluate(() => Array.from(document.querySelectorAll('.ad-card .ad-card-content')).map((c) => c.textContent || ''))
  console.log('  -- 合规 cards:', JSON.stringify(cardsA).slice(0, 200))
  check('A2: 合规样例无违规卡片', cardsA.length === 0)

  // ---- B: 违规样例 ----
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await treeClick('xxljob/notify-executor/下游机构通知-违规.md')
  await page.waitForTimeout(8000)
  const cardsB = await page.evaluate(() => Array.from(document.querySelectorAll('.ad-card .ad-card-content')).map((c) => c.textContent || ''))
  console.log('  -- 违规 cards:', JSON.stringify(cardsB).slice(0, 500))
  check('B1: 检出「执行器」未填写', cardsB.some((c) => c.includes('执行器') && c.includes('未填写')))
  check('B2: 检出 JobHandler 格式违规', cardsB.some((c) => c.includes('JobHandler') && c.includes('标识符')))
  check('B3: 检出调度类型枚举违规', cardsB.some((c) => c.includes('调度类型') && c.includes('cron/固定速度/固定延迟')))
  check('B4: 检出 cron 格式违规', cardsB.some((c) => c.includes('cron') && c.includes('6-7 段')))
  check('B5: 检出路由策略枚举违规', cardsB.some((c) => c.includes('路由策略') && c.includes('不在枚举内')))
  check('B6: 检出缺少任务职责章节', cardsB.some((c) => c.includes('任务职责')))

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
  await browser.close()
  process.exit(fail ? 1 : 0)
})()
