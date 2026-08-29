// tabbar-overflow-e2e —— 标签栏布局回归：tab 独立滚动区 / 溢出时右端固定控件不被挤出 /
//                      滚轮横向滚动 / 溢出后最后一个标签仍可点击
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js tabbar-overflow-e2e
// 注意：Crepe 实例多标签常驻，页面主线程较重 → 等待均做容错轮询，避免 Runtime.evaluate 竞态。
const C = L.newChecker()

const task = await L.acquireTaskSpace('tabbar-overflow-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

// 1. 结构：标签包在独立滚动区内（与窗口控制按钮分离布局的前提）
C.check('标签滚动区存在', (await L.q('.tab-scroll')) === 1)
const bar0 = await js(`(() => { const b = document.querySelector('.tabbar'); return b.scrollWidth - b.clientWidth })()`).catch(() => -1)
C.check('标签栏整体不横向溢出', bar0 === 0)

// 2. 连续打开 12 个标签（Alt+↓ 依次打开文件树中的下一个可编辑文件）。
//    每次按键后等标签数实际增长再按下一次（编辑器实例初始化较重，超时容错）
const GOAL = 12
for (let i = 1; i <= GOAL; i++) {
  await L.press('Alt+ArrowDown')
  let ok = false
  for (let k = 0; k < 50 && !ok; k++) {
    await L.waitMs(300)
    const n = await L.q('.tab').catch(() => 0)
    if (n >= i) ok = true
  }
  if (!ok) cliLog('[warn] 第 ' + i + ' 个标签打开超时')
}
const tabCount = await L.q('.tab').catch(() => 0)
C.check(`已打开 ${tabCount} 个标签`, tabCount >= 12)

// 3. 标签溢出 → 滚动区可横向滚动；标签栏整体仍不溢出（右端固定控件不被挤出）
const overflow = await js(`(() => { const el = document.querySelector('.tab-scroll'); return el.scrollWidth - el.clientWidth })()`).catch(() => 0)
C.check('滚动区标签溢出量 > 0', overflow > 0)
const barAfter = await js(`(() => { const b = document.querySelector('.tabbar'); return b.scrollWidth - b.clientWidth })()`).catch(() => -1)
C.check('溢出不外溢到标签栏本体（右端控件固定）', barAfter === 0)

// 4. 滚轮 → 横向滚动（隐藏滚动条后的兜底交互）
await js(`(() => { const el = document.querySelector('.tab-scroll'); el.scrollLeft = 0; return el.scrollWidth })()`).catch(() => {})
await L.waitMs(200)
const rbox = await js(`(() => { const r = document.querySelector('.tab-scroll').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`).catch(() => null)
if (rbox) {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(rbox.x + rbox.w - 60), y: Math.round(rbox.y + rbox.h / 2), deltaY: 900, deltaX: 0 })
  await L.waitMs(400)
  const scAfter = await js(`document.querySelector('.tab-scroll').scrollLeft`).catch(() => 0)
  C.check('滚轮横向滚动生效', scAfter > 0)
} else {
  C.check('滚轮横向滚动生效（无法定位滚动区）', false)
}

// 5. 溢出后最后一个标签仍可点击激活（纯坐标点击 + 轮询激活结果）
const lastRect = await js(`(() => {
  const ts = [...document.querySelectorAll('.tab')]
  const e = ts[ts.length - 1]
  e.scrollIntoView({ block: 'nearest', inline: 'end' })
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth }
})()`).catch(() => null)
if (lastRect && lastRect.w > 0) {
  const cx = Math.round(lastRect.x + Math.min(lastRect.w / 2, 40))
  const cy = Math.round(lastRect.y + lastRect.h / 2)
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 })
  let activated = false
  for (let k = 0; k < 30 && !activated; k++) {
    await L.waitMs(350)
    activated = await js(`(() => { const ts = [...document.querySelectorAll('.tab')]; return ts[ts.length - 1].classList.contains('active') })()`).catch(() => false)
  }
  C.check('溢出后最后一个标签可点击激活', activated)
  // 激活切换触发的编辑器装载可能较重，等一下再进入下一步
  await L.waitMs(1500)
} else {
  C.check('溢出后最后一个标签可点击激活（无法定位）', false)
}

// 6. 中键关闭仍可用（回归：关闭/切换不受布局重构影响）——按索引中键关闭第一个标签
const c0 = await L.q('.tab').catch(() => 0)
const firstRect = await js(`(() => { const e = [...document.querySelectorAll('.tab')][0]; e.scrollIntoView({ inline: 'start' }); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`).catch(() => null)
if (firstRect) {
  const mx = Math.round(firstRect.x + 30), my = Math.round(firstRect.y + firstRect.h / 2)
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: mx, y: my, button: 'middle', clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mx, y: my, button: 'middle', clickCount: 1 })
  await L.waitMs(1000)
  const c1 = await L.q('.tab').catch(() => 0)
  C.check('中键关闭第一个标签', c1 === c0 - 1)
} else {
  C.check('中键关闭第一个标签（无法定位）', false)
}

cliLog(C.summary())
const errs = await L.errors()
cliLog('\n== 错误 ==')
cliLog(errs.length ? errs.join('\n') : '(无)')
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail || errs.length ? 1 : 0)