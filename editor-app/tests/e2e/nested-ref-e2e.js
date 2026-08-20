// nested-ref-e2e —— 多层块嵌入回归（![[A]] 嵌 ![[B]] 嵌 ![[C]] ...）
// 覆盖：
//  ① 打开 A：递归物化显示 B、C（多层展开）；保存不得把未物化/被嵌入空块写空
//  ② 在已打开的 A 中 菜单插入 ![[B]]（B 内嵌 C）→ 立即同时看到 B 和 C（插入即递归物化）
//  ③ 10 层嵌套（MAX_DEPTH=10）全层物化、最深层内容可见、保存不写空最深层
// 运行：node tests/e2e/_run-one.js nested-ref-e2e

const task = await L.acquireTaskSpace('nested-ref-e2e')
await L.installErrors()
await L.openApp('http://localhost:5173/?backend=mock', 2000)

const C = L.newChecker()
const KEY = 'milkdown-note-mock-fs-v2'

// 可见面板内的卡片文本/路径（多标签下 .ref-file-block 会跨面板统计）
const activeBlocks = () => js(`(() => {
  const p = [...document.querySelectorAll('.editor-pane')].find(e => e.getClientRects().length > 0)
  return p ? [...p.querySelectorAll('.ref-file-block')].map(x => x.textContent) : []
})()`)
const activePaths = () => js(`(() => {
  const p = [...document.querySelectorAll('.editor-pane')].find(e => e.getClientRects().length > 0)
  return p ? [...p.querySelectorAll('.ref-file-block-path')].map(x => x.textContent) : []
})()`)
const mockFile = (path) => js(`(() => {
  const d = JSON.parse(localStorage.getItem('${KEY}') || '{}')
  return (d.files && d.files[${JSON.stringify(path)}]) || ''
})()`)

// ---- 注入嵌套文件：3 层（嵌套/A 嵌 B 嵌 C）+ 插入（插入/A 空宿主）+ 10 层（深/层1..层10）----
const seedNested = `(() => {
  const data = JSON.parse(localStorage.getItem('${KEY}') || '{}')
  data.files = data.files || {}
  data.files['嵌套/A.md'] = '# A 顶层\\n\\n![[嵌套/B]]\\n'
  data.files['嵌套/B.md'] = '# B 中层\\n\\nB 的正文\\n\\n![[嵌套/C]]\\n'
  data.files['嵌套/C.md'] = '# C 底层\\n\\nC 的内容 —— 不能被写空\\n'
  data.files['插入/A.md'] = '# A 插入宿主\\n\\nA 的正文\\n'
  for (let i = 1; i <= 10; i++) {
    data.files['深/层' + i + '.md'] = i === 10
      ? '# 层10\\n\\nL10 底部内容（最深层）\\n'
      : '# 层' + i + '\\n\\n![[深/层' + (i + 1) + ']]\\n'
  }
  data.seeded = true
  data.seededVersion = data.seededVersion || 0
  localStorage.setItem('${KEY}', JSON.stringify(data))
  return true
})()`
await js(seedNested)
await L.reloadApp()

// ===== ① 3 层：打开 A → B、C 都物化 + 保存不写空 =====
await js(`window.__editorOpenPath('嵌套/A.md')`)
await L.waitMs(3000)
C.check('A 中物化出 2 张嵌入卡（B + C）', (await activeBlocks()).length === 2)
const bTxt = (await activeBlocks())
C.check('B 正文可见', bTxt.some((t) => t.includes('B 的正文')))
C.check('C 内容物化可见（多层展开）', bTxt.some((t) => t.includes('C 的内容 —— 不能被写空')))
const md1 = await L.pageMd()
C.check('A 顶层序列化只含 ![[嵌套/B]]', md1.includes('![[嵌套/B]]') && !md1.includes('C 的内容'))
await L.press('Control+s')
await L.waitMs(1500)
C.check('保存 A 后 B 文件未被写空', (await mockFile('嵌套/B.md')).includes('B 的正文'))
C.check('保存 A 后 C 文件未被写空', (await mockFile('嵌套/C.md')).includes('C 的内容 —— 不能被写空'))

// ===== ② 插入递归：在已打开 A 中菜单插入 ![[嵌套/B]] → 立即看到 B 和 C =====
await js(`window.__editorOpenPath('插入/A.md')`)
await L.waitMs(2500)
await L.focusEditor(); await L.goEnd(); await L.waitMs(400); await L.press('Enter'); await L.waitMs(300)
await L.type('![[嵌套/B')
await L.waitMs(1200)
await L.press('Enter')
await L.waitMs(2500)
const insBlocks = await activeBlocks()
C.check('插入 B 后立即物化出 2 卡（B + 内嵌 C）', insBlocks.length === 2)
C.check('插入的 B 卡含 B 正文', insBlocks.some((t) => t.includes('B 的正文')))
C.check('插入 B 后内嵌 C 内容立即可见（无需关重开）', insBlocks.some((t) => t.includes('C 的内容 —— 不能被写空')))
// 序列化：插入 A 的 md 应含新嵌入标记
const mdIns = await L.pageMd()
C.check('插入后宿主序列化含 ![[嵌套/B]]', mdIns.includes('![[嵌套/B]]'))

// ===== ③ 10 层嵌套全物化 + 保存不写空最深层 =====
await js(`window.__editorOpenPath('深/层1.md')`)
await L.waitMs(5000)
C.check('10 层打开后可见嵌套卡 9 张（层2..层10）', (await activePaths()).length === 9)
const paths10 = await activePaths()
C.check('卡片路径覆盖层2..层10', paths10.length === 9 && paths10.every((p, i) => p === '深/层' + (i + 2)))
C.check('最深层 L10 内容物化可见', (await activeBlocks()).some((t) => t.includes('L10 底部内容')))
const md10 = await L.pageMd()
C.check('10 层顶层只含 ![[深/层2]] 标记', md10.includes('![[深/层2]]'))
await L.press('Control+s')
await L.waitMs(1500)
C.check('保存后最深层 深/层10 未被写空', (await mockFile('深/层10.md')).includes('L10 底部内容'))
C.check('保存后层9 保留 ![[深/层10]]', (await mockFile('深/层9.md')).includes('![[深/层10]]'))

await L.shotTo('15-多层嵌入回归.png')

const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)