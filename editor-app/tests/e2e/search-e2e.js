// E2E：全局搜索面板（M15 补全）
//   - 图标列 🔍 / Ctrl+Shift+F 打开侧栏搜索面板
//   - 输入关键词 → 全文结果分组展示（命中文件 + 行号 + 高亮）
//   - 点击结果 / Enter → 打开文件并滚动到匹配处（scrollToSearchMatch）
//   - Esc 清空 → 再按一次收起侧栏；Ctrl+Shift+F 重新展开
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 部分受限环境（无 GUI/精简沙箱）默认 chromium 起不来 → 优先用 playwright 自带的
// chrome-headless-shell；本地完整环境无该目录时回退到 playwright 默认浏览器。
function resolveChromium() {
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const cands = [];
  try {
    for (const d of fs.readdirSync(cache)) {
      if (!d.startsWith('chromium_headless_shell-')) continue
      const exe = path.join(cache, d, 'chrome-headless-shell')
      if (fs.existsSync(exe)) cands.push(exe)
    }
  } catch { /* 无缓存目录 → 用默认 */ }
  return cands.sort().pop()
}

(async () => {
  const executablePath = resolveChromium();
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:5173/?backend=mock', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  let pass = 0, fail = 0;
  const check = (n, c) => { c ? pass++ : (fail++, console.log('❌', n)); };
  const panelVisible = () => page.locator('[data-search-panel]').isVisible();
  const hitCount = () => page.locator('.sp-hit').count();
  const waitHits = async (min, timeout = 6000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if ((await hitCount()) >= min) return true;
      await page.waitForTimeout(100);
    }
    return (await hitCount()) >= min;
  };

  // ===== 1. 图标列 🔍 打开面板 =====
  await page.locator('button[title^="全局搜索"]').click();
  await page.waitForTimeout(300);
  check('🔍 图标打开搜索面板', await panelVisible());
  check('输入框自动聚焦', await page.evaluate(() => document.activeElement?.classList.contains('sp-input')));

  // ===== 2. 全文搜索：结果分组 + 状态计数 =====
  await page.locator('.sp-input').fill('助贷放款');
  check('命中结果出现（多文件分组）', await waitHits(1));
  await page.waitForTimeout(400);
  const status = await page.locator('.sp-status').textContent();
  check('状态行显示匹配计数', /^\s*\d+\s*处匹配/.test(status ?? ''));
  const paths = await page.locator('.sp-file-path').allTextContents();
  check('结果按文件分组且含接口文档', paths.some((p) => p.includes('助贷放款接口.md')));

  // 高亮标记存在
  check('命中行关键字高亮 <mark>', (await page.locator('.sp-hit .sp-mark').count()) > 0);
  // 行号展示
  const lineNos = await page.locator('.sp-hit .sp-line-no').allTextContents();
  check('命中行有行号', lineNos.length > 0 && lineNos.every((n) => /^\d+$/.test(n)));

  // ===== 3. 点击结果 → 打开文件并滚动（scrollToSearchMatch 链路） =====
  await page.locator('.sp-hit').first().click();
  await page.waitForTimeout(1500);
  const tabNames = await page.locator('.tab-name').allTextContents();
  check('点击结果打开对应文件标签', tabNames.some((t) => t.includes('助贷放款')));

  // ===== 4. Esc 清空 → 再按收起侧栏 =====
  await page.locator('.sp-input').press('Escape');
  check('Esc 清空输入', (await page.locator('.sp-input').inputValue()) === '');
  await page.locator('.sp-input').press('Escape');
  await page.waitForTimeout(200);
  check('再按 Esc 收起侧栏', await page.evaluate(() => document.querySelector('.content-col')?.classList.contains('collapsed')));

  // ===== 5. Ctrl+Shift+F 快捷键重新打开 =====
  await page.evaluate(() => document.querySelector('.editor-area')?.dispatchEvent(new FocusEvent('focus')));
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('Control+Shift+F');
  await page.waitForTimeout(400);
  check('Ctrl+Shift+F 重新展开搜索面板', await panelVisible());
  check('快捷键后面板输入框聚焦', await page.evaluate(() => document.activeElement?.classList.contains('sp-input')));

  // ===== 6. 大小写选项 + 无结果提示 =====
  await page.locator('.sp-input').fill('不存在的关键词xyz123');
  await waitHits(0);
  const emptyText = await page.locator('.sp-empty').textContent();
  check('无结果提示', (emptyText ?? '').includes('没有找到'));
  await page.locator('.sp-opt').click();
  check('大小写开关可切换', await page.locator('.sp-opt').evaluate((el) => el.classList.contains('on')));
  await page.locator('.sp-opt').click(); // 恢复忽略大小写

  // ===== 7. 替换功能：全部替换 → 确认 → 数据变更 + 缓存失效 =====
  await page.locator('.sp-input').fill('助贷放款');
  await waitHits(1);
  await page.waitForTimeout(400);
  const hitsBefore = await hitCount();
  check('替换行可见', await page.locator('.sp-replace-row').isVisible());
  await page.locator('.sp-rinput').fill('助贷放款TEST');
  await page.locator('.sp-btn.danger').click(); // 全部替换
  await page.waitForTimeout(600);
  check('确认框出现', await page.locator('.modal').isVisible());
  await page.locator('.modal .btn.danger, .modal button:has-text("全部替换")').click();
  await page.waitForTimeout(2500);
  check('替换成功 toast', ((await page.locator('.toast').last().textContent()) ?? '').includes('已替换'));
  check('替换后旧词命中归零', (await hitCount()) === 0);
  await page.locator('.sp-input').fill('助贷放款TEST');
  await waitHits(1);
  check('替换后新词命中', (await hitCount()) >= hitsBefore);
  // 恢复 mock 示例数据（设置页刷新）
  await page.locator('.sp-input').press('Escape');
  await page.locator('.sp-input').press('Escape');
  await page.locator('button[title^="设置"]').click();
  await page.waitForTimeout(600);
  await page.locator('button:has-text("刷新 Mock 示例数据")').click();
  await page.waitForTimeout(2000);
  await page.locator('.modal-mask, .modal').count(); // 兜底等待
  await page.keyboard.press('Escape');

  // ===== 8. 跳转定位 + 编辑器内高亮 =====
  await page.locator('button[title^="全局搜索"]').click();
  await page.waitForTimeout(300);
  await page.locator('.sp-input').fill('助贷放款');
  await waitHits(1);
  await page.locator('.sp-hit').first().click();
  await page.waitForTimeout(2500);
  check('点击结果打开文件', ((await page.locator('.tab-name').allTextContents()) || []).length > 0);
  check('编辑器内命中词高亮', (await page.locator('.milkdown .search-hit-highlight').count()) > 0);
  check('同文件所有匹配都高亮', (await page.locator('.milkdown .search-hit-highlight').count()) >= (await page.locator('.sp-hit').count()));
  check('当前命中带橙红闪烁样式', await page.locator('.milkdown .search-hit-current').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return cs.animationName.includes('pulse') && (cs.color === 'rgb(255, 255, 255)');
  }));
  check('普通命中淡橙无动画', await page.locator('.milkdown .search-hit-highlight:not(.search-hit-current)').first().evaluate((el) => getComputedStyle(el).animationName === 'none'));
  // 编辑一次 → 高亮自动清除
  await page.locator('.milkdown .ProseMirror').click({ position: { x: 40, y: 40 } });
  await page.keyboard.type('x');
  await page.waitForTimeout(600);
  check('编辑后高亮自动清除', (await page.locator('.milkdown .search-hit-highlight').count()) === 0);

  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  console.log(errors.length ? '页面错误:\n' + errors.join('\n') : '');
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });