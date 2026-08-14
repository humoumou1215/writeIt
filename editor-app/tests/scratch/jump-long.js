const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  page.on('console', (m) => { if (m.text().includes('[scroll2]')) console.log('LOG:', m.text().slice(0, 160)); });
  await page.waitForTimeout(2500);
  // 造一个长文档 笔记/会议记录（60 个标题）
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    let md = '# 会议记录\n\n';
    for (let i = 1; i <= 60; i++) md += `## 标题${i}\n\n这是标题 ${i} 的内容段落，用来撑起文档高度。\n\n`;
    fs.files['笔记/会议记录.md'] = md;
    // 引用演示加链接
    fs.files['引用演示.md'] = fs.files['引用演示.md'].replace('- [[笔记/会议记录#2026-08-11 周会]]', '- [[笔记/会议记录#标题2]]');
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(5000);
  // 点击 [[笔记/会议记录#标题2]]
  const f = page.locator('a.ref-file[data-fragment="标题2"]').first();
  console.log('链接存在:', await f.count() > 0);
  await f.click();
  await page.waitForTimeout(3000);
  const st = await page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll('.editor-pane')).find(p => getComputedStyle(p).display !== 'none');
    const pm = visible?.querySelector('.ProseMirror');
    const head = pm ? Array.from(pm.querySelectorAll('h1,h2,h3')).find(h => h.textContent.trim() === '标题2') : null;
    const paneRect = visible?.getBoundingClientRect();
    const headRect = head?.getBoundingClientRect();
    // 滚动容器信息
    const scrollChain = [];
    let el = head;
    while (el) {
      const cs = getComputedStyle(el);
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') scrollChain.push(el.className);
      el = el.parentElement;
    }
    return {
      paneTop: paneRect ? Math.round(paneRect.top) : null,
      paneBottom: paneRect ? Math.round(paneRect.bottom) : null,
      paneScroll: visible ? Math.round(visible.scrollTop) : null,
      headTop: headRect ? Math.round(headRect.top) : null,
      headVisible: headRect ? headRect.top >= 0 && headRect.bottom <= window.innerHeight : false,
      headCentered: headRect ? Math.abs(headRect.top - (paneRect.top + (paneRect.height * 0.25))) < 120 : false,
      scrollChain,
      milkdownScroll: document.querySelector('.milkdown')?.scrollTop ?? 'none',
      pmScroll: pm?.scrollTop ?? 'none',
    };
  });
  console.log('跳转结果:', JSON.stringify(st, null, 1));
  await browser.close();
})();
