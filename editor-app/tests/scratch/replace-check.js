const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[Mermaid');
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const collapsed = await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'));
  if (collapsed) { await page.locator('.icon-col .icon-btn').first().click(); await page.waitForTimeout(400); }
  await page.locator('.tree .name', { hasText: 'Mermaid 图表集.md' }).click({ button: 'right' });
  await page.waitForTimeout(400);
  await page.locator('.menu-item.danger', { hasText: '删除' }).click();
  await page.waitForTimeout(400);
  await page.locator('.modal .danger').click();
  await page.waitForTimeout(1500);
  await page.locator('a.ref-file.ref-broken').first().click();
  await page.waitForTimeout(800);
  await page.keyboard.type('待办');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  // 检查残留断链元素
  const info = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.ref-broken'));
    return els.map(el => ({
      tag: el.tagName,
      path: el.getAttribute('data-path'),
      cls: el.className,
      html: el.outerHTML.slice(0, 150),
    }));
  });
  console.log('残留断链元素:', JSON.stringify(info, null, 1));
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  console.log('md 含 Mermaid:', md.includes('Mermaid'));
  await browser.close();
})();
