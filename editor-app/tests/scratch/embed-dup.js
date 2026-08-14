const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(5000);
  // 引用演示已有待办清单块（中部）。在文档开头插入新的待办清单嵌入
  await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror');
    pm.focus();
    // 光标移到文档开头
    window.__editorGoStart ? window.__editorGoStart() : null;
  });
  // 用 Control+Home 到开头
  await page.keyboard.press('Control+Home');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('![[待办清单');
  await page.waitForTimeout(900);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.ref-file-block'));
    return cards.map(c => ({
      path: c.querySelector('.ref-file-block-path')?.textContent,
      len: c.querySelector('.ref-file-block-content')?.textContent?.length ?? 0,
    }));
  });
  console.log('重复插入后所有卡片:', JSON.stringify(st));
  const allFilled = st.filter(c => c.path === '笔记/待办清单').every(c => c.len > 0);
  console.log(allFilled ? '✅ 所有待办清单块都物化' : '❌ 有块未物化');
  await browser.close();
})();
