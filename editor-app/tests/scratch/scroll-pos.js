const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 构造用户场景：会议记录加 标题2 + 大量 <br />
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    let md = '# 会议记录\n\n## 2026-08-11 周会\n\n- [x] 事项\n\n' + '<br />\n'.repeat(12) + '\n## 标题2\n\n' + '<br />\n'.repeat(12) + '\n内容\n';
    fs.files['笔记/会议记录.md'] = md;
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  // 新建一个含引用的文件
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['跳转测试.md'] = '点这里 [[会议记录#标题2]]\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('.tree .name', { hasText: '跳转测试.md' }).click();
  await page.waitForTimeout(4000);
  await page.locator('a.ref-file[data-fragment="标题2"]').click();
  await page.waitForTimeout(3000);  // 等 smooth 完成
  const st = await page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll('.editor-pane')).find(p => getComputedStyle(p).display !== 'none');
    const pm = visible?.querySelector('.ProseMirror');
    const head = pm ? Array.from(pm.querySelectorAll('h2')).find(h => h.textContent.trim() === '标题2') : null;
    const paneRect = visible?.getBoundingClientRect();
    const headRect = head?.getBoundingClientRect();
    // 滚动容器
    const scrollables = [];
    let p = visible;
    while (p) { if (p.scrollHeight > p.clientHeight + 5) scrollables.push({ cls: p.className, scrollTop: p.scrollTop, max: p.scrollHeight - p.clientHeight }); p = p.parentElement; }
    return {
      paneTop: paneRect ? Math.round(paneRect.top) : null,
      paneBottom: paneRect ? Math.round(paneRect.bottom) : null,
      headTop: headRect ? Math.round(headRect.top) : null,
      scrollables,
      headVisible: headRect ? headRect.top >= 0 && headRect.bottom <= window.innerHeight : false,
    };
  });
  console.log('跳转后:', JSON.stringify(st, null, 1));
  await browser.close();
})();
