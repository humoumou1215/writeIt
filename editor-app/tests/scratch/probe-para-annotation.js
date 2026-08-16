// debug：段落批注锚点文本
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/mermaid批注测试.md'] = 'doctype:demo\n\n# Mermaid 批注测试\n\n```mermaid\ngraph TD\n    A[开始] --> B[结束]\n```\n\n普通段落文本。\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.mini.pin').first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: 'mermaid批注测试.md' }).click();
  await page.waitForTimeout(6000);

  const p = page.locator('.ProseMirror p', { hasText: '普通段落文本' }).first();
  const pbox = await p.boundingBox();
  console.log('段落 box:', JSON.stringify(pbox));
  if (pbox) {
    await page.mouse.move(pbox.x + 10, pbox.y + pbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(pbox.x + 90, pbox.y + pbox.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const sel = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    console.log('选中文本:', JSON.stringify(sel));
    await page.keyboard.press('Control+r');
    await page.waitForTimeout(700);
    const input2 = await page.locator('.annotation-input-visible').count();
    console.log('浮窗:', input2);
    if (input2) {
      await page.locator('.annotation-input-ta').fill('段落批注');
      await page.locator('.annotation-input-ta').press('Enter');
      await page.waitForTimeout(1500);
      const md = await page.evaluate(() => window.__editorGetMarkdown());
      console.log('=== md ===');
      console.log(md);
    }
  }
  await browser.close();
})();
