// 复现：mermaid 代码块内添加批注 → mermaid 解析异常
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  page.on('console', (m) => { const t = m.text(); if (t.includes('[mermaid]') || m.type() === 'error') console.log('CONSOLE:', m.type(), t.slice(0, 300)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/mermaid批注测试.md'] = 'doctype:demo\n\n# Mermaid 批注测试\n\n```mermaid\ngraph TD\n    A[开始] --> B[结束]\n    B --> C{判断}\n```\n\n正常段落文本。\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: 'mermaid批注测试.md' }).click();
  await page.waitForTimeout(6000);

  // 确认 mermaid 预览正常
  const previewOk = await page.locator('.milkdown-code-block .preview svg').count();
  console.log('初始 mermaid 预览 SVG:', previewOk);

  // 在代码块内选中文本 "A[开始]"
  const cm = page.locator('.milkdown-code-block:visible .cm-content').first();
  await cm.click();
  await page.waitForTimeout(400);
  // 全选代码块内容后反选一段：先用 Ctrl+A 全选再输入批注（模拟选中部分）
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(300);
  // 缩小选区：向左移动 10 个字符（留下 "graph TD..." 部分）
  for (let i = 0; i < 14; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.waitForTimeout(300);

  // Ctrl+R 添加批注
  await page.keyboard.press('Control+r');
  await page.waitForTimeout(700);
  const inputShown = await page.locator('.annotation-input-visible').count();
  console.log('批注输入浮窗:', inputShown);
  if (inputShown) {
    await page.locator('.annotation-input-ta').fill('这是代码块内的批注');
    await page.locator('.annotation-input-ta').press('Enter');
    await page.waitForTimeout(1200);
  }

  const md = await page.evaluate(() => window.__editorGetMarkdown());
  console.log('=== 序列化 md ===');
  console.log(md);
  const mdHasMark = /<mark data-note/.test(md);
  console.log('md 含 mark 标签:', mdHasMark);

  // 检查 mermaid 预览是否报错
  const errText = await page.locator('.milkdown-code-block .preview').first().innerText().catch(() => '');
  console.log('=== 预览内容 ===');
  console.log(errText.slice(0, 300));
  const parseErr = /Mermaid 渲染失败|Error/i.test(errText);
  console.log('mermaid 解析异常:', parseErr);

  // round-trip：重新打开（切走再切回）
  await page.locator('.tree .name', { hasText: 'demo.md' }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('.tree .name', { hasText: 'mermaid批注测试.md' }).click();
  await page.waitForTimeout(6000);
  const md2 = await page.evaluate(() => window.__editorGetMarkdown());
  console.log('=== round-trip 后 md ===');
  console.log(md2);
  const md2HasMark = /<mark data-note/.test(md2);
  console.log('round-trip 后 md 含 mark:', md2HasMark);

  await browser.close();
})();
