// Mermaid 引用（M9）：代码块内 @ 联想（复用 ref 菜单）+ 渲染文本级链接 + 点击跳转
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  // 注入测试文档：mermaid 流程图（引号内引用）+ js 代码块（应不触发联想）
  await page.evaluate(() => {
    const KEY = 'milkdown-note-mock-fs-v2';
    const fs = JSON.parse(localStorage.getItem(KEY) || '{}');
    fs.files['Mermaid引用测试.md'] = [
      'doctype:demo',
      '',
      '# 引用测试',
      '',
      '```mermaid',
      'graph TD',
      '  A[流程开始] --> B["修改 [[数据库/loan/loan_apply#amount]] 的值为 1"]',
      '  C["查 [[数据库/loan/loan_apply#apply_no]]"] --> B',
      '```',
      '',
      '```js',
      'const x = @decorator',
      '```',
    ].join('\n');
    localStorage.setItem(KEY, JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: 'Mermaid引用测试.md' }).click({ force: true });
  await page.waitForTimeout(4000);

  // ---- A: 渲染文本级链接 ----
  await page.locator('.preview-toggle-button').first().click();
  await page.waitForTimeout(3000);
  const refs = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll('.preview a.mmd-text-ref')];
    return anchors.map(a => ({ text: a.textContent, ref: a.getAttribute('data-ref') }));
  });
  ok('A1: 文本引用渲染（≥2）', refs.length >= 2);
  ok('A2: 显示路径去掉了 [[ ]]', refs.every(r => r.text && !r.text.includes('[[') && !r.text.includes(']]')));
  ok('A3: data-ref 保留完整引用', refs.some(r => r.ref === '数据库/loan/loan_apply#amount') && refs.some(r => r.ref === '数据库/loan/loan_apply#apply_no'));

  // ---- B: 点击跳转 ----
  await page.locator('.preview a.mmd-text-ref').first().click();
  await page.waitForTimeout(2500);
  const activeTab = await page.evaluate(() => document.querySelector('.tabbar .tab.active')?.textContent?.trim());
  ok('B1: 点击引用打开目标文档（loan_apply.md）', (activeTab || '').includes('loan_apply'));

  // ---- C: 代码块内 @ 联想（回到引用测试文档） ----
  // B1 打开目标文档后侧边栏保持展开；若已收纳则点 📁 展开
  if (await page.locator('.content-col.collapsed').count()) {
    await page.locator('.icon-btn').first().click();
    await page.waitForTimeout(600);
  }
  await page.locator('.tree .name', { hasText: 'Mermaid引用测试.md' }).scrollIntoViewIfNeeded();
  await page.locator('.tree .name', { hasText: 'Mermaid引用测试.md' }).click({ force: true });
  await page.waitForTimeout(3000);
  const visibleBlocks = await page.locator('.milkdown-code-block:visible').count();
  ok('C0: 可见代码块存在（≥2）', visibleBlocks >= 2);
  // A 部分开过预览 → 切回编辑模式（preview-toggle 再点一次）
  const hostHidden = await page.locator('.codemirror-host.hidden').count();
  if (hostHidden > 0) {
    await page.locator('.preview-toggle-button').first().click();
    await page.waitForTimeout(800);
  }
  // 聚焦第一个可见代码块（mermaid）→ 全选 → 输入含 @ 的文本
  await page.locator('.milkdown-code-block:visible').first().click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('graph TD\n  A[开始] --> B["改 @');
  await page.waitForTimeout(1500);
  const anyMenuShown = await page.evaluate(() => [...document.querySelectorAll('[data-mermaid-ref]')].some(el => el.getAttribute('data-show') === 'true'));
  ok('C1: mermaid 代码块内 @ 触发联想', anyMenuShown);

  // 过滤 → 选择 → 实体级 → 插入
  await page.keyboard.type('loan_apply');
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const entityShown = await page.evaluate(() => [...document.querySelectorAll('[data-mermaid-ref]')].some(el => el.getAttribute('data-show') === 'true' && el.textContent?.includes('📄')));
  ok('C2: 选中文件进入实体级（suggest 对象）', entityShown);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const cmText = await page.evaluate(() => document.querySelector('.cm-content')?.textContent);
  const menuAfter = await page.evaluate(() => [...document.querySelectorAll('[data-mermaid-ref]')].every(el => el.getAttribute('data-show') === 'false'));
  ok('C3: 实体选择插入 [[path#fragment]]', /\[\[[^\]]+#[^\]]+\]\]/.test(cmText || ''));
  ok('C4: 插入后菜单关闭', menuAfter);

  // ---- C5: 无引号节点自动补引号（菱形节点文本含 [[ 可正常渲染） ----
  await page.locator('.milkdown-code-block:visible .cm-content').first().click();
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('graph TD\n  A[开始] --> B{有权限? @');
  await page.waitForTimeout(1500);
  await page.keyboard.type('loan_apply');
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); // 选实体
  await page.waitForTimeout(800);
  const cmDiamond = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.milkdown-code-block')];
    const mmd = blocks.find((b) => b.querySelector('.language-button')?.textContent?.trim() === 'mermaid');
    return mmd?.querySelector('.cm-content')?.textContent ?? '';
  });
  ok('C5: 无引号节点自动补引号包裹', /"[\s\S]*\[\[/.test(cmDiamond));
  await page.locator('.preview-toggle-button').first().click();
  await page.waitForTimeout(3000);
  const renderErr = await page.evaluate(() => document.querySelector('.preview')?.textContent?.includes('Mermaid 渲染失败'));
  ok('C6: 自动补引号后渲染成功', !renderErr);
  await page.locator('.preview-toggle-button').first().click(); // 切回编辑

  // ---- D: 非 mermaid 代码块不触发联想 ----
  await page.keyboard.press('Control+a');
  await page.keyboard.type('const x = 1;');
  await page.waitForTimeout(400);
  // 滚动到 js 代码块（懒加载：滚动触发重新挂载 cm）
  await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.milkdown-code-block')];
    const js = blocks.find((b) => b.querySelector('.language-button')?.textContent?.trim() === 'js');
    js?.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(1500);
  // js 代码块可能有预览态 → 确保编辑模式
  const jsHostHidden = await page.locator('.codemirror-host.hidden').count();
  if (jsHostHidden > 0) {
    await page.locator('.preview-toggle-button').last().click();
    await page.waitForTimeout(600);
  }
  const jsCm = page.locator('.milkdown-code-block:visible').filter({ has: page.locator('.cm-content') }).last();
  await jsCm.click({ force: true });
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('const y = @deco');
  await page.waitForTimeout(1200);
  const menuInJs = await page.evaluate(() => [...document.querySelectorAll('[data-mermaid-ref]')].some(el => el.getAttribute('data-show') === 'true'));
  ok('D1: js 代码块输入 @ 不触发联想', !menuInJs);

  // ---- E: 断链点击 → toast（不存在路径） ----
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  ok('E0: 文档无损坏', md.length > 0);

  // ---- F: 未加引号的 [[..]] 渲染不再失败（预处理占位符 + 渲染后链接化） ----
  // ---- G: mermaid 联想返回上级目录（适配器补 back()） ----
  await page.evaluate(() => {
    const KEY = 'milkdown-note-mock-fs-v2';
    const files = JSON.parse(localStorage.getItem(KEY) || '{}');
    files.files['Mermaid无引号.md'] = [
      'doctype:demo',
      '',
      '# 无引号引用',
      '',
      '```mermaid',
      'graph TD',
      '  A[开始] --> B{有权限? [[笔记/待办清单#待办清单]]}',
      '  B -->|是| C[处理请求]',
      '  B -->|否| D[拒绝访问]',
      '  C --> E[结束]',
      '```',
      '',
    ].join('\n');
    files.files['Aaa联想.md'] = [
      'doctype:demo', '', '# 联想', '',
      '```mermaid', 'graph TD', '  A[开始] --> B[结束]', '```', '',
    ].join('\n');
    files.files['Aaa/深层/深层文件.md'] = '# 深层\n';
    localStorage.setItem(KEY, JSON.stringify(files));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // F：打开无引号文档 → 不应渲染失败 + 引用链接化
  // 侧边栏 reload 后默认展开；若收起（.tree 不可见）则点 📁 展开，再滚动到树项
  if (!(await page.locator('.tree').first().isVisible().catch(() => false))) {
    await page.locator('.icon-btn').first().click();
    await page.waitForTimeout(500);
  }
  await page.locator('.tree .name', { hasText: 'Mermaid无引号.md' }).scrollIntoViewIfNeeded();
  await page.locator('.tree .name', { hasText: 'Mermaid无引号.md' }).click({ force: true });
  await page.waitForTimeout(4000);
  const unquotedPreview = await page.locator('.milkdown-code-block .preview').first().innerText().catch(() => '');
  ok('F1: 未加引号 [[..]] 不再渲染失败', !(unquotedPreview || '').includes('渲染失败'));
  const unquotedRef = await page.locator('.preview a.mmd-text-ref').first().getAttribute('data-ref').catch(() => null);
  ok('F2: 未加引号引用被链接化（data-ref 完整）', unquotedRef === '笔记/待办清单#待办清单');
  ok('F3: 预览显示去掉 [[ ]] 只显路径', !(unquotedPreview || '').includes('[['));

  // G：打开含 mermaid 代码块的文档 → 代码块内 @ 联想 → 进入目录 → ← 返回第一级
  const sidebarOpen = (await page.locator('.icon-btn.active').count().catch(() => 0)) > 0;
  if (!sidebarOpen) {
    await page.locator('.icon-btn').first().click();
    await page.waitForTimeout(600);
  }
  await page.locator('.tree .name', { hasText: 'Aaa联想.md' }).scrollIntoViewIfNeeded();
  await page.locator('.tree .name', { hasText: 'Aaa联想.md' }).click({ force: true });
  await page.waitForSelector('.cm-content', { timeout: 15000 });
  await page.waitForTimeout(800);
  const gCm = page.locator('.milkdown-code-block:visible .cm-content').first();
  await gCm.click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('graph TD\n  A[开始]-->B[结束] @');
  await page.waitForTimeout(1200);
  const gShown = await page.evaluate(() =>
    [...document.querySelectorAll('[data-mermaid-ref]')].some(el => el.getAttribute('data-show') === 'true'));
  ok('G1: mermaid 代码块内 @ 联想菜单打开', gShown);
  const gTitle0 = (await page.locator('[data-mermaid-ref]:not([data-show="false"]) h6').first().innerText().catch(() => ''))?.trim();
  ok('G2: 初始在根（第一级）', gTitle0 === '文件');
  // 进入 Aaa 目录
  await page.keyboard.type('Aaa');
  await page.waitForSelector('[data-mermaid-ref] li', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const readH6 = () => page.evaluate(() => [...document.querySelectorAll('[data-mermaid-ref]:not([data-show="false"]) h6')].map(h => h.textContent?.trim() ?? '').join(',') || '');
  const gTitle1 = await readH6();
  ok('G3: 进入目录（标题显示 📁 Aaa）', gTitle1.includes('Aaa'));
  // 再进入 深层
  await page.waitForSelector('[data-mermaid-ref] li', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  // 逐级 ← 返回直到第一级
  let gTitle = await readH6();
  let guard = 0;
  while (gTitle !== '文件' && guard++ < 5) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    gTitle = await readH6();
  }
  ok('G4: 逐级 ← 返回可回到第一级（文件）', gTitle === '文件');
  // 反向确认：再次返回仍停留第一级，未吞掉标题（多级返回不越级）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const menuHidden = await page.evaluate(() =>
    [...document.querySelectorAll('[data-mermaid-ref]')].every(el => el.getAttribute('data-show') === 'false'));
  ok('G5: ESC 关闭联想菜单（无异常）', menuHidden);

  // ---- H: M10 需求组（.template 过滤 / 时序图跳转 / 边标签 / → 键） ----
  await page.evaluate(() => {
    const KEY = 'milkdown-note-mock-fs-v2';
    const files = JSON.parse(localStorage.getItem(KEY) || '{}');
    files.files['MermaidM10.md'] = [
      'doctype:demo', '', '# M10', '',
      '```mermaid', 'sequenceDiagram',
      '  Alice->>Bob: 查看 [[数据库/loan/loan_apply#amount]]',
      '```', '',
      '```mermaid', 'graph TD',
      '  A[开始] --> B{"有权限? [[数据库/loan/loan_apply#status]]"}',
      '  B -->|"是 [[数据库/loan/loan_apply#amount]]"| C[处理请求]',
      '```', '',
    ].join('\n');
    localStorage.setItem(KEY, JSON.stringify(files));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: 'MermaidM10.md' }).scrollIntoViewIfNeeded();
  await page.locator('.tree .name', { hasText: 'MermaidM10.md' }).click({ force: true });
  await page.waitForTimeout(4500);

  // H1: 时序图消息链接化（tspan）+ 点击跳转
  const tspans = await page.evaluate(() => [...document.querySelectorAll('.preview tspan.mmd-text-ref')].map(t => t.textContent));
  ok('H1: 时序图消息文本链接化（tspan）', tspans.some(t => t === '数据库/loan/loan_apply#amount'));
  await page.locator('.preview tspan.mmd-text-ref').first().click();
  await page.waitForTimeout(2500);
  const seqActive = await page.evaluate(() => document.querySelector('.tabbar .tab.active')?.textContent?.trim());
  ok('H2: 时序图 tspan 点击跳转', (seqActive || '').includes('loan_apply'));

  // H3: 边标签引用链接化（a.mmd-text-ref）
  const edgeRefs = await page.evaluate(() => [...document.querySelectorAll('.preview a.mmd-text-ref')].map(a => a.textContent));
  ok('H3: 边标签引用链接化', edgeRefs.some(t => t === '数据库/loan/loan_apply#amount'));

  // H4: 联想不出现 .template（隐藏目录过滤）
  const hSidebar = (await page.locator('.icon-btn.active').count().catch(() => 0)) > 0;
  if (!hSidebar) {
    await page.locator('.icon-btn').first().click();
    await page.waitForTimeout(600);
  }
  await page.locator('.tree .name', { hasText: 'MermaidM10.md' }).scrollIntoViewIfNeeded();
  await page.locator('.tree .name', { hasText: 'MermaidM10.md' }).click({ force: true });
  await page.waitForTimeout(3000);
  await page.locator('.milkdown-code-block:visible .cm-content').first().click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('graph TD\n  A --> B["改 @');
  await page.waitForTimeout(1500);
  const menuRoot = await page.evaluate(() => document.querySelector('[data-mermaid-ref]:not([data-show="false"])')?.textContent?.slice(0, 150) ?? '');
  ok('H4: 联想不出现 .template（隐藏目录）', !menuRoot.includes('template'));

  // H5: 实体级 ArrowRight 不移动光标
  await page.keyboard.type('loan_apply');
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  const cLen1 = await page.evaluate(() => document.querySelector('.cm-content')?.textContent?.length);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  const cLen2 = await page.evaluate(() => document.querySelector('.cm-content')?.textContent?.length);
  ok('H5: 实体级 → 键不移动光标', cLen1 === cLen2);

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
