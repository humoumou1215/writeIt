// 验证：块内 IME 组合输入是否进块（组合未提交 vs 提交）
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('笔记/嵌入测试.md'));
  await page.waitForTimeout(4500);
  // 先建嵌入测试文件（含周报块）
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/嵌入测试.md'] = 'doctype:demo\n\n# 嵌入测试\n\n![[笔记/周报]]\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('笔记/嵌入测试.md'));
  await page.waitForTimeout(5000);
  // 点击块内 li
  const zli = page.locator('.ref-file-block li').first();
  await zli.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const zbox = await zli.boundingBox();
  await page.mouse.click(zbox.x + 25, zbox.y + 8);
  await page.waitForTimeout(400);
  // 模拟 IME 组合：compositionstart/update + insertCompositionText input + compositionend
  const imeRes = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror');
    if (!pm) return 'no-pm';
    const sel = window.getSelection();
    const range = sel.getRangeAt(0);
    const fire = (type, data) => {
      const ev = new InputEvent(type, { data, inputType: 'insertCompositionText', bubbles: true, cancelable: true, composed: true });
      pm.dispatchEvent(ev);
    };
    // 组合开始
    pm.dispatchEvent(new CompositionEvent('compositionstart', { data: '我', bubbles: true }));
    fire('beforeinput', '我');
    fire('input', '我');
    pm.dispatchEvent(new CompositionEvent('compositionupdate', { data: '我', bubbles: true }));
    pm.dispatchEvent(new CompositionEvent('compositionend', { data: '我', bubbles: true }));
    // 提交后普通输入（IME 确认上屏通常是 keydown+input）
    fire('beforeinput', '');
    return 'done';
  });
  await page.waitForTimeout(1500);
  const d = await page.evaluate(() => window.__writebackDiag());
  const blockHas = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => x.textContent.includes('我'));
    return b ? 'yes' : 'no';
  });
  console.log('[debug] IME 模拟后块含中文:', blockHas, 'dirty:', JSON.stringify(d.tabs.map(t => ({ t: t.tab, dirty: t.dirty, mdLen: t.mdLen }))));
  // 真实输入中文（keyboard.insertText 走 input）
  await page.keyboard.insertText('中文输入');
  await page.waitForTimeout(1500);
  const d2 = await page.evaluate(() => window.__writebackDiag());
  const blockHas2 = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => x.textContent.includes('中文输入'));
    return b ? 'yes' : 'no';
  });
  console.log('[debug] insertText 后块含中文:', blockHas2, 'dirty:', JSON.stringify(d2.tabs.map(t => ({ t: t.tab, dirty: t.dirty }))));
  ok('insertText 中文进块', blockHas2 === 'yes');
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
