const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 160)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 模拟用户数据：会议记录加 标题2；引用演示加 [[笔记/会议记录#标题2]] 链接
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/会议记录.md'] = `# 会议记录

## 2026-08-11 周会

- [x] 讨论编辑器方案

## 标题2

这里是标题2的内容，用于测试滚动定位。

## 标题3

更多内容。
`;
    fs.files['引用演示.md'] = fs.files['引用演示.md'] + '\n\n## 跳转测试\n\n点击 [[笔记/会议记录#标题2]] 应滚动到 标题2\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(5000);
  // 滚动到 跳转测试 段落使链接可见，点击
  const link = page.locator('a.ref-file[data-fragment="标题2"]').first();
  await link.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await link.click();
  await page.waitForTimeout(3000);
  const st = await page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll('.editor-pane')).find(p => getComputedStyle(p).display !== 'none');
    const pm = visible?.querySelector('.ProseMirror');
    const heads = pm ? Array.from(pm.querySelectorAll('h1,h2,h3')) : [];
    const t2 = heads.find(h => h.textContent.trim() === '标题2');
    const paneRect = visible?.getBoundingClientRect();
    return {
      tabs: Array.from(document.querySelectorAll('.tabbar .tab-name')).map(t => t.textContent.trim()),
      paneTop: paneRect ? Math.round(paneRect.top) : null,
      paneBottom: paneRect ? Math.round(paneRect.bottom) : null,
      t2Top: t2 ? Math.round(t2.getBoundingClientRect().top) : null,
      t2InView: t2 ? t2.getBoundingClientRect().top >= 0 && t2.getBoundingClientRect().bottom <= window.innerHeight : false,
      paneScroll: visible ? Math.round(visible.scrollTop) : null,
    };
  });
  console.log('滚动结果:', JSON.stringify(st, null, 1));
  await browser.close();
})();
