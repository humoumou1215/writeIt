// 截图 icon-preview.html（ego-lite 驱动，【禁止 playwright】）
// 运行：PATH="$HOME/.local/bin:$PATH" ego-browser nodejs < scripts/shoot-icons.mjs
// 输出到 editor-app/demo-shots/（浅色全页 / 深色全页 / 三套 hover 特写 / 设置齿轮特写）
const path = (await import('node:path')).default
// ego-browser 的 helper 进程 cwd=/，这里用编辑器应用绝对路径（本仓库固定位置）
const BASE = '/Users/huyongsheng/project/writeIt/editor-app'
const pageUrl = 'file://' + path.join(BASE, 'icon-preview.html')
const out = path.join(BASE, 'demo-shots')

const task = await useOrCreateTaskSpace('shoot-icons-' + Date.now() % 100000)
await openOrReuseTab(pageUrl, { wait: true, timeout: 30 })
await wait(1)

await captureScreenshot(path.join(out, '20-图标选型-浅色全页.png'))

// 深色全页
await js(`document.documentElement.classList.add('dark')`)
await wait(0.6)
await captureScreenshot(path.join(out, '21-图标选型-深色全页.png'))

// hover 特写：三套的「Git」图标（展示 hover 态 + 流动动画）
for (const [set, name] of [['line', 'git'], ['soft', 'git'], ['gradient', 'git']]) {
  const sel = `.set-card[data-set="${set}"] .cell .icon[data-name="${name}"]`
  await hover(sel)
  await wait(0.8)
  const box = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x - 40, y: r.y - 40, w: r.width + 80, h: r.height + 80 } })()`)
  if (box) {
    await captureScreenshot(path.join(out, `22-图标选型-${set}-hover.png`), { clip: { x: box.x, y: box.y, width: box.w, height: box.h } })
  }
}

// 设置齿轮特写（旋转动画的中间帧）
for (const set of ['line', 'soft', 'gradient']) {
  const sel = `.set-card[data-set="${set}"] .cell .icon[data-name="settings"]`
  await hover(sel)
  await wait(1)
  const box = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x - 40, y: r.y - 40, w: r.width + 80, h: r.height + 80 } })()`)
  if (box) {
    await captureScreenshot(path.join(out, `23-图标选型-${set}-设置-hover.png`), { clip: { x: box.x, y: box.y, width: box.w, height: box.h } })
  }
}

await completeTaskSpace(task.id, { keep: false })
cliLog('done')
