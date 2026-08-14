// 找出块内被手柄拦截的点击区域
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
  const zhouBlock = page.locator('.ref-file-block', { has: page.locator('.ref-file-block-path', { hasText: '周报' }) }).first();
  await zhouBlock.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const box = await zhouBlock.boundingBox();
  console.log('[debug] 块 box:', JSON.stringify(box));
  if (!box) process.exit(1);
  // 先 hover 块触发手柄显示，检查手柄 DOM
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.waitForTimeout(600);
  const handles = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*="handle"]')).filter(h => getComputedStyle(h).display !== 'none').map(h => {
      const r = h.getBoundingClientRect();
      return { cls: h.className.slice(0, 40), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), role: h.getAttribute('data-role') };
    });
  });
  console.log('[debug] 可见手柄:', JSON.stringify(handles));
  // 测试点击位置网格（相对块内）
  const positions = [
    { label: '顶部', x: box.x + box.width / 2, y: box.y + 15 },
    { label: '标题', x: box.x + 60, y: box.y + 45 },
    { label: '中部内容', x: box.x + 100, y: box.y + box.height / 2 },
    { label: '左缘', x: box.x + 8, y: box.y + box.height / 2 },
    { label: '底部', x: box.x + box.width / 2, y: box.y + box.height - 15 },
  ];
  for (const p of positions) {
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(350);
    const f = await page.evaluate(() => {
      const el = document.activeElement;
      const pm = document.querySelector('.ProseMirror');
      return {
        activeIsPM: el === pm || pm?.contains(el),
        activeCls: el ? el.className.slice(0, 40) : 'none',
        activeRole: el ? el.getAttribute('data-role') : null,
      };
    });
    await page.keyboard.type('T');
    await page.waitForTimeout(400);
    const ue = await page.evaluate(() => {
      const tabs = document.querySelectorAll('.tabbar .tab');
      return Array.from(tabs).map(t => t.querySelector('.dot.dirty') ? 1 : 0);
    });
    const blockTxt = await zhouBlock.textContent().catch(() => '');
    const hasT = blockTxt.includes('T');
    console.log(`[debug] ${p.label}: 焦点=${JSON.stringify(f)} 块含T=${hasT}`);
    // 撤销 T（避免累积）
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
  }
  await browser.close();
})();
