// embed-sync-alwaysalign-e2e —— 嵌入同步 V2 回归：docstore 全量同步 + 源脏标记
//   回归目标（2026-08-30 现场双 bug）：
//     A. 嵌入块内编辑后打开源文件【不亮脏灯】→ 修复：写回路径同步 markUserDirty(源路径)
//     B. 第二个嵌入块内容与模型/兄弟块【不一致】（订阅停旧 rev、stale=false 假同步）
//        → 修复：分发统一 canonical 全量对齐（不再 steps 增量映射，docstore 模型=唯一事实源）
//   验证点：
//     A1 块内真实输入 → 源文件标签打开亮脏灯（.dot.dirty）
//     A2 保存后脏灯熄灭 + 磁盘落盘
//     B1 块内多段输入（模拟现场「新增1行/内容不一致了？」）→ 双嵌入块严格一致
//     B2 docstore 订阅基线：两个 block 订阅 rev == 模型 rev 且 stale=false（杜绝 rev 分裂）
//     B3 块视图 = 独立窗口（三窗口共用同一运行态文档层）
//     B4 反向：源窗口编辑 → 双嵌入块跟到最新（全量同步双向生效）
//     C  保存 + reload 后从磁盘重物化，双块仍一致
// （ego-lite，禁 playwright）运行：node tests/e2e/_run-one.js embed-sync-alwaysalign-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('embed-sync-alwaysalign-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const AP = '.editor-pane:not([style*="display: none"])'
const ED = `${AP} .ref-file-block:not(.readonly):not(.is-collapsed) .ref-file-block-content`
const blockTexts = () => js(`[...document.querySelectorAll('${ED}')].map(e => e.textContent || '')`)
const diskOf = (p) => js(
  `(JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}').files[${L.J(p)}] ?? null)`
)
const setDisk = (p, v) => js(`(() => {
  const K='milkdown-note-mock-fs-v2'; const fs=JSON.parse(localStorage.getItem(K)||'{}');
  fs.files[${L.J(p)}]=${L.J(v)}; localStorage.setItem(K, JSON.stringify(fs)); return true
})()`)
const openTab = async (name, waitms = 600) => { await L.treeClick(name, waitms) }
const tabClick = async (label, waitms = 900) => { await L.clickText('.tab', label); await L.waitMs(waitms) }
const tabDirty = (label) => js(`(() => {
  const t = [...document.querySelectorAll('.tab')].find(e => (e.textContent||'').includes(${L.J(label)}))
  return t ? !!t.querySelector('.dot.dirty') : null
})()`)
const untilTrue = async (pred, timeout = 9000, step = 200) => {
  const t0 = Date.now(); let ok = false
  while (Date.now() - t0 < timeout) { if (await pred()) { ok = true; break } await L.waitMs(step) }
  return ok
}
// docstore 订阅基线：返回 { modelRev, userDirty, blocks:[{rev,stale}] }
const storeSubOf = (real) => js(`(() => {
  const s = window.__docstoreInspect ? window.__docstoreInspect() : null
  if (!s) return null
  const m = (s.models || []).find(x => x.realPath === ${L.J(real)})
  if (!m) return null
  return {
    modelRev: m.rev,
    userDirty: m.dirty,
    revDirty: m.revDirty,
    blocks: (m.subscribers || [])
      .filter(x => x.kind === 'block')
      .map(x => ({ rev: x.rev, stale: x.stale }))
  }
})()`)

// ============ 种子 ============
const SRC = 'asrc.md'
const HOST = 'ahost.md'
await setDisk(SRC, '# 源\n\n基行1\n\n基行2')
await setDisk(HOST, '# 宿主\n\n![[asrc]]\n\n![[asrc]]')
await L.reloadApp(2500)

// ============ 场景 A：块内输入 → 源文件脏灯（bug1 修复验证） ============
await openTab(HOST, 5500)
C.check('A0 宿主双块物化', (await blockTexts()).length === 2)
// 真键盘输入进块1（走拦截器 → commitBlockSteps 写回源模型）
await L.clickEl(`${ED}`, 0)
await L.waitMs(400)
await L.type('脏灯x')
const convA = await untilTrue(async () => {
  const t = await blockTexts(); return t.length === 2 && t[0] === t[1] && t[0].includes('脏灯x')
}, 9000)
C.check('A1 双块全量同步收敛（含输入）', convA)
const dsA = await storeSubOf(SRC)
C.check('A2 源模型已标 userDirty（写回同步脏标记）', !!dsA && dsA.userDirty === true && dsA.revDirty === true)
C.check('A3 双块订阅基线追平模型 rev（无 rev 分裂）', !!dsA && dsA.blocks.length === 2
  && dsA.blocks.every((b) => b.rev === dsA.modelRev && b.stale === false))
