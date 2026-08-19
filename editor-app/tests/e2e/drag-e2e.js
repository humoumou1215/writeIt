// drag-e2e —— M7-Drag 拖拽移动（mock 模式）
// 覆盖：文件入目录 / 目录递归 / 拖到根 / 插入线同级 / 循环拒绝 / 空操作 / 冲突拒绝 /
//       悬停自动展开 / 标签+引用联动 / 真实 HTML5 DnD 冒烟 / 瞄准定位
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js drag-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('drag-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const rootSel = (p) => '.tree [data-path="' + p + '"]'
// 浏览器侧选择器（JSON 转义）
const B = (p) => JSON.stringify(rootSel(p))

const treeReady = async () => {
  const start = Date.now()
  while (Date.now() - start < 15000) {
    if ((await L.q('.tree [data-path="README.md"]')) > 0) return true
    await L.waitMs(200)
  }
  return false
}
await treeReady()

const count = (p) => L.q(rootSel(p))
const hasPath = async (p) => (await count(p)) > 0
const md = () => L.pageMd()

// 手动 dispatch HTML5 DnD 事件（可精确控制悬停位置）
async function dragDrop(source, target, pos) {
  if (pos === 'into') await ensureExpanded(target)
  await js(`(() => {
    const src = document.querySelector(${B(source)})
    const tgt = document.querySelector(${B(target)})
    if (!src || !tgt) throw new Error('节点不存在')
    const dt = () => new DataTransfer()
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt() }))
    const rect = tgt.getBoundingClientRect()
    let y = rect.top + rect.height / 2
    if (${JSON.stringify(pos)} === 'before') y = rect.top + 2
    if (${JSON.stringify(pos)} === 'after') y = rect.bottom - 2
    const x = rect.left + rect.width / 2
    tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt() }))
    tgt.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt() }))
  })()`)
  await L.waitMs(900)
}
// 拖到树根空白区
async function dragDropRoot(source) {
  await js(`(() => {
    const src = document.querySelector(${B(source)})
    if (!src) throw new Error('节点不存在')
    const dt = () => new DataTransfer()
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt() }))
    const tree = document.querySelector('.tree')
    const rect = tree.getBoundingClientRect()
    const x = rect.left + 30
    const y = rect.bottom - 8
    tree.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt() }))
    tree.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt() }))
  })()`)
  await L.waitMs(900)
}
const ensureSidebar = async () => {
  if (await js(`document.querySelector('.content-col') ? document.querySelector('.content-col').classList.contains('collapsed') : false`)) {
    await L.clickEl('.icon-col .icon-btn', 0)
    await L.waitMs(400)
  }
}
const clickNode = async (path) => {
  await js(`(() => { const el = document.querySelector(${B(path)} + ' .name'); if (el) el.click() })()`)
}
const ensureExpanded = async (path) => {
  if ((await L.q(rootSel(path))) === 0) return false
  if ((await L.q(rootSel(path) + ' .arrow.open')) === 0) {
    await js(`(() => { const el = document.querySelector(${B(path)} + ' .arrow'); if (el) el.click() })()`)
    await L.waitMs(450)
  }
  return true
}

// ===== 1. 文件拖入目录（into）=====
await ensureSidebar()
await dragDrop('README.md', '笔记', 'into')
C.check('文件拖入目录 → 笔记/README.md', await hasPath('笔记/README.md'))
C.check('源位置移除', !(await hasPath('README.md')))

// ===== 2. 插入线 before =====
await ensureExpanded('笔记')
await dragDrop('Mermaid 图表集.md', '笔记/会议记录.md', 'before')
C.check('插入线 before → 笔记/Mermaid 图表集.md', await hasPath('笔记/Mermaid 图表集.md'))

// ===== 3. 插入线 after =====
await dragDrop('引用演示.md', '笔记/会议记录.md', 'after')
C.check('插入线 after → 笔记/引用演示.md', await hasPath('笔记/引用演示.md'))

// ===== 4. 目录递归移动 =====
await dragDrop('数据', '笔记', 'into')
await ensureExpanded('笔记/数据')
C.check('目录递归 → 笔记/数据/原始数据.txt', await hasPath('笔记/数据/原始数据.txt'))

// ===== 5. 拖到树根空白区 =====
await dragDropRoot('笔记/待办清单.md')
C.check('拖到根 → 待办清单.md', await hasPath('待办清单.md'))
C.check('原位置移除', !(await hasPath('笔记/待办清单.md')))

// ===== 6. 循环拒绝 =====
await ensureExpanded('笔记/数据')
const before6 = await count('笔记/数据')
await dragDrop('笔记', '笔记/数据/原始数据.txt', 'before')
C.check('循环拒绝（目录→后代）树不变', (await count('笔记/数据')) === before6)
C.check('循环拒绝（目录→后代）源未消失', await hasPath('笔记'))

// ===== 7. 空操作拒绝 =====
await dragDrop('笔记/README.md', '笔记', 'into')
C.check('拖回原父目录 = 空操作', await hasPath('笔记/README.md'))
await dragDrop('笔记/README.md', '笔记/README.md', 'before')
C.check('拖到自身 = 空操作', await hasPath('笔记/README.md'))

// ===== 8. 冲突拒绝 =====
await ensureSidebar()
await L.clickEl('.sidebar-actions .mini[title="新建文件"]', 0, { label: '新建' })
await L.waitMs(300)
await L.fill('.tree .rename-input', '新文件.md')
await L.press('Enter')
await L.waitMs(1200)
await dragDrop('新文件.md', '笔记', 'into')
C.check('冲突前置：新文件.md 移入笔记', await hasPath('笔记/新文件.md'))
await ensureSidebar()
await L.clickEl('.sidebar-actions .mini[title="新建文件"]', 0, { label: '新建' })
await L.waitMs(300)
await L.fill('.tree .rename-input', '新文件.md')
await L.press('Enter')
await L.waitMs(1200)
await ensureSidebar()
await dragDropRoot('笔记/新文件.md')
C.check('冲突拒绝：根同名文件仍在', await hasPath('新文件.md'))
C.check('冲突拒绝：源未移动（仍在笔记）', await hasPath('笔记/新文件.md'))

// ===== 9. 悬停目录自动展开 =====
await clickNode('笔记')
await L.waitMs(400)
C.check('前置：笔记已折叠', (await L.q(rootSel('笔记/会议记录.md'))) === 0)
await js(`(() => {
  const src = document.querySelector(${B('新文件.md')})
  const tgt = document.querySelector(${B('笔记')})
  const dt = () => new DataTransfer()
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt() }))
  const rect = tgt.getBoundingClientRect()
  tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, dataTransfer: dt() }))
})()`)
await L.waitMs(1100)
C.check('悬停目录 500ms 自动展开', (await L.q(rootSel('笔记/会议记录.md'))) > 0)
await js(`(() => { const el = document.querySelector(${B('新文件.md')}); if (el) el.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true })) })()`)
await L.waitMs(300)

// ===== 10. 真实 HTML5 DnD 冒烟（egolite 真实拖拽）=====
await dragDrop('待办清单.md', '.template', 'into')
C.check('冒烟前置：待办清单.md → template', await hasPath('.template/待办清单.md'))
// 用 ego 真实拖拽：.template/待办清单.md → 笔记
const srcBox = await L.box(rootSel('.template/待办清单.md'))
const tgtBox = await L.box(rootSel('笔记'))
await dragMouse([[srcBox.cx, srcBox.cy], [tgtBox.cx, tgtBox.cy]], { label: '真实拖拽' })
await L.waitMs(1200)
C.check('真实拖拽生效 → 笔记/待办清单.md', await hasPath('笔记/待办清单.md'))
C.check('真实拖拽后源移除', !(await hasPath('.template/待办清单.md')))

// ===== 11. 标签 + 引用联动 =====
await ensureSidebar()
await ensureExpanded('笔记')
await clickNode('笔记/引用演示.md')
await L.waitMs(2500)
C.check('引用演示标签已打开', await L.has('.tab', '引用演示'))
await ensureSidebar()
await ensureExpanded('笔记')
await clickNode('笔记/会议记录.md')
await L.waitMs(2500)
C.check('会议记录标签已打开', await L.has('.tab', '会议记录'))
await L.clickText('.tab', '引用演示')
await L.waitMs(1500)
const mdBefore = await md()
C.check('引用原文含 [[笔记/会议记录]]', mdBefore.includes('[[笔记/会议记录]]'))
await dragDrop('笔记', '.template', 'into')
await ensureExpanded('.template/笔记')
C.check('目录移动 → template/笔记/会议记录.md', await hasPath('.template/笔记/会议记录.md'))
const mdAfter = await md()
C.check('引用联动：[[.template/笔记/会议记录]]', mdAfter.includes('[[.template/笔记/会议记录]]'))
C.check('旧引用路径已不存在', !mdAfter.includes('[[笔记/会议记录]]'))
C.check('联动后标签未关闭', await L.has('.tab', '会议记录'))

// ===== 12. 瞄准定位（🎯）=====
await clickNode('.template')
await L.waitMs(400)
C.check('前置：template 已折叠', (await L.q(rootSel('.template/笔记/会议记录.md'))) === 0)
await L.clickText('.tab', '会议记录')
await L.waitMs(800)
await ensureSidebar()
await L.clickText('.sidebar-actions .mini', '定位')
await L.waitMs(700)
C.check('定位：祖先链展开（template/笔记 可见）', (await L.q(rootSel('.template/笔记/会议记录.md'))) > 0)
C.check('定位：节点高亮 revealed', (await L.q(rootSel('.template/笔记/会议记录.md') + '.revealed')) > 0)
await L.waitMs(2200)
C.check('定位：高亮自动清除', (await L.q(rootSel('.template/笔记/会议记录.md') + '.revealed')) === 0)

C.check('无页面错误', (await L.errors()).length === 0)
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
