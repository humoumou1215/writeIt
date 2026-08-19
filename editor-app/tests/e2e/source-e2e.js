// source-e2e —— M7 源码查看模式（Ctrl+E 切换所见即所得 / 源码）
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js source-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('source-e2e')
await L.installErrors()

const activeTaShown = () => js(`(() => {
  const panes = Array.from(document.querySelectorAll('.editor-pane'))
  const active = panes.find(p => p.style.display !== 'none')
  const ta = active ? active.querySelector('.source-ta') : null
  return !!ta && ta.style.display === 'block'
})()`)
const activeMilkdownHidden = () => js(`(() => {
  const panes = Array.from(document.querySelectorAll('.editor-pane'))
  const active = panes.find(p => p.style.display !== 'none')
  const md = active ? active.querySelector('.milkdown') : null
  return !!md && md.style.display === 'none'
})()`)

await L.freshApp('http://localhost:5173/?backend=mock', 2500)
await js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  fs.files['笔记/源码测试.md'] = '# 源码测试\\n\\n第一段内容。\\n'
  localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
})()`)
await L.reloadApp(2500)
await L.clickText('.tree .node', '笔记')
await L.waitMs(400)
await L.clickText('.tree .name', '源码测试.md')
await L.waitMs(4500)

// 1. Ctrl+E 进入源码模式
await L.press('Control+e')
await L.waitMs(600)
C.check('Ctrl+E 进入源码模式（textarea 显示）', await activeTaShown())
C.check('WYSIWYG 隐藏（.milkdown display:none）', await activeMilkdownHidden())
C.check('状态栏显示「源码模式」标识', (await L.q('.mode-badge')) > 0)
const taVal = await L.val('.source-ta')
C.check('textarea 内容 = 文档 markdown', taVal.includes('# 源码测试') && taVal.includes('第一段内容'))
const srcFocus = await js(`document.activeElement ? document.activeElement.getAttribute('data-source-ta') === '' : false`)
C.check('焦点在源码 textarea', srcFocus)

// 2. 源码编辑 → 脏标记
await js(`(() => { const ta = document.querySelector('.source-ta'); if (ta) ta.focus() })()`)
await L.press('End')
await L.type('\n\n新增段落：源码编辑。')
await L.waitMs(400)
C.check('源码编辑 → 标签脏标记亮', (await L.q('.tab .dot.dirty')) > 0)
const statusDirty = await L.txt('.statusbar .active-file')
C.check('状态栏显示未保存', statusDirty.includes('未保存'))
const mdNow = await L.pageMd()
C.check('__editorGetMarkdown 返回源码最新内容', mdNow.includes('源码编辑'))

// 3. Ctrl+E 切回所见即所得
await L.press('Control+e')
await L.waitMs(1800)
C.check('Ctrl+E 切回 WYSIWYG（textarea 隐藏）', !(await activeTaShown()))
const rendered = await L.txt('.ProseMirror')
C.check('新增段落渲染为 WYSIWYG 内容', rendered.includes('源码编辑'))
C.check('源码模式标识消失', (await L.q('.mode-badge')) === 0)

// 4. 未修改 → 切回不脏
await L.press('Control+s')
await L.waitMs(2500)
await L.press('Control+e'); await L.waitMs(500)
await L.press('Control+e'); await L.waitMs(1200)
C.check('未修改源码切回 → 不脏', (await L.q('.tab .dot.dirty')) === 0)

// 5. 源码模式 Ctrl+S 保存
await L.press('Control+e'); await L.waitMs(500)
await js(`(() => { const ta = document.querySelector('.source-ta'); if (ta) ta.focus() })()`)
await L.press('End')
await L.type('\n\n保存前加的源码内容。')
await L.press('Control+s')
await L.waitMs(3000)
C.check('源码模式 Ctrl+S 后仍保持源码模式', await activeTaShown())
C.check('保存后脏标记熄灭', (await L.q('.tab .dot.dirty')) === 0)
const disk = await js(`(JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}').files['笔记/源码测试.md'] || '')`)
C.check('源码内容已落盘到 mock fs', disk.includes('保存前加的源码内容'))
const mdSaved = await L.pageMd()
C.check('保存后 __editorGetMarkdown = 源码内容', mdSaved.includes('保存前加的源码内容'))

