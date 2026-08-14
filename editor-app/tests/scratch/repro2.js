const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 160)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(5000);

  // ---- 场景 A：目标未打开，点击标题引用跳转 ----
  const f1 = page.locator('a.ref-file[data-fragment="2026-08-11 周会"]').first();
  console.log('场景A 标题链接存在:', await f1.count() > 0);
  await f1.click();
  await page.waitForTimeout(2500);
  let st = await page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll('.editor-pane')).find(p => getComputedStyle(p).display !== 'none');
    const pm = visible?.querySelector('.ProseMirror');
    const head = pm ? Array.from(pm.querySelectorAll('h1,h2,h3')).find(h => h.textContent.trim() === '2026-08-11 周会') : null;
    return { tabs: Array.from(document.querySelectorAll('.tabbar .tab-name')).map(t => t.textContent.trim()), headTop: head ? Math.round(head.getBoundingClientRect().top) : null, paneH: visible?.clientHeight };
  });
  console.log('场景A（未打开→点击）:', JSON.stringify(st));

  // ---- 场景 B：目标已打开，再点引用跳转 ----
  await page.locator('.icon-col .icon-btn').first().click();  // 展开侧边栏
  await page.waitForTimeout(400);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();  // 展开笔记
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '会议记录.md' }).click();
  await page.waitForTimeout(4000);
  // 回到引用演示
  await page.locator('.tabbar .tab', { hasText: '引用演示' }).click();
  await page.waitForTimeout(1500);
  const f2 = page.locator('a.ref-file[data-fragment="2026-08-11 周会"]').first();
  await f2.click();
  await page.waitForTimeout(2500);
  st = await page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll('.editor-pane')).find(p => getComputedStyle(p).display !== 'none');
    const pm = visible?.querySelector('.ProseMirror');
    const head = pm ? Array.from(pm.querySelectorAll('h1,h2,h3')).find(h => h.textContent.trim() === '2026-08-11 周会') : null;
    return { tabs: Array.from(document.querySelectorAll('.tabbar .tab-name')).map(t => t.textContent.trim()), headTop: head ? Math.round(head.getBoundingClientRect().top) : null };
  });
  console.log('场景B（已打开→点击）:', JSON.stringify(st));
  await browser.close();
})();
