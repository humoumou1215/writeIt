const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(5000);
  // 点「会议记录#待办清单」标题链接（跳转标题）
  const tgt = page.locator('a.ref-file[data-fragment="2026-08-11 周会"]').first();
  console.log('找到标题链接:', await tgt.count() > 0);
  await tgt.click();
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => {
    const panes = Array.from(document.querySelectorAll('.editor-pane'));
    const visible = panes.find(p => getComputedStyle(p).display !== 'none');
    const pm = visible?.querySelector('.ProseMirror');
    // 找 待办清单 标题
    const heads = pm ? Array.from(pm.querySelectorAll('h1,h2,h3,h4')) : [];
    const target = heads.find(h => h.textContent.trim() === '2026-08-11 周会');
    const paneRect = visible?.getBoundingClientRect();
    return {
      activeTab: Array.from(document.querySelectorAll('.tabbar .tab-name')).map(t => t.textContent.trim()),
      paneTop: paneRect ? Math.round(paneRect.top) : null,
      paneBottom: paneRect ? Math.round(paneRect.bottom) : null,
      targetTop: target ? Math.round(target.getBoundingClientRect().top) : null,
      paneScroll: visible ? Math.round(visible.scrollTop) : null,
      targetInView: target ? target.getBoundingClientRect().top >= 0 && target.getBoundingClientRect().bottom <= window.innerHeight : false,
    };
  });
  console.log('跳转结果:', JSON.stringify(st, null, 1));
  await browser.close();
})();
