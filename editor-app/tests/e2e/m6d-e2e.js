// m6d-e2e —— M6 回归：file_block 嵌入块内添加批注 → 保存写回源文件 → 打开源文件
// （双重转义回归：note 属性 round-trip 只转义一次）
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m6d-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('m6d-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

// 干净起点：重置待办清单文件
const todoSeed = '# 待办清单\n\n- [ ] 支持自动保存\n- [ ] 文件树右键菜单\n- [ ] 多标签页\n- [ ] 主题适配\n- [x] 搭建工程'
await js(`(() => {
  const KEY = 'milkdown-note-mock-fs-v2'
  const fs = JSON.parse(localStorage.getItem(KEY) || '{}')
  fs.files['笔记/待办清单.md'] = ${JSON.stringify(todoSeed)}
  localStorage.setItem(KEY, JSON.stringify(fs))
})()`)
await L.reloadApp(2500)

// 1. 打开引用演示.md（含 ![[笔记/待办清单]] 嵌入）
await L.clickText('.tree .name', '引用演示.md', { label: '打开引用演示' })
await L.waitMs(6000)
C.check('嵌入块已物化（.ref-file-block）', (await L.q('.ref-file-block')) > 0)

// 2. 在嵌入块内选中文字（待办清单第一条）
await L.selectText('.ref-file-block-content li', '支持自动保存', 45, 145)
await L.waitMs(800)

// 3. Toolbar → 添加批注「评2」
const addBtnCount = await L.q('[data-toolbar-item="add-annotation"]')
C.check('toolbar 含添加批注按钮', addBtnCount > 0)
if (addBtnCount > 0) {
  await L.clickEl('[data-toolbar-item="add-annotation"]', 0, { label: '点添加批注' })
  await L.waitMs(600)
  await L.fill('.annotation-input-ta', '评2')
  const inputBox = await L.box('.annotation-input')
  C.check('批注浮窗完整在视口内（底部上翻定位）', !!inputBox && inputBox.y >= 0 && inputBox.y + inputBox.h <= 750)
  await L.press('Enter')
  await L.waitMs(1200)
  C.check('嵌入块内批注节点插入', (await L.q('.ref-file-block-content mark.annotation')) > 0)

  // 4. Ctrl+S 保存 → writeback 写回源文件
  await L.press('Control+s')
  await L.waitMs(2000)
  const source = await js(`(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
    return fs.files['笔记/待办清单.md'] || ''
  })()`)
  cliLog('[debug] 源文件内容: ' + JSON.stringify(source))
  C.check('写回：源文件含 <mark data-note', source.includes('<mark data-note='))
  C.check('写回：单引号属性 + JSON 双引号原样（评2）', /data-note='[^']*"c":"评2"/.test(source))
  C.check('写回：无 HTML 实体转义（不含 &quot;）', !source.includes('&quot;'))
  C.check('写回：无双重转义（不含 &amp;quot;）', !source.includes('&amp;quot;'))

  // 5. 打开源文件 笔记/待办清单.md（若侧边栏已收纳先展开）
  if ((await L.q('.content-col.collapsed')) > 0) {
    await L.clickEl('.icon-col .icon-btn', 0)
    await L.waitMs(400)
  }
  await L.clickText('.tree .node', '笔记')
  await L.waitMs(400)
  await L.clickText('.tree .name', '待办清单.md')
  await L.waitMs(6000)
  C.check('源文件打开后批注渲染为 mark.annotation', (await js(`[...document.querySelectorAll('.ProseMirror mark.annotation')].filter(e => e.offsetParent !== null).length`)) > 0)

  // 6. 点击批注 → 抽屉卡：作者=我，内容=评2
  await js(`(() => {
    const el = Array.from(document.querySelectorAll('.ProseMirror mark.annotation')).find(e => e.offsetParent !== null)
    if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })()`)
  await L.waitMs(900)
  const card = await js(`(() => {
    const c = document.querySelector('.ad-card.active')
    if (!c) return null
    const author = c.querySelector('.ad-author') ? c.querySelector('.ad-author').textContent : ''
    const content = c.querySelector('.ad-comment-content') ? c.querySelector('.ad-comment-content').textContent : ''
    return { author, content }
  })()`)
  cliLog('[debug] 抽屉卡: ' + JSON.stringify(card))
  C.check('批注作者显示正确（我）', card && card.author === '我')
  C.check('批注内容正确（评2）', card && card.content.includes('评2'))
  C.check('内容非原始转义 JSON', card && !card.content.includes('&quot;'))
}

cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
