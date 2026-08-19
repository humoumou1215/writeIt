// xxljob-e2e —— M7 xxljob：一文件一任务模板校验 + 基本信息属性对象引用
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js xxljob-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('xxljob-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock', 3000)

// ---- A: 合规 job（无违规 + 跨文件对象引用 resolve）----
await L.treeClick('xxljob')
await L.treeClick('xxljob/notify-executor')
await L.treeClick('xxljob/notify-executor/下游机构通知.md')
await L.waitMs(12000)
const refs = await js(`(() => Array.from(document.querySelectorAll('[data-object-ref]')).map(e => ({
  obj: e.getAttribute('data-object') || '', text: e.getAttribute('data-text') || '',
})))()`)
cliLog('  -- object_refs: ' + JSON.stringify(refs))
C.check('A1: 引用接口文档 applyNo 对象 resolve 含「类型:string」', refs.some(o => o.obj === 'applyNo' && o.text.includes('类型:string')))
const cardsA = await js(`Array.from(document.querySelectorAll('.ad-card .ad-card-content')).map(c => c.textContent || '')`)
cliLog('  -- 合规 cards: ' + JSON.stringify(cardsA).slice(0, 200))
C.check('A2: 合规样例无违规卡片', cardsA.length === 0)

// ---- B: 违规样例 ----
await L.press('Escape')
await L.waitMs(300)
await L.treeClick('xxljob/notify-executor/下游机构通知-违规.md')
await L.waitMs(8000)
const cardsB = await js(`Array.from(document.querySelectorAll('.ad-card .ad-card-content')).map(c => c.textContent || '')`)
cliLog('  -- 违规 cards: ' + JSON.stringify(cardsB).slice(0, 500))
C.check('B1: 检出「执行器」未填写', cardsB.some(c => c.includes('执行器') && c.includes('未填写')))
C.check('B2: 检出 JobHandler 格式违规', cardsB.some(c => c.includes('JobHandler') && c.includes('标识符')))
C.check('B3: 检出调度类型枚举违规', cardsB.some(c => c.includes('调度类型') && c.includes('cron/固定速度/固定延迟')))
C.check('B4: 检出 cron 格式违规', cardsB.some(c => c.includes('cron') && c.includes('6-7 段')))
C.check('B5: 检出路由策略枚举违规', cardsB.some(c => c.includes('路由策略') && c.includes('不在枚举内')))
C.check('B6: 检出缺少任务职责章节', cardsB.some(c => c.includes('任务职责')))

cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
