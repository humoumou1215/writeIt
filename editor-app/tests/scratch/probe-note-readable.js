// 验证 v7.1：单引号属性 + JSON 双引号原样（可读性）+ 特殊字符评论 round-trip + 旧格式兼容
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  // 构造：含特殊字符评论 + 旧格式（双引号 &quot;）批注，验证兼容
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/批注可读性测试.md'] = [
      'doctype:demo',
      '',
      '# 批注可读性测试',
      '',
      // 旧格式：双引号属性 + &quot; 转义（兼容测试）
      '<mark data-note="[{&quot;a&quot;:&quot;旧格式&quot;,&quot;c&quot;:&quot;旧评论&quot;,&quot;t&quot;:1000,&quot;r&quot;:0}]">旧格式锚点</mark> 段落。',
      '',
      '新格式段落文本。',
      '',
    ].join('\n');
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.mini.pin').first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '批注可读性测试.md' }).click();
  await page.waitForTimeout(6000);

  // 1. 旧格式兼容：抽屉里旧批注作者/内容正确
  const oldCard = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.ad-card'));
    const c = cards.find((x) => (x.querySelector('.ad-anchor')?.textContent || '').includes('旧格式锚点'));
    if (!c) return null;
    return {
      anchor: c.querySelector('.ad-anchor')?.textContent ?? '',
      author: c.querySelector('.ad-author')?.textContent ?? '',
      content: c.querySelector('.ad-comment-content')?.textContent ?? '',
    };
  });
  console.log('旧格式批注卡:', JSON.stringify(oldCard));
  console.log('旧格式兼容:', oldCard?.author === '旧格式' && oldCard?.content === '旧评论' ? '✅' : '❌');

  // 2. 新段落添加含特殊字符评论：单引号、双引号、&、<、>
  const p = page.locator('.ProseMirror p', { hasText: '新格式段落文本' }).first();
  const pbox = await p.boundingBox();
  if (!pbox) { console.log('no p box'); process.exit(1); }
  await page.mouse.move(pbox.x + 2, pbox.y + pbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(pbox.x + 100, pbox.y + pbox.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+r');
  await page.waitForTimeout(700);
  await page.locator('.annotation-input-ta').fill("含'单引号' \"双引号\" & 与 <尖括号>");
  await page.locator('.annotation-input-ta').press('Enter');
  await page.waitForTimeout(1500);

  const md = await page.evaluate(() => window.__editorGetMarkdown());
  console.log('=== 序列化 md ===');
  console.log(md);
  console.log('=== 新格式可读性检查 ===');
  const m = /data-note=(['"])([^'"]*)\1/.exec(md) ?? [];
  const noteRaw = m[2] ?? '';
  console.log('note 原始(未解码):', JSON.stringify(noteRaw));
  console.log('含双引号原样(非&quot;):', /"/.test(noteRaw) && !noteRaw.includes('&quot;') ? '✅' : '❌');
  console.log('单引号已转义为&#39;:', noteRaw.includes('&#39;') ? '✅' : '❌');
  console.log('& 已转义为&amp;:', noteRaw.includes('&amp;') ? '✅' : '❌');
  console.log('< 已转义为&lt;:', noteRaw.includes('&lt;') ? '✅' : '❌');

  // 3. round-trip：切走切回 → 批注仍在、作者/内容正确（含特殊字符解码）
  await page.locator('.tree .name', { hasText: '引用演示.md' }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('.tree .name', { hasText: '批注可读性测试.md' }).click();
  await page.waitForTimeout(6000);
  const newCard = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.ad-card'));
    const c = cards.find((x) => (x.querySelector('.ad-anchor') || { textContent: '' }).textContent.includes('新格式段落'));
    if (!c) return null;
    return {
      author: c.querySelector('.ad-author')?.textContent ?? '',
      content: c.querySelector('.ad-comment-content')?.textContent ?? '',
    };
  });
  console.log('round-trip 新批注卡:', JSON.stringify(newCard));
  const expect = "含'单引号' \"双引号\" & 与 <尖括号>";
  console.log('round-trip 内容解码正确:', newCard?.content === expect ? '✅' : '❌');

  await browser.close();
})();
