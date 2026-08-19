// m8-db-e2e —— M8 数据库：字段对象 objectsFor + 表清单↔字段表一致性
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m8-db-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('m8-db-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock', 3000)

// ---- A: 数据库字段对象 resolve ----
await L.clickText('.tree .name', '数据库字段引用.md', { label: '打开数据库字段引用' })
await L.waitMs(12000)
const refs = await js(`(() => Array.from(document.querySelectorAll('[data-object-ref]')).map(e => ({
  obj: e.getAttribute('data-object') || '', text: e.getAttribute('data-text') || '',
})))()`)
cliLog('  -- object_refs: ' + JSON.stringify(refs))
C.check('A1: amount resolve 含「类型:decimal(18,2)」', refs.some(o => o.obj === 'amount' && o.text.includes('类型:decimal(18,2)')))
C.check('A2: amount resolve 含「约束:非空」', refs.some(o => o.obj === 'amount' && o.text.includes('约束:非空')))
C.check('A3: apply_no resolve 含「类型:varchar(32)」', refs.some(o => o.obj === 'apply_no' && o.text.includes('类型:varchar(32)')))
C.check('A4: customer.id resolve 含「约束:PK 自增」', refs.some(o => o.obj === 'id' && o.text.includes('约束:PK 自增')))

// ---- B: 违规样例 rules ----
await L.press('Escape')
await L.waitMs(400)
await L.treeClick('数据库')
await L.treeClick('数据库/loan')
await L.treeClick('数据库/loan/loan_apply-违规.md')
await L.waitMs(8000)
const warn = await js(`document.querySelector('.annotation-drawer .ad-counts .warn') ? document.querySelector('.annotation-drawer .ad-counts .warn').textContent : ''`)
cliLog('  -- 违规 warn: ' + warn)
C.check('B1: 违规样例产生 warning', /\d/.test(warn) && parseInt(warn) > 0)
const cards = await js(`Array.from(document.querySelectorAll('.ad-card .ad-card-content')).map(c => c.textContent || '')`)
cliLog('  -- 违规 cards: ' + JSON.stringify(cards).slice(0, 400))
C.check('B2: 检出版本号格式违规', cards.some(c => c.includes('版本号') && c.includes('vX.Y.Z')))
C.check('B3: 检出表名含空格违规', cards.some(c => c.includes('表名') && c.includes('loan apply')))
C.check('B4: 检出缺「类型」列', cards.some(c => c.includes('缺少「类型」列')))
C.check('B5: 检出字段名 apply no 违规', cards.some(c => c.includes('apply no')))

// ---- C: 合规样例 ----
await L.press('Escape')
await L.waitMs(300)
await L.treeClick('数据库/loan/loan_apply.md')
await L.waitMs(8000)
const cardsC = await js(`Array.from(document.querySelectorAll('.ad-card .ad-card-content')).map(c => c.textContent || '')`)
cliLog('  -- 合规 cards: ' + JSON.stringify(cardsC).slice(0, 300))
C.check('C1: 合规样例无违规', cardsC.length === 0)

cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
