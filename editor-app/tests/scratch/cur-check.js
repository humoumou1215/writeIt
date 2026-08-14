const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: 'README.md' }).click();
  await page.waitForTimeout(4000);
  const before = await page.evaluate(() => {
    const ed = window.__editorDebug();
    const pm = document.querySelector('.ProseMirror');
    const sel = window.getSelection();
    const r = sel.rangeCount ? sel.getRangeAt(0) : null;
    return {
      pmText: pm?.textContent.slice(0, 30),
      rangeStart: r ? r.startOffset : null,
      rangeEnd: r ? r.endOffset : null,
      pmLen: pm?.textContent.length,
      hasFocus: pm === document.activeElement,
    };
  });
  console.log('打开后选区:', JSON.stringify(before));
  await page.keyboard.type('Z');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror');
    const md = window.__editorGetMarkdown();
    const zPos = md.indexOf('Z');
    return { zPos, mdHead: md.slice(0, 60), pmTail: pm?.textContent.slice(-10) };
  });
  console.log('打 Z 后:', JSON.stringify(after));
  await browser.close();
})();
