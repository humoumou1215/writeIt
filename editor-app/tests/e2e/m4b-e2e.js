// m4b-e2e —— M4 第二轮：标题实体（Obsidian 模式）+ suggest 新样例 + 实体级 UI
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m4b-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('m4b-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

// ---- 1. suggest 新对象解析（引用演示打开后）----
await L.clickText('.tree .name', '引用演示.md', { label: '打开引用演示' })
await L.waitMs(5000)
const objs = await js(`(() => {
  const spans = Array.from(document.querySelectorAll('[data-object-ref]'))
  return spans.map(s => ({ obj: s.getAttribute('data-object'), text: s.getAttribute('data-text') }))
})()`)
cliLog('object_ref: ' + JSON.stringify(objs))
C.check('todo-count=5', objs.some(s => s.obj === 'todo-count' && s.text === '5'))
C.check('progress=3/5', objs.some(s => s.obj === 'progress' && s.text === '3/5'))
C.check('first-task=引用语法与节点', objs.some(s => s.obj === 'first-task' && s.text && s.text.includes('引用语法与节点')))

// ---- 2. 标题实体（无 suggest 文件：会议记录.md）----
await L.goEnd()
await L.waitMs(300)
await L.press('Enter')
await L.waitMs(300)
await L.type('[[会议记录')
await L.waitMs(900)
await L.press('ArrowRight') // 应用演进：文件级 Enter=插入链接，ArrowRight 才下钻实体级
await L.waitMs(800)
const ent = await js(`(() => {
  const el = document.querySelector('[data-ref-menu]')
  return {
    h6: el ? (el.querySelector('h6') ? el.querySelector('h6').textContent : null) : null,
    items: el ? Array.from(el.querySelectorAll('.menu-group li')).map(li => li.textContent.trim()).slice(0, 5) : [],
  }
})()`)
cliLog('会议记录实体级: ' + JSON.stringify(ent))
C.check('标题实体 h6 路径风格', ent.h6 && ent.h6.includes('会议记录') && ent.h6.includes('/'))
C.check('标题实体含「会议记录」标题', ent.items.some(t => t.includes('会议记录')))
C.check('标题实体含「周会」标题', ent.items.some(t => t.includes('2026-08-11 周会')))
// 实体级：首项=文件本身，其后是标题 → 选第三个（周会）插入 [[会议记录#2026-08-11 周会]]
await L.press('ArrowDown')
await L.press('ArrowDown')
await L.press('Enter')
await L.waitMs(1200)
const md = await L.pageMd()
C.check('插入标题引用', md.includes('[[笔记/会议记录#2026-08-11 周会]]'))
const frags = await js(`(() => {
  const as = Array.from(document.querySelectorAll('a[data-file-ref]'))
  return as.map(a => ({ frag: a.getAttribute('data-fragment'), text: a.textContent }))
})()`)
cliLog('file_ref: ' + JSON.stringify(frags))
C.check('file_ref fragment 正确', frags.some(f => f.frag === '2026-08-11 周会'))

// ---- 3. suggest 对象实体（周报.md 5 个对象）----
await L.goEnd()
await L.waitMs(300)
await L.press('Enter')
await L.waitMs(300)
await L.type('[[笔记/周报')
await L.waitMs(900)
await L.press('ArrowRight')
await L.waitMs(800)
const ent2 = await js(`(() => {
  const el = document.querySelector('[data-ref-menu]')
  return el ? Array.from(el.querySelectorAll('.menu-group li')).map(li => li.textContent.trim()) : []
})()`)
cliLog('周报实体级: ' + JSON.stringify(ent2))
C.check('周报实体级=文件+5对象', ent2.length === 6 && ent2.some(t => t.includes('完成率')) && ent2.some(t => t.includes('首个待办')))

await L.shotTo('18-实体级引用-标题与对象.png')
cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
