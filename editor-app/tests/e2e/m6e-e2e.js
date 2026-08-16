// M6 v7：代码块整块批注（变体 D）
//   代码块内选中文本添加批注 → 自动升级为整块批注：锚点=代码块摘要（语言+首行），
//   批注节点插入代码块上方新段落；mermaid 预览不破坏；round-trip 稳定。
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/mermaid批注测试.md'] = 'doctype:demo\n\n# Mermaid 批注测试\n\n```mermaid\ngraph TD\n    A[开始] --> B[结束]\n    B --> C{判断}\n```\n\n普通段落文本。\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  // 固定侧边栏（防止打开文件后自动收纳，导致后续切换文件时树不可见）
  await page.locator('.mini.pin').first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: 'mermaid批注测试.md' }).click();
  await page.waitForTimeout(6000);

  // 1. 初始 mermaid 预览正常
  const svg0 = await page.locator('.milkdown-code-block .preview svg').count();
  ok('初始 mermaid 预览渲染', svg0 > 0);

  // 2. 代码块内选中文本 → Ctrl+R → 块级提示
  const cm = page.locator('.milkdown-code-block:visible .cm-content').first();
  const box = await cm.boundingBox();
  if (!box) { console.log('no cm box'); process.exit(1); }
  await page.mouse.move(box.x + 20, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 8, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+r');
  await page.waitForTimeout(700);
  const inputShown = await page.locator('.annotation-input-visible').count();
  ok('Ctrl+R 弹出评论输入框', inputShown > 0);
  const ph = await page.locator('.annotation-input-ta').getAttribute('placeholder');
  ok('提示以整个代码块为锚点', (ph || '').includes('整个代码块'));

  // 3. 提交 → 摘要段落 + mark + 代码块完整
  await page.locator('.annotation-input-ta').fill('代码块批注内容');
  await page.locator('.annotation-input-ta').press('Enter');
  await page.waitForTimeout(1500);
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  ok('摘要锚点段落（代码块 (mermaid)）', md.includes('代码块 (mermaid)：graph TD'));
  ok('批注 mark 落盘', /<mark data-note/.test(md));
  ok('mermaid 代码块完整', md.includes('```mermaid') && md.includes('B --> C{判断}') && md.includes('```'));
  const markIdx = md.indexOf('<mark data-note');
  const fenceIdx = md.indexOf('```mermaid');
  ok('mark 位于代码块上方', markIdx >= 0 && fenceIdx > markIdx);

  // 4. mermaid 预览不破坏
  await page.waitForTimeout(800);
  const svg1 = await page.locator('.milkdown-code-block .preview svg').count();
  ok('批注后 mermaid 预览仍渲染', svg1 > 0);
  const errText = await page.locator('.milkdown-code-block .preview').first().innerText().catch(() => '');
  ok('无渲染失败提示', !/渲染失败/i.test(errText));

  // 5. 抽屉批注卡（锚点=摘要）+ 回复
  await page.waitForTimeout(800);
  const cardAnchor = await page.locator('.ad-card .ad-anchor').first().innerText().catch(() => '');
  ok('批注卡锚点=代码块摘要', (cardAnchor || '').includes('代码块 (mermaid)'));
  await page.locator('.ad-card:not(.read-only) .ad-card-head').first().click();
  await page.waitForTimeout(600);
  const replyBox = await page.locator('.ad-card.active .ad-reply textarea').count();
  ok('点头部展开回复框', replyBox > 0);
  await page.locator('.ad-card.active .ad-reply textarea').fill('代码块批注的回复');
  await page.locator('.ad-reply-actions button', { hasText: '发送' }).click();
  await page.waitForTimeout(1200);
  const comments = await page.locator('.ad-card .ad-comment').count();
  ok('回复后评论 2 条', comments === 2);

  // 6. round-trip：切走再切回
  await page.locator('.tree .name', { hasText: '周报.md' }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('.tree .name', { hasText: 'mermaid批注测试.md' }).click();
  await page.waitForTimeout(6000);
  const md2 = await page.evaluate(() => window.__editorGetMarkdown());
  ok('round-trip 后摘要段落保留', md2.includes('代码块 (mermaid)：graph TD'));
  ok('round-trip 后代码块完整', md2.includes('```mermaid') && md2.includes('B --> C{判断}'));
  const svg2 = await page.locator('.milkdown-code-block .preview svg').count();
  ok('round-trip 后 mermaid 预览正常', svg2 > 0);
  const cardAfter = await page.locator('.ad-card .ad-anchor').first().innerText().catch(() => '');
  ok('round-trip 后批注卡仍在', (cardAfter || '').includes('代码块 (mermaid)'));

  // 7. 普通段落批注不受影响（锚点=选中文本）
  const p = page.locator('.ProseMirror p', { hasText: '普通段落文本' }).first();
  const pbox = await p.boundingBox();
  if (pbox) {
    await page.mouse.move(pbox.x + 2, pbox.y + pbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(pbox.x + 90, pbox.y + pbox.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await page.keyboard.press('Control+r');
    await page.waitForTimeout(700);
    const input2 = await page.locator('.annotation-input-visible').count();
    ok('段落批注浮窗正常', input2 > 0);
    const ph2 = await page.locator('.annotation-input-ta').getAttribute('placeholder');
    ok('段落批注提示为普通文案', (ph2 || '').includes('在此输入评论'));
    await page.locator('.annotation-input-ta').fill('段落批注');
    await page.locator('.annotation-input-ta').press('Enter');
    await page.waitForTimeout(1500);
    const md3 = await page.evaluate(() => window.__editorGetMarkdown());
    // 段落批注的 mark 内容 = 选中文本（非代码块摘要），且与摘要 mark 共存
    // v7.1：单引号属性（值内无裸单引号，escapeAttr 保证）
    const marks3 = md3.match(/<mark data-note='[^']*'>[^<]*<\/mark>/g) || [];
    ok('段落批注锚点=选中文本', marks3.length >= 2 && !marks3[1].includes('代码块'));
  } else {
    console.log('❌ 无段落框');
    fail++;
  }

  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
