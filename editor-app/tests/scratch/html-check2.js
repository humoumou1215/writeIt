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
    const ed = window.__editorDebug();
    const out = { nodeTypes: [], rendered: null };
    ed.action((ctx) => {
      const { editorViewCtx } = window;
    });
    // 从最后一段找节点
    const pm = document.querySelector('.ProseMirror');
    const paras = pm.querySelectorAll('p');
    const last = paras[paras.length - 1];
    return {
      lastParaText: last ? last.textContent : null,
      lastParaHTML: last ? last.innerHTML.slice(0, 200) : null,
    };
  });
  console.log('最后段 textContent:', JSON.stringify(st.lastParaText));
  console.log('最后段 innerHTML:', JSON.stringify(st.lastParaHTML));
  await browser.close();
})();
