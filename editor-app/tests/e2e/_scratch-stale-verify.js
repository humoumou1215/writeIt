// 临时验证：M5 失步徽标链路（spec §6.1）——人工置失步 → 徽标渲染 → 点击对齐 → 清除
// 运行：node tests/e2e/_run-one.js _scratch-stale-verify
// （__docstoreMarkStale 为 debug 钩子；真实失步极罕见——对齐兜底几乎总成功）
const C = L.newChecker()

const task = await L.acquireTaskSpace('scratch-stale-verify')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const AP = '.editor-pane:not([style*="display: none"])'
const blockTexts = () => js(
  `[...document.querySelectorAll('${AP} .ref-file-block:not(.readonly) .ref-file-block-content')].map(e => e.textContent || '')`
)

const SRC_PATH = '数据库字段引用.md'
const PROBE_PATH = 'probe.md'
const probeSeed = '# 探针\n\n![[数据库字段引用]]\n\n![[数据库字段引用]]'
await js(`(() => {
  const KEY = 'milkdown-note-mock-fs-v2'
  const fs = JSON.parse(localStorage.getItem(KEY) || '{}')
  fs.files[${L.J(PROBE_PATH)}] = ${JSON.stringify(probeSeed)}
  localStorage.setItem(KEY, JSON.stringify(fs))
})()`)
await L.reloadApp(2500)

await L.clickText('.tree .name', '数据库字段引用.md', { label: '打开源文件' })
await L.waitMs(2500)
await L.clickText('.tree .name', 'probe.md', { label: '打开 probe' })
await L.waitMs(6000)
C.check('probe 双块物化', (await blockTexts()).length === 2)

// 1. 从 inspect 找模型与宿主订阅（kind=block 的 tabId/blockId）
const sub = await js(`(() => {
  const snap = window.__docstoreInspect()
  const m = snap.models.find((x) => x.realPath === ${L.J(SRC_PATH)})
  if (!m) return null
  const b = m.subscribers.find((s) => s.kind === 'block')
  return b ? { tabId: b.tabId, blockId: b.blockId } : null
})()`)
C.check('docstore 有源模型 + block 订阅', !!sub && !!sub.blockId)
if (!sub || !sub.blockId) {
  console.log(C.summary())
  await L.completeTaskSpace(task.id, { keep: false }).catch(() => {})
  process.exit(0)
}

// 2. 人为置失步 → 触发空事务 → 徽标渲染
await js(`window.__docstoreMarkStale(${L.J(SRC_PATH)}, ${L.J(sub.tabId)}, ${L.J(sub.blockId)})`)
await L.press('ArrowRight', {})  // 触发 selection 事务 → decoration apply
await L.waitMs(600)
const badge = await js(`(() => {
  const el = document.querySelector('.ref-stale-badge')
  return el ? { text: el.textContent, path: el.getAttribute('data-path'), blockId: el.getAttribute('data-block-id') } : null
})()`)
C.check('失步徽标渲染（⚠ 失步 + 源路径）', !!badge && badge.text.includes('失步') && badge.path === SRC_PATH)
C.check('徽标指向正确块', !!badge && badge.blockId === sub.blockId)

// 3. 点击徽标 → 对齐到最新（模型内容整块 fill）→ 徽标消失 + 订阅不 stale
const after = await js(`(() => {
  try {
    const el = document.querySelector('.ref-stale-badge')
    if (!el) return 'no-badge'
    el.click()
    return 'clicked'
  } catch (e) { return 'err:' + String(e) }
})()`)
C.check('徽标可点击', after === 'clicked')
await L.waitMs(800)
const still = await js(`document.querySelector('.ref-stale-badge') !== null`)
C.check('对齐后徽标消失', !still)
const staleNow = await js(`window.__docstoreInspect().models.find((x) => x.realPath === ${L.J(SRC_PATH)})?.subscribers.filter((s) => s.kind === 'block' && s.stale).length ?? -1`)
C.check('对齐后订阅不 stale', staleNow === 0)

await L.shot('/tmp/stale-verify-final.png')
console.log(C.summary())
await completeTaskSpace(task.id, { keep: false }).catch(() => {})
process.exit(0)