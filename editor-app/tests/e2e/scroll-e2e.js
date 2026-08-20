// scroll-e2e —— 切 tab 保持滚动位置
// 背景：多标签用 display:none 隐藏非活动容器，而 display:none 的元素无布局、scrollTop 被浏览器清 0，
//       重新显示时不会自动恢复 → 需在隐藏前保存、显示后手动还原（manager.saveTabScroll/restoreTabScroll）。
// 说明：文件树/标签用 dispatchEvent click（绕过 CDP 点击竞争，drag-e2e 同款做法）。
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js scroll-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('scroll-e2e')
await L.installErrors()

// 动画滚动关闭并返回当前活动 pane 的 scrollTop
const paneScrollTop = () => js(`(() => {
  const panes = Array.from(document.querySelectorAll('.editor-pane'))
  const active = panes.find(p => p.style.display !== 'none')
  return active ? active.scrollTop : -1
})()`)
const paneScrollTopOfFirst = () => js(`(() => {
  const panes = Array.from(document.querySelectorAll('.editor-pane'))
  return panes.length ? panes[0].scrollTop : -1
})()`)
// dispatch click 打开/激活树节点文件（按文本匹配）
const treeOpen = (name) => js(
  `(() => { const el = [...document.querySelectorAll('.tree .name')].find(x => (x.textContent||'').includes(${JSON.stringify(name)})); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el })()`
)
// dispatch click 激活标签（按 tab 名文本匹配）
const tabActivate = (name) => js(
  `(() => { const el = [...document.querySelectorAll('.tab-name')].find(x => (x.textContent||'').includes(${JSON.stringify(name)})); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el })()`
)
// 滚动活动 pane 到指定位置；编辑器异步渲染（Milkdown + 懒加载）期间内容高度不足会导致 scrollTop 被 clamp，
// 故重试直到接近目标（或超时返回当前值）
const scrollPaneToVerify = async (v, tries = 20) => {
  let t = -1
  for (let i = 0; i < tries; i++) {
    await js(`(() => {
      const panes = Array.from(document.querySelectorAll('.editor-pane'))
      const p = panes.find(x => x.style.display !== 'none')
      if (p) p.scrollTop = ${v}
    })()`)
    t = await paneScrollTop()
    if (Math.abs(t - v) < 80) return t
    await L.waitMs(250)
  }
  return t
}

await L.freshApp('http://localhost:5173/?backend=mock', 2500)
// 在浏览器内循环生成两个中长文档（缩小 js 表达式体积；字符串过长会导致 ego-lite evaluate 卡死）
await js(`(() => {
  const gen = (t) => { let s = '# ' + t; for (let i = 1; i <= 22; i++) s += '\\n\\n### 小节 ' + i + '\\n\\n第 ' + i + ' 段内容，用于撑起页面高度，让文档足够长以便滚动。'; return s }
  const fs = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
  fs.files['笔记/滚动一.md'] = gen('滚动一')
  fs.files['笔记/滚动二.md'] = gen('滚动二')
  localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fs))
})()`)
await L.reloadApp(2500)
await L.clickText('.tree .node', '笔记')
await L.waitMs(400)
C.check('文件树出现两个测试文档', (await L.qText('.tree .name', '滚动')) >= 2)

// 1. 打开文档一并滚动到中部
await treeOpen('滚动一')
await L.waitMs(5000)
const saved1 = await scrollPaneToVerify(1500)
cliLog('DEBUG saved1=' + saved1)
C.check('文档一已打开并可滚动（scrollTop≈1500）', Math.abs(saved1 - 1500) < 80)

// 2. 打开文档二（新标签）→ 文档一容器被 display:none
await treeOpen('滚动二')
await L.waitMs(5000)
C.check('已打开第二个标签', (await L.q('.tab')) >= 2)
const hiddenScroll1 = await paneScrollTopOfFirst()
cliLog('DEBUG hiddenScroll1=' + hiddenScroll1)
C.check('隐藏的文档一 scrollTop 被浏览器清 0（需手动恢复的根因）', hiddenScroll1 === 0)
C.check('文档二初始在顶部', (await paneScrollTop()) === 0)

// 轮询等待活动 pane 滚动接近 target（容错 content/restore 异步就绪时序；超时返回最后值）
const waitScrollApprox = async (target, timeoutMs) => {
  const t0 = Date.now()
  let v = -1
  while (Date.now() - t0 < timeoutMs) {
    v = await paneScrollTop()
    if (Math.abs(v - target) < 80) return v
    await L.waitMs(150)
  }
  return v
}

// 3. 切回文档一 → 滚动位置应被还原
await tabActivate('滚动一')
const restored1 = await waitScrollApprox(saved1, 3500)
cliLog('DEBUG restored1=' + restored1)
C.check('切回文档一：滚动位置保持', Math.abs(restored1 - saved1) < 80)

// 4. 文档二初始在顶部 → 切过去保持顶部
await tabActivate('滚动二')
await L.waitMs(1000)
C.check('切到文档二：保持其在顶部的初始位置', (await paneScrollTop()) === 0)

// 5. 文档二滚到中部 → 切走再切回 → 两个标签各自独立保持
const saved2 = await scrollPaneToVerify(900)
cliLog('DEBUG saved2=' + saved2)
C.check('文档二已滚动到中部（scrollTop≈900）', Math.abs(saved2 - 900) < 80)
await tabActivate('滚动一')
await L.waitMs(1000)
C.check('切到文档一：文档一仍保持之前位置', Math.abs((await paneScrollTop()) - saved1) < 80)
await tabActivate('滚动二')
const back2 = await waitScrollApprox(saved2, 3500)
cliLog('DEBUG back2=' + back2)
C.check('切回文档二：文档二滚动位置保持', Math.abs(back2 - saved2) < 80)

console.log('滚动态必读：切 tab 滚动保持', C.summary())