const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '会议记录.md' }).click();
  await page.waitForTimeout(2500);
  // 滚动编辑器到中部
  await page.evaluate(() => { const pane = document.querySelector('.editor-pane'); pane.scrollTop = 300; });
  await page.waitForTimeout(500);
  const seam = await page.evaluate(() => {
    // 检查 tabbar 底部到 topbar 之间的区域是否有内容渗出
    const tabbar = document.querySelector('.tabbar').getBoundingClientRect();
    const topbar = document.querySelector('.milkdown-top-bar').getBoundingClientRect();
    const gap = topbar.top - tabbar.bottom;
    // 检查贴缝处元素
    const elAtSeam = document.elementFromPoint(700, tabbar.bottom + gap / 2);
    return {
      tabbarBottom: Math.round(tabbar.bottom),
      topbarTop: Math.round(topbar.top),
      gap: Math.round(gap),
      seamEl: elAtSeam?.className || elAtSeam?.tagName,
      topbarSticky: Math.round(topbar.top), // sticky 后仍在 36
    };
  });
  console.log(JSON.stringify(seam, null, 1));
  await page.screenshot({ path: '/media/writeIt/editor-app/demo-shots/08-标签栏配色与无缝.png' });
  await browser.close();
})();
