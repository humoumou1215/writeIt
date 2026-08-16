// 验证：OPEN_RE 对含双引号 JSON 的单引号属性的匹配行为 + round-trip 后 md
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  // 直接在页面里测 OPEN_RE（与 remark-annotation.ts 同源）
  const re = await page.evaluate(() => {
    const OPEN_RE = /^<mark\s+data-note=(['"])([^'"]*)\1\s*>$/i;
    const s = `<mark data-note='[{"a":"我","c":"评论","t":1,"r":0}]'>文本</mark>`;
    const m = OPEN_RE.exec(s);
    return { ok: !!m, note: m ? m[2] : null };
  });
  console.log('OPEN_RE 匹配含双引号 JSON:', JSON.stringify(re));

  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/re测试.md'] = 'doctype:demo\n\n# 测试\n\n<mark data-note=\'[{"a":"我","c":"双引号内容","t":1,"r":0}]\'>锚点文本</mark> 段落。\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.mini.pin').first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: 're测试.md' }).click();
  await page.waitForTimeout(6000);

  // 打开后：PM 里有没有 annotation 节点？抽屉批注卡？
  const state0 = await page.evaluate(() => {
    const marks = document.querySelectorAll('.ProseMirror mark.annotation').length;
    const card = document.querySelector('.ad-card .ad-comment-content')?.textContent ?? '';
    return { marks, card };
  });
  console.log('打开后 mark 数 / 批注卡内容:', JSON.stringify(state0));

  // 序列化后 md
  const md = await page.evaluate(() => window.__editorGetMarkdown());
  console.log('序列化 md:', md);
  console.log('md 保留 mark:', md.includes('<mark data-note'));
  await browser.close();
})();
