// M6 批注插件 e2e（v3 抽屉）：round-trip / 锚点激活 / 动态批注只读卡
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m6-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('m6-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

// 1. 持久化批注 round-trip（产品路径格式：&quot; 转义）
const note = JSON.stringify([{ a: '我', c: '这里需要补充说明', t: Date.now() - 60000, r: 0 }]).replace(/"/g, '&quot;')
await js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  fs.files['笔记/周报.md'] = 'doctype:demo\\n\\n# 周报\\n\\n<mark data-note="${note}">本周进展</mark> 已同步。\\n\\n## 版本\\n\\nv0.2.1\\n\\n## 需求\\n\\n| 前置 | 后置 |\\n| --- | --- |\\n| A | B |\\n'
  localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
})()`)
await L.reloadApp(2500)
await L.clickText('.tree .node', '笔记')
await L.waitMs(400)
await L.clickText('.tree .name', '周报.md')
await L.waitMs(6000)
C.check('持久化批注渲染为 mark.annotation', (await L.q('.ProseMirror mark.annotation')) > 0)
const md = await L.pageMd()
C.check('round-trip 保留 <mark data-note>', md.includes('<mark data-note='))

// 2. 点击批注 → 抽屉激活对应卡 + 内容
await L.clickEl('.ProseMirror mark.annotation', 0, { label: '点批注' })
await L.waitMs(800)
const cardText = await js(`(() => {
  const card = document.querySelector('.ad-card.active .ad-comment-content')
  return card ? card.textContent : 'NO'
})()`)
C.check('点击批注 → 抽屉激活卡显示内容', (cardText || '').includes('这里需要补充说明'))

// 3. 动态批注（校验）：需求表部分填写 → 锚定行高亮 + 抽屉只读卡
await js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  const z = fs.files['笔记/周报.md']
  fs.files['笔记/周报.md'] = z.replace('| A | B |', '| A |  |')
  localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
})()`)
await L.reloadApp(2500)
await L.clickText('.tree .node', '笔记')
await L.waitMs(400)
await L.clickText('.tree .name', '周报.md')
await L.waitMs(6000)
C.check('动态批注锚定行高亮', (await L.q('tr.annotation-dynamic')) > 0)
await js(`(() => {
  const tr = document.querySelector('tr.annotation-dynamic')
  if (tr) tr.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
})()`)
await L.waitMs(800)
const dynCard = await js(`(() => {
  const card = document.querySelector('.ad-card.read-only.active .ad-card-content')
  return card ? card.textContent : 'NO'
})()`)
C.check('动态批注抽屉卡显示校验消息', (dynCard || '').includes('后置不能为空'))
const dynDel = await js(`(() => {
  const card = document.querySelector('.ad-card.read-only.active')
  return card ? card.querySelectorAll('.mini.danger').length : -1
})()`)
C.check('动态批注只读（无删除按钮）', dynDel === 0)

cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
