// embed-sync-p1-e2e —— P1 止血回归：嵌入块同步 / 写回一致性
// 复现用户报告：probe.md 块嵌入 ![[数据库字段引用]] 两次
//   场景1：编辑第1个块 → 第2个块 + 原文本必须同步（此前不同步，last-wins 吞编辑）
//   场景2：源文件有真实未保存编辑 → 宿主保存不得覆盖源（此前脏写风险）
//   场景3：编辑对称性 —— 编辑第2个块 → 第1个块同样同步
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js embed-sync-p1-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('embed-sync-p1-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

// 活动 pane（可见编辑器容器）限定选择器
const AP = '.editor-pane:not([style*="display: none"])'
const blockTexts = () => js(
  `[...document.querySelectorAll('${AP} .ref-file-block:not(.readonly) .ref-file-block-content')].map(e => e.textContent || '')`
)
const diskOf = (p) => js(
  `(JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}').files[${L.J(p)}] || '')`
)
const toastLog = async () =>
  js(`[...document.querySelectorAll('.toast')].map(t => t.textContent || '')`)

// ---------- 准备：干净基线文件 ----------
// 注意：数据库字段引用.md 在 mock FORCE_UPDATE_PATHS 中（每次 reload 强制回种）——不能覆盖，
// 直接用回种内容（含「数据库字段引用演示4444」）；probe.md 可覆盖（含两个 ![[数据库字段引用]]）。
const SRC_PATH = '数据库字段引用.md'
const PROBE_PATH = 'probe.md'
const SEED_MARK = '数据库字段引用演示4444'
const probeSeed = '# 探针\n\n![[数据库字段引用]]\n\n![[数据库字段引用]]'
await js(`(() => {
  const KEY = 'milkdown-note-mock-fs-v2'
  const fs = JSON.parse(localStorage.getItem(KEY) || '{}')
  fs.files[${L.J(PROBE_PATH)}] = ${JSON.stringify(probeSeed)}
  localStorage.setItem(KEY, JSON.stringify(fs))
})()`)
await L.reloadApp(2500)

// ---------- 场景 0：打开两个标签，双块物化 ----------
await L.clickText('.tree .name', '数据库字段引用.md', { label: '打开源文件' })
await L.waitMs(2500)
await L.clickText('.tree .name', 'probe.md', { label: '打开 probe' })
await L.waitMs(6000)
C.check('probe 双块物化', (await blockTexts()).length === 2)
const t0 = await blockTexts()
C.check('两处嵌入初始内容一致', t0[0].includes(SEED_MARK) && t0[1] === t0[0])

// ---------- 场景 1：编辑第 1 个块 → 第 2 个块 + 源标签同步 ----------
const added1 = await js(`window.__editorBlockAppend('数据库字段引用', '块一编辑A', 0)`)
C.check('块1 追加成功', added1 === 'inserted@2')
await L.waitMs(3000) // 防抖 600ms + 物化/刷新时间
const t1 = await blockTexts()
cliLog('[debug] 编辑块1后: ' + JSON.stringify(t1.map(x => x.slice(-40))))
C.check('块1 含新内容', t1[0].includes('块一编辑A'))
C.check('块2 同步为块1 新内容（兄弟收敛）', t1.length === 2 && t1[1].includes('块一编辑A') && t1[0].includes('块一编辑A'))
C.check('probe 标签脏标记亮', (await L.q('.tab .dot.dirty')) > 0)

// 源标签（打开无自身编辑）→ 预览刷新为块内容
await L.clickText('.tab', '数据库字段引用', { label: '切到源标签' })
await L.waitMs(1200)
const srcTxt = await L.txt(`${AP} .ProseMirror`)
C.check('源标签预览刷新为块内容', srcTxt.includes('块一编辑A') && !srcTxt.includes('块二编辑B'))

// ---------- 场景 2：对称 —— 编辑第 2 个块 → 第 1 个块同步 ----------
await L.clickText('.tab', 'probe', { label: '切回 probe' })
await L.waitMs(900)
const added2 = await js(`window.__editorBlockAppend('数据库字段引用', '块二编辑B', 1)`)
C.check('块2 追加成功', added2 === 'inserted@2')
await L.waitMs(3000)
const t2 = await blockTexts()
cliLog('[debug] 编辑块2后: ' + JSON.stringify(t2.map(x => x.slice(-40))))
C.check('块2 含新内容', t2[1].includes('块二编辑B'))
C.check('块1 同步为块2 新内容（对称）', t2.length === 2 && t2[0] === t2[1] && t2[0].includes('块二编辑B'))

// ---------- 场景 3：保存宿主 → 写回收敛（源无真实编辑） ----------
// 环境注：ego 下 CDP 组合键（Control+s）偶发不送达 keydown → 用 manager 探针触发 saveActiveTab（语义等价）
await js(`window.__saveActiveTab()`)
await L.waitMs(3000)
const diskAfterSave = await diskOf(SRC_PATH)
C.check('保存后源文件落盘为最新块内容', diskAfterSave.includes('块二编辑B') && diskAfterSave.includes('块一编辑A'))
// 源标签被广播①清脏（无真实用户编辑）
await L.clickText('.tab', '数据库字段引用', { label: '切到源标签(2)' })
await L.waitMs(1200)
C.check('源标签保存后脏灭（无真实编辑被同步）', await js(`(() => {
  const tabEl = [...document.querySelectorAll('.tab')].find(e => (e.textContent||'').includes('数据库字段引用'))
  return !tabEl || !tabEl.querySelector('.dot.dirty')
})()`))
// probe.md 序列化只输出标记（物化内容不落盘）
await L.clickText('.tab', 'probe', { label: '切回 probe(2)' })
await L.waitMs(900)
const md = await L.pageMd()
C.check('probe 序列化保留两个 ![[ 标记', (md.match(/!\[\[数据库字段引用\]\]/g) || []).length === 2)
C.check('probe 序列化不含物化内容', !md.includes('块二编辑B'))

// ---------- 场景 4：源标签有真实未保存编辑 → 宿主保存不覆盖 ----------
await L.clickText('.tab', '数据库字段引用', { label: '切到源标签(3)' })
await L.waitMs(900)
await L.focusEditor()
await L.goEnd()
await L.waitMs(300)
await L.type('\n用户私有编辑CC')
await L.waitMs(600)
C.check('源标签脏（真实编辑）', (await L.q('.tab .dot.dirty')) > 0)

// 宿主编辑块1 → 保存：M4 模型层语义——源标签用户编辑与宿主块编辑都已即时入模型（不丢任何编辑），
// 保存 flush 模型整合落盘；无“跳过写回”提示（旧 last-wins 守卫已删）。
await L.clickText('.tab', 'probe', { label: '切回 probe(3)' })
await L.waitMs(900)
await js(`window.__editorBlockAppend('数据库字段引用', '宿主块编辑DDD', 0)`)
await L.waitMs(2800)
await js(`window.__saveActiveTab()`)
await L.waitMs(3000)
const diskAfterBlock = await diskOf(SRC_PATH)
cliLog('[debug] 有源编辑时的宿主保存后磁盘: ' + JSON.stringify(diskAfterBlock.slice(0, 80)))
C.check('宿主保存未丢块编辑（整合落盘含宿主块内容）', diskAfterBlock.includes('宿主块编辑DDD'))
C.check('宿主保存未丢源用户编辑（用户私有编辑保留）', diskAfterBlock.includes('用户私有编辑CC'))
C.check('宿主保存未丢此前内容（块二编辑B 保留）', diskAfterBlock.includes('块二编辑B'))

// 源标签保存 → 落盘用户编辑（已整合，幂等）
await L.clickText('.tab', '数据库字段引用', { label: '切到源标签(4)' })
await L.waitMs(900)
await js(`window.__saveActiveTab()`)
await L.waitMs(2200)
const diskAfterSrcSave = await diskOf(SRC_PATH)
cliLog('[debug] 源保存后磁盘: ' + JSON.stringify(diskAfterSrcSave.slice(0, 80)))
C.check('源保存后磁盘含用户编辑', diskAfterSrcSave.includes('用户私有编辑CC'))

const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)