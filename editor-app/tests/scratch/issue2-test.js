const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 开两个标签
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  // 打开文件自动收纳侧边栏 → 重新展开
  await page.locator('.icon-col .icon-btn').first().click();
  await page.waitForTimeout(500);
  await page.locator('.tree .name', { hasText: 'Mermaid 图表集.md' }).click();
  await page.waitForTimeout(4000);
  await page.locator('.icon-col .icon-btn').first().click();
  await page.waitForTimeout(500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(1500);
  // 在引用演示尾部输入 @
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('@');
  await page.waitForTimeout(1000);
  // 菜单第一项（文件条目）
  const items = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu][data-show="true"]');
    return el ? Array.from(el.querySelectorAll('.menu-group li')).map(li => li.textContent.trim()).slice(0, 4) : null;
  });
  console.log('菜单条目:', JSON.stringify(items));
  // 找到 笔记 目录项（第一个 dir）并选中它（ArrowDown 直到 hover 在 dir 上）
  // 这里直接按 Enter 处理第一个条目（应为目录 笔记）
  const mdBefore = await page.evaluate(() => window.__editorGetMarkdown());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu][data-show="true"]');
    const md = window.__editorGetMarkdown();
    return {
      menuOpen: el ? el.getAttribute('data-show') : null,
      firstItem: el?.querySelector('.menu-group li')?.textContent.trim() ?? null,
      docGrew: md.length,
    };
  });
  console.log('按 Enter 后:', JSON.stringify(after), '| doc 原长:', mdBefore.length);
  // 若一次 Enter 就插入了文件（doc 变长），说明双重触发
  const docAfter = await page.evaluate(() => window.__editorGetMarkdown());
  const inserted = docAfter.length > mdBefore.length;
  console.log(inserted ? '❌ 一次 Enter 就插入了内容（双重触发）' : '✅ 一次 Enter 只展开目录');
  await browser.close();
})();
