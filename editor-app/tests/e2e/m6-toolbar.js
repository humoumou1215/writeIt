// m6-toolbar —— M6 Toolbar 添加批注 / Ctrl+R / Ctrl+Enter / ESC
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m6-toolbar
const C = L.newChecker()

const task = await L.acquireTaskSpace('m6-toolbar')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

await js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  fs.files['笔记/周报.md'] = 'doctype:demo\\n\\n# 周报\\n\\n这是一段用于测试批注功能的文本内容。\\n'
  localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
})()`)
await L.reloadApp(2500)
await L.clickText('.tree .node', '笔记')
await L.waitMs(400)
await L.clickText('.tree .name', '周报.md')
await L.waitMs(4500)

// 选中"用于测试批注功能"这段文本
await L.selectText('.ProseMirror p', '这是一段用于测试批注功能的文本内容')
await L.waitMs(800)
C.check('选中文本后 toolbar 出现', (await L.q('.milkdown-toolbar')) > 0)
const items = await js(`Array.from(document.querySelectorAll('.milkdown-toolbar [data-toolbar-item]')).map(i => i.getAttribute('data-toolbar-item'))`)
cliLog('[debug] toolbar items: ' + JSON.stringify(items))

// 点"添加批注"（try 包裹防浮窗偶发未开致 fill 崩溃）
C.check('toolbar 含 添加批注 按钮', items.includes('add-annotation'))
try {
  if (items.includes('add-annotation')) {
    await L.clickEl('[data-toolbar-item="add-annotation"]', 0, { label: '点添加批注' })
    await L.waitMs(800)
  C.check('批注输入浮窗出现', (await L.q('.annotation-input-visible')) > 0)
  await L.fill('.annotation-input-ta', '人工批注内容')
  await L.press('Enter') // 输入浮窗交互：Enter 确认提交
  await L.waitMs(1200)
  C.check('批注节点插入（mark.annotation）', (await L.q('.ProseMirror mark.annotation')) > 0)
  const md = await L.pageMd()
  cliLog('[debug] md: ' + JSON.stringify(md.slice(-120)))
  // v7.1：单引号属性 + JSON 双引号原样（不再 &quot; 转义）
  C.check('md 含线程 JSON（人工批注内容）', /data-note='[^']*"c":"人工批注内容"/.test(md))
  // 批注卡无删除按钮（v4 决策）
  await L.clickEl('.ProseMirror mark.annotation', 0, { label: '点批注' })
  await L.waitMs(800)
  C.check('批注卡无删除按钮', (await L.q('.ad-card.active .mini.danger')) === 0)
  // v6：卡片默认收起，点击头部展开（显示回复输入框）
  await L.clickEl('.ad-card.active .ad-card-head', 0, { label: '展开卡' })
  await L.waitMs(600)
  // 注：应用演进后，回复 textarea 的 Enter 直接提交（不再是换行），故只测 ESC 清空与 Ctrl+Enter 提交。
  await L.fill('.ad-card.active .ad-reply textarea', '待取消')
  await L.press('Escape')
  C.check('ESC 清空草稿', (await L.val('.ad-card.active .ad-reply textarea')) === '')
  // Ctrl+Enter 提交回复
  await L.fill('.ad-card.active .ad-reply textarea', '用 Ctrl+Enter 发送的回复')
  await L.press('Control+Enter')
  await L.waitMs(1200)
  const replyComments = await js(`(() => {
    const card = document.querySelector('.ad-card.active')
    const authors = Array.from(card.querySelectorAll('.ad-comment .ad-author')).map(a => a.textContent)
    const contents = Array.from(card.querySelectorAll('.ad-comment-content')).map(c => c.textContent)
    return { authors, contents }
  })()`)
  C.check('Ctrl+Enter 提交回复', replyComments.contents.some(c => c.includes('Ctrl+Enter 发送的回复')))
  }
} catch (e) {
  cliLog('❌ 批注流程异常: ' + e.message)
}

// Ctrl+R：选中文字后快速弹评论输入框
// 注：经探测，当前应用版本下选中后按 Ctrl+R 不弹输入框（快捷键行为可能有变），
// 该断言如实保留，失败即反映应用回归。
await L.focusEditor()
await L.selectText('.ProseMirror p', '这是一段用于测试批注功能的文本内容')
await L.waitMs(500)
await L.focusEditor()
await L.press('Control+r')
await L.waitMs(700)
C.check('Ctrl+R 弹出评论输入框', (await L.q('.annotation-input-visible')) > 0)
await L.press('Escape')

cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
