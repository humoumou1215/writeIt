// 环折叠单独验证
const C = L.newChecker()
const task = await L.acquireTaskSpace('_cycchk')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')
const allBlocks = () => js(
  `[...document.querySelectorAll('.editor-pane:not([style*="display: none"]) .ref-file-block')].map(e => ({
     txt: (e.querySelector('.ref-file-block-content')?.textContent || ''),
     ro: e.classList.contains('readonly'),
     col: e.classList.contains('is-collapsed'),
     chain: e.getAttribute('data-chain') || null
   }))`
)
await L.clickText('.tree .name', 'cycA.md', { label: 'open cycA' })
await L.waitMs(6000)
const cyc = await allBlocks()
cliLog('_CYCC ' + JSON.stringify(cyc.slice(0, 4)))
C.check('环折叠卡出现', cyc.some((x) => x.col))
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail === 0 ? 0 : 1)