// 打开源文件标签 → 脏灯应亮（bug1：此前不亮）
await openTab(SRC, 1600)
C.check('A4 源文件标签打开亮脏灯（.dot.dirty）', (await tabDirty('asrc')) === true)
// 保存 → 脏灯熄灭 + 磁盘落盘
await L.press('Control+s'); await L.waitMs(2200)
C.check('A5 保存后脏灯熄灭', (await tabDirty('asrc')) === false)
C.check('A6 磁盘已落盘含输入', ((await diskOf(SRC)) || '').includes('脏灯x'))

// ============ 场景 B：多段输入 → 三窗口一致（bug2 修复验证，复刻现场操作） ============
await tabClick('ahost', 1300)
await L.clickEl(`${ED}`, 0)
await L.waitMs(400)
await L.type('新增1行')
await L.press('Enter')
await L.waitMs(300)
await L.type('内容不一致了？')
const convB = await untilTrue(async () => {
  const t = await blockTexts()
  return t.length === 2 && t[0] === t[1] && t[0].includes('新增1行') && t[0].includes('内容不一致了？')
}, 9000)
C.check('B1 多段输入后双嵌入块严格一致（复刻现场第二块不再失步）', convB)
const dsB = await storeSubOf(SRC)
C.check('B2 双块订阅 rev == 模型 rev 且 stale=false（原 bug：rev 5 vs 54）', !!dsB && dsB.blocks.length === 2
  && dsB.blocks.every((b) => b.rev === dsB.modelRev && b.stale === false))
// 独立窗口内容 = 嵌入块内容（三窗口共用运行态文档层）
await tabClick('asrc', 1300)
const mdSrc = await L.pageMd()
const hostTextsB = await blockTexts() // 宿主还可见？源激活后宿主隐藏——先取块内容再切换
await tabClick('ahost', 1000)
const hostTextsB2 = await blockTexts()
C.check('B3 独立窗口=块1内容', (mdSrc || '').includes('新增1行') && (mdSrc || '').includes('内容不一致了？'))
C.check('B4 独立窗口=块2内容（三窗口一致）', hostTextsB2.length === 2 && hostTextsB2[0] === hostTextsB2[1]
  && hostTextsB2[1].includes('新增1行') && hostTextsB2[1].includes('内容不一致了？'))
// 反向：源窗口编辑 → 双嵌入块跟到最新
await tabClick('asrc', 1300)
await L.focusEditor(); await L.goEnd(); await L.waitMs(300)
await L.type('回写q')
const convBrev = await untilTrue(async () => {
  await tabClick('ahost', 700)
  const t = await blockTexts()
  await tabClick('asrc', 500)
  return t.length === 2 && t[0] === t[1] && t[0].includes('回写q')
}, 10000)
C.check('B5 源窗口编辑反向全量同步到双块', convBrev)

// ============ 场景 C：保存 + reload 持久化，双块从磁盘重物化仍一致 ============
await tabClick('asrc', 1200)
await L.press('Control+s'); await L.waitMs(2200)
C.check('C1 磁盘含全部编辑（含回写q）', ((await diskOf(SRC)) || '').includes('回写q'))
await L.reloadApp(3000)
await openTab(HOST, 5500)
const tc = await blockTexts()
C.check('C2 reload 后双块重物化且严格一致（含最新编辑）', tc.length === 2 && tc[0] === tc[1]
  && tc[0].includes('脏灯x') && tc[0].includes('新增1行') && tc[0].includes('内容不一致了？') && tc[0].includes('回写q'))
const dsC = await storeSubOf(SRC)
C.check('C3 reload 后订阅基线仍追平', !!dsC && dsC.blocks.length === 2 && dsC.blocks.every((b) => b.rev === dsC.modelRev && b.stale === false))

const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)