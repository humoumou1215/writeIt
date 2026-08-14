const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
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
  const zhouBlock = page.locator('.ref-file-block', { has: page.locator('.ref-file-block-path', { hasText: '周报' }) }).first();
  await zhouBlock.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const box = await zhouBlock.boundingBox();
  const selInfo = () => page.evaluate(() => {
    const ed = window.__editorDebug();
    let out = { sel: -1, docLen: -1, node: '' };
    ed.action((ctx) => {
      const { editorViewCtx } = window.__proto__ ? {} : {};
    });
    return out;
  });
  // 点击块头部
  await page.mouse.click(box.x + 30, box.y + 12);
  await page.waitForTimeout(400);
  const hdr = await page.evaluate(() => {
    const ed = window.__editorDebug();
    let out = { sel: -1, docLen: -1, node: '' };
    if (ed) {
      ed.action((ctx) => {
        // 无法动态 import——用 DOM 层近似
      });
    }
    // 从 DOM 看光标所在元素
    const sel = window.getSelection();
    const anchor = sel.anchorNode;
    out.sel = sel.anchorOffset;
    out.node = anchor ? anchor.nodeName + ':' + (anchor.textContent || '').slice(0, 20) : 'none';
    return out;
  });
  console.log('[debug] 点头部后 selection:', JSON.stringify(hdr));
  await page.keyboard.type('X');
  await page.waitForTimeout(600);
  const afterHdr = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('周报'));
    const md = window.__editorGetMarkdown();
    return { blockHasX: b ? b.textContent.includes('X') : 'no', mdHasX: md.includes('X') };
  });
  console.log('[debug] 头部点击输入后:', JSON.stringify(afterHdr));
  const vsH = await page.evaluate(() => window.__editorSelection());
  console.log('[debug] 头部后 view selection:', JSON.stringify(vsH));
  // 点击块内容 li
  const zli = zhouBlock.locator('li').first();
  const zbox = await zli.boundingBox();
  await page.mouse.click(zbox.x + 25, zbox.y + 8);
  await page.waitForTimeout(400);
  const c = await page.evaluate(() => {
    const sel = window.getSelection();
    const anchor = sel.anchorNode;
    return { sel: sel.anchorOffset, node: anchor ? anchor.nodeName + ':' + (anchor.textContent || '').slice(0, 25) : 'none' };
  });
  console.log('[debug] 点内容后 DOM selection:', JSON.stringify(c));
  const vs = await page.evaluate(() => window.__editorSelection());
  console.log('[debug] 点内容后 view selection:', JSON.stringify(vs));
  await page.keyboard.type('Y');
  await page.waitForTimeout(600);
  const afterC = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('周报'));
    const md = window.__editorGetMarkdown();
    return { blockHasY: b ? b.textContent.includes('Y') : 'no', mdHasY: md.includes('Y') };
  });
  console.log('[debug] 内容点击输入后:', JSON.stringify(afterC));
  await browser.close();
})();
