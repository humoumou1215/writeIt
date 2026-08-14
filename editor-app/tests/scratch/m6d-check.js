const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 150)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  const note = JSON.stringify([{ a: '我', c: '原始评论', t: Date.now() - 60000, r: 0 }]).replace(/"/g, '&quot;');
  await page.evaluate((noteVal) => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/周报.md'] = 'doctype:demo\n\n# 周报\n\n<mark data-note="' + noteVal + '">本周进展</mark> 已同步。\n\n## 版本\n\nv0.2.1\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  }, note);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(6000);
  const ta = page.locator('.ad-reply textarea');
  // 1. Enter 换行不提交
  await ta.fill('第一行');
  await ta.press('Enter');
  await ta.press('Enter');
  await page.waitForTimeout(500);
  const valAfterEnter = await ta.inputValue();
  console.log('Enter 后 textarea 值（应含换行）:', JSON.stringify(valAfterEnter));
  // 2. Ctrl+Enter 提交
  await ta.fill('第二行内容');
  await ta.press('Control+Enter');
  await page.waitForTimeout(1200);
  const contents = await page.evaluate(() => Array.from(document.querySelectorAll('.ad-comment-content')).map(c => c.textContent));
  console.log('Ctrl+Enter 后评论:', JSON.stringify(contents));
  // 3. ESC 清空
  await ta.fill('待取消内容');
  await ta.press('Escape');
  await page.waitForTimeout(300);
  const valAfterEsc = await ta.inputValue();
  console.log('ESC 后 textarea 值（应为空）:', JSON.stringify(valAfterEsc));
  await browser.close();
})();
