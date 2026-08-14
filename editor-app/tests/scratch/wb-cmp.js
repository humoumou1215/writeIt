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
  // 1. 普通段落输入（块外的正文——如"文件名链接"段落）
  const para = page.locator('.ProseMirror p', { hasText: '文件名链接' }).first();
  await para.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const pbox = await para.boundingBox();
  await page.mouse.click(pbox.x + 60, pbox.y + 10);
  await page.waitForTimeout(400);
  await page.keyboard.type('P1');
  await page.waitForTimeout(600);
  const paraRes = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    return { mdHasP1: md.includes('P1') };
  });
  console.log('[debug] 普通段落输入进 doc:', JSON.stringify(paraRes));
  // 2. 块内输入
  const zhouBlock = page.locator('.ref-file-block', { has: page.locator('.ref-file-block-path', { hasText: '周报' }) }).first();
  const zcnt = await zhouBlock.count();
  console.log('[debug] 周报块数:', zcnt);
  if (zcnt > 0) {
    await zhouBlock.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    const zli = zhouBlock.locator('li').first();
    const zbox = await zli.boundingBox().catch(() => null);
    if (zbox) {
      await page.mouse.click(zbox.x + 25, zbox.y + 8);
      await page.waitForTimeout(400);
      await page.keyboard.type('B1');
      await page.waitForTimeout(600);
    }
  }
  const blockRes = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    return { mdHasB1: md.includes('B1') };
  });
  console.log('[debug] 块内输入进 doc:', JSON.stringify(blockRes));
  // 3. 程序化 dispatch 文本到块内（绕过输入层）
  const dispatchRes = await page.evaluate(() => {
    const ed = window.__editorDebug();
    if (!ed) return 'no-ed';
    let out = 'no-run';
    ed.action((ctx) => {
      // 用 manager 钩子代替——直接 __editorBlockAppend
    });
    return out;
  });
  const docCheck = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    return {
      mdHasBlock: md.includes('![[笔记/周报]]'),
      mdTail: md.slice(-150),
    };
  });
  console.log('[debug] doc 状态:', JSON.stringify(docCheck));
  const nodes = await page.evaluate(() => window.__editorDocNodes());
  console.log('[debug] doc 节点:', JSON.stringify(nodes));
  const appendRes = await page.evaluate(() => (window.__editorBlockAppend && window.__editorBlockAppend('周报', 'D1')) ?? 'no-hook');
  await page.waitForTimeout(800);
  const dispatchCheck = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    // D1 在块内——宿主 md 不含块内容——检查块序列化
    return { hook: 'append', mdHasD1: md.includes('D1') };
  });
  console.log('[debug] 程序化插入:', JSON.stringify({ appendRes, ...dispatchCheck }));
  await browser.close();
})();
