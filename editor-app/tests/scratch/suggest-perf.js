const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4000);
  const r = await page.evaluate(async () => {
    const { templateService } = await import('/src/template/service.ts');
    await templateService.ready();
    const t0 = performance.now();
    const objs = await templateService.loadSuggestForFile('template/demo/demo');
    const t1 = performance.now();
    return { ms: Math.round(t1 - t0), count: objs?.length };
  });
  console.log('loadSuggestForFile 直测:', JSON.stringify(r));
  await browser.close();
})();
