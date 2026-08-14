// M4 第二轮：标题实体（Obsidian 模式）+ suggest 新样例 + 实体级 UI
const { chromium } = require('playwright');
let pass = 0, fail = 0;
function check(name, ok) { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}`); }

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 180)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 160)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  // ---- 1. suggest 新对象解析（引用演示打开后）----
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(5000);
  const objs = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('[data-object-ref]'));
    return spans.map(s => ({ obj: s.getAttribute('data-object'), text: s.getAttribute('data-text') }));
  });
  console.log('object_ref:', JSON.stringify(objs));
  check('todo-count=5', objs.some(s => s.obj === 'todo-count' && s.text === '5'));
  check('progress=3/5', objs.some(s => s.obj === 'progress' && s.text === '3/5'));
  check('first-task=引用语法与节点', objs.some(s => s.obj === 'first-task' && s.text && s.text.includes('引用语法与节点')));

  // ---- 2. 标题实体（无 suggest 文件：会议记录.md）----
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('[[会议记录');
  await page.waitForTimeout(900);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const ent = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu]');
    return {
      h6: el?.querySelector('h6')?.textContent,
      items: Array.from(el.querySelectorAll('.menu-group li')).map(li => li.textContent.trim()).slice(0, 5),
    };
  });
  console.log('会议记录实体级:', JSON.stringify(ent));
  check('标题实体 h6 路径风格', ent.h6 && ent.h6.includes('会议记录') && ent.h6.includes('/'));
  check('标题实体含「会议记录」标题', ent.items.some(t => t.includes('会议记录')));
  check('标题实体含「周会」标题', ent.items.some(t => t.includes('2026-08-11 周会')));
  // 实体级：首项=文件本身，其后是标题 → 选第三个（周会）插入 [[会议记录#2026-08-11 周会]]
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  check('插入标题引用', md.includes('[[笔记/会议记录#2026-08-11 周会]]'));
  const frags = await page.evaluate(() => {
    const as = Array.from(document.querySelectorAll('a[data-file-ref]'));
    return as.map(a => ({ frag: a.getAttribute('data-fragment'), text: a.textContent }));
  });
  console.log('file_ref:', JSON.stringify(frags));
  check('file_ref fragment 正确', frags.some(f => f.frag === '2026-08-11 周会'));

  // ---- 3. suggest 对象实体（周报.md 5 个对象）----
  await page.evaluate(() => window.__editorGoEnd());
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('[[笔记/周报');
  await page.waitForTimeout(900);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const ent2 = await page.evaluate(() => {
    const el = document.querySelector('[data-ref-menu]');
    return Array.from(el.querySelectorAll('.menu-group li')).map(li => li.textContent.trim());
  });
  console.log('周报实体级:', JSON.stringify(ent2));
  check('周报实体级=文件+5对象', ent2.length === 6 && ent2.some(t => t.includes('完成率')) && ent2.some(t => t.includes('首个待办')));

  await page.screenshot({ path: '/media/writeIt/editor-app/demo-shots/18-实体级引用-标题与对象.png' });
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
})();
