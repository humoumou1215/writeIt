const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror');
    return {
      editable: pm?.isContentEditable,
      contenteditable: pm?.getAttribute('contenteditable'),
      activeIsPm: document.activeElement === pm,
      pmCount: document.querySelectorAll('.ProseMirror').length,
      focusedClass: pm?.classList.contains('ProseMirror-focused'),
      menuRect: (() => { const m = document.querySelector('[data-ref-menu]'); const r = m?.getBoundingClientRect(); return r ? { w: r.width, h: r.height, x: r.x, y: r.y } : null; })(),
      menuDisplay: (() => { const m = document.querySelector('[data-ref-menu]'); return m ? getComputedStyle(m).visibility : null; })(),
    };
  });
  console.log('编辑器状态:', JSON.stringify(info, null, 1));
  const r = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror');
    pm.focus();
    const ok = document.execCommand('insertText', false, 'Q');
    return { ok, text: pm.textContent.slice(-5) };
  });
  console.log('execCommand insertText:', JSON.stringify(r));
  await browser.close();
})();
