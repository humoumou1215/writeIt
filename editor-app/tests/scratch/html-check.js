const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  // 粘贴含 <mark data-note> 的文本
  await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror');
    pm.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', '测试 <mark data-note="评论内容">锚定文本</mark> 结尾');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    pm.dispatchEvent(ev);
  });
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    const pm = document.querySelector('.ProseMirror');
    return {
      md: md.slice(-200),
      hasMark: !!pm.querySelector('mark'),
      bodyHTML: pm.innerHTML.slice(-300),
    };
  });
  console.log('getMarkdown 尾部:', JSON.stringify(st.md));
  console.log('DOM 有 mark:', st.hasMark);
  await browser.close();
})();
