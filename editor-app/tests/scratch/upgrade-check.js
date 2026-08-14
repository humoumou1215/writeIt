const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  // 预置旧格式数据（M3 时代：seeded=true，无 seededVersion，无模板文件）
  await page.goto('http://localhost:5173/');
  await page.evaluate(() => {
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify({
      seeded: true,
      dirs: ['笔记', '数据'],
      files: {
        'README.md': '# 旧 README',
        '笔记/会议记录.md': '# 旧会议',
      },
    }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return {
      seededVersion: data.seededVersion,
      hasTemplateDemoMd: 'template/demo/demo.md' in (data.files || {}),
      hasTemplateSuggest: 'template/demo/demo.suggest.ts' in (data.files || {}),
      files: Object.keys(data.files || {}).length,
    };
  });
  console.log('升级后:', JSON.stringify(st));
  // 展开 template/demo 看树
  await page.locator('.tree .node', { hasText: 'template' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .node', { hasText: 'demo' }).first().click();
  await page.waitForTimeout(500);
  const names = await page.evaluate(() => Array.from(document.querySelectorAll('.tree .name')).map(n => n.textContent.trim()));
  console.log('树 template/demo:', JSON.stringify(names.slice(0, 8)));
  await browser.close();
})();
