// 截图 icon-preview.html：浅色全页 / 深色全页 / 三套 hover 特写
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const pageUrl = 'file://' + path.join(here, '..', 'icon-preview.html')
const out = path.join(here, '..', 'demo-shots')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 })

await page.goto(pageUrl)
await page.waitForTimeout(600)

// 浅色全页
await page.evaluate(() => document.documentElement.classList.remove('dark'))
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(out, '20-图标选型-浅色全页.png'), fullPage: true })

// 深色全页
await page.evaluate(() => document.documentElement.classList.add('dark'))
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(out, '21-图标选型-深色全页.png'), fullPage: true })

// hover 特写：三套的「Git」图标（展示 hover 态 + 流动动画）
const hoverTargets = [
  ['line', 'git'],
  ['soft', 'git'],
  ['gradient', 'git'],
]
for (const [set, name] of hoverTargets) {
  const sel = `.set-card[data-set="${set}"] .cell .icon[data-name="${name}"]`
  await page.hover(sel, { force: true, noWaitAfter: true })
  await page.waitForTimeout(700) // 等动画进入中间帧
  const box = await page.locator(sel).boundingBox()
  if (box) {
    await page.screenshot({
      path: path.join(out, `22-图标选型-${set}-hover.png`),
      clip: { x: box.x - 40, y: box.y - 40, width: box.width + 80, height: box.height + 80 },
    })
  }
}

// 设置齿轮特写（旋转动画的中间帧）
for (const set of ['line', 'soft', 'gradient']) {
  const sel = `.set-card[data-set="${set}"] .cell .icon[data-name="settings"]`
  await page.hover(sel, { force: true, noWaitAfter: true })
  await page.waitForTimeout(900)
  const box = await page.locator(sel).boundingBox()
  if (box) {
    await page.screenshot({
      path: path.join(out, `23-图标选型-${set}-设置-hover.png`),
      clip: { x: box.x - 40, y: box.y - 40, width: box.width + 80, height: box.height + 80 },
    })
  }
}

await browser.close()
console.log('done')
