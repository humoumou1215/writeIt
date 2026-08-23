// 一次性复现脚本：{{http://...}} 重解析后占位符失效 + 内容被 autolink 吞掉
const C = L.newChecker()
const task = await L.acquireTaskSpace('ph-repro')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock', 3000)

// 打开带占位符的模板文件
await L.treeClick('.template')
await L.treeClick('.template/接口文档')
await L.treeClick('.template/接口文档/接口文档.md')
await L.waitMs(6000)

const before = await L.q('.tpl-placeholder')
cliLog('[before] 占位符数量: ' + before)

// 源码模式注入一行 {{http://example.com}}
await L.press('Control+e')
await L.waitMs(800)
await L.press('Enter')
await L.type('{{http://example.com}}')
await L.waitMs(400)
const srcVal = await L.val('.source-ta')
cliLog('[source textarea tail] ' + JSON.stringify(srcVal.slice(-60)))

// 切回所见即所得 → replaceAll 重新解析（round-trip）
await L.press('Control+e')
await L.waitMs(2500)

const after = await L.q('.tpl-placeholder')
cliLog('[after] 占位符数量: ' + after)
const md = await L.pageMd()
cliLog('[md] 含完整 {{http://example.com}}: ' + md.includes('{{http://example.com}}'))
cliLog('[md] 含 example.com: ' + md.includes('example.com'))
const idx = md.indexOf('example')
cliLog('[md context] ' + (idx >= 0 ? JSON.stringify(md.slice(Math.max(0, idx - 45), idx + 45)) : 'N/A'))
const links = await L.txtAll('.ProseMirror a')
cliLog('[wysiwyg links] ' + JSON.stringify(links))
const errs = await L.errors()
cliLog('[errors] ' + JSON.stringify(errs.slice(-5)))

cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(0)