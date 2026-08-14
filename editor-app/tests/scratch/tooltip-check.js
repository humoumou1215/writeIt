const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(5000);
  // 悬停 file_ref（无片段）
  const f1 = page.locator('a.ref-file[data-path="README.md"]').first();
  await f1.hover();
  await page.waitForTimeout(400);
  const t1 = await page.evaluate(() => document.querySelector('.ref-tooltip')?.textContent?.trim());
  console.log('file_ref 浮窗:', JSON.stringify(t1));
  // 悬停带片段的
  const f2 = page.locator('a.ref-file[data-fragment]').first();
  await f2.hover();
  await page.waitForTimeout(400);
  const t2 = await page.evaluate(() => document.querySelector('.ref-tooltip')?.textContent?.trim());
  console.log('file_ref#片段 浮窗:', JSON.stringify(t2));
  // 悬停 object_ref
  const o1 = page.locator('span.ref-object[data-object="version"]').first();
  await o1.hover();
  await page.waitForTimeout(400);
  const t3 = await page.evaluate(() => document.querySelector('.ref-tooltip')?.textContent?.trim());
  console.log('object_ref 浮窗:', JSON.stringify(t3));
  const cur = await page.evaluate(() => getComputedStyle(document.querySelector('span.ref-object')).cursor);
  console.log('object_ref 光标:', cur);
  // 断链（删除文件后）
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    delete fs.files['README.md'];
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(5000);
  const broken = page.locator('a.ref-file.ref-broken').first();
  if (await broken.count() > 0) {
    await broken.hover();
    await page.waitForTimeout(400);
    const t4 = await page.evaluate(() => document.querySelector('.ref-tooltip')?.textContent?.trim());
    console.log('断链浮窗:', JSON.stringify(t4));
  } else {
    console.log('断链浮窗: 未找到断链 chip');
  }
  await browser.close();
})();
