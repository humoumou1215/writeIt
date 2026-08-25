// annotations-overlap-e2e —— v8 方案A：重叠/嵌套/同文多条/跨行批注 + 旧文件兼容
//  1. 预置嵌套 md（B 覆盖 12345，内层 A 覆盖 345）→ 渲染两层 mark、round-trip 保留嵌套
//  2. 点击重叠处（内层）→ 抽屉自动展开 → 两张卡 + 选择气泡 → 点选激活对应卡
//  3. 服务层删除批注 A → 文本保留、B 恢复单层、抽屉剩一张
//  4. 旧文件（无 data-a）→ 渲染 + round-trip 补 data-a + 批注卡可见
//  5. 段内跨行（mark 覆盖 hardbreak）→ 同 id 两段 + 收集合并一张卡
//  6. 同一文本两条独立批注（完全同范围）→ 两张卡 + 选择气泡
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js annotations-overlap-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('annotations-overlap-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const THREAD = (c) => `[{&quot;a&quot;:&quot;我&quot;,&quot;c&quot;:&quot;${c}&quot;,&quot;t&quot;:1,&quot;r&quot;:0}]`

const seedFile = (path, body) => js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  fs.files[${JSON.stringify(path)}] = ${JSON.stringify(body)}
  localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
})()`)
const openFile = async (nodeName, fileName) => {
  await L.clickText('.tree .node', nodeName)
  await L.waitMs(400)
  await L.clickText('.tree .name', fileName)
  await L.waitMs(6000)
}
const commentCardCount = () => js(`document.querySelectorAll('.ad-card:not(.read-only)').length`)

// 1. 嵌套 md（B=12345 ⊃ A=345 重叠）：渲染两层 + round-trip
await seedFile(
  '笔记/重叠.md',
  `doctype:demo\n\n# 重叠\n\n<mark data-note='${THREAD('批注B')}' data-a='b1'>12<mark data-note='${THREAD('批注A')}' data-a='a1'>345</mark></mark>6\n`
)
await L.reloadApp(2500)
await openFile('笔记', '重叠.md')
cliLog('[info] 打开 重叠.md')
C.check('两层 mark 渲染', (await L.q('.ProseMirror mark.annotation')) === 2)
const md1 = await L.pageMd()
C.check('round-trip 保留嵌套标签', md1.includes("data-a='b1'") && md1.includes("data-a='a1'") && /data-a='b1'>[^<]*<mark/.test(md1))
C.check('round-trip 锚文本保留', md1.includes('345') && md1.includes('批注B'))

// 2. 点击重叠处（内层 345）→ 选择气泡（2 条）→ 点选批注A → 抽屉展开两张卡 + A 激活
await L.clickEl('.ProseMirror mark.annotation mark.annotation', 0, { label: '点重叠内层' })
await L.waitMs(900)
const pickerInfo = await js(`(() => {
  const p = document.querySelector('.annotation-picker')
  if (!p) return { exists: false, items: [] }
  return {
    exists: true,
    items: Array.from(p.querySelectorAll('.annotation-picker-item .ap-content')).map(x => x.textContent),
  }
})()`)
C.check('点击重叠处弹选择气泡（2 条）', pickerInfo.exists && pickerInfo.items.length === 2)
C.check('气泡列出两条批注', pickerInfo.items.some((t) => t.includes('批注A')) && pickerInfo.items.some((t) => t.includes('批注B')))
await L.clickText('.annotation-picker-item', '批注A', { label: '点选批注A' })
await L.waitMs(900)
C.check('点选后抽屉展开两张批注卡', (await commentCardCount()) === 2)
const anchors = await js(
  `Array.from(document.querySelectorAll('.ad-card:not(.read-only) .ad-anchor')).map(x => x.textContent)`
)
C.check('卡片锚文本区分', anchors.some((a) => a.includes('12') && a.includes('345')) && anchors.some((a) => a.includes('345') && !a.includes('12')))
const activeContent = await L.txt('.ad-card.active .ad-comment-content')
C.check('点选后激活批注A卡', (activeContent || '').includes('批注A'))

