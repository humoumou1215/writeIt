// embed-sync-realinput —— 用户 4 问题最终验证（修复后）
//   1输入不重复  2光标在块内可见  3保存后块内容不消失/一致  4块编辑回流源(源已保存时)
const C = L.newChecker()
const task = await L.acquireTaskSpace('embed-sync-realinput')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')
const AP = '.editor-pane:not([style*="display: none"])'
const MK = 'milkdown-note-mock-fs-v2'
const blockTexts = () => js(
  `[...document.querySelectorAll('${AP} .ref-file-block:not(.readonly) .ref-file-block-content')].map(e => e.textContent || '')`
)
const selDetail = () => js(`(() => {
  const s = window.getSelection()
  if (!s || s.rangeCount === 0) return 'no-sel'
  const r = s.getRangeAt(0)
  const blocks = [...document.querySelectorAll('${AP} .ref-file-block-content')]
  const idx = blocks.findIndex(b => b.contains(r.startContainer))
  return 'block:' + idx + (s.isCollapsed ? '/col' : '/range')
})()`)
const toastTexts = () => js(`[...document.querySelectorAll('.toast')].map(t => t.textContent || '')`)
await js(`(() => {
  const fs = JSON.parse(localStorage.getItem(${L.J(MK)}) || '{}')
  fs.files['probe.md'] = ['# 探针','','开场段落第一行','','![[数据库字段引用]]','','![[数据库字段引用]]','','结尾段落末行'].join('\\n')
  localStorage.setItem(${L.J(MK)}, JSON.stringify(fs))
})()`)
await L.reloadApp(2500)
await L.clickText('.tree .name', 'probe.md', { label: '打开 probe' })
await L.waitMs(6000)

// ---- 问题2：点击块1 → 光标在块内 ----
await L.clickEl(`${AP} .ref-file-block:not(.readonly) .ref-file-block-content`, 0, { label: '点块1' })
await L.waitMs(400)
const si0 = await selDetail()
cliLog('[Q2] 点击后光标: ' + si0)
C.check('Q2 光标在块内', si0.startsWith('block:0'))

// ---- 问题1：输入 1 次 → 恰好 +1 ----
const len0 = (await blockTexts()).map(x => x.length)
await L.type('1')
await L.waitMs(400)
const len1 = (await blockTexts()).map(x => x.length)
cliLog('[Q1] 块长: ' + JSON.stringify(len0) + ' → ' + JSON.stringify(len1))
C.check('Q1 按1次只进1个字符（块1 +1）', len1[0] === len0[0] + 1)
// M3a：块2 与块1 同一源模型投影 → 块1 输入后块2 实时同步（长度与块1 一致，不超增）
C.check('Q1 块2 与块1 同步一致（不超增）', len1[1] === len1[0])
C.check('Q2 输入后光标仍在块内', String(await selDetail()).startsWith('block:0'))

// ---- 问题3：保存后块内容不消失、两块收敛一致 ----
await L.press('Control+s')
await L.waitMs(1500) // 保存 + 广播收敛
const blS = await blockTexts()
cliLog('[Q3] 保存后块长: ' + JSON.stringify(blS.map(x => x.length)))
C.check('Q3 保存后块内容不消失', blS.length === 2 && (blS[0].length) >= len0[0] + 1)
C.check('Q3 保存后两块一致（收敛）', blS[0] === blS[1])
const mdS = await L.pageMd()
C.check('Q3 保存后 md 保留宿主正文', mdS.includes('结尾段落末行') && mdS.includes('开场段落第一行'))

// ---- 问题4：源tab 编辑并保存后 → 块编辑回流源 ----
// 用 __editorOpenPath 打开源（tree 虚拟滚动下 clickText 对不可见文件不可靠，属 e2e 基建问题）
await js(`window.__editorOpenPath ? window.__editorOpenPath('数据库字段引用.md') : null`)
await L.waitMs(2400)
await L.focusEditor(); await L.goEnd(); await L.waitMs(300)
await L.type('源标Q7')
await L.waitMs(1200)
await L.press('Control+s') // 保存源 → 清 lastExternalSyncAt
await L.waitMs(1500)
await L.clickText('.tab', 'probe', { label: '切probe' })
await L.waitMs(2000)
cliLog('[Q4] 源编辑同步到块: ' + (await blockTexts())[0]?.includes('源标Q7'))
C.check('P3 源→块同步', (await blockTexts())[0]?.includes('源标Q7'))
await L.clickEl(`${AP} .ref-file-block:not(.readonly) .ref-file-block-content`, 1, { label: '点块2' })
await L.waitMs(400)
await L.type('Z8')
await L.waitMs(2500)
await L.clickText('.tab', '数据库字段引用', { label: '切源(2)' })
await L.waitMs(1500)
const srcMd = await L.pageMd()
cliLog('[Q4] 块编辑后源md含Z8: ' + srcMd.includes('Z8'))
C.check('Q4 块编辑回流源tab（源已保存）', srcMd.includes('Z8'))
const errs = await L.errors()
cliLog('\n== 错误 =='); cliLog(errs.length ? errs.join('\n') : '(无)')
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)
