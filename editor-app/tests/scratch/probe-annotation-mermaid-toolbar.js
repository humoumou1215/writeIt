// 复现：代码块内选中文本 → 工具栏「添加批注」入口
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/mermaid批注测试.md'] = 'doctype:demo\n\n# Mermaid 批注测试\n\n```mermaid\ngraph TD\n    A[开始] --> B[结束]\n```\n\n正常段落文本。\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: 'mermaid批注测试.md' }).click();
  await page.waitForTimeout(6000);

  // 代码块内用鼠标选中一段文本
  const cm = page.locator('.milkdown-code-block:visible .cm-content').first();
  const box = await cm.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 10, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(800);

  const toolbar = await page.locator('.milkdown-toolbar').count();
  console.log('代码块内选中后 toolbar 出现:', toolbar > 0);
  const addBtn = await page.locator('[data-toolbar-item="add-annotation"]').count();
  console.log('add-annotation 按钮存在:', addBtn > 0);
  if (addBtn > 0) {
    await page.locator('[data-toolbar-item="add-annotation"]').first().click();
    await page.waitForTimeout(700);
    const inputShown = await page.locator('.annotation-input-visible').count();
    console.log('批注输入浮窗:', inputShown);
    if (inputShown) {
      await page.locator('.annotation-input-ta').fill('工具栏添加的代码块批注');
      await page.locator('.annotation-input-ta').press('Enter');
      await page.waitForTimeout(1200);
      const md = await page.evaluate(() => window.__editorGetMarkdown());
      console.log('=== 工具栏入口序列化 md ===');
      console.log(md);
      const errText = await page.locator('.milkdown-code-block .preview').first().innerText().catch(() => '');
      console.log('mermaid 解析异常:', /Mermaid 渲染失败|Error/i.test(errText));
    }
  }
  await browser.close();
})();
