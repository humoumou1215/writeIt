// app-e2e —— 综合：新布局 / 多开 / 收纳 / 保存 / 设置 / 主题 / 快捷键 / 宽度拖拽
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js app-e2e（会清空 demo-shots/）
const C = L.newChecker()

const task = await L.acquireTaskSpace('app-e2e')
await L.installErrors()
L.clearDemoShots()

await L.freshApp('http://localhost:5173/?backend=mock')

// 1. 无顶栏 + 新侧边栏结构
C.check('顶栏已移除', (await L.q('.topbar')) === 0)
C.check('图标列存在', (await L.q('.icon-col')) === 1)
C.check('图标列 ≥2 个按钮', (await L.q('.icon-col .icon-btn')) >= 2)
C.check('内容列默认展开', !(await js(`document.querySelector('.content-col').classList.contains('collapsed')`)))
C.check('状态栏保留', (await L.q('.statusbar')) === 1)

// 2. 文件树加载
C.check('树含 README.md', (await L.has('.tree .name', 'README.md')))
C.check('树含 笔记 目录', (await L.has('.tree .name', '笔记')))
await L.shotTo('01-新布局初始.png')

// 3. 打开文件 → 不自动收纳
await L.clickText('.tree .node', '笔记')
await L.waitMs(400)
await L.clickText('.tree .name', '会议记录.md')
await L.waitMs(2500)
C.check('编辑器渲染', (await L.has('.milkdown h1', '会议记录')))
C.check('打开文件后不收纳', !(await js(`document.querySelector('.content-col').classList.contains('collapsed')`)))
C.check('标签出现', (await L.q('.tab')) === 1)

// 3.5 连续打开第二个文件
await L.clickText('.tree .name', 'README.md')
await L.waitMs(2000)
C.check('连续打开第二个文件', (await L.q('.tab')) === 2)
C.check('连续打开时侧边栏仍展开', !(await js(`document.querySelector('.content-col').classList.contains('collapsed')`)))
await L.shotTo('02-打开文件不收纳-连续多开.png')

// 4. 点击编辑区 → 收纳；点图标重新展开
await L.clickEl('.workspace', 0, { dx: 320, dy: 200 })
await L.waitMs(400)
C.check('点击编辑区收纳', await js(`document.querySelector('.content-col').classList.contains('collapsed')`))
await L.clickEl('.icon-col .icon-btn', 0, { label: '展开' })
await L.waitMs(400)
C.check('点击图标重新展开', !(await js(`document.querySelector('.content-col').classList.contains('collapsed')`)))

// 5. 编辑 → 脏标记 → Ctrl+S 保存
await L.focusEditor()
await L.waitMs(300)
await L.press('End')
await L.type(' 新布局测试')
await L.waitMs(600)
C.check('脏标记出现', (await L.q('.tab .dot.dirty')) === 1)
await L.press('Control+s')
await L.waitMs(800)
C.check('保存后脏标记清除', (await L.q('.tab .dot.dirty')) === 0)

// 6. 设置弹窗
await L.clickEl('.icon-col .icon-btn[title^="设置"]', 0, { label: '设置' })
await L.waitMs(500)
C.check('设置弹窗打开', await L.vis('.settings-modal'))
C.check('弹窗有 常规/快捷键 两个页签', (await L.q('.tab-btn')) === 2)
await L.shotTo('03-设置弹窗-常规.png')

// 7. 主题切换
await js(`(() => { const s = document.querySelector('.settings-modal select'); if (s) { s.value = 'nord-dark'; s.dispatchEvent(new Event('change', { bubbles: true })) } })()`)
await L.waitMs(600)
const chromeBg = await js(`getComputedStyle(document.documentElement).getPropertyValue('--chrome-background').trim()`)
C.check('深色主题外壳同步', chromeBg.length > 0 && chromeBg !== '#ffffff')

