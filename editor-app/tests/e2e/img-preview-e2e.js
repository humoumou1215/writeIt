// 图片预览/定位/资源管理器 交互验证
// 运行：node tests/e2e/_run-one.js img-preview-e2e
// 覆盖：①右键图片（完整序列不闪烁）→ 定位/资源管理器 ②点击图片→预览（滚轮缩放/触摸板 pinch/拖拽/无按钮/Esc）
//       ③悬停放大镜（右上角 caption 隔壁，风格一致）④inline 图片同支持
const C = L.newChecker()
const task = await L.acquireTaskSpace('img-preview-e2e')
await L.installErrors()


const imgSel = '.milkdown .milkdown-image-block img, .milkdown .milkdown-image-inline img'
const jsDown = (button) => js(`(() => {
  const img = document.querySelector('${imgSel}')
  if (!img) return false
  img.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: ${button} }))
  return true
})()`)
const fullRightClick = () => js(`(() => {
  const img = document.querySelector('${imgSel}')
  if (!img) return false
  img.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2 }))
  img.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 2 }))
  img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
  return true
})()`)

// ---------- 准备：mock + 注入真实 PNG + 引用文档（block 图 + inline 图各一） ----------
await L.freshApp('http://localhost:5173/?backend=mock')
await js(`localStorage.removeItem('milkdown-note-settings-v1')`)
await L.reloadApp(2000)
await js(`(() => {
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#d33'; ctx.fillRect(0, 0, 64, 64)
  ctx.fillStyle = '#fff'; ctx.fillRect(16, 16, 32, 32)
  fs.binaries = fs.binaries || {}
  fs.binaries['images/sample.png'] = canvas.toDataURL('image/png').split(',')[1]
  fs.files['图片预览测试.md'] = '# 图片预览测试\\n\\n![示例图](images/sample.png)\\n\\n内嵌文字图片 ![内嵌](images/sample.png) 尾部。\\n'
  localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
})()`)
await L.reloadApp(2500)
await L.treeClick('图片预览测试.md', 200)
let imgOk = false
for (let i = 0; i < 12; i++) {
  await L.waitMs(1000)
  if (await js(`!!document.querySelector('.milkdown-image-block img')`)) { imgOk = true; break }
}
C.check('block 图片已渲染', imgOk)
C.check('inline 图片已渲染', await js(`!!document.querySelector('.milkdown-image-inline img')`))

// ---------- ③ 悬停 → 放大镜（右上角 caption 隔壁） ----------
if (imgOk) {
  await js(`(() => { const img = document.querySelector('.milkdown-image-block img'); img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return true })()`)
  await L.waitMs(400)
  const zoomGeom = await js(`(() => {
    const b = document.querySelector('.writeit-img-zoom')
    if (!b) return null
    const r = b.getBoundingClientRect()
    const img = document.querySelector('.milkdown-image-block img').getBoundingClientRect()
    const op = document.querySelector('.milkdown-image-block .operation-item')
    const or = op ? op.getBoundingClientRect() : null
    return { w: r.width, x: r.x, imgRight: img.right, opRight: or ? or.right : null, opTop: or ? or.top : null, top: r.top }
  })()`)
  C.check('悬停 → 放大镜出现（32px 圆形）', !!(zoomGeom && Math.round(zoomGeom.w) === 32))
  C.check('放大镜位于右上角（caption 图标右侧隔壁）', !!(zoomGeom && zoomGeom.opRight != null && zoomGeom.x >= zoomGeom.opRight - 2))
  // 点放大镜 → 预览
  await js(`(() => { const b = document.querySelector('.writeit-img-zoom'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true })()`)
  await L.waitMs(600)
  C.check('放大镜点击 → 预览打开', (await L.q('.imgpv-mask')) > 0)
  C.check('预览无按钮（仅 Esc 关闭）', (await L.q('.imgpv-btn')) === 0 && (await L.q('.imgpv-close')) === 0)

  // ---------- 预览滚轮缩放 + 触摸板 pinch + 拖拽 + 双击还原 ----------
  await js(`(() => { document.querySelector('.imgpv-mask').dispatchEvent(new WheelEvent('wheel', { deltaY: -160, bubbles: true, cancelable: true })); return true })()`)
  await L.waitMs(250)
  const wheelZoom = await js(`(() => { const t = getComputedStyle(document.querySelector('.imgpv-img')).transform; const m = /matrix\\(([-\\d.]+)/.exec(t) || /scale\\(([\\d.]+)\\)/.exec(t); return m ? Math.abs(parseFloat(m[1])) : 0 })()`)
  C.check('滚轮上滚 → 图片放大（scale>1）', wheelZoom > 1)
  await js(`(() => { document.querySelector('.imgpv-mask').dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true })); return true })()`)
  await L.waitMs(250)
  const pinchScale = await js(`(() => { const t = getComputedStyle(document.querySelector('.imgpv-img')).transform; const m = /matrix\\(([-\\d.]+)/.exec(t) || /scale\\(([\\d.]+)\\)/.exec(t); return m ? Math.abs(parseFloat(m[1])) : 0 })()`)
  C.check('触摸板两指 pinch（ctrlKey+wheel）继续放大', pinchScale > wheelZoom)
  // 分步派发 pointer 事件（Vue 响应式 DOM 更新是异步 flush，需拆分等待）
  const panBefore = await js(`getComputedStyle(document.querySelector('.imgpv-img')).transform`)
  await js(`(() => {
    const mask = document.querySelector('.imgpv-mask')
    const r = mask.getBoundingClientRect()
    mask.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2, pointerId: 1, button: 0, buttons: 1 }))
    return true
  })()`)
  await L.waitMs(150)
  await js(`(() => {
    const mask = document.querySelector('.imgpv-mask')
    const r = mask.getBoundingClientRect()
    mask.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + r.width/2 + 60, clientY: r.y + r.height/2 + 30, pointerId: 1, button: 0, buttons: 1 }))
    return true
  })()`)
  await L.waitMs(150)
  const panAfter = await js(`getComputedStyle(document.querySelector('.imgpv-img')).transform`)
  await js(`(() => {
    const mask = document.querySelector('.imgpv-mask')
    const r = mask.getBoundingClientRect()
    mask.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.x + r.width/2 + 60, clientY: r.y + r.height/2 + 30, pointerId: 1, button: 0, buttons: 0 }))
    return true
  })()`)
  cliLog('PAN=' + JSON.stringify({ before: panBefore, after: panAfter }))
  C.check('拖拽平移视窗（transform 变化）', panBefore !== panAfter)
  await js(`(() => { document.querySelector('.imgpv-mask').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true })()`)
  await L.waitMs(200)
  C.check('双击还原（scale 回 1）', (await js(`(() => { const t = getComputedStyle(document.querySelector('.imgpv-img')).transform; const m = /matrix\\(([-\\d.]+)/.exec(t) || /scale\(([\\d.]+)\)/.exec(t); return m ? Math.abs(parseFloat(m[1])) : 0 })()`)) <= 1.001)
  await L.press('Escape')
  await L.waitMs(400)
  C.check('Esc 关闭预览', (await L.q('.imgpv-mask')) === 0)
  await L.focusEditor()
}

