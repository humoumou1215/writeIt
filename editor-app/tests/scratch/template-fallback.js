const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { if (m.text().includes('[mock-fs]')) console.log('LOG:', m.text().slice(0, 140)); });
  await page.goto('http://localhost:5173/');
  // 模拟用户数据：seededVersion=2 但缺 template 文件
  await page.evaluate(() => {
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify({
      seeded: true,
      seededVersion: 2,
      dirs: ['笔记', '数据'],
      files: {
        'README.md': '# 旧 README',
        '笔记/会议记录.md': '# 旧会议',
        '引用演示.md': '# 旧演示',
      },
    }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const d = window.__mockFsDebug();
    const tree = Array.from(document.querySelectorAll('.tree .name')).map(n => n.textContent.trim());
    return { debug: d, treeHasTemplate: tree.some(t => t === 'template') };
  });
  console.log('兜底后:', JSON.stringify(r.debug));
  console.log('树含 template:', r.treeHasTemplate);
  await browser.close();
})();
