const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 新建空文件
  await page.locator('.sidebar-actions .mini', { hasText: '＋文件' }).click();
  await page.waitForTimeout(400);
  await page.locator('.tree .rename-input').fill('短测试.md');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  // 输入几行内容（光标在末尾，可见）
  await page.keyboard.type('第一行内容\n第二行内容\n第三行内容\n第四行内容\n第五行内容\n第六行内容\n第七行内容\n第八行内容\n第九行内容\n第十行内容\n第十一行内容\n第十二行内容');
  await page.waitForTimeout(600);
  const cur = await page.evaluate(() => {
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    return { top: Math.round(r.top), vh: window.innerHeight, onScreen: r.top > 0 && r.top < window.innerHeight - 30 };
  });
  console.log('光标:', JSON.stringify(cur));
  await page.keyboard.type(' @');
  await page.waitForTimeout(1200);
  const menu = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu][data-show="true"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight, onScreen: r.top >= 0 && r.bottom <= window.innerHeight };
  });
  console.log('菜单:', JSON.stringify(menu));
  console.log(menu ? (menu.top < cur.top ? '→ 在光标上方（翻转）' : '→ 在光标下方') : '菜单未打开');
  console.log(menu && menu.onScreen ? '✅ 在屏幕内' : '❌ 出屏');
  await browser.close();
})();