// ---------- ② 左键点击图片 → 预览 ----------
if (imgOk) {
  C.check('左键点击图片 → 预览打开', await jsDown(0))
  await L.waitMs(600)
  C.check('预览已显示', (await L.q('.imgpv-mask')) > 0)
  C.check('预览栏显示文件名+路径', (await L.txt('.imgpv-mask')).includes('sample.png') && (await L.txt('.imgpv-mask')).includes('images/sample.png'))
  await L.press('Escape')
  await L.waitMs(400)
}

// ---------- ① 右键图片：完整序列，菜单不闪烁 + 定位/资源管理器 ----------
if (imgOk) {
  C.check('右键（完整序列）→ 菜单弹出', await fullRightClick())
  await L.waitMs(300)
  const menuText = await L.txt('.rm-menu')
  C.check('图片菜单三项（预览/定位/资源管理器）', menuText.includes('预览图片') && menuText.includes('在文件树中定位') && menuText.includes('在文件浏览器中打开'))
  await L.waitMs(500)
  C.check('菜单 500ms 后仍在（不闪烁消失）', (await L.q('.rm-menu')) > 0 && (await L.txt('.rm-menu')).includes('在文件树中定位'))
  await L.clickText('.rm-menu .rm-item', '在文件树中定位')
  await L.waitMs(800)
  C.check('右键「在文件树中定位」→ 文件树高亮', (await js(`(() => { const d = document.querySelector('.tree [data-path="images/sample.png"]'); return !!(d && d.className.includes('revealed')) })()`)))
  await fullRightClick()
  await L.waitMs(500)
  await L.clickText('.rm-menu .rm-item', '在文件浏览器中打开')
  await L.waitMs(600)
  C.check('右键「在文件浏览器中打开」mock 提示', (await L.txt('body')).includes('该功能仅在桌面应用中可用'))
}

// ---------- ④ inline 图片同支持 ----------
if (imgOk) {
  const inlineOver = await js(`(() => {
    document.querySelectorAll('.milkdown-image-inline img').forEach(i => i.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    return !!document.querySelector('.writeit-img-zoom')
  })()`)
  C.check('inline 图片悬停也出放大镜', inlineOver)
  await js(`(() => { const b = document.querySelector('.writeit-img-zoom'); if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true })()`)
  await L.waitMs(500)
  C.check('inline 放大镜 → 预览打开', (await L.q('.imgpv-mask')) > 0)
  await L.press('Escape')
  await L.waitMs(300)
  C.check('inline 区块左键点击也预览', await js(`(() => {
    const img = document.querySelector('.milkdown-image-inline img')
    if (!img) return false
    img.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    return true
  })()`))
  await L.waitMs(500)
  C.check('inline 预览显示', (await L.q('.imgpv-mask')) > 0)
  await L.press('Escape')
  await L.waitMs(300)
}

cliLog('errors=' + JSON.stringify(await L.errors()))
C.check('无 JS 错误', (await L.errors()).length === 0)
cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
