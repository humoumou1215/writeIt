const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
    if (m.text().includes('[M3]')) console.log('LOG:', m.text().slice(0, 130));
  });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  let pass = 0, fail = 0;
  const check = (n, c) => { c ? pass++ : (fail++, console.log('❌', n)); };
  const focusEditor = () => page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  const freshPara = async () => {
    await focusEditor();
    await page.evaluate(() => window.__editorGoEnd());
    await page.waitForTimeout(600);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  };
  const ensureSidebar = async () => {
    const collapsed = await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'));
    if (collapsed) {
      await page.locator('.icon-col .icon-btn').first().click();
      await page.waitForTimeout(400);
    }
  };
  const switchToDemo = async () => {
    await page.locator('.tab', { hasText: '引用演示' }).click();
    await page.waitForTimeout(800);
  };
  const waitMenu = async (open, timeout = 4000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const n = await page.locator('[data-ref-menu] .menu-group li').count();
      if (open && n > 0) return true;
      if (!open && n === 0) return true;
      await page.waitForTimeout(100);
    }
    return false;
  };
  const waitBroken = async (timeout = 4000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const n = await page.locator('a.ref-file.ref-broken').count();
      if (n > 0) return n;
      await page.waitForTimeout(100);
    }
    return 0;
  };
  const entryLabels = () => page.locator('[data-ref-menu] .menu-group li > span:nth-child(2)').allTextContents();
  const md = () => page.evaluate(() => window.__editorGetMarkdown());

  // ===== 1. chip 点击跳转 =====
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3500);
  const tabsBefore = (await page.locator('.tab-name').allTextContents()).length;
  await page.locator('a.ref-file[data-path="README.md"]').first().click();
  await page.waitForTimeout(2000);
  const tabsAfter = await page.locator('.tab-name').allTextContents();
  check('点击 chip 打开新标签(README)', tabsAfter.length === tabsBefore + 1 && tabsAfter.some(t => t.includes('README')));
  // 关闭 README 标签，后续全部在引用演示中操作
  await page.locator('.tab', { hasText: 'README' }).click({ button: 'middle' });
  await page.waitForTimeout(800);

  // ===== 2. 断链（先引用 Mermaid → 删除 → 断链 → 替换）=====
  await switchToDemo();
  await freshPara();
  await page.keyboard.type('[[Mermaid');
  await waitMenu(true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  // 实体级（Obsidian 标题）：选首项=文件本身 → 插入整文件链接
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  check('已引用 Mermaid 图表集', (await md()).includes('[[Mermaid 图表集]]'));

  await ensureSidebar();
  await page.locator('.tree .name', { hasText: 'Mermaid 图表集.md' }).click({ button: 'right' });
  await page.waitForTimeout(400);
  await page.locator('.menu-item.danger', { hasText: '删除' }).click();
  await page.waitForTimeout(400);
  await page.locator('.modal .danger').click();
  await page.waitForTimeout(1000);
  check('删除后引用变断链', (await waitBroken()) >= 1);

  // 断链重选（树导航替换）
  await page.locator('a.ref-file.ref-broken').first().click();
  await page.waitForTimeout(600);
  check('断链点击打开替换菜单', await waitMenu(true));
  const rootLabels = await entryLabels();
  const noteIdx = rootLabels.findIndex(t => t === '笔记');
  for (let i = 0; i < noteIdx; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const noteLabels = await entryLabels();
  const todoIdx = noteLabels.findIndex(t => t.includes('待办清单'));
  for (let i = 0; i < todoIdx; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  check('替换后断链消失', (await waitBroken(2000)) === 0);
  const md2 = await md();
  console.log('替换后 md 含 Mermaid:', md2.includes('Mermaid'), '| 尾部:', JSON.stringify(md2.slice(-120)));
  check('替换为 [[笔记/待办清单]]', md2.includes('[[笔记/待办清单]]'));

  // ===== 3. 只读事务守卫 =====
  await switchToDemo();
  await freshPara();
  await page.keyboard.type('![[会议');
  await waitMenu(true);
  await page.keyboard.press('ArrowRight'); // 嵌入只读
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  await page.locator('.ref-file-block.readonly .ref-file-block-content').first().click({ position: { x: 30, y: 30 } });
  await page.keyboard.type('注入内容');
  await page.waitForTimeout(500);
  const readonlyText = await page.locator('.ref-file-block.readonly').first().textContent();
  check('只读卡片未被注入内容', !readonlyText.includes('注入内容'));

  // ===== 4. 重命名联动 =====
  await switchToDemo();
  await ensureSidebar();
  await page.locator('.tree .name', { hasText: 'README.md' }).click({ button: 'right' });
  await page.waitForTimeout(400);
  await page.locator('.menu-item', { hasText: '重命名' }).click();
  await page.waitForTimeout(400);
  await page.locator('.tree .rename-input').fill('README-改.md');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const mdAfter = await md();
  console.log('重命名后 md 中的 README 相关:', JSON.stringify(mdAfter.split('\n').filter(l => l.includes('README'))));
  check('重命名后引用联动更新', mdAfter.includes('[[README-改]]'));
  check('旧引用已清除', !mdAfter.includes('[[README]]') || mdAfter.includes('![[README.md|ro]]'));
  // 恢复
  await page.locator('.tree .name', { hasText: 'README-改.md' }).click({ button: 'right' });
  await page.waitForTimeout(400);
  await page.locator('.menu-item', { hasText: '重命名' }).click();
  await page.waitForTimeout(400);
  await page.locator('.tree .rename-input').fill('README.md');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);

  await page.screenshot({ path: '/media/writeIt/editor-app/demo-shots/16-文件树联动-M3.png' });

  console.log('\n== 错误 ==');
  console.log(errors.length ? errors.join('\n') : '(无)');
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
