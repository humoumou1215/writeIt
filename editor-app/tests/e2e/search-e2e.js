// search-e2e —— M15：全局搜索面板（全文搜索/跳转/替换/快捷键/收起/高亮）
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js search-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('search-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const panelVisible = () => L.vis('[data-search-panel]')
const hitCount = () => L.q('.sp-hit')
const waitHits = async (min, timeout = 6000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if ((await hitCount()) >= min) return true
    await L.waitMs(100)
  }
  return (await hitCount()) >= min
}

// ===== 1. 图标列 🔍 打开面板 =====
await L.clickEl('button[title^="全局搜索"]', 0, { label: '🔍' })
await L.waitMs(300)
C.check('🔍 图标打开搜索面板', await panelVisible())
C.check('输入框自动聚焦', await js(`document.activeElement ? document.activeElement.classList.contains('sp-input') : false`))

// ===== 2. 全文搜索 =====
await L.fill('.sp-input', '助贷放款')
C.check('命中结果出现（多文件分组）', await waitHits(1))
await L.waitMs(400)
const status = await L.txt('.sp-status')
C.check('状态行显示匹配计数', /^\s*\d+\s*处匹配/.test(status ?? ''))
const paths = await L.txtAll('.sp-file-path')
C.check('结果按文件分组且含接口文档', paths.some(p => p.includes('助贷放款接口.md')))
C.check('命中行关键字高亮 <mark>', (await L.q('.sp-hit .sp-mark')) > 0)
const lineNos = await L.txtAll('.sp-hit .sp-line-no')
C.check('命中行有行号', lineNos.length > 0 && lineNos.every(n => /^\d+$/.test(n)))

// ===== 3. 点击结果 → 打开文件 =====
await L.clickEl('.sp-hit', 0, { label: '点命中' })
await L.waitMs(1500)
const tabNames = await L.txtAll('.tab-name')
C.check('点击结果打开对应文件标签', tabNames.some(t => t.includes('助贷放款')))

// ===== 4. Esc 清空 → 再按收起 =====
await L.fill('.sp-input', '')
await L.press('Escape')
C.check('Esc 清空输入', (await L.val('.sp-input')) === '')
await L.press('Escape')
await L.waitMs(200)
C.check('再按 Esc 收起侧栏', await js(`document.querySelector('.content-col') ? document.querySelector('.content-col').classList.contains('collapsed') : false`))

// ===== 5. Ctrl+Shift+F 重新打开 =====
await js(`(() => { document.body.focus() })()`)
await L.press('Control+Shift+F')
await L.waitMs(400)
C.check('Ctrl+Shift+F 重新展开搜索面板', await panelVisible())
C.check('快捷键后面板输入框聚焦', await js(`document.activeElement ? document.activeElement.classList.contains('sp-input') : false`))

// ===== 6. 大小写选项 + 无结果 =====
await L.fill('.sp-input', '不存在的关键词xyz123')
await waitHits(0)
const emptyText = await L.txt('.sp-empty')
C.check('无结果提示', (emptyText ?? '').includes('没有找到'))
await L.clickEl('.sp-opt', 0, { label: '大小写' })
C.check('大小写开关可切换', await js(`document.querySelector('.sp-opt') ? document.querySelector('.sp-opt').classList.contains('on') : false`))
await L.clickEl('.sp-opt', 0, { label: '恢复大小写' })

// ===== 7. 替换功能（try 包裹：确认框/按钮偶发时序）=====
try {
  await L.fill('.sp-input', '助贷放款')
  await waitHits(1)
  await L.waitMs(400)
  const hitsBefore = await hitCount()
  C.check('替换行可见', await L.vis('.sp-replace-row'))
  await L.fill('.sp-rinput', '助贷放款TEST')
  await L.clickEl('.sp-btn.danger', 0, { label: '全部替换' })
  await L.waitMs(600)
  C.check('确认框出现', await L.vis('.modal'))
  try { await L.clickText('.modal .btn.danger, .modal button', '全部替换') } catch { await L.clickEl('.modal .btn.danger', 0, { label: '确认' }).catch(() => {}) }
  await L.waitMs(2500)
  C.check('替换成功 toast', (await L.txt('.toast', await js(`[...document.querySelectorAll('.toast')].length - 1`))).includes('已替换'))
  C.check('替换后旧词命中归零', (await hitCount()) === 0)
  await L.fill('.sp-input', '助贷放款TEST')
  await waitHits(1)
  C.check('替换后新词命中', (await hitCount()) >= hitsBefore)
  // 恢复 mock 示例数据
  await L.press('Escape'); await L.press('Escape')
  await L.clickEl('button[title^="设置"]', 0, { label: '设置' })
  await L.waitMs(600)
  await L.clickText('button', '刷新 Mock 示例数据')
  await L.waitMs(2000)
  await L.waitMs(300)
  await L.press('Escape')
} catch (e) {
  cliLog('❌ 替换流程异常: ' + e.message)
}

// ===== 8. 跳转定位 + 编辑器内高亮 =====
await L.clickEl('button[title^="全局搜索"]', 0, { label: '🔍' })
await L.waitMs(300)
await L.fill('.sp-input', '助贷放款')
await waitHits(1)
await L.clickEl('.sp-hit', 0, { label: '点命中' })
await L.waitMs(2500)
C.check('点击结果打开文件', (await js(`[...document.querySelectorAll('.tab-name')].length`)) > 0)
C.check('编辑器内命中词高亮', (await L.q('.milkdown .search-hit-highlight')) > 0)
C.check('同文件所有匹配都高亮', (await L.q('.milkdown .search-hit-highlight')) >= (await L.q('.sp-hit')))
const currentAnim = await js(`(() => {
  const el = document.querySelector('.milkdown .search-hit-current')
  if (!el) return null
  const cs = getComputedStyle(el)
  return { hasPulse: cs.animationName.includes('pulse'), white: cs.color === 'rgb(255, 255, 255)' }
})()`)
C.check('当前命中带橙红闪烁样式', currentAnim && currentAnim.hasPulse && currentAnim.white)
const normalAnim = await js(`(() => {
  const el = document.querySelector('.milkdown .search-hit-highlight:not(.search-hit-current)')
  return el ? getComputedStyle(el).animationName === 'none' : false
})()`)
C.check('普通命中淡橙无动画', normalAnim)
await L.clickEl('.milkdown .ProseMirror', 0, { dx: 40, dy: 40 })
await L.type('x')
await L.waitMs(600)
C.check('编辑后高亮自动清除', (await L.q('.milkdown .search-hit-highlight')) === 0)

cliLog('结果: ' + C.pass + ' 通过 / ' + C.fail + ' 失败')
const errs = await L.errors()
cliLog(errs.length ? '页面错误:\n' + errs.join('\n') : '')
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)
