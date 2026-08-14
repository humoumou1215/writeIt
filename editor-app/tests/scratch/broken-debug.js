const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.text().includes('[M3]')) console.log(m.text().slice(0, 160)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[不存在的文件');
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  // 检查 broken 装饰相关
  const info = await page.evaluate(async () => {
    const editor = window.__editorDebug();
    const m = await import('/src/editor/ref/app-plugin.ts');
    const exists = await m.refPathExists('不存在的文件');
    // 检查 DOM
    const all = document.querySelectorAll('.ref-broken');
    const chip = document.querySelector('a.ref-file[data-path="不存在的文件"]');
    const chips = Array.from(document.querySelectorAll('a.ref-file')).map(a => a.getAttribute('data-path'));
    const md = window.__editorGetMarkdown ? window.__editorGetMarkdown().slice(-200) : '';
    return {
      exists,
      brokenDom: all.length,
      chips,
      chipHtml: chip ? chip.outerHTML.slice(0, 200) : 'NO CHIP',
      mdTail: md,
    };
  });
  console.log('检查:', JSON.stringify(info, null, 1));
  await browser.close();
})();
