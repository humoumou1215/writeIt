// mermaid-zoom-e2e —— Mermaid 预览放大查看：悬停放大镜 → Lightbox 放大 → ESC/✕/遮罩关闭 → 缩放/复位
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js mermaid-zoom-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('mermaid-zoom-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

// 打开 Mermaid 图表集（根文件）
await L.clickText('.tree .name', 'Mermaid 图表集.md', { label: '打开图表集' })
await L.waitMs(3000)

// 1. 渲染结果被包裹：.mmd-zoomable 内含 svg + 放大镜按钮
await waitForElement('.mmd-zoomable', { timeout: 15 }).catch(() => {})
const wraps = await L.q('.mmd-zoomable')
C.check('预览被 .mmd-zoomable 包裹（≥1）', wraps >= 1)
const btnCount = await L.q('.mmd-zoomable .mmd-zoom-btn')
C.check('每个包裹层带放大镜按钮', btnCount === wraps)
const hasSvg = await js(`(() => { const e = document.querySelector('.mmd-zoomable > svg'); return !!e && e.getClientRects().length > 0 })()`)
C.check('包裹层内是渲染出的 SVG', hasSvg)

// 2. 未悬停时按钮隐藏（opacity 0），悬停后显示
const opacityBefore = await js(`getComputedStyle(document.querySelector('.mmd-zoomable .mmd-zoom-btn')).opacity`)
C.check('未悬停时放大镜按钮 opacity=0', opacityBefore === '0')
await L.hoverEl('.mmd-zoomable', 0)
await L.waitMs(300)
const opacityAfter = await js(`getComputedStyle(document.querySelector('.mmd-zoomable .mmd-zoom-btn')).opacity`)
C.check('悬停预览后放大镜按钮显示（opacity=1）', opacityAfter === '1')

// 3. 点击放大镜 → Lightbox 打开
await L.clickEl('.mmd-zoomable .mmd-zoom-btn', 0, { label: '点放大镜' })
await L.waitMs(400)
C.check('点击后 Lightbox 打开', (await L.q('.mmd-lightbox')) === 1)
C.check('Lightbox 画布内是 SVG', (await L.q('.mmd-lightbox-canvas > svg')) === 1)
C.check('Lightbox 有关闭按钮', (await L.q('.mmd-lightbox-close')) === 1)
const transform = await js(`document.querySelector('.mmd-lightbox-canvas').style.transform`)
C.check('画布应用了 translate+scale 变换', /translate\(.+\) scale\(/.test(transform))

// 4. ESC 关闭
await L.press('Escape')
await L.waitMs(300)
C.check('ESC 关闭 Lightbox', (await L.q('.mmd-lightbox')) === 0)

// 5. 点 ✕ 关闭
await L.clickEl('.mmd-zoomable .mmd-zoom-btn', 0, { label: '点放大镜' })
await L.waitMs(300)
await L.clickEl('.mmd-lightbox-close', 0, { label: '点✕' })
await L.waitMs(300)
C.check('点 ✕ 关闭 Lightbox', (await L.q('.mmd-lightbox')) === 0)

// 6. 点遮罩空白处关闭
await L.clickEl('.mmd-zoomable .mmd-zoom-btn', 0, { label: '点放大镜' })
await L.waitMs(300)
await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 30, y: 30, button: 'left', clickCount: 1 })
await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 30, y: 30, button: 'left', clickCount: 1 })
await L.waitMs(300)
C.check('点遮罩空白处关闭 Lightbox', (await L.q('.mmd-lightbox')) === 0)

// 7. 滚轮缩放 + 双击复位
await L.clickEl('.mmd-zoomable .mmd-zoom-btn', 0, { label: '点放大镜' })
await L.waitMs(300)
const scaleOf = () => js(`(() => { const m = /scale\\(([\\d.]+)\\)/.exec(document.querySelector('.mmd-lightbox-canvas').style.transform); return m ? parseFloat(m[1]) : 0 })()`)
const before = await scaleOf()
await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 350, deltaX: 0, deltaY: -120 })
await L.waitMs(200)
const after = await scaleOf()
C.check('滚轮向上缩放变大', after > before + 0.01)
await L.dblClickEl('.mmd-lightbox-canvas', 0)
await L.waitMs(200)
const reset = await scaleOf()
C.check('双击复位到适配缩放', Math.abs(reset - before) < 0.001)

// 8. 拖拽平移
const posOf = () => js(`(() => { const m = /translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/.exec(document.querySelector('.mmd-lightbox-canvas').style.transform); return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null })()`)
const posBefore = await posOf()
await dragMouse([[700, 350], [780, 400]], { label: '拖拽平移' })
await L.waitMs(200)
const posAfter = await posOf()
C.check('拖拽后画布平移', posBefore && posAfter && posAfter.x > posBefore.x + 40 && posAfter.y > posBefore.y + 20)
C.check('拖拽结束不触发关闭（仍在 Lightbox 内）', (await L.q('.mmd-lightbox')) === 1)
await L.press('Escape')

cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail > 0 ? 1 : 0)
