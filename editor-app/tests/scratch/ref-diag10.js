const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  const ls = await page.evaluate(() => {
    const raw = localStorage.getItem('milkdown-note-mock-fs-v1');
    if (!raw) return { has: false };
    const d = JSON.parse(raw);
    return { has: true, readme: d.files['README.md']?.slice(0, 60), todo: d.files['笔记/待办清单.md']?.slice(0, 60) };
  });
  console.log('localStorage mock:', JSON.stringify(ls, null, 1));
  await browser.close();
})();
