// M5 strict 门禁：mode strict + error 违规 → 保存前确认
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  // 模板 rules mode 改 strict + 周报无版本章节（制造 error）
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    const rules = fs.files['.template/demo/demo.rules.ts'] || '';
    fs.files['.template/demo/demo.rules.ts'] = rules.replace("export const mode: 'hint' | 'strict' = 'hint'", "export const mode: 'hint' | 'strict' = 'strict'");
    fs.files['笔记/周报.md'] = fs.files['笔记/周报.md'].replace('## 版本\n\nv0.2.1\n', '');
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '周报.md' }).click();
  await page.waitForTimeout(5000);
  // 保存 → 应弹确认框
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2000);
  const dlg = await page.locator('.modal-mask').count();
  ok('strict 保存弹确认框', dlg > 0);
  // 取消 → 不保存
  const cancelBtn = page.locator('.modal-actions button', { hasText: '取消' }).first();
  if (await cancelBtn.count() > 0) await cancelBtn.click();
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    const f = fs.files['笔记/周报.md'] || '';
    return { len: f.length, hasVersion: f.includes('## 版本') };
  });
  ok('取消后未保存（仍缺版本）', !saved.hasVersion);
  // 再保存一次 → 确认保存 → 应写入（但内容无版本）
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2000);
  const dlg2 = await page.locator('.modal-mask').count();
  ok('再次保存仍弹确认', dlg2 > 0);
  if (dlg2 > 0) {
    await page.locator('.modal-actions button', { hasText: '仍然保存' }).first().click();
    await page.waitForTimeout(1500);
  }
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
