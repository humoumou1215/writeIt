// m6c-e2e —— M6 v3：批注抽屉（评论线程 / 标记已解决 / 校验只读卡 / 连线 / 拖拽 / 折叠）
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js m6c-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('m6c-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

// 构造：周报 + 一条人工批注（线程）+ 校验违规（需求表部分填写）
const note = JSON.stringify([{ a: '张三', c: '这里需要补充**验收标准**', t: Date.now() - 7200000, r: 0 }]).replace(/"/g, '&quot;')
await js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  fs.files['笔记/周报.md'] = 'doctype:demo\\n\\n# 周报\\n\\n<mark data-note="${note}">本周进展</mark>已同步。\\n\\n## 版本\\n\\nv0.2.1\\n\\n## 需求\\n\\n| 前置 | 后置 |\\n| --- | --- |\\n| A |  |\\n'
  localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
})()`)
await L.reloadApp(2500)
await L.clickText('.tree .node', '笔记')
await L.waitMs(400)
await L.clickText('.tree .name', '周报.md')
await L.waitMs(6000)

// 1. 抽屉默认收纳（打开文件不展开）+ 批注卡（1 人工 + 1 校验违规）
C.check('抽屉默认收纳（不展开）', (await L.q('.annotation-drawer.open')) === 0)
C.check('折叠态显示右缘把手（展开方向）', (await L.q('.ad-toggle.expand')) > 0)
await L.clickEl('.ad-toggle.expand', 0, { label: '展开抽屉' })
await L.waitMs(500)
C.check('点击展开按钮后抽屉打开', (await L.q('.annotation-drawer.open')) > 0)
C.check('抽屉显示 2 张卡（人工 + 校验）', (await L.q('.ad-card')) === 2)
const threadText = await L.txt('.ad-card .ad-comment-content')
C.check('人工批注评论内容显示', (threadText || '').includes('验收标准'))
const bodyGap = await js(`(() => {
  const drawer = document.querySelector('.annotation-drawer.open')
  const body = drawer ? drawer.querySelector('.annotation-drawer-body') : null
  if (!drawer || !body) return 999
  const dr = drawer.getBoundingClientRect()
  const br = body.getBoundingClientRect()
  return Math.round(dr.right - br.right)
})()`)
C.check('抽屉 body 撑满宽度（无右侧空隙）', bodyGap <= 1)

// 2. 校验违规只读卡（无回复输入）；v6：卡片默认收起
C.check('校验违规只读卡', (await L.q('.ad-card.read-only')) === 1)
C.check('初始批注卡收起（无回复框）', (await L.q('.ad-reply')) === 0)
await L.clickEl('.ad-card:not(.read-only) .ad-card-head', 0, { label: '展开人工卡' })
await L.waitMs(600)
C.check('点击头部展开后回复框 1 个', (await L.q('.ad-reply')) === 1)

// 3. 回复评论（追加线程）
await L.fill('.ad-reply textarea', '我补充了量化指标：通过率 ≥ 95%')
await L.clickText('.ad-reply-actions button', '发送')
await L.waitMs(1200)
C.check('回复后评论 2 条', (await L.q('.ad-comment')) === 2)

// 4. 持久化 round-trip（md 里线程 JSON 两条）
const md = await L.pageMd()
const parseOk = await js(`(() => {
  const t = ${JSON.stringify(md)}
  const m = /data-note=(["'])((?:(?!\\1).)*)\\1/.exec(t)
  if (!m) return false
  const arr = JSON.parse(m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
  return Array.isArray(arr) && arr.length === 2
})()`)
C.check('线程持久化到 md（2 条评论 JSON）', parseOk)

// 5. 已解决状态圆
const zhangDot = await js(`(() => {
  const comment = Array.from(document.querySelectorAll('.ad-comment')).find(c => (c.querySelector('.ad-author') ? c.querySelector('.ad-author').textContent : '').includes('张三'))
  const dot = comment ? comment.querySelector('.ad-resolve-dot') : null
  return dot ? { mine: dot.classList.contains('mine'), resolved: dot.classList.contains('resolved') } : null
})()`)
C.check('非创建人（张三）圆不可点（非 mine）', zhangDot && !zhangDot.mine)
const myDot = await js(`(() => {
  const comment = Array.from(document.querySelectorAll('.ad-comment')).find(c => (c.querySelector('.ad-author') ? c.querySelector('.ad-author').textContent : '').includes('我'))
  const dot = comment ? comment.querySelector('.ad-resolve-dot') : null
  return dot ? dot.classList.contains('mine') : false
})()`)
C.check('创建人（我）圆可点（mine）', myDot === true)
await js(`(() => {
  const comment = Array.from(document.querySelectorAll('.ad-comment')).find(c => (c.querySelector('.ad-author') ? c.querySelector('.ad-author').textContent : '').includes('我'))
  const dot = comment.querySelector('.ad-resolve-dot')
  dot.click()
})()`)
await L.waitMs(1000)
const resolvedDot = await js(`(() => {
  const comment = Array.from(document.querySelectorAll('.ad-comment')).find(c => (c.querySelector('.ad-author') ? c.querySelector('.ad-author').textContent : '').includes('我'))
  return comment ? comment.querySelector('.ad-resolve-dot').classList.contains('resolved') : false
})()`)
C.check('点击圆 → 已解决（✔）', resolvedDot === true)
// 把手数字 = 未解决批注卡数：线程仍有「张三」未解决 → 不误减（2 = 1 违规 + 1 人工未解决）
const numAfterResolve = await js(`(() => { const n = document.querySelector('.ad-toggle-num'); return n ? n.textContent : '' })()`)
C.check('部分已解决不降低未解决数（线程未全部解决）', numAfterResolve === '2')
await js(`(() => {
  const comment = Array.from(document.querySelectorAll('.ad-comment')).find(c => (c.querySelector('.ad-author') ? c.querySelector('.ad-author').textContent : '').includes('我'))
  comment.querySelector('.ad-resolve-dot').click()
})()`)
await L.waitMs(1000)
const reopenedDot = await js(`(() => {
  const comment = Array.from(document.querySelectorAll('.ad-comment')).find(c => (c.querySelector('.ad-author') ? c.querySelector('.ad-author').textContent : '').includes('我'))
  return comment ? !comment.querySelector('.ad-resolve-dot').classList.contains('resolved') : false
})()`)
C.check('再点圆 → 重新打开（空圆）', reopenedDot === true)

// 6. 点击正文锚点 → 激活批注 + 连线出现
await L.clickEl('.ProseMirror mark.annotation', 0, { label: '点锚点' })
await L.waitMs(800)
C.check('点击锚点激活对应批注卡', (await L.q('.ad-card.active')) > 0)
C.check('激活后卡片默认收起', (await L.q('.ad-card.active.collapsed')) > 0)
await L.clickEl('.ad-card.active .ad-card-head', 0, { label: '展开' })
await L.waitMs(600)
C.check('点击头部展开', (await L.q('.ad-card.active:not(.collapsed)')) > 0)
C.check('展开时显示评论输入框', (await L.q('.ad-card.active:not(.collapsed) .ad-reply')) > 0)
await L.clickEl('.ad-card.active .ad-card-head', 0, { label: '收起' })
await L.waitMs(600)
C.check('再点头部收起', (await L.q('.ad-card.active.collapsed')) > 0)
C.check('收起时无评论输入框', (await L.q('.ad-card.active.collapsed .ad-reply')) === 0)
const commentsShown = await js(`(() => { const card = document.querySelector('.ad-card.active.collapsed'); return card ? card.querySelectorAll('.ad-comment').length : 0 })()`)
C.check('收起仍显示评论列表', commentsShown > 0)
await L.clickEl('.ad-card.active .ad-card-head', 0, { label: '再展开' })
await L.waitMs(600)
await waitForElement('.ad-card.read-only', { timeout: 10 }).catch(() => {})
await L.clickEl('.ad-card.read-only', 0, { label: '点只读卡' })
await L.waitMs(600)
const humanCollapsed = await js(`(() => { const human = document.querySelector('.ad-card:not(.read-only)'); return human ? human.classList.contains('collapsed') : false })()`)
C.check('点击其他卡片 → 人工卡收起', humanCollapsed === true)
await L.clickEl('.ad-card:not(.read-only) .ad-card-head', 0, { label: '再点人工卡头部' })
await L.waitMs(600)
C.check('再点人工卡头部展开', (await L.q('.ad-card.active:not(.collapsed)')) > 0)
const connDisplay = await js(`(() => { const svg = document.querySelector('.annotation-connector'); return svg ? getComputedStyle(svg).display : 'none' })()`)
C.check('连线显示', connDisplay !== 'none')

// 7. 宽度拖拽（50-480 限制）：左缘把手向左拖 = 变宽
await js(`(() => {
  const btn = document.querySelector('.ad-toggle.collapse')
  const rect = btn ? btn.getBoundingClientRect() : null
  if (!btn || !rect) return
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: rect.left + 10, clientY: rect.top + 24 }))
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: rect.left - 300, clientY: rect.top + 24 }))
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: rect.left - 300, clientY: rect.top + 24 }))
})()`)
await L.waitMs(400)
const w1 = await js(`document.querySelector('.annotation-drawer.open') ? document.querySelector('.annotation-drawer.open').getBoundingClientRect().width : -1`)
C.check('拖拽宽度受限（50-480）', w1 >= 50 && w1 <= 480)

// 8. 折叠：点击左缘把手（收纳方向）
await L.clickEl('.ad-toggle.collapse', 0, { label: '折叠' })
await L.waitMs(400)
C.check('折叠后显示右缘展开把手', (await L.q('.ad-toggle.expand')) > 0)
const collapsedW = await js(`document.querySelector('.annotation-drawer') ? document.querySelector('.annotation-drawer').getBoundingClientRect().width : -1`)
C.check('折叠态不占布局宽度（0px）', collapsedW === 0)
const btnH = await js(`document.querySelector('.ad-toggle.expand') ? document.querySelector('.ad-toggle.expand').getBoundingClientRect().height : 9999`)
C.check('把手为小尺寸（非整条竖栏）', btnH > 0 && btnH < 100)
const btnNum = await js(`(() => { const b = document.querySelector('.ad-toggle.expand'); const n = b ? b.querySelector('.ad-toggle-num') : null; return n ? n.textContent : '' })()`)
C.check('把手上显示批注数量数字（2）', btnNum === '2')
const connGone = await js(`(() => { const svg = document.querySelector('.annotation-connector'); return svg ? getComputedStyle(svg).display : 'none' })()`)
C.check('折叠后连线隐藏', connGone === 'none')

// 9. 再次展开：宽度恢复到保存值（回归：折叠动画曾把 width 污染为 0 → 内容缩到右缘不可见）
await L.clickEl('.ad-toggle.expand', 0, { label: '再次展开' })
await L.waitMs(600)
const w2 = await js(`(() => { const d = document.querySelector('.annotation-drawer.open'); return d ? Math.round(d.getBoundingClientRect().width) : -1 })()`)
C.check('再次展开后抽屉恢复宽度（>0 并可读）', w2 > 0)
const cardsAgain = await js(`(() => { const d = document.querySelector('.annotation-drawer.open'); if (!d) return -1; const r = d.getBoundingClientRect(); const head = d.querySelector('.ad-card .ad-card-head'); return head ? (head.getBoundingClientRect().left + head.getBoundingClientRect().width / 2 < window.innerWidth) : -1 })()`)
C.check('再次展开后卡片中心在视口内（不缩到右边外）', cardsAgain === true)

cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
