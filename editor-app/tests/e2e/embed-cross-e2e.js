// embed-cross-e2e —— v8.1：跨嵌入块（file_block）选区的批注拦截
//  场景A：Ctrl+R 全选（选区包含整个嵌入块 = 跨块）→ toast 提示 + 不弹输入浮窗
//  场景B：toolbar「添加批注」跨块选区 → 同样拦截
//  场景C：完全在嵌入块内选中（m6d 语义）→ 不拦截，浮窗正常弹出
// 注：Ctrl+A 在 macOS 上不触发 PM 全选（Mod-a = Meta）→ 用 Meta+a
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js embed-cross-e2e
const C = L.newChecker()

const task = await L.acquireTaskSpace('embed-cross-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

// 打开引用演示.md（mock 自带，含 ![[笔记/待办清单]] 可编辑嵌入）
await L.clickText('.tree .name', '引用演示.md', { label: '打开引用演示' })
await L.waitMs(6000)
C.check('嵌入块已物化（.ref-file-block）', (await L.q('.ref-file-block')) > 0)

/** 等待 toast 文案出现（轮询，参考 source-e2e） */
const waitToast = async (text, tries = 20) => {
  for (let i = 0; i < tries; i++) {
    await L.waitMs(100)
    const hit = await js(`[...document.querySelectorAll('.toast')].some(t => (t.textContent||'').includes(${JSON.stringify(text)}))`)
    if (hit) return true
  }
  return false
}

// ---------- 场景A：Meta+A 全选（跨块）→ Ctrl+R 拦截 ----------
await L.focusEditor()
await L.waitMs(400)
await L.press('Meta+a')
await L.waitMs(700)
const crossSel = await js(`(() => { const s = window.getSelection(); return s ? s.toString() : '' })()`)
cliLog('[info] 全选文本长度 = ' + (crossSel || '').length)
C.check('全选确实横跨嵌入块区域', (crossSel || '').includes('嵌入如下') && (crossSel || '').includes('只读嵌入'))
await L.press('Control+r')
await L.waitMs(900)
C.check('Ctrl+R 跨块后不弹输入浮窗', (await L.q('.annotation-input-visible')) === 0)
C.check('Ctrl+R 跨块有 toast 提示', await waitToast('暂不支持跨越嵌入块选区的批注'))
await L.press('Escape')

// ---------- 场景B：再次全选（跨块）→ Ctrl+R 拦截（验证重复触发有效） ----------
await L.waitMs(900) // 等场景A 的 toast 过期，避免视觉干扰
await L.focusEditor()
await L.waitMs(300)
await L.press('Meta+a')
await L.waitMs(700)
const selLenB = await js(`(window.getSelection()?.toString() || '').length`)
cliLog('[info] 场景B 选区长度 = ' + selLenB)
C.check('场景B 全选选区跨块', selLenB > 1000)
await L.press('Control+r')
await L.waitMs(900)
C.check('场景B 跨块后不弹输入浮窗', (await L.q('.annotation-input-visible')) === 0)
C.check('场景B 跨块有 toast 提示', await waitToast('暂不支持跨越嵌入块选区的批注'))
await L.press('Escape')

// ---------- 场景C：完全在嵌入块内选中 → 不拦截 ----------
// 复位 PM 选区锚点：场景A/B 的 Meta+A 全选后，PM 选区锚点残留在文档开头，
// 直接拖选会从旧锚点扩展成跨块选区而被拦截（套件隔离修复）
await L.clickEl(`.editor-pane:not([style*="display: none"]) .ref-file-block:not(.readonly) .ref-file-block-content li`, 0, { label: '点块内li复位锚点' })
await L.waitMs(400)
await L.selectText('.ref-file-block-content li', '支持自动保存', 45, 145)
await L.waitMs(800)
C.check('块内选中 toolbar 出现', (await L.q('[data-toolbar-item="add-annotation"]')) > 0)
await L.clickEl('[data-toolbar-item="add-annotation"]', 0, { label: '点添加批注（块内）' })
await L.waitMs(800)
C.check('块内选中正常弹出输入浮窗（不拦截）', (await L.q('.annotation-input-visible')) > 0)
const ph = await L.attr('.annotation-input-ta', 'placeholder')
C.check('块内选中为普通批注提示', (ph || '').includes('在此输入评论'))
await L.press('Escape')

cliLog(C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)