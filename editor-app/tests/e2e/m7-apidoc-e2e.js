// m7-apidoc-e2e —— M7 接口文档：动态对象 objectsFor resolve + findCodeBlocks 字段一致性校验
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m7-apidoc-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('m7-apidoc-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock', 3000)

// ---- A: 动态字段对象 resolve ----
await L.clickText('.tree .name', '接口字段引用.md', { label: '打开接口字段引用' })
await L.waitMs(12000)
const refs = await js(`(() => Array.from(document.querySelectorAll('[data-object-ref]')).map(e => ({
  obj: e.getAttribute('data-object') || '', text: e.getAttribute('data-text') || '',
})))()`)
cliLog('  -- object_refs: ' + JSON.stringify(refs))
C.check('A1: amount resolve 含「类型:bigint」', refs.some(o => o.obj === 'amount' && o.text.includes('类型:bigint')))
C.check('A2: amount resolve 含「高风险:是」', refs.some(o => o.obj === 'amount' && o.text.includes('高风险:是')))
C.check('A3: amount resolve 含「来源:数据库/loan/loan_apply#amount」', refs.some(o => o.obj === 'amount' && o.text.includes('来源:数据库/loan/loan_apply#amount')))
C.check('A4: applyNo resolve 含「类型:string」', refs.some(o => o.obj === 'applyNo' && o.text.includes('类型:string')))

// ---- B: 违规样例 rules ----
await L.press('Escape')
await L.waitMs(400)
await L.treeClick('接口文档')
await L.treeClick('接口文档/助贷')
await L.treeClick('接口文档/助贷/助贷接口-违规.md')
await L.waitMs(8000)
const warn = await js(`document.querySelector('.annotation-drawer .ad-counts .warn') ? document.querySelector('.annotation-drawer .ad-counts .warn').textContent : ''`)
cliLog('  -- 违规 warn: ' + warn)
C.check('B1: 违规样例产生 warning', /\d/.test(warn) && parseInt(warn) > 0)
const cards = await js(`Array.from(document.querySelectorAll('.ad-card .ad-card-content')).map(c => c.textContent || '')`)
cliLog('  -- 违规 cards: ' + JSON.stringify(cards).slice(0, 400))
C.check('B2: 检出 extraField 未登记', cards.some(c => c.includes('extraField') && c.includes('未登记')))
C.check('B3: 检出 status 未出现', cards.some(c => c.includes('status') && c.includes('未出现')))

// ---- C: 合规样例 ----
await L.press('Escape')
await L.waitMs(300)
await L.treeClick('接口文档/助贷/助贷接口.md')
await L.waitMs(8000)
const cardsC = await js(`Array.from(document.querySelectorAll('.ad-card .ad-card-content')).map(c => c.textContent || '')`)
cliLog('  -- 合规 cards: ' + JSON.stringify(cardsC).slice(0, 300))
C.check('C1: 合规样例无字段一致性违规', !cardsC.some(c => c.includes('未登记') || c.includes('未出现')))

cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
