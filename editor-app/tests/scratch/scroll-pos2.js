const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/会议记录.md'] = '# 会议记录\n\n## 2026-08-11 周会\n\n- [x] 事项\n\n' + '<br />\n'.repeat(12) + '\n## 标题2\n\n' + '<br />\n'.repeat(12) + '\n内容\n';
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
  await page.waitForTimeout(3000);
  const st = await page.evaluate(() => {
    const panes = Array.from(document.querySelectorAll('.editor-pane'));
    return panes.map(p => {
      const pm = p.querySelector('.ProseMirror');
      const heads = pm ? Array.from(pm.querySelectorAll('h2')).map(h => h.textContent.trim()) : [];
      const head = heads.includes('标题2') ? Array.from(pm.querySelectorAll('h2')).find(h => h.textContent.trim() === '标题2') : null;
      const r = p.getBoundingClientRect();
      const hr = head?.getBoundingClientRect();
      return {
        display: getComputedStyle(p).display,
        cls: p.className,
        tabVisible: p.offsetParent !== null,
        heads: heads.slice(0, 4),
        headTop: hr ? Math.round(hr.top) : null,
        scrollTop: p.scrollTop,
        max: p.scrollHeight - p.clientHeight,
      };
    });
  });
  console.log('所有 pane:', JSON.stringify(st, null, 1));
  await browser.close();
})();
