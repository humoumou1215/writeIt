// m6e-e2e —— M6 v7：代码块整块批注（变体 D）
//  代码块内选中文本添加批注 → 自动升级为整块批注；mermaid 预览不破坏；round-trip 稳定。
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m6e-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('m6e-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

await js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  fs.files['笔记/mermaid批注测试.md'] = 'doctype:demo\\n\\n# Mermaid 批注测试\\n\\n\`\`\`mermaid\\ngraph TD\\n    A[开始] --> B[结束]\\n    B --> C{判断}\\n\`\`\`\\n\\n普通段落文本。\\n'
  localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
})()`)
await L.reloadApp(2500)
await L.clickEl('.mini.pin', 0, { label: '固定侧边栏' }).catch(() => {})
await L.waitMs(300)
await L.clickText('.tree .node', '笔记')
await L.waitMs(400)
await L.clickText('.tree .name', 'mermaid批注测试.md')
await L.waitMs(6000)

// 1. 初始 mermaid 预览正常
C.check('初始 mermaid 预览渲染', (await L.q('.milkdown-code-block .preview svg')) > 0)

// 2. 代码块内选中文本 → Ctrl+R → 块级提示
const cmBox = await js(`(() => {
  const e = [...document.querySelectorAll('.milkdown-code-block .cm-content')].find(x => x.offsetParent !== null)
  if (!e) return null
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
})()`)
if (!cmBox) { cliLog('no cm box'); process.exit(1) }
await dragMouse([[cmBox.x + 20, cmBox.y + 8], [cmBox.x + 150, cmBox.y + 8]], { label: '选代码块文本' })
await L.waitMs(400)
await L.press('Control+r')
await L.waitMs(700)
C.check('Ctrl+R 弹出评论输入框', (await L.q('.annotation-input-visible')) > 0)
const ph = await L.attr('.annotation-input-ta', 'placeholder')
C.check('提示以整个代码块为锚点', (ph || '').includes('整个代码块'))

// 3. 提交 → 摘要段落 + mark + 代码块完整
await L.fill('.annotation-input-ta', '代码块批注内容')
await L.press('Enter')
await L.waitMs(1500)
const md = await L.pageMd()
C.check('摘要锚点段落（代码块 (mermaid)）', md.includes('代码块 (mermaid)：graph TD'))
C.check('批注 mark 落盘', /<mark data-note/.test(md))
C.check('mermaid 代码块完整', md.includes('```mermaid') && md.includes('B --> C{判断}') && md.includes('```'))
const markIdx = md.indexOf('<mark data-note')
const fenceIdx = md.indexOf('```mermaid')
C.check('mark 位于代码块上方', markIdx >= 0 && fenceIdx > markIdx)

// 4. mermaid 预览不破坏
await L.waitMs(800)
C.check('批注后 mermaid 预览仍渲染', (await L.q('.milkdown-code-block .preview svg')) > 0)
const errText = await L.txt('.milkdown-code-block .preview')
C.check('无渲染失败提示', !/渲染失败/i.test(errText))

// 5. 抽屉批注卡 + 回复
await L.waitMs(800)
const cardAnchor = await L.txt('.ad-card .ad-anchor')
C.check('批注卡锚点=代码块摘要', (cardAnchor || '').includes('代码块 (mermaid)'))
await L.clickEl('.ad-card:not(.read-only) .ad-card-head', 0, { label: '展开回复框' })
await L.waitMs(600)
C.check('点头部展开回复框', (await L.q('.ad-card.active .ad-reply textarea')) > 0)
await L.fill('.ad-card.active .ad-reply textarea', '代码块批注的回复')
await L.clickText('.ad-reply-actions button', '发送')
await L.waitMs(1200)
C.check('回复后评论 2 条', (await L.q('.ad-card .ad-comment')) === 2)

// 6. round-trip：切走再切回
await L.clickText('.tree .name', '周报.md')
await L.waitMs(1500)
await L.clickText('.tree .name', 'mermaid批注测试.md')
await L.waitMs(6000)
const md2 = await L.pageMd()
C.check('round-trip 后摘要段落保留', md2.includes('代码块 (mermaid)：graph TD'))
C.check('round-trip 后代码块完整', md2.includes('```mermaid') && md2.includes('B --> C{判断}'))
C.check('round-trip 后 mermaid 预览正常', (await L.q('.milkdown-code-block .preview svg')) > 0)
const cardAfter = await L.txt('.ad-card .ad-anchor')
C.check('round-trip 后批注卡仍在', (cardAfter || '').includes('代码块 (mermaid)'))

// 7. 普通段落批注不受影响（锚点=选中文本）
const pbox = await js(`(() => {
  const e = [...document.querySelectorAll('.ProseMirror p')].find(x => x.textContent.includes('普通段落文本'))
  if (!e) return null
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, h: r.height }
})()`)
if (pbox) {
  await dragMouse([[pbox.x + 2, pbox.y + pbox.h / 2], [pbox.x + 90, pbox.y + pbox.h / 2]], { label: '选段落文本' })
  await L.waitMs(400)
  await L.press('Control+r')
  await L.waitMs(700)
  C.check('段落批注浮窗正常', (await L.q('.annotation-input-visible')) > 0)
  const ph2 = await L.attr('.annotation-input-ta', 'placeholder')
  C.check('段落批注提示为普通文案', (ph2 || '').includes('在此输入评论'))
  await L.fill('.annotation-input-ta', '段落批注')
  await L.press('Enter')
  await L.waitMs(1500)
  const md3 = await L.pageMd()
  const marks3 = md3.match(/<mark data-note='[^']*'[^>]*>[^<]*<\/mark>/g) || []
  C.check('段落批注锚点=选中文本', marks3.length >= 2 && !marks3[1].includes('代码块'))
} else {
  cliLog('❌ 无段落框')
  C.check('段落框存在', false)
}

cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
