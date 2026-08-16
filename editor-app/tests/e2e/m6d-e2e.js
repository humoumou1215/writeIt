// M6 回归：file_block 嵌入块内添加批注 → 保存写回源文件 → 打开源文件
// bug 场景：嵌入块内评论经 writeback round-trip（序列化→再解析→再序列化）后
// note 属性被双重转义（&quot; → &amp;quot;），源文件打开后 parseThread 只解一层
// → JSON.parse 失败 → 作者显示"未知"、内容显示原始转义字符串。
// 修复：parseMarkdown runner 对 note 解码（与 escapeAttr 互逆），round-trip 稳定单次转义。
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 750 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  // 干净起点：重置两个文件（seededVersion>=3 时不会被 seed 覆盖）
  const todoSeed = `# 待办清单

- [ ] 支持自动保存
- [ ] 文件树右键菜单
- [ ] 多标签页
- [ ] 主题适配
- [x] 搭建工程`;
  await page.evaluate((todo) => {
    const KEY = 'milkdown-note-mock-fs-v2';
    const fs = JSON.parse(localStorage.getItem(KEY) || '{}');
    fs.files['笔记/待办清单.md'] = todo;
    localStorage.setItem(KEY, JSON.stringify(fs));
  }, todoSeed);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // 1. 打开引用演示.md（含 ![[笔记/待办清单]] 嵌入）
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(6000);
  const blockCount = await page.locator('.ref-file-block').count();
  ok('嵌入块已物化（.ref-file-block）', blockCount > 0);

  // 2. 在嵌入块内选中文字（待办清单第一条）
  const li = page.locator('.ref-file-block-content li', { hasText: '支持自动保存' }).first();
  const box = await li.boundingBox();
  if (!box) { console.log('❌ 嵌入块 li 无 boundingBox'); fail++; }
  else {
    await page.mouse.move(box.x + 45, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 45 + 100, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(800);

    // 3. Toolbar → 添加批注「评2」
    const addBtn = page.locator('[data-toolbar-item="add-annotation"]').first();
    if (await addBtn.count() > 0) {
      await addBtn.click();
      await page.waitForTimeout(600);
      await page.locator('.annotation-input-ta').fill('评2');
      // M6 定位修复回归：锚点在视口底部附近时浮窗应上翻（此前浮窗底部/按钮超出屏幕）
      // 输入浮窗交互：Enter 确认提交（按钮组已改为快捷键交互）
      const inputBox = await page.locator('.annotation-input').boundingBox();
      ok('批注浮窗完整在视口内（底部上翻定位）', !!inputBox && inputBox.y >= 0 && inputBox.y + inputBox.height <= 750);
      await page.locator('.annotation-input-ta').press('Enter');
      await page.waitForTimeout(1200);
      const inBlock = await page.locator('.ref-file-block-content mark.annotation').count();
      ok('嵌入块内批注节点插入', inBlock > 0);

      // 4. Ctrl+S 保存 → writeback 写回源文件 笔记/待办清单.md
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(2000);
      const source = await page.evaluate(() => {
        const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
        return fs.files['笔记/待办清单.md'] || '';
      });
      console.log('[debug] 源文件内容:', JSON.stringify(source));
      ok('写回：源文件含 <mark data-note', source.includes('<mark data-note='));
      ok('写回：note 为单次转义（含 &quot;评2&quot;）', source.includes('&quot;评2&quot;'));
      ok('写回：无双重转义（不含 &amp;quot;）', !source.includes('&amp;quot;'));

      // 5. 打开源文件 笔记/待办清单.md（打开文件不收纳；若已收纳则先展开）
      if ((await page.locator('.content-col.collapsed').count()) > 0) {
        await page.locator('.icon-col .icon-btn').first().click();
        await page.waitForTimeout(400);
      }
      await page.locator('.tree .node', { hasText: '笔记' }).first().click();
      await page.waitForTimeout(400);
      await page.locator('.tree .name', { hasText: '待办清单.md' }).click();
      await page.waitForTimeout(6000);
      const marks = await page.locator('.ProseMirror mark.annotation:visible').count();
      ok('源文件打开后批注渲染为 mark.annotation', marks > 0);

      // 6. 点击批注 → 抽屉卡：作者=我，内容=评2（非未知/非原始 JSON）
      // mark 点击走 card.ts document 级事件委托（capture）；多标签下需选中可见 pane 里的 mark
      await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('.ProseMirror mark.annotation'))
          .find((e) => e.offsetParent !== null);
        if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await page.waitForTimeout(900);
      const card = await page.evaluate(() => {
        const c = document.querySelector('.ad-card.active');
        if (!c) return null;
        const author = c.querySelector('.ad-author')?.textContent ?? '';
        const content = c.querySelector('.ad-comment-content')?.textContent ?? '';
        return { author, content };
      });
      console.log('[debug] 抽屉卡:', JSON.stringify(card));
      ok('批注作者显示正确（我）', card?.author === '我');
      ok('批注内容正确（评2）', (card?.content ?? '').includes('评2'));
      ok('内容非原始转义 JSON', !(card?.content ?? '').includes('&quot;'));
    } else {
      console.log('❌ 嵌入块内 add-annotation 按钮不存在');
      fail++;
    }
  }

  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
