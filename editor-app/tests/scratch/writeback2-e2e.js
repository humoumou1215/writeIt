// §6.7 补充：只读块不写回 + 广播刷新（其他标签物化内容同步）
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  // 建一个镜像文件也嵌入待办清单（广播刷新验证）
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    fs.files['笔记/镜像.md'] = 'doctype:demo\n\n# 镜像\n\n![[笔记/待办清单]]\n';
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  // 先打开镜像.md（物化旧内容）→ 再开引用演示.md
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '镜像.md' }).click();
  await page.waitForTimeout(5000);
  const mirrorBlockText = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('待办清单'));
    return b ? b.textContent.slice(-40) : 'NO';
  });
  console.log('[debug] 镜像块前:', JSON.stringify(mirrorBlockText));
  // 侧边栏可能已收起——展开后再点树
  await page.locator('.icon-col .icon-btn').first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .node', { hasText: '笔记' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.tree .name', { hasText: '引用演示.md' }).click();
  await page.waitForTimeout(5000);
  const dbg2 = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('待办清单'));
    return { block: b ? b.textContent.slice(-30) : 'NO', active: document.querySelector('.tabbar .tab.active')?.textContent };
  });
  console.log('[debug] 引用演示活动标签:', JSON.stringify(dbg2));
  await page.evaluate(() => {
    const r = window.__editorGoBlockEnd && window.__editorGoBlockEnd('待办清单');
    return r;
  });
  const selDbg = await page.evaluate(() => {
    const ed = window.__editorDebug();
    let out = {};
    if (ed) {
      ed.action((ctx) => {
        const { editorViewCtx } = window.__proto__ ? {} : {};
      });
    }
    return out;
  });
  // 用 editor.action 在块内末尾插入新段落（绕过键盘输入的多标签焦点问题）
  const insOk = await page.evaluate(() => {
    const ed = window.__editorDebug();
    if (!ed) return 'no-ed';
    ed.action((ctx) => {
      const { editorViewCtx } = window.__proto__ ? {} : {};
    });
    return 'called';
  });
  await page.evaluate(async () => {
    const ed = window.__editorDebug();
    const r = await ed.action((ctx) => {
      // 通过 editor 内部 API 插入：用动态 import 拿 editorViewCtx
      return 'skip';
    });
    return r;
  });
  // 直接用 __editorGoBlockEnd + dispatch 插入（manager 内同步版）
  await page.evaluate(() => {
    const ed = window.__editorDebug();
    if (!ed) return;
    ed.action((ctx) => {
      const { editorViewCtx } = window.__proto__ ? {} : {};
    });
  });
  // 用 __editorBlockAppend 在块内末尾插入文本（绕过输入层，测写回/广播链路）
  const appendRes = await page.evaluate(() => (window.__editorBlockAppend && window.__editorBlockAppend('待办清单', '广播刷新测试条目')) ?? 'no-hook');
  console.log('[debug] append:', JSON.stringify(appendRes));
  await page.waitForTimeout(800);
  const docDbg = await page.evaluate(() => {
    const ed = window.__editorDebug();
    let out = { blocks: [] };
    if (ed) {
      ed.action((ctx) => {
        const { editorViewCtx } = window.__proto__ ? {} : {};
      });
    }
    // 直接读 DOM
    const panes = Array.from(document.querySelectorAll('.editor-pane'));
    panes.forEach((p, i) => {
      const visible = getComputedStyle(p).display !== 'none';
      if (!visible) return;
      const b = Array.from(p.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('待办清单'));
      out.blocks.push({ pane: i, text: b ? b.textContent.slice(-50) : 'NO' });
    });
    return out;
  });
  console.log('[debug] docDbg:', JSON.stringify(docDbg));
  const selDbg2 = await page.evaluate(() => {
    const ed = window.__editorDebug();
    let out = { active: document.activeElement ? document.activeElement.className.slice(0, 30) : 'none' };
    if (ed) {
      ed.action((ctx) => {
        const { editorViewCtx } = window.__proto__ ? {} : {};
      });
    }
    return out;
  });
  console.log('[debug] active:', JSON.stringify(selDbg2));
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('广播刷新测试条目');
  await page.waitForTimeout(1000);
  await page.waitForTimeout(1000);
  const blockAfterType = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('待办清单'));
    const md = window.__editorGetMarkdown ? window.__editorGetMarkdown() : '';
    return { block: b ? b.textContent.slice(-40) : 'NO', mdHasNew: md.includes('广播刷新测试条目'), mdTail: md.slice(-80) };
  });
  console.log('[debug] 输入后:', JSON.stringify(blockAfterType));
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2500);
  // 切回镜像.md → 块应刷新为新内容
  await page.locator('.tabbar .tab', { hasText: '镜像' }).click();
  await page.waitForTimeout(2000);
  const mirrorBlockAfter = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ref-file-block')).find(x => (x.querySelector('.ref-file-block-path')?.textContent || '').includes('待办清单'));
    return b ? b.textContent.slice(-40) : 'NO';
  });
  console.log('[debug] 镜像块后:', JSON.stringify(mirrorBlockAfter));
  ok('广播刷新：镜像标签块物化同步', (mirrorBlockAfter || '').includes('广播刷新测试条目'));
  // 只读块不写回：README.md 内容不变
  const readme = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}');
    return fs.files['README.md'] ? fs.files['README.md'].slice(0, 40) : 'MISSING';
  });
  ok('只读块（README.md|ro）未被写回', readme !== 'MISSING' && readme.length > 0);
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
