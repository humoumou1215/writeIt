// 问题 1/3/4：完整路径显示、object_ref 点击跳转、平滑滚动
const { chromium } = require('playwright');
let pass = 0, fail = 0;
function check(name, ok) { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}`); }

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 180)));
  page.on('console', (m) => { if (m.text().includes('[click]')) console.log('LOG:', m.text().slice(0, 120)); });
  await page.goto('http://localhost:5173/?backend=mock', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(8000);

  // ---- 1. 完整路径显示 ----
  const chipTexts = await page.evaluate(() => Array.from(document.querySelectorAll('a.ref-file')).map(a => a.textContent));
  console.log('file_ref 显示:', JSON.stringify(chipTexts));
  check('显示完整路径（笔记/会议记录）', chipTexts.some(t => t === '笔记/会议记录'));
  check('显示完整路径+片段', chipTexts.some(t => t === '笔记/会议记录#2026-08-11 周会'));

  // ---- 3. object_ref 点击跳转 ----
  // 当前在引用演示；点 版本号 对象 → 打开 周报 并滚到 版本 标题
  const verLoc = page.locator('span.ref-object[data-object="version"]').first();
  check('找到 version 对象', await verLoc.count() > 0);
  await verLoc.click();
  check('点击 version 对象', true);
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.tabbar .tab-name')).map(t => t.textContent.trim());
    return { tabs, active: tabs[tabs.length - 1] };
  });
  console.log('点击后标签:', JSON.stringify(after));
  check('点击对象跳转打开周报', after.active === '周报.md');
  // 检查是否滚动到版本标题附近（smooth 需要时间）
  await page.waitForTimeout(1200);
  const scrollInfo = await page.evaluate(() => {
    // 活动标签的编辑器（可见的 ProseMirror）
    const visible = Array.from(document.querySelectorAll('.editor-pane')).find(p => p.offsetParent !== null || getComputedStyle(p).display !== 'none');
    const pm = visible?.querySelector('.ProseMirror');
    const pane = visible;
    const headings = pm ? Array.from(pm.querySelectorAll('h2')).map(h => ({ text: h.textContent.trim(), top: Math.round(h.getBoundingClientRect().top) })) : [];
    return { scrollTop: pane?.scrollTop ?? -1, headings };
  });
  console.log('滚动信息:', JSON.stringify(scrollInfo));
  const verHeading = scrollInfo.headings.find(h => h.text.includes('版本'));
  check('版本标题在视口内', verHeading && verHeading.top > -50 && verHeading.top < 600);

  await browser.close();
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
})();
