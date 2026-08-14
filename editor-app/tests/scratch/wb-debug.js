const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { const t = m.text(); if (t.includes('[writeback]')) console.log('LOG:', t.slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(5000);
  // 不编辑，直接检查块内节点
  const st = await page.evaluate(() => {
    const ed = window.__editorDebug();
    let out = { blockContents: [], md: '' };
    ed.action((ctx) => {
      const { editorViewCtx } = window.__proto__ ? {} : {};
    });
    out.md = window.__editorGetMarkdown();
    const block = Array.from(document.querySelectorAll('.ref-file-block')).find(b => (b.querySelector('.ref-file-block-path')?.textContent || '').includes('待办清单'));
    if (block) {
      const content = block.querySelector('.ref-file-block-content');
      out.blockContents = Array.from(content.querySelectorAll('h1,h2,h3,p,li')).slice(0, 4).map(n => n.tagName + ':' + n.textContent.slice(0, 20));
    }
    return out;
  });
  console.log('块内容节点:', JSON.stringify(st.blockContents));
  console.log('宿主 md 含![[待办:', st.md.includes('![[笔记/待办清单]]'));
  await browser.close();
})();
