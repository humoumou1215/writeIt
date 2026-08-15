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

  // 打开引用演示.md
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(3000);

  // 1. doctype 节点
  check('doctype 渲染', await page.locator('.ref-doctype').count() === 1);
  const doctypeText = (await page.locator('.ref-doctype').first().textContent())?.trim();
  check('doctype 内容 = doctype:demo', doctypeText === 'doctype:demo');

  // 2. file_ref chips
  check('file_ref chip 数量', await page.locator('a.ref-file').count() >= 3);
  const chipTexts = await page.locator('a.ref-file').allTextContents();
  check('chip 含 README.md', chipTexts.some(t => t.includes('README.md')));
  check('chip 含 会议记录#片段', chipTexts.some(t => t.includes('#')));

  // 3. file_block 卡片
  check('file_block 卡片数 = 2', await page.locator('.ref-file-block').count() === 2);
  check('只读卡片有 readonly 类', await page.locator('.ref-file-block.readonly').count() === 1);
  const badges = await page.locator('.ref-file-block-badge').allTextContents();
  check('只读徽标存在', badges.some(t => t.includes('只读')));

  // 4. 物化：嵌入内容出现在卡片内
  await page.waitForTimeout(1000);
  const blockContent = await page.locator('.ref-file-block:not(.readonly)').textContent();
  check('可编辑卡片内含源文件内容(待办清单)', blockContent.includes('待办清单'));
  const readonlyContent = await page.locator('.ref-file-block.readonly').textContent();
  check('只读卡片内含 README 内容', readonlyContent.length > 80 && readonlyContent.includes('消金业务合作'));

  // 5. 序列化往返：getMarkdown 只输出标记，不落盘物化内容
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  check('序列化含 ![[标记', md.includes('![[笔记/待办清单]]'));
  check('序列化含 |ro 标记', md.includes('![[README.md|ro]]'));
  check('序列化含 [[链接', md.includes('[[README.md]]'));
  check('物化内容未落盘', !md.includes('搭建工程'));

  // 6. 转义：字面量 [[ 不应解析为引用
  check('转义文本保持为文本', md.includes('\\[[') || md.includes('不应被解析'));

  await page.screenshot({ path: '/media/writeIt/editor-app/demo-shots/09-引用机制-M1.png' });

  console.log('\n== 错误 ==');
  console.log(errors.length ? errors.join('\n') : '(无)');
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
