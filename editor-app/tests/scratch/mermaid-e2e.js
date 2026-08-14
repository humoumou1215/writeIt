const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  let pass = 0, fail = 0;
  const check = (n, c) => { c ? pass++ : (fail++, console.log('❌', n)); };

  await page.locator('.tree .name', { hasText: 'README.md' }).click();
  await page.waitForTimeout(3000);
  check('README 打开', await page.locator('.milkdown h1', { hasText: 'Milkdown × Crepe' }).count() > 0);

  // 滚动使代码块初始化
  await page.evaluate(() => {
    document.querySelectorAll('.milkdown .milkdown-code-block').forEach((b) => b.scrollIntoView({ block: 'center' }));
  });
  await page.waitForTimeout(3000);

  // 语言按钮文本
  const langs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.milkdown .language-button')).map((b) => b.textContent.trim().split('\n')[0])
  );
  console.log('代码块语言:', JSON.stringify(langs));
  check('含 mermaid 语言按钮', langs.some((l) => l === 'mermaid'));

  // 点击 mermaid 块的预览按钮（copy 之外的按钮；若不可见则先悬停显示）
  const clickResult = await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll('.milkdown .milkdown-code-block'));
    for (const b of blocks) {
      const lang = b.querySelector('.language-button')?.textContent?.trim().split('\n')[0];
      if (lang === 'mermaid') {
        const group = b.querySelector('.tools-button-group');
        const btns = group ? Array.from(group.querySelectorAll('button')) : [];
        // 预览按钮可能是隐藏的（hover 显示），直接强制点击
        const preview = btns.find((x) => x.className.includes('preview') || !x.className.includes('copy'));
        if (preview) {
          preview.style.display = 'inline-flex';
          preview.click();
          return { found: true, cls: preview.className, title: preview.title || '' };
        }
        return { found: false, btns: btns.map((x) => x.className) };
      }
    }
    return { found: false };
  });
  console.log('点击预览按钮:', JSON.stringify(clickResult));
  check('找到并点击预览按钮', clickResult.found);

  // 等待 mermaid 渲染
  await page.waitForTimeout(8000);
  const svgCount = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.milkdown svg')).filter((s) => (s.id || '').startsWith('mmd')).length
  );
  check('Mermaid SVG 渲染成功', svgCount > 0);
  console.log('mmd- SVG 数:', svgCount);

  // 斜杠菜单 Mermaid 分组
  await page.locator('.milkdown .ProseMirror').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.waitForTimeout(1200);
  const menuHasMermaid = await page.evaluate(() =>
    (document.querySelector('.milkdown [class*="slash"]')?.textContent || '').includes('Mermaid')
  );
  check('斜杠菜单出现 Mermaid 分组', menuHasMermaid);

  await page.screenshot({ path: '/media/writeIt/editor-app/demo-shots/07-mermaid.png' });
  console.log('\n== 错误 ==');
  console.log(errors.length ? errors.join('\n') : '(无)');
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
