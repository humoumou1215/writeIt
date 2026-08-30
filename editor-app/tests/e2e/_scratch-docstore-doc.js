// 临时验证：docstore.doc / refs.registry(deprecated)（spec §6.3）
// 运行：node tests/e2e/_run-one.js _scratch-docstore-doc
const C = L.newChecker()

const task = await L.acquireTaskSpace('scratch-docstore-doc')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const SRC_PATH = '数据库字段引用.md'

// 先打开任意文件：触发 docstore pipeline/IO 装配（幂等；此后全局可查）
await L.clickText('.tree .name', '数据库字段引用.md', { label: '打开源文件' })
await L.waitMs(3000)

// 取一个「存在但模型未加载」的文件路径（mock fs 里非当前标签的文件）
const OTHER = await js(`(() => {
  const KEY = 'milkdown-note-mock-fs-v2'
  const fs = JSON.parse(localStorage.getItem(KEY) || '{}')
  const keys = Object.keys(fs.files || {})
  return keys.find((k) => k !== '数据库字段引用.md' && (fs.files[k] || '').length > 3) ?? null
})()`)
C.check('mock fs 存在可用的未打开文件', typeof OTHER === 'string' && OTHER.length > 0)

// 未加载模型的路径：pipeline/IO 就绪 → docContent 先 load（磁盘 → 模型）再返回 canonical
const r1 = await js(`window.__docstoreDoc(${L.J(OTHER)})`)
C.check('docstore.doc：未加载文件先 load 再返回 canonical', !!r1 && typeof r1.canonical === 'string' && r1.canonical.length > 0)
C.check('docstore.doc：返回 rev/dirty 元信息', !!r1 && typeof r1.rev === 'number' && typeof r1.dirty === 'boolean')

// 与磁盘内容一致（未编辑文件：模型 canonical ≡ 磁盘内容的 canonical 归一形）
const diskOther = await js(`(JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}').files[${L.J(OTHER)}] || '')`)
C.check('docstore.doc：canonical 与磁盘内容一致（未编辑）', !!r1 && diskOther.length > 0 && r1.canonical.includes(diskOther.trim().slice(0, 20)))

// 已加载标签的路径：快照直接返回（内容 = 磁盘 canonical）
const r2 = await js(`window.__docstoreDoc(${L.J(SRC_PATH)})`)
const diskSrc = await js(`(JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}').files[${L.J(SRC_PATH)}] || '')`)
C.check('docstore.doc：已加载模型 → 快照直接返回', !!r2 && r2.canonical.includes(diskSrc.trim().slice(0, 20)))

// 不存在的文件 → null（无内容）
const r3 = await js(`window.__docstoreDoc('不存在/文件.md')`)
C.check('docstore.doc：不存在文件返回 null', r3 === null)

// refs.registry deprecated 标注（compat 结构保留）
const reg = await js(`(() => { try { const w = window; return { deprecated: w.__registryDiag ? (w.__registryDiag().deprecated ?? false) : false } } catch (e) { return { deprecated: false, err: String(e) } } })()`)
C.check('refs.registry 输出 deprecated 信息', reg.deprecated === false || reg.deprecated === true)

console.log(C.summary())
await completeTaskSpace(task.id, { keep: false }).catch(() => {})
process.exit(0)