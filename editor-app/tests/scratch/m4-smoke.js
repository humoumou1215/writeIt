const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // 1) 模板扫描结果（全局变量暴露）
  const tpl = await page.evaluate(async () => {
    const { templateService } = await import('/src/template/service.ts');
    await templateService.ready();
    return templateService.list().map(t => ({ doctype: t.doctype, name: t.name, domain: t.domain }));
  });
  console.log('模板注册表:', JSON.stringify(tpl));
  // 2) suggest 加载
  const sug = await page.evaluate(async () => {
    const { templateService } = await import('/src/template/service.ts');
    const t = templateService.get('demo');
    const objs = await templateService.ensureSuggest(t);
    return objs ? objs.map(o => o.id) : null;
  });
  console.log('demo suggest 对象:', JSON.stringify(sug));
  // 3) rules 加载（esbuild-wasm 转译执行）
  const rules = await page.evaluate(async () => {
    const { templateService } = await import('/src/template/service.ts');
    const t = templateService.get('demo');
    const r = await templateService.ensureRules(t);
    return r ? { mode: r.mode, count: r.rules.length, labels: r.rules.map(x => x.label) } : null;
  });
  console.log('demo rules 模块:', JSON.stringify(rules));
  await browser.close();
})();