// 3. 服务层删除批注 A（a1）→ 文本保留、B 单层
const delRes = await js(`(async () => {
  try {
    const { removeAnnotation } = await import('/src/annotations/service.ts')
    const editor = window.__editorDebug ? window.__editorDebug() : null
    if (!editor) return { err: 'no editor' }
    return { ok: removeAnnotation(editor, 'a1') }
  } catch (e) { return { err: String(e) } }
})()`)
C.check('删除批注A 成功', delRes.ok === true)
await L.waitMs(800)
// 点击 b1 锚文本（真实模块 setActiveAnnotation → notify → 抽屉 refresh 去除已删卡）
await L.clickText('.ProseMirror mark.annotation', '12', { label: '点 b1 文本' })
await L.waitMs(1000)
const md2 = await L.pageMd()
C.check('A 从 md 移除', (md2.match(/data-a='a1'/g) || []).length === 0)
C.check('B 保留且单层（恢复为 12345）', (md2.match(/data-a='b1'/g) || []).length === 1 && md2.includes('12345'))
C.check('锚文本留在文档（12/345/6）', md2.includes('12') && md2.includes('345') && md2.includes('6'))
C.check('删除后剩一张批注卡', (await commentCardCount()) === 1)

// 4. 旧文件（无 data-a）兼容
await seedFile(
  '笔记/旧文件.md',
  `doctype:demo\n\n# 旧\n\n<mark data-note="${THREAD('老批注')}">锚定文字</mark> 结束。\n`
)
await L.reloadApp(2500)
await openFile('笔记', '旧文件.md')
C.check('旧文件 mark 渲染', (await L.q('.ProseMirror mark.annotation')) >= 1)
await L.clickEl('.ProseMirror mark.annotation', 0, { label: '点旧批注' })
await L.waitMs(800)
const oldCard = await L.txt('.ad-card .ad-comment-content')
C.check('旧文件批注卡可见', (oldCard || '').includes('老批注'))
const mdOld = await L.pageMd()
C.check('round-trip 补 data-a', /data-a='[^']+'/.test(mdOld) && mdOld.includes('老批注'))

// 5. 段内跨行（mark 覆盖 hardbreak）
await seedFile(
  '笔记/跨行.md',
  `doctype:demo\n\n# 跨行\n\n<mark data-note='${THREAD('跨行批注')}' data-a='c1'>第一行\\\n第二行</mark> 后文\n`
)
await L.reloadApp(2500)
await openFile('笔记', '跨行.md')
const md3 = await L.pageMd()
C.check('跨行批注单段 mark 保留（内容含换行）', (md3.match(/data-a='c1'/g) || []).length === 1 && md3.includes('第一行') && md3.includes('第二行'))
await js(`(() => {
  const m = document.querySelector('.ProseMirror mark.annotation')
  if (m) m.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return !!m
})()`)
await L.waitMs(1000)
const crossAnchor = await L.txt('.ad-card:not(.read-only) .ad-anchor')
C.check('跨行批注合并一张卡（锚文本连接）', (crossAnchor || '').includes('第一行') && (crossAnchor || '').includes('第二行'))

// 6. 同一文本两条独立批注（完全同范围）→ 两张卡 + 选择气泡
await seedFile(
  '笔记/同文.md',
  `doctype:demo\n\n# 同文\n\n<mark data-note='${THREAD('批注X')}' data-a='x1'><mark data-note='${THREAD('批注Y')}' data-a='y1'>345</mark></mark> 后文\n`
)
await L.reloadApp(2500)
await openFile('笔记', '同文.md')
await L.clickEl('.ProseMirror mark.annotation mark.annotation', 0, { label: '点同文内层' })
await L.waitMs(900)
const picker2 = await js(`(() => {
  const p = document.querySelector('.annotation-picker')
  return p ? Array.from(p.querySelectorAll('.annotation-picker-item .ap-content')).map(x => x.textContent) : []
})()`)
C.check('同文处点击弹选择气泡（2 条）', picker2.length === 2)
await L.clickText('.annotation-picker-item', '批注Y', { label: '点选批注Y' })
await L.waitMs(900)
C.check('同文两条批注两张卡', (await commentCardCount()) === 2)
const md4 = await L.pageMd()
C.check('同文 round-trip 双 mark 保留', md4.includes("data-a='x1'") && md4.includes("data-a='y1'"))

cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)