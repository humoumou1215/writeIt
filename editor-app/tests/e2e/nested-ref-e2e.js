// nested-ref-e2e —— 多层块嵌入回归（![[A]] 嵌 ![[B]] 嵌 ![[C]] ...）
// 覆盖：
//  ① 打开 A：递归物化显示 B、C（多层展开）；保存不得把未物化/被嵌入空块写空
//  ② 在已打开的 A 中 菜单插入 ![[B]]（B 内嵌 C）→ 立即同时看到 B 和 C（插入即递归物化）
//  ③ 10 层嵌套（MAX_DEPTH=10）全层物化、最深层内容可见、保存不写空最深层
//  ④-⑨ 多层嵌入治理（docs/embed-nesting-governance.md）：
//  ④ 环 A嵌B嵌A → 内层折叠提示卡（不渲染循环内容）+ 折叠态不落 md
//  ⑤ 自嵌 A 嵌 A → 折叠 ⑥ 11 层链：第 10 层渲染、第 11 层折叠（深度=嵌入链深，与结构解耦）
//  ⑦ 兄弟重复 A 嵌 B ×2 → 两处正常渲染（不是环） ⑧ 环解除后重开 → 重新判定
//  ⑨ 结构深度干扰：12 层嵌套列表后再嵌 C（链深 2）→ 正常渲染（N3 回归）
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
  // 治理用例（embed-nesting-governance 验证）：环 A嵌B嵌A / 自嵌 / 11 层（第 11 层折叠）/ 兄弟重复 / 环解除 / 结构深度干扰
  data.files['环/A.md'] = '# A 环宿主\\n\\n![[环/B]]\\n'
  data.files['环/B.md'] = '# B\\n\\nB 的正文——环用例\\n\\n![[环/A]]\\n'
  data.files['自嵌/S.md'] = '# S 自嵌\\n\\n![[自嵌/S]]\\n'
  data.files['环2/A.md'] = '# A 环2\\n\\n![[环2/B]]\\n'
  data.files['环2/B.md'] = '# B\\n\\nB 文本（环2 初始）\\n\\n![[环2/A]]\\n'
  for (let i = 1; i <= 12; i++) {
    data.files['深2/层' + i + '.md'] = i === 11
      ? '# 层11\\n\\nL11 底部内容（第 10 层，可渲染）\\n\\n![[深2/层12]]\\n'
      : (i === 12
        ? '# 层12\\n\\nL12 底层内容（第 11 层，折叠）\\n'
        : '# 层' + i + '\\n\\n![[深2/层' + (i + 1) + ']]\\n')
  }
  data.files['兄弟/H.md'] = '# H\\n\\n![[兄弟/B]]\\n\\n![[兄弟/B]]\\n'
  data.files['兄弟/B.md'] = '# B\\n\\nB 双份正文——兄弟重复\\n'
  data.files['结构/H.md'] = '# H 结构宿主\\n\\n![[结构/B]]\\n'
  let pad = ''
  const list = []
  for (let i = 1; i <= 12; i++) { list.push(pad + '- l' + i); pad += '  ' }
  data.files['结构/B.md'] = '# B\\n\\n' + list.join('\\n') + '\\n\\n![[结构/C]]\\n'
  data.files['结构/C.md'] = '# C\\n\\nC 结构干扰内容——必须渲染\\n'
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

// 截图 best-effort（ego-browser CDP 截图服务在重负载下偶发超时；不阻塞检查结论）
try {
  await L.shotTo('15-多层嵌入回归.png')
} catch (e) {
  cliLog('[shot] 跳过截图（CDP 超时）:', e?.message ?? e)
}

