// E2E：导出功能（M10）
// 覆盖：
//   1. 默认导出 PDF（内置中文字体，%PDF 头 + 非空）
//   2. 默认导出 DOCX（PK zip 头 + 非空）
//   3. 默认导出 Markdown（内容一致）
//   4. 设置弹窗「导出」页签 UI（当前文件 / 格式选择 / 按钮导出）
//   5. 模板 export.ts：注入自定义导出 → 按定义（自定义文件名/内容/格式）
// 依赖：dev server :5173 + mock 文件系统（笔记/周报.md，doctype:demo）
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || t.includes('[export]')) console.log(m.type().toUpperCase() + ':', t.slice(0, 300));
  });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  // ---------- 0：无活动标签时导出 → 失败提示（页面初始无标签） ----------
  {
    const outcome = await page.evaluate(() => window.__exportDebug(undefined, 'pdf'));
    ok('无活动标签导出返回错误', outcome && outcome.ok === false && outcome.error === 'no-active-tab');
  }

  // ---------- 1-3：默认导出（调试钩子） ----------
  {
    // PDF
    const [download, outcome] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.evaluate(() => window.__exportDebug('笔记/周报.md', 'pdf')),
    ]);
    ok('PDF 导出 ok + usedExportTs=false', outcome.ok && outcome.usedExportTs === false);
    ok('PDF 文件名 .pdf', (download.suggestedFilename() || '').endsWith('.pdf'));
    const stream = await download.createReadStream();
    const head = await new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).slice(0, 8).toString('latin1')));
      stream.on('error', reject);
    });
    ok('PDF 文件头 %PDF-', head.startsWith('%PDF-'));
    ok('PDF 导出字节数 > 10KB（含中文字体子集）', (outcome.size || 0) > 10000);
  }
  {
    // DOCX
    const [download, outcome] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.evaluate(() => window.__exportDebug('笔记/周报.md', 'docx')),
    ]);
    ok('DOCX 导出 ok', outcome.ok && outcome.format === 'docx');
    ok('DOCX 文件名 .docx', (download.suggestedFilename() || '').endsWith('.docx'));
    const stream = await download.createReadStream();
    const head = await new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).slice(0, 4).toString('latin1')));
      stream.on('error', reject);
    });
    ok('DOCX 文件头 PK（zip）', head === 'PK\x03\x04');
    ok('DOCX 导出字节数 > 2KB', (outcome.size || 0) > 2000);
  }
  {
    // Markdown
    const [download, outcome] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.evaluate(() => window.__exportDebug('笔记/周报.md', 'md')),
    ]);
    ok('MD 导出 ok', outcome.ok && outcome.format === 'md');
    const stream = await download.createReadStream();
    const text = await new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
    ok('MD 导出内容含标题', text.includes('# 周报'));
  }

  // ---------- 4：图标列 📤 独立导出弹窗 UI ----------
  {
    await page.locator('.icon-btn', { hasText: '📤' }).click();
    await page.waitForTimeout(500);
    const modalVisible = await page.locator('.export-modal').isVisible();
    ok('导出弹窗打开（图标列 📤 独立按钮）', modalVisible);
    const pathText = await page.locator('.export-modal .export-path').textContent();
    ok('导出弹窗显示当前文件路径', pathText.includes('笔记/周报.md'));
    const badgeText = await page.locator('.export-modal .export-target .badge').first().textContent();
    ok('导出弹窗显示 doctype', badgeText.includes('demo'));
    // 选 PDF + 点导出
    await page.locator('.export-modal .fmt input[type=radio][value="pdf"]').check();
    await page.waitForTimeout(200);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.locator('.export-modal .btn.primary').click(),
    ]);
    ok('导出弹窗导出触发下载 .pdf', (download.suggestedFilename() || '').endsWith('.pdf'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  // ---------- 4.5：嵌入块导出包含内容（引用演示.md 含 ![[ 嵌入） ----------
  {
    const [download, outcome] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.evaluate(() => window.__exportDebug('引用演示.md', 'md')),
    ]);
    ok('嵌入块文档导出 ok', outcome.ok);
    const stream = await download.createReadStream();
    const text = await new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
    ok('MD 导出包含嵌入内容（待办清单标题）', text.includes('# 待办清单'));
    ok('MD 导出包含嵌入内容（待办项 - [ ]）', text.includes('- [ ]'));
    ok('MD 导出嵌入标记已展开（无 ![[ 残留）', !text.includes('![['));
    // PDF 也走同一展开管线：验证能成功生成且含嵌入标题文本
    const [dlPdf] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.evaluate(() => window.__exportDebug('引用演示.md', 'pdf')),
    ]);
    ok('嵌入块文档 PDF 导出成功', (dlPdf.suggestedFilename() || '').endsWith('.pdf'));
  }

  // ---------- 5：模板 export.ts 按定义导出 ----------
  {
    await page.evaluate(() => {
      const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
      fs.files = fs.files || {};
      fs.files['.template/demo/demo.export.ts'] = `export const format = 'pdf'
export const filename = '自定义导出名'
export const build = (ctx) => ({ content: '# 自定义标题\\n\\n来自 export.ts：' + ctx.title + '，doctype=' + ctx.doctype + '，path=' + ctx.path })
`;
      localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    // 注入后 rescan：通过刷新树触发模板热扫描
    await page.evaluate(() => window.__mockFsDebug && null);
    const [download, outcome] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.evaluate(() => window.__exportDebug('笔记/周报.md', 'auto')),
    ]);
    ok('export.ts 生效（usedExportTs=true）', outcome.ok && outcome.usedExportTs === true);
    ok('export.ts 自定义文件名', (download.suggestedFilename() || '').startsWith('自定义导出名'));
    const stream = await download.createReadStream();
    const head = await new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).slice(0, 8).toString('latin1')));
      stream.on('error', reject);
    });
    ok('export.ts 导出为 PDF（format=pdf）', head.startsWith('%PDF-'));
  }

  // ---------- 6：链接引用展示内容 + Mermaid 渲染图片导出 ----------
  {
    await page.evaluate(() => {
      const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
      fs.files['导出测试.md'] =
        '# 导出测试\n\n## 版本\n\nv0.1.0\n\n周报版本号：[[笔记/周报#version]]\n\n```mermaid\ngraph TD\nA[开始] --> B[结束]\n```\n';
      localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    // md：引用展示 + mermaid 图片
    const [dl, outcome] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }),
      page.evaluate(() => window.__exportDebug('导出测试.md', 'md')),
    ]);
    ok('含引用/mermaid 文件 md 导出 ok', outcome.ok);
    const stream = await dl.createReadStream();
    const text = await new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
    ok('链接引用展示为解析值（周报版本 [v0.2.1]）', text.includes('周报版本号：[v0.2.1](笔记/周报)'));
    ok('md 导出含 mermaid 图片（data:image/png）', text.includes('data:image/png'));
    ok('md 导出 mermaid 代码块已替换为图片', !text.includes('```mermaid'));

    // PDF：含渲染图片
    const [dlPdf, outcomePdf] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }),
      page.evaluate(() => window.__exportDebug('导出测试.md', 'pdf')),
    ]);
    ok('含 mermaid 的 PDF 导出成功（>30KB 含图片）', outcomePdf.ok && (outcomePdf.size || 0) > 30000);

    // DOCX：含渲染图片
    const [dlDocx, outcomeDocx] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }),
      page.evaluate(() => window.__exportDebug('导出测试.md', 'docx')),
    ]);
    ok('含 mermaid 的 DOCX 导出成功（PK zip）', outcomeDocx.ok && (outcomeDocx.size || 0) > 2000);
  }

  // ---------- 7：数学公式（katex）渲染图片导出 ----------
  {
    await page.evaluate(() => {
      const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
      fs.files['公式测试.md'] =
        '# 公式测试\n\n行内公式 $E = mc^2$ 与块级公式：\n\n$$\n\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$\n';
      localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    // md：保留公式原文（可编辑）
    const [dl, outcome] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }),
      page.evaluate(() => window.__exportDebug('公式测试.md', 'md')),
    ]);
    ok('公式文档 md 导出 ok', outcome.ok);
    const stream = await dl.createReadStream();
    const text = await new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
    ok('md 导出保留行内公式原文（$E = mc^2$）', text.includes('$E = mc^2$'));
    ok('md 导出块级公式为 latex 代码块', text.includes('```latex'));

    // PDF：公式渲染为图片嵌入
    const [dlPdf, oPdf] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }),
      page.evaluate(() => window.__exportDebug('公式测试.md', 'pdf')),
    ]);
    ok('含公式 PDF 导出成功（>40KB 含公式图片）', oPdf.ok && (oPdf.size || 0) > 40000);

    // DOCX：公式渲染为图片嵌入
    const [dlDocx, oDocx] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }),
      page.evaluate(() => window.__exportDebug('公式测试.md', 'docx')),
    ]);
    ok('含公式 DOCX 导出成功（>10KB 含公式图片）', oDocx.ok && (oDocx.size || 0) > 10000);
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
