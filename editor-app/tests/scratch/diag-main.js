const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const main = q('.main');
    const editorArea = q('.editor-area');
    const welcome = q('.welcome');
    const contentCol = q('.content-col');
    const app = q('.app');
    return {
      appRect: app?.getBoundingClientRect().toJSON(),
      mainRect: main?.getBoundingClientRect().toJSON(),
      editorAreaRect: editorArea?.getBoundingClientRect().toJSON(),
      welcomeVisible: welcome ? getComputedStyle(welcome).display !== 'none' : false,
      contentColWidth: contentCol?.getBoundingClientRect().width,
      bodyHtml: document.body.innerHTML.length,
    };
  });
  console.log('布局信息:', JSON.stringify(info, null, 1));
  await page.screenshot({ path: '/tmp/main-broken.png' });
  await browser.close();
})();
