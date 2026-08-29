// M3a 现场验证（临时套件）：A 嵌 B 两次；块1内编辑 → B 模型即时推进 + 块2增量同步
const C = L.newChecker()
const task = await L.acquireTaskSpace('_m3check')
await L.installErrors()
await L.openApp('http://localhost:5173/?backend=mock', 4000)
await js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  if (!fs.dirs) fs.dirs = []
  fs.files['笔记/M3A.md'] = '# M3A 宿主\\n\\n开场。\\n\\n![[M3B]]\\n\\n![[M3B]]\\n\\n结尾。\\n'
  fs.files['笔记/M3B.md'] = '# M3B 源\\n\\n源内容第一段。\\n\\n第二段。\\n'
  localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
  return 'injected'
})()`)
await L.reloadApp(4000)
await L.clickText('.tree .node', '笔记')
await L.waitMs(400)
await L.clickText('.tree .name', 'M3A.md', { label: 'open A' })
await L.waitMs(4000)
const base = await js(`(() => {
  const m = __docstoreInspect().models
  return {
    hostRev: (m.find(x => x.realPath === '笔记/M3A.md')||{}).rev,
    bRev: (m.find(x => x.realPath === '笔记/M3B.md')||{}).rev,
    subs: (m.find(x => x.realPath === '笔记/M3B.md')||{}).subscribers ? (m.find(x => x.realPath === '笔记/M3B.md')).subscribers.length : 0,
    blocks: document.querySelectorAll('.ref-file-block').length,
  }
})()`)
C.check('M3a 两嵌入块物化', base.blocks === 2)
C.check('M3a B 源被两个块订阅', base.subs === 2)
// 块1内 append
await js("__editorBlockAppend('M3B', ' 新段落X', 0)")
await L.waitMs(1500)
const after = await js(`(() => {
  const m = __docstoreInspect().models
  return {
    bRev: (m.find(x => x.realPath === '笔记/M3B.md')||{}).rev,
    hostRev: (m.find(x => x.realPath === '笔记/M3A.md')||{}).rev,
    disp: window.__docstoreDispatchCount || 0,
    commitErr: window.__docstoreCommitErr || null,
    commitWhy: window.__docstoreCommitWhy || null,
    commitEntered: window.__docstoreCommitEntered || false,
    commitIn: window.__docstoreCommitIn || null,
    commitTail: window.__docstoreCommitTail || null,
    mid1: window.__docstoreCommitMid || null,
    mid2: window.__docstoreCommitMid2 || null,
    mid3: window.__docstoreCommitMid3 || null,
    hook: window.__docstoreLastHook || null,
    blockTexts: [...document.querySelectorAll('.ref-file-block:not(.readonly) .ref-file-block-content')].map(e => (e.textContent||'').slice(-20)),
  }
})()`)
C.check('M3a 块1编辑 → B 源模型 rev 推进', after.bRev === (base.bRev != null ? base.bRev + 1 : 999))
C.check('M3a 宿主 rev 不变', after.hostRev === base.hostRev)
C.check('M3a dispatcher 分发发生', after.disp > 0)
C.check('M3a 块2同步含新内容', after.blockTexts.length >= 2 && after.blockTexts[1].includes('新段落X'))
cliLog('_M3CHK base=' + JSON.stringify(base) + ' after=' + JSON.stringify(after))
// ---------- M3b-2：保存 → flush 写盘 ----------
await js("__editorBlockAppend('M3B', ' 保存存活Y', 0)")
await L.waitMs(1500)
await js(`window.__saveActiveTab()`)
await L.waitMs(2500)
const saveChk = await js(`(() => {
  const m = __docstoreInspect().models
  const b = m.find(x => x.realPath === '笔记/M3B.md') || {}
  const disk = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}').files['笔记/M3B.md'] || ''
  return { bDirty: b.dirty, bRev: b.rev, diskHasY: disk.includes('保存存活Y'), diskHasX: disk.includes('新段落X') }
})()`)
C.check('M3b-2 保存后模型脏灭（diskRev 追平）', saveChk.bDirty === false)
C.check('M3b-2 保存后源磁盘含模型内容（flush 写盘）', saveChk.diskHasY && saveChk.diskHasX)
cliLog('_M3SAVE ' + JSON.stringify(saveChk))

cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail === 0 ? 0 : 1)

// ---------- M3b-2 保存链路：编辑块 → 保存 → 模型 flush 写盘 ----------
// （追加段：复用同一页面状态，编辑块2 → 保存 → 验证磁盘与模型状态）
