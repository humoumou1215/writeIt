// M7 源码查看模式（Ctrl+E 切换所见即所得 / 源码）
// 覆盖：切换/内容回填/源码编辑脏标记/切回渲染/未改不脏/源码模式保存/
//       切标签模式保持/Ctrl+R 守卫/Ctrl+Shift+E 改绑 inline-code
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning') console.log(m.type().toUpperCase() + ':', t.slice(0, 300)); });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };

  // 活动标签容器内的源码 textarea 是否显示（切标签后多个实例并存，需定位活动容器）
  const activeTaShown = () => page.evaluate(() => {
    const panes = Array.from(document.querySelectorAll('.editor-pane'));
    const active = panes.find((p) => p.style.display !== 'none');
    const ta = active?.querySelector('.source-ta');
    return !!ta && ta.style.display === 'block';
  });
  const activeMilkdownHidden = () => page.evaluate(() => {
    const panes = Array.from(document.querySelectorAll('.editor-pane'));
    const active = panes.find((p) => p.style.display !== 'none');
    const md = active?.querySelector('.milkdown');
    return !!md && md.style.display === 'none';
  });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/源码测试.md'] = '# 源码测试\n\n第一段内容。\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '源码测试.md' }).click();
  await page.waitForTimeout(4500);

  // 1. Ctrl+E 进入源码模式
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(600);
  ok('Ctrl+E 进入源码模式（textarea 显示）', await activeTaShown());
  ok('WYSIWYG 隐藏（.milkdown display:none）', await activeMilkdownHidden());
  const badge = await page.locator('.mode-badge').count();
  ok('状态栏显示「源码模式」标识', badge > 0);
  const taVal = await page.locator('.source-ta').inputValue();
  ok('textarea 内容 = 文档 markdown（含标题与正文）', taVal.includes('# 源码测试') && taVal.includes('第一段内容'));
  const srcFocus = await page.evaluate(() => document.activeElement?.getAttribute('data-source-ta') === '');
  ok('焦点在源码 textarea', srcFocus);

  // 2. 源码编辑 → 脏标记
  await page.locator('.source-ta').press('End');
  await page.keyboard.type('\n\n新增段落：源码编辑。');
  await page.waitForTimeout(400);
  ok('源码编辑 → 标签脏标记亮', (await page.locator('.tab .dot.dirty').count()) > 0);
  const statusDirty = await page.locator('.statusbar .active-file').textContent();
  ok('状态栏显示未保存', statusDirty.includes('未保存'));
  const mdNow = await page.evaluate(() => window.__editorGetMarkdown());
  ok('__editorGetMarkdown 返回源码最新内容', mdNow.includes('源码编辑'));

  // 3. Ctrl+E 切回所见即所得
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(1800);
  ok('Ctrl+E 切回 WYSIWYG（textarea 隐藏）', !(await activeTaShown()));
  const rendered = await page.locator('.ProseMirror').textContent();
  ok('新增段落渲染为 WYSIWYG 内容', rendered.includes('源码编辑'));
  ok('源码模式标识消失', (await page.locator('.mode-badge').count()) === 0);

  // 4. 未修改 → 切回不脏（先保存清脏）
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Control+e'); // 进源码
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+e'); // 不改切回
  await page.waitForTimeout(1200);
  ok('未修改源码切回 → 不脏', (await page.locator('.tab .dot.dirty').count()) === 0);

  // 5. 源码模式 Ctrl+S 保存（保持源码模式 + 落盘）
  await page.keyboard.press('Control+e'); // 进源码
  await page.waitForTimeout(500);
  await page.locator('.source-ta').press('End');
  await page.keyboard.type('\n\n保存前加的源码内容。');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(3000);
  ok('源码模式 Ctrl+S 后仍保持源码模式', await activeTaShown());
  ok('保存后脏标记熄灭', (await page.locator('.tab .dot.dirty').count()) === 0);
  const disk = await page.evaluate(
    () => JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}').files['笔记/源码测试.md'] || ''
  );
  ok('源码内容已落盘到 mock fs', disk.includes('保存前加的源码内容'));
  const mdSaved = await page.evaluate(() => window.__editorGetMarkdown());
  ok('保存后 __editorGetMarkdown = 源码内容', mdSaved.includes('保存前加的源码内容'));

  // 6. 切标签模式保持
  await page.keyboard.press('Control+e'); // 第一个标签切回 WYSIWYG
  await page.waitForTimeout(1200);
  // 确保侧边栏展开（打开文件不收纳；若已收纳则点 📁 展开）
  if (await page.locator('.content-col.collapsed').count()) {
    await page.locator('.icon-btn[title^="文件目录"]').click();
    await page.waitForTimeout(600);
  }
  await page.locator('.tree .name', { hasText: 'README.md' }).click();
  await page.waitForTimeout(5000);
  await page.keyboard.press('Control+e'); // 第二个标签进源码
  await page.waitForTimeout(600);
  ok('第二个标签进入源码模式', await activeTaShown());
  await page.locator('.tab', { hasText: '源码测试.md' }).click();
  await page.waitForTimeout(900);
  // 第一个标签保持切回 WYSIWYG 的状态（textarea 隐藏、milkdown 显示）
  ok('切回第一个标签 → 保持 WYSIWYG 模式（textarea 隐藏）', !(await activeTaShown()));
  ok('第一个标签 milkdown 显示', !(await activeMilkdownHidden()));
  await page.locator('.tab', { hasText: 'README.md' }).click();
  await page.waitForTimeout(900);
  ok('切到第二个标签 → 其 textarea 仍显示（模式保持）', await activeTaShown());
  await page.keyboard.press('Control+e'); // 第二个标签切回 WYSIWYG
  await page.waitForTimeout(1200);
  // 关闭第二个标签，避免后续混淆
  await page.locator('.tab', { hasText: 'README.md' }).locator('.close').click();
  await page.waitForTimeout(800);

  // 7. 源码模式 Ctrl+R 守卫（无批注浮窗 + 页面不刷新）
  await page.keyboard.press('Control+e'); // 进源码
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__x = 1; });
  await page.locator('.source-ta:visible').selectText();
  await page.keyboard.press('Control+r');
  await page.waitForTimeout(700);
  ok('源码模式 Ctrl+R 不弹批注输入', (await page.locator('.annotation-input-visible').count()) === 0);
  const toastShown = await page
    .locator('.toast', { hasText: '源码模式' })
    .waitFor({ state: 'visible', timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  ok('Ctrl+R 有引导提示（切回编辑模式）', toastShown);
  ok('Ctrl+R 未触发页面刷新', await page.evaluate(() => window.__x === 1));
  await page.keyboard.press('Control+e'); // 切回 WYSIWYG
  await page.waitForTimeout(1200);

  // 8. inline-code 改绑 Ctrl+Shift+E 验证（释放 Ctrl+E）
  const pm = page.locator('.ProseMirror p', { hasText: '第一段内容' }).first();
  const box = await pm.boundingBox();
  if (!box) { console.log('no box for 第一段内容'); process.exit(1); }
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+Shift+e');
  await page.waitForTimeout(700);
  ok('Ctrl+Shift+E 切换行内代码（改绑生效）', (await page.locator('.ProseMirror code').count()) > 0);
  const mdInline = await page.evaluate(() => window.__editorGetMarkdown());
  ok('行内代码写入 markdown（反引号）', mdInline.includes('`'));
  // WYSIWYG 下 Ctrl+E 本身切源码而非行内代码
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(600);
  ok('WYSIWYG 下 Ctrl+E 进入源码模式（不再切换行内代码）', await activeTaShown());
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(1000);

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
