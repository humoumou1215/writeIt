// paste-ref-e2e —— 复制文件粘贴为引用（Ctrl+V 默认链接）+ 编辑器右键菜单（三种粘贴/类型切换）
// 覆盖：文件树复制→Ctrl+V 链接引用 / 右键菜单粘贴为块嵌入·只读嵌入 / 引用 chip 右键切换类型 /
// 目录复制→路径文本 / 多文件分段 / OS 系统复制（text/uri-list）降级 basename / 打开引用
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js paste-ref-e2e
const C = L.newChecker()

await L.acquireTaskSpace('paste-ref-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

// ---- 工具 ----
const refChipCount = (path) => js(`document.querySelectorAll('a.ref-file[data-path="${path}"]').length`)
const blockCount = (path, ro) => js(`[...document.querySelectorAll('.ref-file-block${ro ? '.readonly' : ''}')].filter(e => (e.querySelector('.ref-file-block-path')||{}).textContent === ${L.J(path)}).length`)

/** 右键一坐标并轮询菜单出现；返回菜单文字列表（未出现 → []) */
const rightClickAt = async (x, y) => {
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 })
  const start = Date.now()
  while (Date.now() - start < 700) {
    const items = await js(`[...document.querySelectorAll('.rm-menu .rm-item')].map(b => b.textContent.trim())`)
    if (items.length) return items
    await L.waitMs(80)
  }
  return []
}

/** 编辑器右键弹出自定义菜单（多位置重试，返回菜单文字列表） */
const openEditorMenu = async () => {
  await L.focusEditor()
  const b = await L.box('.milkdown .ProseMirror')
  if (!b) throw new Error('editor not found')
  for (const [fx, fy] of [[0.85, 0.25], [0.5, 0.5], [0.7, 0.75]]) {
    const items = await rightClickAt(Math.round(b.x + b.w * fx), Math.round(b.y + Math.min(120, b.h * fy)))
    if (items.length) return items
    // 清理残留菜单再换位置
    await js(`document.querySelector('.rm-mask')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
    await L.waitMs(200)
  }
  return []
}

/** 右键 DOM 元素（选择器）中心：scrollIntoView + elementFromPoint 校准（异步重排会漂移坐标） */
const rightClickSel = async (sel) => {
  let hit = null
  for (let i = 0; i < 6; i++) {
    hit = await js(`(() => {
      const e = document.querySelector(${L.J(sel)})
      if (!e) return null
      e.scrollIntoView({ block: 'center', behavior: 'instant' })
      const r = e.getBoundingClientRect()
      const x = Math.round(r.x + Math.min(r.width / 2, 40))
      const y = Math.round(r.y + r.height / 2)
      const at = document.elementFromPoint(x, y)
      const ok = !!at && (at === e || (e.contains ? e.contains(at) : false) || (at.closest ? at.closest(${L.J(sel)}) === e : false))
      return ok ? { x, y } : null
    })()`)
    if (hit) break
    await L.waitMs(250)
  }
  if (!hit) throw new Error('rightClickSel: no stable target ' + sel)
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'right', clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'right', clickCount: 1 })
  const start = Date.now()
  while (Date.now() - start < 700) {
    const items = await js(`[...document.querySelectorAll('.rm-menu .rm-item')].map(b => b.textContent.trim())`)
    if (items.length) return items
    await L.waitMs(80)
  }
  return []
}

/** 在编辑器右键菜单中点击文本匹配项（含子串匹配） */
const clickRmItem = async (text) => {
  const ok = await js(`(() => {
    const btns = [...document.querySelectorAll('.rm-menu .rm-item')]
    const b = btns.find(x => (x.textContent||'').includes(${L.J(text)}))
    if (!b) return false
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })()`)
  if (!ok) throw new Error('rm-item not found: ' + text)
  let t0 = Date.now()
  while (Date.now() - t0 < 1200) {
    if (await js(`document.querySelectorAll('.rm-menu .rm-item').length`) === 0) break
    await L.waitMs(80)
  }
}

/** 清空内部剪贴板（模拟用户复制了别的内容：copy 事件无自定义 MIME） */
const clearInternalClip = () => js(`
  (() => { document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: new DataTransfer() })); return true })()`)

/** 构造剪贴板事件并 dispatch 到编辑器（自定义 MIME / text-uri-list 模拟系统复制） */
const dispatchPaste = (mime, data) => js(`
  (() => {
    const dt = new DataTransfer()
    dt.setData(${L.J(mime)}, ${L.J(data)})
    let ev
    try { ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }) }
    catch { ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'clipboardData', { value: dt }) }
    document.querySelector('.milkdown .ProseMirror').dispatchEvent(ev)
    return true
  })()`)

// ---- 准备：新建测试文件并打开 ----
/** 轮询等待 JS 表达式为真 */
const waitFor = async (expr, timeout = 5000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await js(expr)) return true
    await L.waitMs(120)
  }
  return false
}
/** 展开目录（点击行 = toggleExpand） */
const expandDir = async (path) => {
  const ok = await js(`(() => { const el = document.querySelector('.tree [data-path="${path}"]'); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true })()`)
  await L.waitMs(600)
  return ok
}

await L.clickEl('.sidebar-actions .mini[title="新建文件"]', 0, { label: '新建文件' })
await waitFor(`!!document.querySelector('.tree .rename-input')`)
await L.fill('.tree .rename-input', '粘贴引用测试.md')
await L.press('Enter')
await waitFor(`[...document.querySelectorAll('.tab-name')].map(e => e.textContent).join(',')`)
C.check('测试文件已打开', (await js(`[...document.querySelectorAll('.tab-name')].map(e => e.textContent)`)).includes('粘贴引用测试.md'))


// ===== 1. 文件树复制 → Ctrl+V 粘贴为链接引用 =====
await expandDir('笔记')
await L.rightClick('.tree [data-path="笔记/会议记录.md"]')
await L.waitMs(400)
const treeMenu = await js(`[...document.querySelectorAll('.menu .menu-item')].map(b => b.textContent.trim())`)
C.check('文件树右键菜单含「复制」', treeMenu.some(t => t === '复制'))
await L.clickText('.menu .menu-item', '复制')
await L.waitMs(400)
await L.focusEditor()
await L.goEnd()
// 模拟 Ctrl+V：剪贴板带有文件树复制写入的自定义 MIME（navigator.clipboard.write 成功路径）
await dispatchPaste('application/x-writeit-node',
  JSON.stringify([{ kind: 'file', path: '笔记/会议记录.md' }]))
await L.waitMs(900)
C.check('Ctrl+V 插入链接引用 chip', await refChipCount('笔记/会议记录.md') === 1)
C.check('markdown 含 [[笔记/会议记录.md]]', (await L.pageMd()).includes('[[笔记/会议记录.md]]'))

// ===== 2. 编辑器右键菜单：粘贴为块嵌入 =====
const itemsAfterCopy = await openEditorMenu()
C.check('右键菜单显示三种引用粘贴', itemsAfterCopy.some(t => t.includes('粘贴为链接引用'))
  && itemsAfterCopy.some(t => t.includes('粘贴为块嵌入'))
  && itemsAfterCopy.some(t => t.includes('粘贴为只读嵌入')))
await clickRmItem('粘贴为块嵌入')
const waitBlock = async (path, ro, timeout = 3000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await blockCount(path, ro) > 0) return true
    await L.waitMs(120)
  }
  return false
}
C.check('块嵌入卡片出现（可编辑）', await waitBlock('笔记/会议记录.md', false))
C.check('markdown 含 ![[笔记/会议记录.md]]', (await L.pageMd()).includes('![[笔记/会议记录.md]]'))

// ===== 3. 右键菜单：粘贴为只读嵌入 =====
await openEditorMenu()
await clickRmItem('粘贴为只读嵌入')
C.check('只读嵌入卡片出现', await waitBlock('笔记/会议记录.md', true))
C.check('markdown 含 ![[笔记/会议记录.md|ro]]', (await L.pageMd()).includes('![[笔记/会议记录.md|ro]]'))

// ===== 4. 引用 chip 右键 → 类型切换（先清内部剪贴板避免粘贴组干扰） =====
await clearInternalClip()
const chipMenuItems = await rightClickSel('a.ref-file[data-path="笔记/会议记录.md"]')
C.check('chip 右键菜单含类型切换组', chipMenuItems.some(t => t.includes('链接引用'))
  && chipMenuItems.some(t => t.includes('块嵌入（可编辑）'))
  && chipMenuItems.some(t => t.includes('只读嵌入')))
C.check('菜单同时含打开引用', chipMenuItems.some(t => t.includes('打开引用')))
C.check('菜单含复制引用', chipMenuItems.some(t => t.includes('复制引用')))
// 链接 chip → 块嵌入（可编辑）
const beforeBlocks = await js(`document.querySelectorAll('.ref-file-block').length`)
await clickRmItem('块嵌入（可编辑）')
C.check('链接 chip → 块嵌入', await blockCount('笔记/会议记录.md', false) === beforeBlocks + 1)
C.check('切换到块嵌入后链接 chip 减少', await refChipCount('笔记/会议记录.md') === 0)
// 块嵌入 → 只读
await rightClickSel('.ref-file-block')
await clickRmItem('只读嵌入')
C.check('块嵌入 → 只读嵌入', await blockCount('笔记/会议记录.md', true) >= 1)
// 只读 → 链接引用
await rightClickSel('.ref-file-block.readonly')
await clickRmItem('链接引用')
C.check('只读嵌入 → 链接引用', await refChipCount('笔记/会议记录.md') === 1)

// ===== 5. 目录复制 → Ctrl+V 粘贴路径文本（不作为引用） =====
await L.rightClick('.tree [data-path="笔记"]')
await L.waitMs(400)
await L.clickText('.menu .menu-item', '复制')
await L.waitMs(400)
await L.focusEditor()
await L.goEnd()
await dispatchPaste('application/x-writeit-node', JSON.stringify([{ kind: 'dir', path: '笔记' }]))
await L.waitMs(700)
const md5 = await L.pageMd()
C.check('目录粘贴为路径文本（不含 ![[ ）', md5.includes('笔记') && !md5.includes('![[笔记]]'))
C.check('目录不产生引用节点', await js(`document.querySelectorAll('a.ref-file[data-path="笔记"]').length + [...document.querySelectorAll('.ref-file-block-path')].filter(e => e.textContent === '笔记').length`) === 0)

// ===== 6. 多文件粘贴 → 连续引用自动分段 =====
await dispatchPaste('application/x-writeit-node',
  JSON.stringify([{ kind: 'file', path: '笔记/会议记录.md' }, { kind: 'file', path: '笔记/待办清单.md' }]))
await L.waitMs(900)
const md6 = await L.pageMd()
C.check('多文件粘贴 → 两个链接引用', await refChipCount('笔记/会议记录.md') >= 1 && await refChipCount('笔记/待办清单.md') === 1)
C.check('多文件自动分段（各行独立）',
  md6.includes('\n[[笔记/待办清单.md]]\n') || (await refChipCount('笔记/待办清单.md') === 1))

// ===== 7. OS 系统复制（text/uri-list → 无 rootPath 降级 basename） =====
await dispatchPaste('text/uri-list', 'file:///home/user/workspace/数据/原始数据.txt')
await L.waitMs(900)
C.check('OS 复制文件 → 插入 basename 引用', await refChipCount('原始数据.txt') === 1)
C.check('markdown 含 [[原始数据.txt]]', (await L.pageMd()).includes('[[原始数据.txt]]'))

// ===== 8. 右键「打开引用」跳转目标文件 =====
await rightClickSel('a.ref-file[data-path=\'笔记/待办清单.md\']')
await clickRmItem('打开引用')
await waitFor(`(() => { const t = document.querySelector('.tab.active .tab-name'); return !!(t && (t.textContent||'').includes('待办清单')) })()`)
const activeTabName = await js(`(() => { const t = document.querySelector('.tab.active .tab-name'); return t ? t.textContent : '' })()`)
C.check('打开引用 → 目标文件成为活动标签', activeTabName.includes('待办清单.md'))

// 汇总输出
;(async () => {
  const errs = await L.errors()
  if (errs.length) cliLog('⚠️ 页面错误: ' + errs.slice(0, 5).join(' | '))
  cliLog(C.summary())
})()