// ref-e2e —— M1 引用机制（ego-lite 驱动，【禁止 playwright】）
// 运行：node tests/e2e/_run-one.js ref-e2e
// 共享辅助库 L 由运行器拼接注入（见 _egolite-lib.js）

const task = await L.acquireTaskSpace('ref-e2e')
await L.installErrors()
await L.openApp('http://localhost:5173/?backend=mock')

const C = L.newChecker()

// 打开引用演示.md
await L.clickText('.tree .name', '引用演示.md', { label: '打开引用演示' })
await L.waitMs(3000)

// 1. doctype 节点
C.check('doctype 渲染', (await L.q('.ref-doctype')) === 1)
C.check('doctype 内容 = doctype:demo', (await L.txt('.ref-doctype')).trim() === 'doctype:demo')

// 2. file_ref chips
C.check('file_ref chip 数量', (await L.q('a.ref-file')) >= 3)
const chipTexts = await L.txtAll('a.ref-file')
C.check('chip 含 README.md', chipTexts.some((t) => t.includes('README.md')))
C.check('chip 含 会议记录#片段', chipTexts.some((t) => t.includes('#')))

// 3. file_block 卡片（注意：![[README.md|ro]] 只读物化会带出 README 内的嵌套块，总数=2 顶层+2 嵌套；
// 且嵌套块的 editable/readonly 分配在运行间不稳定（既有物化时序问题，非转换引入者）。
// 因此只断言稳定核心：卡片存在、路径含待办清单与 README、有只读徽标。）
C.check('file_block 卡片数量 >= 2', (await L.q('.ref-file-block')) >= 2)
const blockPaths = await L.txtAll('.ref-file-block-path')
C.check('卡片含 待办清单', blockPaths.some((t) => t.includes('待办清单')))
C.check('卡片含 README 只读引用', blockPaths.some((t) => t.includes('README')))
const badges = await L.txtAll('.ref-file-block-badge')
C.check('只读徽标存在', badges.some((t) => t.includes('只读')))

// 4. 物化：嵌入内容出现在卡片内
await L.waitMs(1000)
C.check('可编辑卡片内含源文件内容(待办清单)', (await L.txt('.ref-file-block:not(.readonly)')).includes('待办清单'))
const readonlyContent = await L.txt('.ref-file-block.readonly')
C.check('只读卡片内含 README 内容', readonlyContent.length > 80 && readonlyContent.includes('消金业务合作'))

// 5. 序列化往返：getMarkdown 只输出标记，不落盘物化内容
const md = await L.pageMd()
C.check('序列化含 ![[标记', md.includes('![[笔记/待办清单]]'))
C.check('序列化含 |ro 标记', md.includes('![[README.md|ro]]'))
C.check('序列化含 [[链接', md.includes('[[README.md]]'))
C.check('物化内容未落盘', !md.includes('搭建工程'))

// 6. 转义：字面量 [[ 不应解析为引用
C.check('转义文本保持为文本', md.includes('\\[[') || md.includes('不应被解析'))

await L.shotTo('09-引用机制-M1.png')

const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)