// 6. 切标签模式保持
await L.press('Control+e'); await L.waitMs(1200)
if (await L.q('.content-col.collapsed')) { await L.clickEl('.icon-btn[title^="文件目录"]', 0); await L.waitMs(600) }
await L.clickText('.tree .name', 'README.md')
await L.waitMs(5000)
await L.press('Control+e'); await L.waitMs(600)
C.check('第二个标签进入源码模式', await activeTaShown())
await L.clickText('.tab', '源码测试.md')
await L.waitMs(900)
C.check('切回第一个标签 → 保持 WYSIWYG 模式（textarea 隐藏）', !(await activeTaShown()))
C.check('第一个标签 milkdown 显示', !(await activeMilkdownHidden()))
await L.clickText('.tab', 'README.md')
await L.waitMs(900)
C.check('切到第二个标签 → 其 textarea 仍显示（模式保持）', await activeTaShown())
await L.press('Control+e'); await L.waitMs(1200)
await L.clickEl('.tab .close', await js(`(() => { const tabs=[...document.querySelectorAll('.tab')]; const i=tabs.findIndex(t=>(t.textContent||'').includes('README')); return i>=0?i:0 })()`), { label: '关第二个标签' }).catch(async () => {
  await L.clickText('.tab', 'README.md')
  await L.clickEl('.tab .close', 0, { label: '关' })
})
await L.waitMs(800)

// 7. 源码模式 Ctrl+R 守卫
await L.press('Control+e'); await L.waitMs(500)
await js(`(() => { window.__x = 1 })()`)
await js(`(() => { const el = Array.from(document.querySelectorAll('.source-ta')).find(e => e.offsetParent !== null); if (el) { el.focus(); el.select() } })()`)
await L.press('Control+r')
await L.waitMs(700)
C.check('源码模式 Ctrl+R 不弹批注输入', (await L.q('.annotation-input-visible')) === 0)
let toastShown = false
for (let i = 0; i < 20; i++) { await L.waitMs(100); if ((await js(`[...document.querySelectorAll('.toast')].some(t => (t.textContent||'').includes('源码模式'))`))) { toastShown = true; break } }
C.check('Ctrl+R 有引导提示（切回编辑模式）', toastShown)
C.check('Ctrl+R 未触发页面刷新', await js(`window.__x === 1`))
await L.press('Control+e'); await L.waitMs(1200)

// 8. inline-code 改绑 Ctrl+Shift+E
const boxp = await js(`(() => {
  const e = [...document.querySelectorAll('.ProseMirror p')].find(x => x.textContent.includes('第一段内容'))
  if (!e) return null
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, h: r.height }
})()`)
if (!boxp) { cliLog('no box for 第一段内容'); process.exit(1) }
await dragMouse([[boxp.x + 10, boxp.y + boxp.h / 2], [boxp.x + 150, boxp.y + boxp.h / 2]], { label: '选段落' })
await L.waitMs(300)
await L.press('Control+Shift+e')
await L.waitMs(700)
C.check('Ctrl+Shift+E 切换行内代码（改绑生效）', (await L.q('.ProseMirror code')) > 0)
const mdInline = await L.pageMd()
C.check('行内代码写入 markdown（反引号）', mdInline.includes('`'))
await L.press('Control+e'); await L.waitMs(600)
C.check('WYSIWYG 下 Ctrl+E 进入源码模式（不再切换行内代码）', await activeTaShown())
await L.press('Control+e'); await L.waitMs(1000)

cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail === 0 ? 0 : 1)
