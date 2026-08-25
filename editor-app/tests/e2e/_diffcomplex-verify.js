// diff-complex 全场景验收（健壮版）：每场景独立 try/catch，js 超时不中断
const FILES = [
  '11-嵌入块内mermaid子图',
  '12-多层嵌入与环',
  '13-表格中的引用',
  '14-mermaid复杂语法',
  '15-模板与对象引用',
  '16-批注与评论',
  '17-综合场景',
  '源/流程图-风控路由',
  '源/层三-明细',
  '源/模板实例-还款计划',
]
const task = await L.acquireTaskSpace('diffcomplex-verify')
await L.openApp('http://localhost:5173/?backend=dev', 3500)
await L.clickEl('.icon-col .icon-btn:nth-child(2)', 0, { label: 'Git面板' })
await L.waitMs(1500)

const results = []
const safe = async (fn) => { try { return await fn() } catch (e) { return { __err: String(e && e.message || e).slice(0,60) } } }

for (const name of FILES) {
  await safe(async () => {
    await js(`(() => { const cs=[...document.querySelectorAll('.commit')]; const t=cs.find(c=>(c.innerText||'').includes('diff-complex B')); if(t&&!String(t.className).includes('expanded')) t.click(); return true })()`)
    await L.waitMs(500)
    await js(`(() => { for (const d of [...document.querySelectorAll('.git-panel .ct-node.dir')]) { const ar=d.querySelector('.arrow'); if(ar && !String(ar.className).includes('open')) d.click() } return true })()`)
    await L.waitMs(350)
    const ok = await js(`(() => { const all=[...document.querySelectorAll('.git-panel *')]; const leaf=all.filter(e=>e.children.length===0 && (e.textContent||'').includes(${JSON.stringify(name)})); if(leaf.length){ (leaf[0].closest('[class*="row"],[class*="file"],.ct-node')||leaf[0]).click(); return true } return false })()`)
    if (!ok) { results.push({ name, err: 'file-not-clicked' }); return }
  })
  await L.waitMs(11000)
  // 展开批注抽屉（幂等）
  await safe(async () => {
    await js(`(() => { const d=document.querySelector('.annotation-drawer'); if(!d) return false; if(d.classList.contains('open')) return true; const b=document.querySelector('.ad-toggle.expand'); if(b) b.click(); return true })()`)
    await L.waitMs(700)
  })
  const r = await safe(async () => await js(`(() => {
    const host=document.querySelector('.render-host')
    const drawer=document.querySelector('.annotation-drawer')
    const cards=drawer? [...drawer.querySelectorAll('.ad-card')] : []
    const mf=host?host.querySelectorAll('.diff-mermaid-fence'):[]
    return {
      cards: cards.map(c=>(c.innerText||'').replace(/\\s+/g,' ').trim().slice(0,44)),
      fence: mf.length,
      svgAdd: host?host.querySelectorAll('.diff-mermaid-fence svg .diffAdd').length : -1,
      svgDel: host?host.querySelectorAll('.diff-mermaid-fence svg .diffDel').length : -1,
      difIns: host?host.querySelectorAll('.diff-ins').length : -1,
      difDel: host?host.querySelectorAll('.diff-del').length : -1,
      diffBadge: host?host.querySelectorAll('.ref-embed-diff-badge').length : -1,
    }
  })()`))
  results.push({ name, ...r })
  cliLog('CASE ' + name + ' => cards[' + (r && (r.cards||[]).length) + '] svgAdd=' + (r&&r.svgAdd) + ' svgDel=' + (r&&r.svgDel) + ' difIns=' + (r&&r.difIns) + ' difDel=' + (r&&r.difDel) + ' fb=' + (r&&r.diffBadge))
  if (r && r.cards && r.cards.length) cliLog('    CARDS: ' + JSON.stringify(r.cards))
}
cliLog('ALL-DONE')
