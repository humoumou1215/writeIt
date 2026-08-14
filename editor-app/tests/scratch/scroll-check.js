const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  page.on('console', (m) => { if (m.text().includes('[scroll]')) console.log('LOG:', m.text().slice(0, 160)); });
  await page.waitForTimeout(2500);
  // 造一个 25 个标题的文件
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    let md = '# 大文件\n';
    for (let i = 1; i <= 25; i++) md += `## 章节 ${i}\n\n内容 ${i}\n\n`;
    fs.files['大文件.md'] = md;
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('[[大文件');
  await page.waitForTimeout(900);
  await page.keyboard.press('Enter');  // 进入实体级（标题列表）
  await page.waitForTimeout(800);
  // 按 ArrowDown 到第 20 项
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => {
    const host = document.querySelector('[data-ref-menu]');
    const root = host?.querySelector('.menu-groups');
    const hover = host?.querySelector('[data-index].hover');
    const rootRect = root?.getBoundingClientRect();
    const hoverRect = hover?.getBoundingClientRect();
    return {
      rootScroll: root?.scrollTop,
      rootH: root?.clientHeight,
      rootScrollH: root?.scrollHeight,
      hover: hover?.textContent.trim(),
      hoverTop: hoverRect ? Math.round(hoverRect.top) : null,
      rootTop: rootRect ? Math.round(rootRect.top) : null,
      rootBottom: rootRect ? Math.round(rootRect.bottom) : null,
      hoverVisible: hoverRect && rootRect ? hoverRect.top >= rootRect.top - 5 && hoverRect.bottom <= rootRect.bottom + 5 : null,
    };
  });
  console.log('实体列表滚动:', JSON.stringify(st, null, 1));
  await browser.close();
})();