// ===== ④ 循环 A 嵌 B 嵌 A → 折叠提示卡（提示，不渲染循环内容） =====
await js(`window.__editorOpenPath('环/A.md')`)
await L.waitMs(3500)
const foldCnt = () => js(`(() => {
  const p = [...document.querySelectorAll('.editor-pane')].find(e => e.getClientRects().length > 0)
  return p ? p.querySelectorAll('.ref-file-block[data-collapsed]').length : 0
})()`)
C.check('A嵌B嵌A：B 卡 + 内层 A 折叠卡（共 2 卡，折叠卡 1 张）', (await activeBlocks()).length === 2 && (await foldCnt()) === 1)
C.check('折叠链路含父环（data-chain = A›B›A）', (await js(`(() => {
  const p = [...document.querySelectorAll('.editor-pane')].find(e => e.getClientRects().length > 0)
  return p?.querySelector('.ref-file-block[data-collapsed]')?.getAttribute('data-chain') || ''
})()`)).includes('环/B.md'))
C.check('折叠卡文案含「已在上级层级出现」', (await js(`(() => {
  const p = [...document.querySelectorAll('.editor-pane')].find(e => e.getClientRects().length > 0)
  return p?.querySelector('.ref-file-block[data-collapsed]')?.textContent || ''
})()`)).includes('已在上级层级出现'))
C.check('B 正文渲染一份（不重复展开）', (await activeBlocks()).filter((t) => t.includes('B 的正文——环用例')).length === 1)
const md4 = await L.pageMd()
C.check('折叠态不落 md（round-trip 无损）', !md4.includes('循环引用') && !md4.includes('已折叠') && !md4.includes('data-collapsed'))

// ===== ⑤ 自嵌 A 嵌 A =====
await js(`window.__editorOpenPath('自嵌/S.md')`)
await L.waitMs(3000)
C.check('自嵌：内层 S 折叠为提示卡', (await activeBlocks()).filter((t) => t.includes('循环引用')).length === 1)

// ===== ⑥ 11 层链：第 10 层渲染，第 11 层折叠 =====
await js(`window.__editorOpenPath('深2/层1.md')`)
await L.waitMs(6500)
C.check('11 层链：层2..层12 共 11 张卡（含折叠卡）', (await activePaths()).length === 11)
C.check('第 10 层（层11）内容渲染可见', (await activeBlocks()).some((t) => t.includes('L11 底部内容')))
C.check('第 11 层（层12）折叠为 ⤓ 提示卡', (await foldCnt()) === 1 && (await js(`(() => {
  const p = [...document.querySelectorAll('.editor-pane')].find(e => e.getClientRects().length > 0)
  return p?.querySelector('.ref-file-block[data-collapsed]')?.textContent || ''
})()`)).includes('嵌套层级超过 10 层，已折叠'))
C.check('折叠层内容不渲染（L12 文本不可见）', !(await activeBlocks()).some((t) => t.includes('L12 底层内容')))

// ===== ⑦ 兄弟重复（A 嵌 B ×2）：不是环，两处都渲染 =====
await js(`window.__editorOpenPath('兄弟/H.md')`)
await L.waitMs(3000)
const blocks7 = await activeBlocks()
C.check('兄弟重复：两处 B 均正常渲染', blocks7.filter((t) => t.includes('B 双份正文')).length === 2)
C.check('兄弟重复：无折叠卡', !blocks7.some((t) => t.includes('循环引用') || t.includes('已折叠')))

// ===== ⑧ 环解除后重开：重新判定、无折叠残留 =====
await js(`window.__editorOpenPath('环2/A.md')`)
await L.waitMs(3000)
C.check('环2 初始：折叠卡存在', (await foldCnt()) >= 1)
await js(`(() => {
  const data = JSON.parse(localStorage.getItem('${KEY}') || '{}')
  data.files['环2/B.md'] = '# B\\n\\nB 文本（环已解除）\\n'
  localStorage.setItem('${KEY}', JSON.stringify(data))
  return true
})()`)
await L.reloadApp()
await L.waitMs(1500)
await js(`window.__editorOpenPath('环2/A.md')`)
await L.waitMs(3500)
C.check('环解除后重开：无折叠卡', !(await activeBlocks()).some((t) => t.includes('循环引用')))
C.check('环解除后 B 正常物化', (await activeBlocks()).some((t) => t.includes('B 文本（环已解除）')))

// ===== ⑨ 结构深度干扰（N3 回归）：12 层列表后再嵌 C，链深 2 → 正常渲染 =====
await js(`window.__editorOpenPath('结构/H.md')`)
await L.waitMs(3500)
C.check('结构深度不计入：深层列表后嵌 C 仍渲染', (await activeBlocks()).some((t) => t.includes('C 结构干扰内容')))
C.check('结构用例无折叠卡', !(await activeBlocks()).some((t) => t.includes('已折叠')))

const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)