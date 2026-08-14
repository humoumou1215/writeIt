// Mermaid 预览放大查看：悬停放大镜按钮 → Lightbox 放大 → ESC/✕/遮罩关闭 → 缩放/复位
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  // 打开 Mermaid 图表集（根文件）
  await page.locator('.tree .name', { hasText: 'Mermaid 图表集.md' }).click();
  await page.waitForTimeout(3000);

  // 1. 渲染结果被包裹：.mmd-zoomable 内含 svg + 放大镜按钮
  await page.waitForSelector('.mmd-zoomable', { timeout: 15000 });
  const wraps = await page.locator('.mmd-zoomable').count();
  ok('预览被 .mmd-zoomable 包裹（≥1）', wraps >= 1);
  const btnCount = await page.locator('.mmd-zoomable .mmd-zoom-btn').count();
  ok('每个包裹层带放大镜按钮', btnCount === wraps);
  const hasSvg = await page.locator('.mmd-zoomable > svg').first().isVisible().catch(() => false);
  ok('包裹层内是渲染出的 SVG', hasSvg);

  // 2. 未悬停时按钮隐藏（opacity 0），悬停后显示
  const btn = page.locator('.mmd-zoomable .mmd-zoom-btn').first();
  const opacityBefore = await btn.evaluate(el => getComputedStyle(el).opacity);
  ok('未悬停时放大镜按钮 opacity=0', opacityBefore === '0');
  await page.locator('.mmd-zoomable').first().hover();
  await page.waitForTimeout(300);
  const opacityAfter = await btn.evaluate(el => getComputedStyle(el).opacity);
  ok('悬停预览后放大镜按钮显示（opacity=1）', opacityAfter === '1');

  // 3. 点击放大镜 → Lightbox 打开，内部是放大的 SVG
  await btn.click();
  await page.waitForTimeout(400);
  const lightboxCount = await page.locator('.mmd-lightbox').count();
  ok('点击后 Lightbox 打开', lightboxCount === 1);
  const lbSvg = await page.locator('.mmd-lightbox-canvas > svg').count();
  ok('Lightbox 画布内是 SVG', lbSvg === 1);
  const hasCloseBtn = await page.locator('.mmd-lightbox-close').count();
  ok('Lightbox 有关闭按钮', hasCloseBtn === 1);
  const transform = await page.locator('.mmd-lightbox-canvas').evaluate(el => el.style.transform);
  ok('画布应用了 translate+scale 变换', /translate\(.+\) scale\(/.test(transform));

  // 4. ESC 关闭（核心需求）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('ESC 关闭 Lightbox', await page.locator('.mmd-lightbox').count() === 0);

  // 5. 再次打开 → 点 ✕ 关闭
  await btn.click();
  await page.waitForTimeout(300);
  await page.locator('.mmd-lightbox-close').click();
  await page.waitForTimeout(300);
  ok('点 ✕ 关闭 Lightbox', await page.locator('.mmd-lightbox').count() === 0);

  // 6. 再次打开 → 点遮罩空白处关闭
  await btn.click();
  await page.waitForTimeout(300);
  await page.mouse.click(30, 30); // 左上角遮罩空白
  await page.waitForTimeout(300);
  ok('点遮罩空白处关闭 Lightbox', await page.locator('.mmd-lightbox').count() === 0);

  // 7. 滚轮缩放：scale 变大；双击复位
  await btn.click();
  await page.waitForTimeout(300);
  const before = await page.locator('.mmd-lightbox-canvas').evaluate(el => {
    const m = /scale\(([\d.]+)\)/.exec(el.style.transform);
    return m ? parseFloat(m[1]) : 0;
  });
  await page.mouse.move(700, 350);
  await page.mouse.wheel(0, -120); // 向上滚 = 放大
  await page.waitForTimeout(200);
  const after = await page.locator('.mmd-lightbox-canvas').evaluate(el => {
    const m = /scale\(([\d.]+)\)/.exec(el.style.transform);
    return m ? parseFloat(m[1]) : 0;
  });
  ok('滚轮向上缩放变大', after > before + 0.01);
  await page.mouse.dblclick(700, 350);
  await page.waitForTimeout(200);
  const reset = await page.locator('.mmd-lightbox-canvas').evaluate(el => {
    const m = /scale\(([\d.]+)\)/.exec(el.style.transform);
    return m ? parseFloat(m[1]) : 0;
  });
  ok('双击复位到适配缩放', Math.abs(reset - before) < 0.001);

  // 8. 拖拽平移：位置变化；拖拽后松开不触发关闭
  const posBefore = await page.locator('.mmd-lightbox-canvas').evaluate(el => {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
  });
  await page.mouse.move(700, 350);
  await page.mouse.down();
  await page.mouse.move(780, 400, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const posAfter = await page.locator('.mmd-lightbox-canvas').evaluate(el => {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
  });
  ok('拖拽后画布平移', posBefore && posAfter && posAfter.x > posBefore.x + 40 && posAfter.y > posBefore.y + 20);
  ok('拖拽结束不触发关闭（仍在 Lightbox 内）', await page.locator('.mmd-lightbox').count() === 1);
  await page.keyboard.press('Escape');

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
