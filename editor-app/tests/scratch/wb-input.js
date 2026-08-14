const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { const t = m.text(); if (t.includes('[inp]')) console.log('LOG:', t.slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    let z = fs.files['引用演示.md'] || '';
    if (!z.includes('![[笔记/周报]]')) z += '\n\n![[笔记/周报]]\n';
    fs.files['引用演示.md'] = z;
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('引用演示.md'));
  await page.waitForTimeout(5500);
  // 监听 beforeinput
  await page.evaluate(() => {
    window.__inpLog = [];
    document.addEventListener('beforeinput', (e) => {
      window.__inpLog.push({ type: e.inputType, data: e.data, target: e.target?.className?.slice?.(0, 30) || e.target?.nodeName });
    }, true);
  });
  const zhouBlock = page.locator('.ref-file-block', { has: page.locator('.ref-file-block-path', { hasText: '周报' }) }).first();
  await zhouBlock.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const zli = zhouBlock.locator('li').first();
  const zbox = await zli.boundingBox();
  await page.mouse.click(zbox.x + 25, zbox.y + 8);
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('周报'));
    const content = b?.querySelector('.ref-file-block-content');
    return {
      contentEditableAttr: content?.getAttribute('contenteditable'),
      isContentEditable: content?.isContentEditable,
      editorRootCE: document.querySelector('.ProseMirror')?.getAttribute('contenteditable'),
      editorRootIsCE: document.querySelector('.ProseMirror')?.isContentEditable,
    };
  });
  console.log('[debug] contenteditable 状态:', JSON.stringify(st));
  // 输入
  await page.keyboard.type('Z');
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('周报'));
    return { mdHasZ: md.includes('Z'), blockHasZ: b ? b.textContent.includes('Z') : 'no', logs: window.__inpLog.slice(-5) };
  });
  console.log('[debug] 输入后:', JSON.stringify(after));
  await browser.close();
})();
