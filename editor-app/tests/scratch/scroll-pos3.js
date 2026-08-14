const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  page.on('console', (m) => { if (m.text().includes('[click]')) console.log('LOG:', m.text().slice(0, 130)); });
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
    const tabs = Array.from(document.querySelectorAll('.tabbar .tab')).map(t => ({ name: t.textContent.trim(), active: t.classList.contains('active') }));
    const visible = Array.from(document.querySelectorAll('.editor-pane')).find(p => p.offsetParent !== null);
    const pm = visible?.querySelector('.ProseMirror');
    return {
      tabs,
      pmTextLen: pm?.textContent.length ?? 0,
      pmHead: pm?.textContent.slice(0, 30),
      headings: pm ? Array.from(pm.querySelectorAll('h1,h2,h3')).map(h => h.textContent.trim()) : [],
      paneScrollH: visible?.scrollHeight,
      paneClientH: visible?.clientHeight,
    };
  });
  console.log('状态:', JSON.stringify(st, null, 1));
  await browser.close();
})();
