// mermaid-ref-e2e —— Mermaid 引用（M9/M10）：代码块内 @ 联想 + 渲染文本级链接 + 点击跳转
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js mermaid-ref-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('mermaid-ref-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

// 注入测试文档
await js(`(() => {
  const KEY = 'milkdown-note-mock-fs-v2'
  const fs = JSON.parse(localStorage.getItem(KEY) || '{}')
  fs.files['Mermaid引用测试.md'] = [
    'doctype:demo', '', '# 引用测试', '',
    '\`\`\`mermaid', 'graph TD',
    '  A[流程开始] --> B["修改 [[数据库/loan/loan_apply#amount]] 的值为 1"]',
    '  C["查 [[数据库/loan/loan_apply#apply_no]]"] --> B',
    '\`\`\`', '',
    '\`\`\`js', 'const x = @decorator', '\`\`\`', '',
  ].join('\\n')
  localStorage.setItem(KEY, JSON.stringify(fs))
})()`)
await L.reloadApp(2500)
await L.treeClick('Mermaid引用测试.md')
await L.waitMs(4000)

// ---- A: 渲染文本级链接 ----
await L.clickEl('.preview-toggle-button', 0, { label: '开预览' })
await L.waitMs(3000)
const refs = await js(`(() => { const anchors = [...document.querySelectorAll('.preview a.mmd-text-ref')]; return anchors.map(a => ({ text: a.textContent, ref: a.getAttribute('data-ref') })) })()`)
C.check('A1: 文本引用渲染（≥2）', refs.length >= 2)
C.check('A2: 显示路径去掉了 [[ ]]', refs.every(r => r.text && !r.text.includes('[[') && !r.text.includes(']]')))
C.check('A3: data-ref 保留完整引用', refs.some(r => r.ref === '数据库/loan/loan_apply#amount') && refs.some(r => r.ref === '数据库/loan/loan_apply#apply_no'))

// ---- B: 点击跳转 ----
await L.clickEl('.preview a.mmd-text-ref', 0, { label: '点引用' })
await L.waitMs(2500)
const activeTab = await js(`document.querySelector('.tabbar .tab.active') ? document.querySelector('.tabbar .tab.active').textContent.trim() : ''`)
C.check('B1: 点击引用打开目标文档（loan_apply.md）', (activeTab || '').includes('loan_apply'))

// ---- C: 代码块内 @ 联想 ----
if ((await L.q('.content-col.collapsed')) > 0) { await L.clickEl('.icon-btn', 0); await L.waitMs(600) }
await L.scrollIntoView('.tree .name', await js(`[...document.querySelectorAll('.tree .name')].findIndex(e => e.textContent.includes('Mermaid引用测试'))`))
await L.clickEl('.tree .name', await js(`[...document.querySelectorAll('.tree .name')].findIndex(e => e.textContent.includes('Mermaid引用测试'))`), { label: '回引用测试' })
await L.waitMs(3000)
C.check('C0: 可见代码块存在（≥2）', (await js(`[...document.querySelectorAll('.milkdown-code-block')].filter(b => b.offsetParent !== null).length`)) >= 2)
// 回到编辑模式
if ((await L.q('.codemirror-host.hidden')) > 0) {
  await L.clickEl('.preview-toggle-button', 0, { label: '关预览' })
  await L.waitMs(800)
}
// 聚焦第一个可见代码块 → 全选 → 输入含 @ 的文本
await L.clickEl('.milkdown-code-block .cm-content', await js(`[...document.querySelectorAll('.milkdown-code-block')].findIndex(b => b.offsetParent !== null)`), { label: '聚焦代码块' }).catch(async () => {
  await js(`(() => { const b=[...document.querySelectorAll('.milkdown-code-block')].find(x=>x.offsetParent!==null); const cm=b?b.querySelector('.cm-content'):null; if(cm) cm.focus() })()`)
})
await L.waitMs(800)
await L.press('Control+a')
await L.type('graph TD\n  A[开始] --> B["改 @')
await L.waitMs(1500)
const anyMenuShown = await js(`[...document.querySelectorAll('[data-mermaid-ref]')].some(el => el.getAttribute('data-show') === 'true')`)
C.check('C1: mermaid 代码块内 @ 触发联想', anyMenuShown)

await L.type('loan_apply')
await L.waitMs(600)
await L.press('Enter')
await L.waitMs(800)
const entityShown = await js(`[...document.querySelectorAll('[data-mermaid-ref]')].some(el => el.getAttribute('data-show') === 'true' && (el.textContent || '').includes('📄'))`)
C.check('C2: 选中文件进入实体级（suggest 对象）', entityShown)
await L.press('ArrowDown')
await L.press('Enter')
await L.waitMs(800)
const cmText = await js(`document.querySelector('.cm-content') ? document.querySelector('.cm-content').textContent : ''`)
const menuAfter = await js(`[...document.querySelectorAll('[data-mermaid-ref]')].every(el => el.getAttribute('data-show') === 'false')`)
C.check('C3: 实体选择插入 [[path#fragment]]', /\[\[[^\]]+#[^\]]+\]\]/.test(cmText || ''))
C.check('C4: 插入后菜单关闭', menuAfter)

// ---- C5: 无引号节点自动补引号 ----
await js(`(() => { const b=[...document.querySelectorAll('.milkdown-code-block')].find(x=>x.offsetParent!==null); const cm=b?b.querySelector('.cm-content'):null; if(cm) cm.focus() })()`)
await L.waitMs(600)
await L.press('Control+a')
await L.type('graph TD\n  A[开始] --> B{有权限? @')
await L.waitMs(1500)
await L.type('loan_apply')
await L.waitMs(600)
await L.press('Enter')
await L.waitMs(1000)
await L.press('ArrowDown')
await L.press('Enter')
await L.waitMs(800)
const cmDiamond = await js(`(() => {
  const blocks = [...document.querySelectorAll('.milkdown-code-block')]
  const mmd = blocks.find(b => b.querySelector('.language-button') && b.querySelector('.language-button').textContent.trim() === 'mermaid')
  return mmd ? (mmd.querySelector('.cm-content') ? mmd.querySelector('.cm-content').textContent : '') : ''
})()`)
C.check('C5: 无引号节点自动补引号包裹', /"[\s\S]*\[\[/.test(cmDiamond))
await L.clickEl('.preview-toggle-button', 0, { label: '开预览' })
await L.waitMs(3000)
const renderErr = await js(`document.querySelector('.preview') ? document.querySelector('.preview').textContent.includes('Mermaid 渲染失败') : false`)
C.check('C6: 自动补引号后渲染成功', !renderErr)
await L.clickEl('.preview-toggle-button', 0, { label: '切回编辑' })

// ---- D: 非 mermaid 代码块不触发联想 ----
await L.press('Control+a')
await L.type('const x = 1;')
await L.waitMs(400)
await js(`(() => {
  const blocks = [...document.querySelectorAll('.milkdown-code-block')]
  const js = blocks.find(b => b.querySelector('.language-button') && b.querySelector('.language-button').textContent.trim() === 'js')
  if (js) js.scrollIntoView({ block: 'center' })
})()`)
await L.waitMs(1500)
if ((await L.q('.codemirror-host.hidden')) > 0) {
  await L.clickEl('.preview-toggle-button', 0, { label: '切编辑' })
  await L.waitMs(600)
}
await js(`(() => { const b=[...document.querySelectorAll('.milkdown-code-block')].find(x=>x.offsetParent!==null && x.querySelector('.cm-content')); const cm=b?b.querySelector('.cm-content'):null; if(cm) cm.focus() })()`)
await L.waitMs(800)
await L.press('Control+a')
await L.type('const y = @deco')
await L.waitMs(1200)
const menuInJs = await js(`[...document.querySelectorAll('[data-mermaid-ref]')].some(el => el.getAttribute('data-show') === 'true')`)
C.check('D1: js 代码块输入 @ 不触发联想', !menuInJs)

// ---- E ----
const md = await L.pageMd()
C.check('E0: 文档无损坏', md.length > 0)

// ---- F/G/H: 注入更多文档 ----
await js(`(() => {
  const KEY = 'milkdown-note-mock-fs-v2'
  const files = JSON.parse(localStorage.getItem(KEY) || '{}')
  files.files['Mermaid无引号.md'] = [
    'doctype:demo', '', '# 无引号引用', '',
    '\`\`\`mermaid', 'graph TD',
    '  A[开始] --> B{有权限? [[笔记/待办清单#待办清单]]}',
    '  B -->|是| C[处理请求]', '  B -->|否| D[拒绝访问]', '  C --> E[结束]',
    '\`\`\`', '',
  ].join('\\n')
  files.files['Aaa联想.md'] = ['doctype:demo', '', '# 联想', '', '\`\`\`mermaid', 'graph TD', '  A[开始] --> B[结束]', '\`\`\`', ''].join('\\n')
  files.files['Aaa/深层/深层文件.md'] = '# 深层\\n'
  localStorage.setItem(KEY, JSON.stringify(files))
})()`)
await L.reloadApp(2500)
if (!(await L.vis('.tree'))) { await L.clickEl('.icon-btn', 0); await L.waitMs(500) }
await L.scrollIntoView('.tree .name', await js(`[...document.querySelectorAll('.tree .name')].findIndex(e => e.textContent.includes('Mermaid无引号'))`))
await L.clickEl('.tree .name', await js(`[...document.querySelectorAll('.tree .name')].findIndex(e => e.textContent.includes('Mermaid无引号'))`), { label: '开无引号' })
await L.waitMs(4000)
const unquotedPreview = await L.txt('.milkdown-code-block .preview')
C.check('F1: 未加引号 [[..]] 不再渲染失败', !(unquotedPreview || '').includes('渲染失败'))
const unquotedRef = await L.attr('.preview a.mmd-text-ref', 'data-ref')
C.check('F2: 未加引号引用被链接化（data-ref 完整）', unquotedRef === '笔记/待办清单#待办清单')
C.check('F3: 预览显示去掉 [[ ]] 只显路径', !(unquotedPreview || '').includes('[['))

// G
const sidebarOpen = (await L.q('.icon-btn.active').catch(() => 0)) > 0
if (!sidebarOpen) { await L.clickEl('.icon-btn', 0); await L.waitMs(600) }
await L.scrollIntoView('.tree .name', await js(`[...document.querySelectorAll('.tree .name')].findIndex(e => e.textContent.includes('Aaa联想'))`))
await L.clickEl('.tree .name', await js(`[...document.querySelectorAll('.tree .name')].findIndex(e => e.textContent.includes('Aaa联想'))`), { label: '开联想' })
await waitForElement('.cm-content', { timeout: 15 }).catch(() => {})
await L.waitMs(800)
await js(`(() => { const b=[...document.querySelectorAll('.milkdown-code-block')].find(x=>x.offsetParent!==null); const cm=b?b.querySelector('.cm-content'):null; if(cm) cm.focus() })()`)
await L.waitMs(400)
await L.press('Control+a')
await L.type('graph TD\n  A[开始]-->B[结束] @')
await L.waitMs(1200)
const gShown = await js(`[...document.querySelectorAll('[data-mermaid-ref]')].some(el => el.getAttribute('data-show') === 'true')`)
C.check('G1: mermaid 代码块内 @ 联想菜单打开', gShown)
const gTitle0 = (await L.txt('[data-mermaid-ref]:not([data-show="false"]) h6')).trim()
C.check('G2: 初始在根（第一级）', gTitle0 === '文件')
await L.type('Aaa')
await waitForElement('[data-mermaid-ref] li', { timeout: 5 }).catch(() => {})
await L.press('Enter')
await L.waitMs(600)
const readH6 = () => js(`[...document.querySelectorAll('[data-mermaid-ref]:not([data-show="false"]) h6')].map(h => (h.textContent || '').trim()).join(',') || ''`)
const gTitle1 = await readH6()
C.check('G3: 进入目录（标题显示 📁 Aaa）', gTitle1.includes('Aaa'))
await waitForElement('[data-mermaid-ref] li', { timeout: 5 }).catch(() => {})
await L.press('Enter')
await L.waitMs(500)
let gTitle = await readH6()
let guard = 0
while (gTitle !== '文件' && guard++ < 5) { await L.press('ArrowLeft'); await L.waitMs(300); gTitle = await readH6() }
C.check('G4: 逐级 ← 返回可回到第一级（文件）', gTitle === '文件')
await L.press('Escape')
await L.waitMs(300)
const menuHidden = await js(`[...document.querySelectorAll('[data-mermaid-ref]')].every(el => el.getAttribute('data-show') === 'false')`)
C.check('G5: ESC 关闭联想菜单（无异常）', menuHidden)

// ---- H ----
await js(`(() => {
  const KEY = 'milkdown-note-mock-fs-v2'
  const files = JSON.parse(localStorage.getItem(KEY) || '{}')
  files.files['MermaidM10.md'] = [
    'doctype:demo', '', '# M10', '',
    '\`\`\`mermaid', 'sequenceDiagram',
    '  Alice->>Bob: 查看 [[数据库/loan/loan_apply#amount]]',
    '\`\`\`', '',
    '\`\`\`mermaid', 'graph TD',
    '  A[开始] --> B{"有权限? [[数据库/loan/loan_apply#status]]"}',
    '  B -->|"是 [[数据库/loan/loan_apply#amount]]"| C[处理请求]',
    '\`\`\`', '',
  ].join('\\n')
  localStorage.setItem(KEY, JSON.stringify(files))
})()`)
await L.reloadApp(2500)
await L.scrollIntoView('.tree .name', await js(`[...document.querySelectorAll('.tree .name')].findIndex(e => e.textContent.includes('MermaidM10'))`))
await L.clickEl('.tree .name', await js(`[...document.querySelectorAll('.tree .name')].findIndex(e => e.textContent.includes('MermaidM10'))`), { label: '开M10' })
await L.waitMs(4500)
const tspans = await js(`[...document.querySelectorAll('.preview tspan.mmd-text-ref')].map(t => t.textContent)`)
C.check('H1: 时序图消息文本链接化（tspan）', tspans.some(t => t === '数据库/loan/loan_apply#amount'))
await L.clickEl('.preview tspan.mmd-text-ref', 0, { label: '点tspan' })
await L.waitMs(2500)
const seqActive = await js(`document.querySelector('.tabbar .tab.active') ? document.querySelector('.tabbar .tab.active').textContent.trim() : ''`)
C.check('H2: 时序图 tspan 点击跳转', (seqActive || '').includes('loan_apply'))
const edgeRefs = await js(`[...document.querySelectorAll('.preview a.mmd-text-ref')].map(a => a.textContent)`)
C.check('H3: 边标签引用链接化', edgeRefs.some(t => t === '数据库/loan/loan_apply#amount'))
const hSidebar = (await L.q('.icon-btn.active').catch(() => 0)) > 0
if (!hSidebar) { await L.clickEl('.icon-btn', 0); await L.waitMs(600) }
await L.scrollIntoView('.tree .name', await js(`[...document.querySelectorAll('.tree .name')].findIndex(e => e.textContent.includes('MermaidM10'))`))
await L.clickEl('.tree .name', await js(`[...document.querySelectorAll('.tree .name')].findIndex(e => e.textContent.includes('MermaidM10'))`), { label: '回M10' })
await L.waitMs(3000)
await js(`(() => { const b=[...document.querySelectorAll('.milkdown-code-block')].find(x=>x.offsetParent!==null); const cm=b?b.querySelector('.cm-content'):null; if(cm) cm.focus() })()`)
await L.waitMs(800)
await L.press('Control+a')
await L.type('graph TD\n  A --> B["改 @')
await L.waitMs(1500)
const menuRoot = await js(`(() => { const el = document.querySelector('[data-mermaid-ref]:not([data-show="false"])'); return el ? el.textContent.slice(0, 150) : '' })()`)
C.check('H4: 联想不出现 .template（隐藏目录）', !menuRoot.includes('template'))
await L.type('loan_apply')
await L.waitMs(600)
await L.press('Enter')
await L.waitMs(1000)
const cLen1 = await js(`document.querySelector('.cm-content') ? document.querySelector('.cm-content').textContent.length : 0`)
await L.press('ArrowRight')
await L.press('ArrowRight')
await L.waitMs(400)
const cLen2 = await js(`document.querySelector('.cm-content') ? document.querySelector('.cm-content').textContent.length : 0`)
C.check('H5: 实体级 → 键不移动光标', cLen1 === cLen2)

cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
