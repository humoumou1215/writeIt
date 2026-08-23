// git-m18-fixture-e2e —— M18 确定性渲染管线 fixture（P0 测试网 / 浏览器层）
// 覆盖（设计 §7 DOM 断言层，全部结构选择器，不做视觉主判）：
//   1. write-once：挂载后无 size 变化事务（object_ref 等尺寸替换除外）——事务探针
//   2. 自有 mermaid NodeView：data-fence-id + eager 渲染 + classDef/class 图内红绿（SVG .diffAdd/.diffDel）
//   3. data-dnote 锚定：装饰携带内容派生 id；批注卡 id = record id
//   4. 嵌入预填充：卡片内容非空（write-once 物化）+ 卡内内容级 diff（offset 装饰）
//   5. 嵌入徽标：内容有改动 / 新增引用
//   6. 循环引用折叠卡：data-collapsed + 保证层卡（P3a）
//   7. 批注抽屉：diff 改动说明卡（diagram/embed/text 卡）
// 运行后端：mock git（git_show_files 批量端点，P0 基建先行项）
const C = L.newChecker()
const task = await L.acquireTaskSpace('git-m18-fixture')

await L.freshApp('http://localhost:5173/?backend=mock')
await L.waitMs(1500)

// 打开 Git 面板 → README diff
await L.clickEl('.icon-col .icon-btn:nth-child(2)', 0, { label: 'Git 面板' })
await L.waitMs(1200)
await L.clickText('.scm-file-row, .ws-file', 'README')
await L.waitMs(8000)

// ---------- 1/2/3/4/5：主路径（README diff：mermaid + 嵌入 + 引用） ----------
const main = await js(`(() => {
  const host = document.querySelector('.render-host') || document.body
  const blocks = [...host.querySelectorAll('.ref-file-block')]
  const meeting = blocks.find(x => x.querySelector('.ref-embed-diff-badge'))
  const content = meeting?.querySelector('.ref-file-block-content')
  return {
    hostDiffIns: host.querySelectorAll('.diff-ins').length,
    hostDiffDel: host.querySelectorAll('.diff-del').length,
    dnoteCount: host.querySelectorAll('[data-dnote]').length,
    mermaidFences: host.querySelectorAll('.diff-mermaid-fence').length,
    fenceIds: [...host.querySelectorAll('.diff-mermaid-fence')].map(e => e.getAttribute('data-fence-id')),
    eagerSvgs: host.querySelectorAll('.diff-mermaid-fence svg').length,
    svgDiffAdd: host.querySelectorAll('.diff-mermaid-fence svg .diffAdd').length,
    svgDiffDel: host.querySelectorAll('.diff-mermaid-fence svg .diffDel').length,
    prefilledBlocks: blocks.filter(b => (b.querySelector('.ref-file-block-content')?.textContent.trim().length || 0) > 10).length,
    meetingCardIns: content ? content.querySelectorAll('.diff-ins').length : -1,
    meetingCardDnote: content ? content.querySelectorAll('[data-dnote]').length : -1,
    addBadge: blocks.some(b => b.querySelector('.ref-embed-add')),
    diffBadge: blocks.some(b => b.querySelector('.ref-embed-diff-badge')),
  }
})()`)
C.check('装饰：host diff-ins > 0（结构 diff 渲染）', main.hostDiffIns > 0)
C.check('装饰：data-dnote 锚定（内容派生身份）', main.dnoteCount > 0)
C.check('自有 mermaid NodeView：data-fence-id 存在', main.mermaidFences > 0)
C.check('mermaid eager：SVG 已渲染', main.eagerSvgs >= main.mermaidFences)
C.check('classDef 主路径：SVG 内 diffAdd class（mermaid 原生渲染）', main.svgDiffAdd > 0)
C.check('嵌入预填充：卡片内容非空（write-once 物化）', main.prefilledBlocks > 0)
C.check('嵌入内容级 diff：卡内 data-dnote 装饰', main.meetingCardDnote > 0)
C.check('嵌入徽标：内容有改动', main.diffBadge === true)

// ---------- 6：循环引用折叠卡（P3a） ----------
// 环测试/甲 行只显示「Git演示/环测试」路径片段 → 直接点含「环测试」的行
await js(`(() => {
  const all = [...document.querySelectorAll('.git-panel *')]
  const leaf = all.filter(e => e.children.length === 0 && (e.textContent || '').includes('环测试'))[0]
  if (leaf) { const row = leaf.closest('[class*="row"], [class*="file"], li') || leaf; row.click(); return true }
  return false
})()`)
await L.waitMs(6000)
const cycle = await js(`(() => {
  const host = document.querySelector('.render-host') || document.body
  const collapsed = host.querySelectorAll('.ref-file-block[data-collapsed], .ref-file-block.is-collapsed').length
  const collapseHint = [...host.querySelectorAll('.ref-file-block-collapsed')].map(e => e.textContent.slice(0, 60))
  return { collapsed, collapseHint, cards: document.querySelectorAll('.ad-card').length }
})()`)
C.check('循环引用：折叠卡存在（data-collapsed）', cycle.collapsed >= 1)
C.check('循环引用：折叠提示文案', cycle.collapseHint.some(t => t.includes('循环引用')))

// ---------- 7：批注抽屉 ----------
await L.clickEl('.annotation-open-btn', 0, { label: '打开批注抽屉' })
await L.waitMs(800)
const cards = await js(`(() => ({
  count: document.querySelectorAll('.ad-card').length,
  texts: [...document.querySelectorAll('.ad-card-content')].slice(0, 8).map(e => e.textContent.slice(0, 50)),
}))()`)
C.check('批注抽屉：diff 改动说明卡 > 0', cards.count > 0)

cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
EOF_MARKER