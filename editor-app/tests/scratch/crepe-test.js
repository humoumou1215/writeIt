const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file:///media/writeIt/index.html', { waitUntil: 'load', timeout: 120000 });

  await page.waitForSelector('.milkdown .ProseMirror', { timeout: 120000 });
  await page.waitForTimeout(3000);

  // 1. 内容已渲染
  const text = await page.textContent('.milkdown .ProseMirror');
  console.log('== 编辑器内容包含 "Milkdown" :', text.includes('Milkdown'));
  console.log('== 标题渲染 (h1) :', (await page.locator('.milkdown h1').count()) > 0);
  console.log('== 表格渲染 (table) :', (await page.locator('.milkdown table').count()) > 0);
  console.log('== 任务列表 :', (await page.locator('.milkdown input[type=checkbox]').count()) > 0);
  console.log('== 引用块 :', (await page.locator('.milkdown blockquote').count()) > 0);
  console.log('== 行内公式 (math) :', (await page.locator('.milkdown math, .milkdown [data-milkdown-math]').count()) > 0);

  // 2. 状态栏
  console.log('== 状态栏字数 :', await page.textContent('#statWords'));
  console.log('== 状态栏行数 :', await page.textContent('#statLines'));

  // 3. 源码预览切换（预览面板内容 = getMarkdown 实时镜像）
  await page.click('#previewToggle');
  await page.waitForTimeout(500);
  const previewVisible = await page.isVisible('#previewPanel');
  const previewText = (await page.textContent('#preview')).length;
  console.log('== 源码预览可见 :', previewVisible, '| 预览文本长度 :', previewText);

  // 4. 主题切换
  await page.selectOption('#theme', 'nord-dark');
  await page.waitForTimeout(500);
  console.log('== 主题切换 nord-dark → body.dark :', await page.evaluate(() => document.body.classList.contains('dark')));

  // 5. 只读切换
  await page.click('#readonly');
  await page.waitForTimeout(300);
  console.log('== 只读切换后状态栏 :', await page.textContent('#statusText'));

  // 6. 导入功能（replaceAll）
  await page.click('#import');
  await page.waitForTimeout(300);
  await page.fill('#importText', '# 新标题\n\n测试导入内容。');
  await page.click('#importConfirm');
  await page.waitForTimeout(800);
  const newText = await page.textContent('.milkdown .ProseMirror');
  console.log('== 导入后标题为"新标题" :', newText.includes('新标题'));
  console.log('== 导入后旧内容已清空 :', !newText.includes('Milkdown × Crepe'));
  console.log('== 导入后预览同步 :', (await page.textContent('#preview')).includes('测试导入内容'));

  // 7. 在编辑器内输入（先退出只读）
  await page.click('#readonly');
  await page.waitForTimeout(300);
  await page.keyboard.press('End');
  await page.keyboard.type(' 追加文字ABC');
  await page.waitForTimeout(500);
  console.log('== 输入后预览追加 :', (await page.textContent('#preview')).includes('追加文字ABC'));
  console.log('== 字数统计更新 :', await page.textContent('#statWords'));

  // 8. 恢复示例
  await page.click('#reset');
  await page.waitForTimeout(800);
  console.log('== 恢复示例后包含表格 :', (await page.locator('.milkdown table').count()) > 0);

  console.log('\n== 错误列表 ==');
  console.log(errors.length ? errors.join('\n') : '(无)');

  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
