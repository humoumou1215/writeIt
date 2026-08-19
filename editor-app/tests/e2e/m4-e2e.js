// m4-e2e —— M4 模板机制：模板服务 + suggest 实体 + / 菜单模板组 + 对象引用 + 基于模板新建
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m4-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('m4-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

// ---- 1. 打开引用演示：对象引用自动消歧 ----
await L.clickText('.tree .name', '引用演示.md', { label: '打开引用演示' })
await L.waitMs(5000)
const objTexts = await js(`(() => {
  const spans = Array.from(document.querySelectorAll('[data-object-ref]'))
  return spans.map(s => ({ obj: s.getAttribute('data-object'), text: s.getAttribute('data-text') }))
})()`)
cliLog('  object_ref: ' + JSON.stringify(objTexts))
C.check('greeting 解析为段落', objTexts.some(s => s.obj === 'greeting' && s.text && s.text.includes('你好')))
C.check('version 解析为版本号', objTexts.some(s => s.obj === 'version' && s.text && s.text.includes('v0.2.1')))

// ---- 2. / 菜单「模板」组（新段落，避免字面量 [[ 干扰）----
await L.goEnd()
await L.waitMs(400)
await L.press('Enter')
await L.waitMs(300)
await L.type('/')
await L.waitMs(1000)
const tplGroup = await js(`(() => {
  const menus = Array.from(document.querySelectorAll('.milkdown-slash-menu[data-show="true"]'))
  for (const m of menus) {
    const groups = Array.from(m.querySelectorAll('.menu-group'))
    const g = groups.find(x => x.querySelector('h6') && x.querySelector('h6').textContent && x.querySelector('h6').textContent.includes('模板'))
    if (g) return { items: Array.from(g.querySelectorAll('li')).map(li => li.textContent.trim()).slice(0, 3) }
  }
  return null
})()`)
cliLog('  模板组: ' + JSON.stringify(tplGroup))
C.check('/ 菜单含「模板」组', tplGroup !== null && tplGroup.items.length >= 1)

// 插入 demo 模板（连续输入过滤）
await L.type('demo')
await L.waitMs(800)
await L.press('Enter')
await L.waitMs(2000)
let md = await L.pageMd()
C.check('插入模板含 doctype', md.includes('doctype:demo'))
C.check('插入模板含占位符 {{title}}', md.includes('{{title}}'))
C.check('插入模板含版本段落', md.includes('## 版本'))

// ---- 3. ref 菜单第二级实体 ----
// 注：应用演进后，文件级按 Enter = 直接插入文件链接；要下钻到实体级需按 ArrowRight。
// 前置 `/`+模板插入后编辑器易失焦，故先 focusEditor 再操作。
await L.focusEditor()
await L.goEnd()
await L.waitMs(300)
await L.press('Enter')
await L.waitMs(300)
await L.type('[[笔记/周报')
await L.waitMs(1000)
await L.press('ArrowRight')
// 轮询等实体级出现
let entityLabels = []
for (let i = 0; i < 15; i++) {
  await L.waitMs(300)
  entityLabels = await js(`(() => {
    const el = document.querySelector('[data-ref-menu][data-show="true"] .menu-group')
    return el ? Array.from(el.querySelectorAll('li span')).map(s => s.textContent.trim()) : []
  })()`)
  if (entityLabels.length >= 2) break
}
cliLog('  实体列表: ' + JSON.stringify(entityLabels))
C.check('实体级显示问候语', entityLabels.includes('问候语'))
C.check('实体级显示版本号', entityLabels.includes('版本号'))
// 选版本号（第 2 项）
await L.press('ArrowDown')
await L.press('Enter')
await L.waitMs(2000)
md = await L.pageMd()
C.check('插入 [[笔记/周报#version]]', md.includes('[[笔记/周报#version]]'))
const newObj = await js(`(() => {
  const spans = Array.from(document.querySelectorAll('[data-object-ref]'))
  return spans.filter(s => s.getAttribute('data-object') === 'version').map(s => s.getAttribute('data-text'))
})()`)
C.check('新插入对象已解析', newObj.some(t => t && t.includes('v0.2.1')))

// ---- 4. 基于模板新建 ----
// 确保侧边栏展开（collapsed 在 content-col 上）
const collapsed = await js(`document.querySelector('.content-col') ? document.querySelector('.content-col').classList.contains('collapsed') : false`)
if (collapsed) {
  await L.clickEl('.icon-col .icon-btn', 0).catch(async () => { await L.press('Control+b') })
  await L.waitMs(500)
}
// .template 是树首节点，y=12 会命中它——改右键「笔记」目录（明确的普通目录）
await L.rightClickText('.tree .node', '笔记')
await L.waitMs(400)
await L.clickText('.menu-item', '基于模板新建')
await L.waitMs(600)
C.check('模板选择器打开', (await L.q('.tpl-picker')) > 0)
await L.clickText('.tpl-item', 'demo')
await L.waitMs(400)
await L.type('从模板新建的周报') // 自动补 .md
await L.press('Enter')
await L.waitMs(3000)
md = await L.pageMd()
C.check('新建文件含模板内容', md.includes('doctype:demo') && md.includes('{{title}}'))
// 打开文件不收纳侧边栏 → 确保展开再检查文件树
const collapsed2 = await js(`document.querySelector('.content-col') ? document.querySelector('.content-col').classList.contains('collapsed') : false`)
if (collapsed2) {
  await L.clickEl('.icon-col .icon-btn', 0)
  await L.waitMs(500)
}
// 展开右键所在目录（笔记）后检查新文件
await L.clickText('.tree .node', '笔记')
await L.waitMs(600)
C.check('文件树显示新文件', (await L.q('.tree .name')) > 0 && await L.has('.tree .name', '从模板新建的周报'))

await L.shotTo('17-模板机制-M4.png')
cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
