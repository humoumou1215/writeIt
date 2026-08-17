const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); if (m.text().includes('[st]')) console.log('LOG:', m.text().slice(0, 110)); });

  await page.goto('http://localhost:5173/?backend=mock', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  let pass = 0, fail = 0;
  const check = (n, c) => { c ? pass++ : (fail++, console.log('❌', n)); };
  const menuCount = () => page.locator('[data-ref-menu] .menu-group li').count();
  const waitMenu = async (open, timeout = 4000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const n = await menuCount();
      if (open && n > 0) return true;
      if (!open && n === 0) return true;
      await page.waitForTimeout(100);
    }
    return false;
  };
  const menuOpen = () => menuCount() > 0;
  const entryLabels = () => page.locator('[data-ref-menu] .menu-group li > span:nth-child(2)').allTextContents();
  const selectedMode = () => page.locator('[data-ref-menu] .tab-group li.selected').textContent();
  const focusEditor = () => page.evaluate(() => document.querySelector('.milkdown .ProseMirror').focus());
  const freshPara = async () => {
    // goEnd：光标到文档末尾可输入位置（末尾是嵌入块时自动补空段落）
    await focusEditor();
    await page.evaluate(() => window.__editorGoEnd());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
  };

  // 打开测试文件
  await page.locator('.sidebar-actions .mini[title="新建文件"]').click();
  await page.waitForTimeout(300);
  await page.locator('.tree .rename-input').fill('菜单测试.md');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  check('测试文件已打开', (await page.locator('.tab-name').allTextContents()).includes('菜单测试.md'));

  // ===== 1. [[ 触发：模式选择器 + 根级文件树 =====
  await freshPara();
  await page.keyboard.type('[[');
  check('[[ 弹出菜单', await waitMenu(true));
  const modes = await page.locator('[data-ref-menu] .tab-group li').allTextContents();
  check('模式选择器三态（链接/嵌入/嵌入只读）', modes.length === 3 && modes.some(m => m.includes('链接')) && modes.some(m => m.includes('嵌入')));
  check('默认链接模式', (await selectedMode()).trim() === '链接');
  const rootEntries = await entryLabels();
  check('根级含目录 笔记', rootEntries.some(t => t === '笔记'));
  check('根级含文件 README', rootEntries.some(t => t.includes('README')));
  check('文件只出现一次', rootEntries.filter(t => t.includes('README')).length === 1);

  // ===== 2. 目录逐级发现 =====
  // Enter 在「笔记」目录上 → 进入
  const noteIdx = (await entryLabels()).findIndex(t => t === '笔记');
  for (let i = 0; i < noteIdx; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const noteChildren = await entryLabels();
  check('进入笔记目录后显示子文件', noteChildren.some(t => t.includes('会议记录')) && noteChildren.some(t => t.includes('待办清单')));
  // Backspace 返回上级
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  const backRoot = await entryLabels();
  check('Backspace 返回根级', backRoot.some(t => t === '笔记'));

  // ===== 3. 过滤（全树搜索）=====
  await page.keyboard.type('会议');
  await page.waitForTimeout(300);
  const filtered = await entryLabels();
  // M14：Git 演示仓库新增 Git演示/笔记/会议纪要.md → 过滤 '会议' 命中 2 个（原断言 length===1 需适配）
  check('过滤显示 笔记/会议记录（含 Git 演示同名）', filtered.length >= 2 && filtered.some(t => t.includes('笔记/会议记录')) && filtered.some(t => t.includes('Git演示/笔记/会议纪要')));
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  const h6AfterBs = await page.locator('[data-ref-menu] .menu-group h6').textContent();
  check('Backspace 删一个字符细化过滤', h6AfterBs.includes('搜索：会'));
  // 再删一个字符清空过滤词 → 回到树（注意不能再删，否则会删到 [[ 触发词）
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  check('清空过滤回到树', (await entryLabels()).some(t => t === '笔记'));

  // ===== 4. Enter 文件 → 实体级（Obsidian：首项=文件本身）→ Enter 插入链接 =====
  // M14：Git 演示同名文件存在 → 用更精确的过滤词「会议记录」只命中 fs 演示文件
  await page.keyboard.type('记录');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const entFirst = (await entryLabels())[0] ?? '';
  check('文件进入实体级（首项=文件本身）', entFirst.includes('会议记录'));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('菜单关闭', await waitMenu(false));
  check('插入 file_ref chip', await page.locator('a.ref-file').count() >= 1);
  const md1 = await page.evaluate(() => window.__editorGetMarkdown());
  check('序列化为 [[笔记/会议记录]]', md1.includes('[[笔记/会议记录]]'));

  // ===== 5. ![[ 嵌入：默认模式 + 插入物化 =====
  await freshPara();
  await page.keyboard.type('![[待办');
  check('![[ 弹出菜单', await waitMenu(true));
  check('默认嵌入模式', (await selectedMode()).trim() === '嵌入');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  check('插入 file_block 卡片', await page.locator('.ref-file-block').count() >= 1);
  const blockText = await page.locator('.ref-file-block').first().textContent();
  check('嵌入卡片已物化(待办清单)', blockText.includes('待办清单'));

  // ===== 6. ←→ 切模式（嵌入只读）=====
  await freshPara();
  await page.keyboard.type('![[会议');
  await waitMenu(true);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  check('Tab 切到嵌入只读', (await selectedMode()).trim() === '嵌入只读');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  check('插入只读卡片', await page.locator('.ref-file-block.readonly').count() >= 1);

  // ===== 7. @ 边界 =====
  await freshPara();
  await page.keyboard.type('联系@小明');
  await page.waitForTimeout(400);
  check('中文紧贴 @ 不触发', !(await menuOpen()));
  await page.keyboard.type(' @');
  const okAt = await waitMenu(true);
  if (!okAt) {
    const st = await page.evaluate(() => ({
      show: document.querySelector('[data-ref-menu]')?.getAttribute('data-show'),
      doc: window.__editorGetMarkdown().slice(-30),
      recent: window.__refMenuState?.recentTyped,
      q: window.__refMenuState?.query,
    }));
    console.log('[debug] @ 触发失败状态:', JSON.stringify(st));
  }
  check('空格后 @ 触发', okAt);
  await page.keyboard.press('Escape');
  check('Esc 关闭', await waitMenu(false));

  // ===== 8. 段落中间嵌入 → 自动劈分 =====
  await freshPara();
  await page.keyboard.type('前段文字');
  await page.keyboard.type('![[数据/原始');
  await waitMenu(true);
  const pre = await page.evaluate(() => ({
    show: document.querySelector('[data-ref-menu]')?.getAttribute('data-show'),
    items: Array.from(document.querySelectorAll('[data-ref-menu] .menu-group li')).map(li => li.textContent.trim()).slice(0, 3),
    hover: document.querySelector('[data-ref-menu] .menu-group li.hover')?.textContent.trim() ?? null,
  }));
  console.log('[debug] Enter 前菜单:', JSON.stringify(pre));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const mdFinal = await page.evaluate(() => window.__editorGetMarkdown());
  console.log('[debug] mdFinal:', JSON.stringify(mdFinal.slice(-200)));
  check('劈分后嵌入存在', mdFinal.includes('![[数据/原始数据]]') && mdFinal.includes('前段文字'));

  await page.screenshot({ path: '/media/writeIt/editor-app/demo-shots/15-三级递进菜单.png' });

  console.log('\n== 错误 ==');
  console.log(errors.length ? errors.join('\n') : '(无)');
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
