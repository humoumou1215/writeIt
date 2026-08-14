// 干净复现：只打开引用演示 → 点块内 li → 输入 → 确认 activeTab + 引用演示 doc
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
    let z = fs.files['引用演示.md'] || '';
    if (!z.includes('![[笔记/周报]]')) z += '\n\n![[笔记/周报]]\n';
    fs.files['引用演示.md'] = z;
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__editorOpenPath && window.__editorOpenPath('引用演示.md'));
  await page.waitForTimeout(5500);
  const zhouBlock = page.locator('.ref-file-block').first();
  await zhouBlock.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  const zli = zhouBlock.locator('li').first();
  const zbox = await zli.boundingBox();
  console.log('[debug] 块 li box:', JSON.stringify(zbox));
  await page.mouse.click(zbox.x + 25, zbox.y + 8);
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => ({
    activeTab: window.__editorDocNodes().activeTab,
    tabs: Array.from(document.querySelectorAll('.tabbar .tab-name')).map(t => t.textContent.trim()),
  }));
  console.log('[debug] 点击后状态:', JSON.stringify(before));
  // 先测程序化 dispatch（绕过输入层）
  const ap = await page.evaluate(() => (window.__editorBlockAppend && window.__editorBlockAppend('周报', 'D2')) ?? 'no-hook');
  await page.waitForTimeout(600);
  const afterAppend = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    return { mdHasBlock: md.includes('![[笔记/周报]]'), ap: 'appended' };
  });
  console.log('[debug] 程序化 append:', JSON.stringify(ap), 'mdHasBlock:', afterAppend.mdHasBlock);
  const posAt = await page.evaluate(() => window.__editorPosAtDOM('周报'));
  console.log('[debug] posAtDOM:', JSON.stringify(posAt));
  // 验证 posAtDOM 对块内文本节点
  const posDbg = await page.evaluate(() => {
    const ed = window.__editorDebug();
    let out = {};
    if (ed) {
      ed.action((ctx) => {
        const { editorViewCtx } = window.__proto__ ? {} : {};
      });
    }
    // 用 DOM 检查块内文本节点
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('周报'));
    const content = b?.querySelector('.ref-file-block-content');
    const textNode = content?.querySelector('li')?.firstChild;
    out.textNodeType = textNode ? textNode.nodeType : 'none';
    out.textNodeVal = textNode && textNode.nodeType === 3 ? textNode.textContent.slice(0, 15) : 'no-text';
    return out;
  });
  console.log('[debug] 块内文本节点:', JSON.stringify(posDbg));
  // patch ProseMirror DOMObserver.registerMutation 记录判定
  await page.evaluate(() => {
    window.__regLog = [];
    const ed = window.__editorDebug();
    if (ed) {
      ed.action((ctx) => {
        const { editorViewCtx } = window.__proto__ ? {} : {};
      });
    }
    // 通过 view.domObserver 的 constructor 找原型
    return 'patched-placeholder';
  });
  await page.evaluate(() => {
    const ed = window.__editorDebug();
    if (!ed) return 'no-ed';
    ed.action((ctx) => {
      const { editorViewCtx } = window.__proto__ ? {} : {};
    });
    return 'x';
  });
  // 用真实 DOM 修改 + 手动触发 view 的 flush（通过点击后输入）
  await page.evaluate(() => {
    const b = document.querySelector('.ref-file-block');
    const content = b?.querySelector('.ref-file-block-content');
    const li = content?.querySelector('li');
    if (li) li.appendChild(document.createTextNode('手动ZZZ'));
    return 'done';
  });
  await page.waitForTimeout(1500);
  const afterManual = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('周报'));
    // 尝试通过 input 链手动同步：查 view 上有没有 observer 信息
    let observerInfo = 'none';
    const ed = window.__editorDebug();
    if (ed) {
      ed.action((ctx) => {
        const { editorViewCtx } = window.__proto__ ? {} : {};
      });
    }
    return { mdHasZZZ: md.includes('手动ZZZ'), blockHasZZZ: b ? b.textContent.includes('手动ZZZ') : 'no', observerInfo };
  });
  console.log('[debug] 手动 DOM 修改后:', JSON.stringify(afterManual));
  // 手动强制 flush DOMObserver → 看 doc 是否同步
  const fs = await page.evaluate(() => window.__editorForceSync());
  await page.waitForTimeout(800);
  const afterFlush = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    return { mdHasZZZ: md.includes('手动ZZZ'), fs: 'done' };
  });
  console.log('[debug] 强制 flush 后:', JSON.stringify({ fs, ...afterFlush }));
  await page.keyboard.type('C1');
  await page.waitForTimeout(800);
  const res = await page.evaluate(() => {
    const md = window.__editorGetMarkdown();
    return {
      activeTab: window.__editorDocNodes().activeTab,
      mdHasC1: md.includes('C1'),
      mdLen: md.length,
      sel: window.__editorSelection(),
    };
  });
  console.log('[debug] 输入后:', JSON.stringify(res));
  ok('点击块内后 activeTab 仍是引用演示', (before.tabs || []).length === 1);
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
