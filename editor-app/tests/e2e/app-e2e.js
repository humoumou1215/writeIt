const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const shots = '/media/writeIt/editor-app/demo-shots';
  const fs = require('fs');
  fs.mkdirSync(shots, { recursive: true });
  // 清掉旧截图
  for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(shots + '/' + f);

  await page.goto('http://localhost:5173/?backend=mock', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  let pass = 0, fail = 0;
  const check = (n, c) => { c ? pass++ : (fail++, console.log('❌', n)); };

  // 1. 无顶栏 + 新侧边栏结构
  check('顶栏已移除', await page.locator('.topbar').count() === 0);
  check('图标列存在', await page.locator('.icon-col').count() === 1);
  check('图标列 ≥2 个按钮', (await page.locator('.icon-col .icon-btn').count()) >= 2);
  check('内容列默认展开', !(await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'))));
  check('状态栏保留', await page.locator('.statusbar').count() === 1);

  // 2. 文件树加载
  check('树含 README.md', await page.locator('.tree .name', { hasText: 'README.md' }).count() > 0);
  check('树含 笔记 目录', await page.locator('.tree .name', { hasText: '笔记' }).count() > 0);
  await page.screenshot({ path: shots + '/01-新布局初始.png' });

  // 3. 打开文件 → 不自动收纳（保留侧边栏，便于连续多开）
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '会议记录.md' }).click();
  await page.waitForTimeout(2500);
  check('编辑器渲染', await page.locator('.milkdown h1', { hasText: '会议记录' }).count() > 0);
  check('打开文件后不收纳', !(await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'))));
  check('标签出现', (await page.locator('.tab').count()) === 1);

  // 3.5 连续打开第二个文件 → 侧边栏保持展开
  await page.locator('.tree .name', { hasText: 'README.md' }).first().click();
  await page.waitForTimeout(2000);
  check('连续打开第二个文件', (await page.locator('.tab').count()) === 2);
  check('连续打开时侧边栏仍展开', !(await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'))));
  await page.screenshot({ path: shots + '/02-打开文件不收纳-连续多开.png' });

  // 4. 点击编辑区 → 收纳；点图标重新展开
  await page.locator('.workspace').click({ position: { x: 320, y: 200 } });
  await page.waitForTimeout(400);
  check('点击编辑区收纳', await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed')));
  await page.locator('.icon-col .icon-btn').first().click();
  await page.waitForTimeout(400);
  check('点击图标重新展开', !(await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'))));

  // 5. 编辑 → 脏标记 → Ctrl+S 保存（聚焦编辑器）
  await page.evaluate(() => (document.querySelector('.milkdown .ProseMirror')).focus());
  await page.waitForTimeout(300);
  await page.keyboard.press('End');
  await page.keyboard.type(' 新布局测试');
  await page.waitForTimeout(600);
  check('脏标记出现', await page.locator('.tab .dot.dirty').count() === 1);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(800);
  check('保存后脏标记清除', await page.locator('.tab .dot.dirty').count() === 0);

  // 6. 设置弹窗（图标列 ⚙️）
  await page.locator('.icon-col .icon-btn').nth(2).click();
  await page.waitForTimeout(500);
  check('设置弹窗打开', await page.isVisible('.settings-modal'));
  check('弹窗有 常规/快捷键 两个页签', (await page.locator('.tab-btn').count()) === 2);
  await page.screenshot({ path: shots + '/03-设置弹窗-常规.png' });

  // 7. 主题切换（快捷键页之前先测常规页主题）
  await page.selectOption('.settings-modal select', 'nord-dark');
  await page.waitForTimeout(600);
  const chromeBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--chrome-background').trim());
  check('深色主题外壳同步', chromeBg.length > 0 && chromeBg !== '#ffffff');

  // 8. 快捷键页
  await page.locator('.tab-btn', { hasText: '快捷键' }).click();
  await page.waitForTimeout(300);
  check('快捷键列表 12 项', (await page.locator('.shortcut-row').count()) === 12);
  check('默认 Ctrl+S 存在', (await page.locator('.shortcut-row', { hasText: '保存当前文件' }).locator('.keybtn').textContent()).trim() === 'Ctrl+S');
  // 录制新快捷键：把「打开设置」改成 Alt+Shift+P
  const settingsRow = page.locator('.shortcut-row', { hasText: '打开设置' });
  await settingsRow.locator('.keybtn').click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Alt+Shift+P');
  await page.waitForTimeout(300);
  check('快捷键已录制', (await settingsRow.locator('.keybtn').textContent()).trim() === 'Alt+Shift+P');
  await page.screenshot({ path: shots + '/04-设置弹窗-快捷键.png' });

  // 9. 关闭设置，用新快捷键打开设置
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('Esc 关闭设置', !(await page.isVisible('.settings-modal')));
  await page.keyboard.press('Alt+Shift+P');
  await page.waitForTimeout(500);
  check('新快捷键可打开设置', await page.isVisible('.settings-modal'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 10. Ctrl+B 收纳/展开
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(400);
  check('Ctrl+B 收纳', await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed')));
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(400);
  check('Ctrl+B 展开', !(await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'))));

  // 11. Alt+ArrowDown 下一个文件（按树顺序导航，原「下一个文件」按钮 → 快捷键）
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForTimeout(2000);
  check('Alt+↓ 打开新标签', (await page.locator('.tab').count()) === 3);

  // 12. 固定侧边栏：点击编辑区不收纳（未固定则收纳）
  if (await page.locator('.content-col.collapsed').count()) {
    await page.locator('.icon-col .icon-btn').first().click(); // 展开（如果已收纳）
    await page.waitForTimeout(300);
  }
  await page.locator('.sidebar-head .pin').click(); // 固定
  await page.waitForTimeout(300);
  await page.locator('.workspace').click({ position: { x: 320, y: 200 } });
  await page.waitForTimeout(400);
  check('固定后点击编辑区不收纳', !(await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed'))));
  await page.locator('.sidebar-head .pin').click(); // 取消固定
  await page.waitForTimeout(300);
  await page.locator('.workspace').click({ position: { x: 320, y: 200 } });
  await page.waitForTimeout(400);
  check('未固定点击编辑区收纳', await page.locator('.content-col').evaluate(el => el.classList.contains('collapsed')));
  await page.locator('.icon-col .icon-btn').first().click(); // 展开，为后续新建文件做准备
  await page.waitForTimeout(300);
  await page.screenshot({ path: shots + '/05-固定侧边栏.png' });

  // 13. 侧边栏新建文件（原顶栏按钮 → 侧边栏）
  await page.locator('.sidebar-actions .mini[title="新建文件"]').click();
  await page.waitForTimeout(300);
  await page.locator('.tree .rename-input').fill('新布局文件.md');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  check('新建文件自动打开', (await page.locator('.tab').count()) === 4);
  check('新建文件在树中', await page.locator('.tree .name', { hasText: '新布局文件.md' }).count() > 0);

  // 14. 宽度拖拽（模拟鼠标拖动）
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('milkdown-note-settings-v1') || '{}').sidebarWidth || 250);
  const handle = page.locator('.resizer');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 100, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('milkdown-note-settings-v1') || '{}').sidebarWidth || 250);
  check(`宽度拖拽生效 (${before} → ${after})`, after > before);
  await page.screenshot({ path: shots + '/06-宽度调整.png' });

  console.log('\n== 错误 ==');
  console.log(errors.length ? errors.join('\n') : '(无)');
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