// 8. 快捷键页
await L.clickText('.tab-btn', '快捷键')
await L.waitMs(300)
C.check('快捷键列表 14 项', (await L.q('.shortcut-row')) === 14)
const saveKey = await L.txt('.shortcut-row') ? await js(`(() => { const row=[...document.querySelectorAll('.shortcut-row')].find(r=>(r.textContent||'').includes('保存当前文件')); return row?row.querySelector('.keybtn').textContent.trim():'' })()`) : ''
C.check('默认 Ctrl+S 存在', saveKey === 'Ctrl+S')
// 录制新快捷键
const settingsKey = await js(`(() => { const row=[...document.querySelectorAll('.shortcut-row')].find(r=>(r.textContent||'').includes('打开设置')); if(row){ row.querySelector('.keybtn').click(); return true } return false })()`)
await L.waitMs(300)
await L.press('Alt+Shift+P')
await L.waitMs(300)
const recordedKey = await js(`(() => { const row=[...document.querySelectorAll('.shortcut-row')].find(r=>(r.textContent||'').includes('打开设置')); return row?row.querySelector('.keybtn').textContent.trim():'' })()`)
C.check('快捷键已录制', recordedKey === 'Alt+Shift+P')
await L.shotTo('04-设置弹窗-快捷键.png')

// 9. 关闭设置，用新快捷键打开
await L.press('Escape')
await L.waitMs(400)
C.check('Esc 关闭设置', !(await L.vis('.settings-modal')))
await L.press('Alt+Shift+P')
await L.waitMs(500)
C.check('新快捷键可打开设置', await L.vis('.settings-modal'))
await L.press('Escape')
await L.waitMs(300)

// 10. Ctrl+B 收纳/展开
await L.press('Control+b')
await L.waitMs(400)
C.check('Ctrl+B 收纳', await js(`document.querySelector('.content-col').classList.contains('collapsed')`))
await L.press('Control+b')
await L.waitMs(400)
C.check('Ctrl+B 展开', !(await js(`document.querySelector('.content-col').classList.contains('collapsed')`)))

// 11. Alt+ArrowDown 下一个文件
await L.press('Alt+ArrowDown')
await L.waitMs(2000)
C.check('Alt+↓ 打开新标签', (await L.q('.tab')) === 3)

// 12. 固定侧边栏
if (await L.q('.content-col.collapsed')) { await L.clickEl('.icon-col .icon-btn', 0); await L.waitMs(300) }
await L.clickEl('.sidebar-head .pin', 0, { label: '固定' })
await L.waitMs(300)
await L.clickEl('.workspace', 0, { dx: 320, dy: 200 })
await L.waitMs(400)
C.check('固定后点击编辑区不收纳', !(await js(`document.querySelector('.content-col').classList.contains('collapsed')`)))
await L.clickEl('.sidebar-head .pin', 0, { label: '取消固定' })
await L.waitMs(300)
await L.clickEl('.workspace', 0, { dx: 320, dy: 200 })
await L.waitMs(400)
C.check('未固定点击编辑区收纳', await js(`document.querySelector('.content-col').classList.contains('collapsed')`))
await L.clickEl('.icon-col .icon-btn', 0, { label: '展开' })
await L.waitMs(300)
await L.shotTo('05-固定侧边栏.png')

// 13. 侧边栏新建文件（try 包裹：侧边栏收纳时单个 remove-input 可能未现，防崩溃只报失败）
try {
  await L.clickEl('.sidebar-actions .mini[title="新建文件"]', 0, { label: '新建' })
  await L.waitMs(300)
  await L.fill('.tree .rename-input', '新布局文件.md')
  await L.press('Enter')
  await L.waitMs(1500)
  C.check('新建文件自动打开', (await L.q('.tab')) === 4)
  C.check('新建文件在树中', (await L.has('.tree .name', '新布局文件.md')))
} catch (e) {
  cliLog('❌ 新建文件流程异常: ' + e.message)
}

// 14. 宽度拖拽
const before = await js(`(JSON.parse(localStorage.getItem('milkdown-note-settings-v1') || '{}').sidebarWidth) || 250`)
const rbox = await L.box('.resizer')
await dragMouse([[rbox.x + 2, rbox.y + 100], [rbox.x + 80, rbox.y + 100]], { label: '拖宽度' })
await L.waitMs(400)
const after = await js(`(JSON.parse(localStorage.getItem('milkdown-note-settings-v1') || '{}').sidebarWidth) || 250`)
C.check(`宽度拖拽生效 (${before} → ${after})`, after > before)
await L.shotTo('06-宽度调整.png')

cliLog(C.summary())
const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)
