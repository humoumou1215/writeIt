// M4 E2E：模板服务 + suggest 实体 + / 菜单模板组 + 对象引用 + 基于模板新建
const { chromium } = require('playwright');
let pass = 0, fail = 0;
function check(name, ok) { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}`); }

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 180)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 180)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  // ---- 1. 打开引用演示：对象引用自动消歧 ----
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(5000);
  const objTexts = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('[data-object-ref]'));
    return spans.map(s => ({ obj: s.getAttribute('data-object'), text: s.getAttribute('data-text') }));
  });
  console.log('  object_ref:', JSON.stringify(objTexts));
  check('greeting 解析为段落', objTexts.some(s => s.obj === 'greeting' && s.text && s.text.includes('你好')));
  check('version 解析为版本号', objTexts.some(s => s.obj === 'version' && s.text && s.text.includes('v0.2.1')));

  // ---- 2. / 菜单「模板」组（新段落，避免字面量 [[ 干扰）----
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('/');
  await page.waitForTimeout(1000);
  const tplGroup = await page.evaluate(() => {
    // crepe 斜杠菜单：找含「模板」组的容器
    const menus = Array.from(document.querySelectorAll('.milkdown-slash-menu[data-show="true"]'));
    for (const m of menus) {
      const groups = Array.from(m.querySelectorAll('.menu-group'));
      const g = groups.find(x => x.querySelector('h6')?.textContent?.includes('模板'));
      if (g) return { items: Array.from(g.querySelectorAll('li')).map(li => li.textContent.trim()).slice(0, 3) };
    }
    return null;
  });
  console.log('  模板组:', JSON.stringify(tplGroup));
  check('/ 菜单含「模板」组', tplGroup !== null && tplGroup.items.length >= 1);

  // 插入 demo 模板（连续输入过滤）
  await page.keyboard.type('demo');
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  let md = await page.evaluate(() => window.__editorGetMarkdown());
  check('插入模板含 doctype', md.includes('doctype:demo'));
  check('插入模板含占位符 {{title}}', md.includes('{{title}}'));
  check('插入模板含版本段落', md.includes('## 版本'));

  // ---- 3. ref 菜单第二级实体 ----
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('[[笔记/周报');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  // 轮询等实体级出现
  let entityLabels = [];
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(300);
    entityLabels = await page.evaluate(() => {
      const el = document.querySelector('[data-ref-menu][data-show="true"] .menu-group');
      return el ? Array.from(el.querySelectorAll('li span')).map(s => s.textContent.trim()) : [];
    });
    if (entityLabels.length >= 2) break;
  }
  console.log('  实体列表:', JSON.stringify(entityLabels));
  check('实体级显示问候语', entityLabels.includes('问候语'));
  check('实体级显示版本号', entityLabels.includes('版本号'));
  // 选版本号（第 2 项）
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  md = await page.evaluate(() => window.__editorGetMarkdown());
  check('插入 [[笔记/周报#version]]', md.includes('[[笔记/周报#version]]'));
  const newObj = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('[data-object-ref]'));
    return spans.filter(s => s.getAttribute('data-object') === 'version').map(s => s.getAttribute('data-text'));
  });
  check('新插入对象已解析', newObj.some(t => t && t.includes('v0.2.1')));

  // ---- 4. 基于模板新建 ----
  // 确保侧边栏展开（collapsed 在 content-col 上）
  const collapsed = await page.evaluate(() => document.querySelector('.content-col')?.classList.contains('collapsed'));
  if (collapsed) {
    await page.locator('.icon-col .icon-btn').first().click().catch(async () => { await page.keyboard.press('Control+b'); });
    await page.waitForTimeout(500);
  }
  await page.locator('.tree').first().click({ position: { x: 12, y: 12 }, button: 'right' });
  await page.waitForTimeout(400);
  await page.locator('.menu-item', { hasText: '基于模板新建' }).click();
  await page.waitForTimeout(600);
  check('模板选择器打开', await page.locator('.tpl-picker').count() > 0);
  await page.locator('.tpl-item', { hasText: 'demo' }).first().click();
  await page.waitForTimeout(400);
  await page.keyboard.type('从模板新建的周报'); // 自动补 .md
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  md = await page.evaluate(() => window.__editorGetMarkdown());
  check('新建文件含模板内容', md.includes('doctype:demo') && md.includes('{{title}}'));
  // 打开文件自动收纳侧边栏 → 重新展开再检查文件树
  const collapsed2 = await page.evaluate(() => document.querySelector('.content-col')?.classList.contains('collapsed'));
  if (collapsed2) {
    await page.locator('.icon-col .icon-btn').first().click();
    await page.waitForTimeout(500);
  }
  // 展开右键所在目录（笔记）后检查新文件
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(600);
  check('文件树显示新文件', await page.locator('.tree .name', { hasText: '从模板新建的周报' }).count() > 0);

  await page.screenshot({ path: '/media/writeIt/editor-app/demo-shots/17-模板机制-M4.png' });
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
})();
