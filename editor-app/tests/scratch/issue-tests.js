const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  // ---- 问题1：template/demo 树 ----
  const tplDir = await page.evaluate(() => {
    const names = Array.from(document.querySelectorAll('.tree .name')).map(n => n.textContent.trim());
    return names.filter(n => n.includes('template') || n.includes('demo'));
  });
  console.log('问题1 树中 template 相关:', JSON.stringify(tplDir));

  // ---- 问题3：文档尾部 @ 菜单位置 ----
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    window.__editorGoEnd();
  });
  await page.waitForTimeout(400);
  await page.keyboard.type(' @');
  await page.waitForTimeout(1200);
  const pos = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu][data-show="true"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, show: el.getAttribute('data-show') };
  });
  console.log('问题3 菜单位置:', JSON.stringify(pos));

  // ---- 问题2：Enter 在目录上的行为（两个标签打开，模拟多实例）----
  // 先打开两个标签
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('@');
  await page.waitForTimeout(900);
  // 选 笔记 目录（第一项是 dir 吗？看 entries）
  const firstEntry = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu][data-show="true"]');
    return el ? el.querySelector('li')?.textContent.trim() : null;
  });
  console.log('问题2 菜单第一项:', JSON.stringify(firstEntry));
  // 按 Enter
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const after1 = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu][data-show="true"]');
    const md = window.__editorGetMarkdown();
    return {
      menuVisible: el ? el.getAttribute('data-show') : null,
      li0: el?.querySelector('li')?.textContent.trim() ?? null,
      docTail: md.slice(-40),
    };
  });
  console.log('问题2 按 Enter 后:', JSON.stringify(after1));
  await browser.close();
})();
