// M11a 冒烟：浏览器模式（mock 后端）下 Git 功能降级 UI
//  - Git 图标存在且灰置
//  - 点击 Git 图标 → toast 提示桌面应用可用
//  - content-col 面板 tab 切换 → Git 面板显示错误提示
//  - 打开文件后 Ctrl+Shift+D → toast（git 不可用）
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  let pass = 0, fail = 0;
  const check = (n, c) => { c ? pass++ : (fail++, console.log('❌', n)); };

  // 1. Git 图标
  const gitBtns = page.locator('.icon-col .icon-btn', { hasText: '🔀' });
  check('Git 图标存在', await gitBtns.count() === 1);
  const gitBtn = gitBtns.first();
  const opacity = await gitBtn.evaluate((el) => getComputedStyle(el).opacity);
  check('Git 图标灰置（浏览器模式）', parseFloat(opacity) < 1);

  // 2. 点击 Git 图标 → toast
  await gitBtn.click();
  await page.waitForTimeout(400);
  check('点击后 toast 提示', (await page.locator('.toast').count()) > 0);

  // 3. 面板 tab 切换（icon-col 点击会切 git tab）
  check('content-col 显示面板 tab', await page.locator('.panel-tab').count() === 2);
  check('Git tab 未激活（浏览器模式提示后不进入）', await page.locator('.panel-tab.active', { hasText: 'Git' }).count() === 0);
  // GitPanel 已挂载（v-show 隐藏）且降级错误信息就绪
  const gitErr = (await page.locator('.git-error').first().textContent()) || '';
  check('Git 面板错误提示（仅桌面应用可用）', gitErr.includes('桌面应用'));
  await page.screenshot({ path: '/tmp/m11a-git-panel-browser.png' });

  // 4. 切回文件 tab → 文件树还在
  await page.locator('.panel-tab', { hasText: '文件' }).click();
  await page.waitForTimeout(300);
  check('切回文件树', await page.locator('.tree .node').count() > 0);

  // 5. 打开文件 + Ctrl+Shift+D → git 不可用 toast（不崩溃）
  await page.locator('.tree .node', { hasText: 'README.md' }).first().click();
  await page.waitForTimeout(2000);
  check('文件打开', await page.locator('.milkdown').count() > 0);
  await page.keyboard.press('Control+Shift+d');
  await page.waitForTimeout(400);
  check('Ctrl+Shift+D → toast（git 不可用）', (await page.locator('.toast').count()) > 0);

  // 6. 无 pageerror / console error
  check('无页面错误', errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
