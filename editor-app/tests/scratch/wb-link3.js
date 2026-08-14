// 场景 3：A 保存后 B 仅块改动 → 关闭无提示；B 有独立修改 → 关闭提示
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/嵌入测试.md'] = 'doctype:demo\n\n# 嵌入测试\n\n![[笔记/周报]]\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('笔记/周报.md'));
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('笔记/嵌入测试.md'));
  await page.waitForTimeout(4500);
  // 编辑 B 块 → A 保存
  await page.evaluate(() => window.__editorBlockAppend && window.__editorBlockAppend('周报', '场景3条目'));
  await page.waitForTimeout(2000);
  await page.locator('.tabbar .tab', { hasText: '周报' }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2500);
  // B 仅块改动 → 脏灭 → 关闭 B 无提示
  const st = await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('.tabbar .tab')).find(x => x.textContent.includes('嵌入测试'));
    return !!t?.querySelector('.dot.dirty');
  });
  ok('A 保存后 B 仅块改动 → B 脏灭', st === false);
  await page.locator('.tabbar .tab', { hasText: '嵌入测试' }).hover();
  await page.waitForTimeout(300);
  // 关闭按钮
  const closeBtn = page.locator('.tabbar .tab', { hasText: '嵌入测试' }).locator('.tab-close, button, [class*="close"]').first();
  await closeBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1500);
  const modal = await page.locator('.modal-mask').count();
  ok('B 脏灭关闭无确认', modal === 0);
  const tabsAfter = await page.evaluate(() => document.querySelectorAll('.tabbar .tab').length);
  ok('B 已关闭', tabsAfter === 1);
  // B 有独立修改 → 关闭提示
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('笔记/嵌入测试.md'));
  await page.waitForTimeout(4500);
  await page.evaluate(() => window.__editorGoEnd && window.__editorGoEnd());
  await page.keyboard.press('Enter');
  await page.keyboard.type('独立修改3');
  await page.waitForTimeout(800);
  await page.locator('.tabbar .tab', { hasText: '嵌入测试' }).hover();
  await page.waitForTimeout(300);
  await closeBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1500);
  const modal2 = await page.locator('.modal-mask').count();
  ok('B 有独立修改关闭弹确认', modal2 > 0);
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
