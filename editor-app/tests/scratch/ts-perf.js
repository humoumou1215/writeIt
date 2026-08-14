const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('console', (m) => { if (m.text().includes('[tsperf]')) console.log('LOG:', m.text()); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  // 直接测 loadTsModule 耗时分解
  await page.evaluate(async () => {
    const { loadTsModule } = await import('/src/template/ts-loader.ts');
    const { fs } = await import('/src/fs/index.ts');
    const t0 = performance.now();
    const source = await fs.readFile('template/demo/demo.suggest.ts');
    console.log('[tsperf] readFile:', Math.round(performance.now() - t0) + 'ms');
    const t1 = performance.now();
    const mod = await loadTsModule('x', () => Promise.resolve(source));
    console.log('[tsperf] loadTsModule(transform+exec):', Math.round(performance.now() - t1) + 'ms, objects=', mod?.objects?.length);
    const t2 = performance.now();
    const mod2 = await loadTsModule('y', () => Promise.resolve(source));
    console.log('[tsperf] 第二次 transform:', Math.round(performance.now() - t2) + 'ms');
  });
  await browser.close();
})();
