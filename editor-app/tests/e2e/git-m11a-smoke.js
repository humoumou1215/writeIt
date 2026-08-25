// git-m11a-smoke —— M11/M14 演示模式：浏览器（mock 后端）下 Git 工作台完整可用
// 覆盖：Git 面板 + README 渲染模式（内联标记/mermaid 节点/嵌入角标/批注卡）+ 会议纪要 + 需求表 + 文本模式 + Esc
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js git-m11a-smoke
const C = L.newChecker()

const task = await L.acquireTaskSpace('git-m11a-smoke')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')

const ensureSidebar = async () => {
  if (await js(`document.querySelector('.content-col') ? document.querySelector('.content-col').classList.contains('collapsed') : false`)) {
    // 抽屉独立交互：用「文件」按钮展开（不要用 Git 按钮——展开后 tab 已是 git，再点 git 会 toggle 收起）
    await L.clickEl('.icon-col .icon-btn', 0, { label: '展开侧栏' })
    await L.waitMs(300)
  }
}

// 1. Git 图标可用
// 抽屉独立交互：点 Git 进 Git 抽屉；已在 Git 抽屉（按钮 active）则不再点，避免 toggle 收起
const gitBtn = async () => {
  const inGit = await js(`(() => { const el = document.querySelector('.icon-col .icon-btn:nth-child(2)'); return !!el && el.classList.contains('active') })()`)
  if (!inGit) await L.clickEl('.icon-col .icon-btn:nth-child(2)', 0, { label: 'Git 面板' })
}
const inlineOp = await js(`(() => { const el = document.querySelector('.icon-col .icon-btn:nth-child(2)'); return el ? el.style.opacity : null })()`)
C.check('Git 图标可用（mock 演示模式）', inlineOp === '' || inlineOp === undefined || inlineOp === null)

// 2. 打开 Git 面板
await gitBtn()
await L.waitMs(900)
C.check('Git 面板激活（Git 按钮高亮）', (await L.q('.icon-col .icon-btn:nth-child(2).active')) === 1)
C.check('示例仓库分支 main', ((await L.txt('.repo-badge')) || '').includes('main'))
C.check('分支区含 feature/图表优化', (await L.qText('.branch', 'feature/图表优化')) === 1)
C.check('工作区 3 文件（README/需求表/会议纪要）', (await L.qText('.section .ws-file', 'README')) + (await L.qText('.section .ws-file', '会议纪要')) + (await L.qText('.section .ws-file', '需求表')) >= 3)
C.check('历史 4 提交（含分叉/合并演示）', (await L.q('.commit')) === 4)
C.check('HEAD 提交展开', (await L.q('.commit.expanded')) === 1)
await L.shot('/tmp/m12-git-panel.png')

// 3. README 工作区 diff → 渲染模式
await L.clickText('.section .ws-file', 'README.md')
await L.waitMs(1500)
C.check('进入 diff 视图', (await L.q('.git-diff-view')) === 1)
C.check('默认渲染模式激活', (await L.qText('.diff-toolbar .mini.active', '渲染')) === 1)
try { await waitForElement('.render-host .diff-ins', { timeout: 20 }).catch(() => {}) } catch {}
try { await waitForElement('.render-host .diff-del', { timeout: 8 }).catch(() => {}) } catch {}
C.check('M14 行内标注（diff-ins ≥3）', (await L.q('.render-host .diff-ins')) >= 3)
C.check('M14 行内标注（diff-del ≥2）', (await L.q('.render-host .diff-del')) >= 2)
C.check('M14 纯删除块（旧版本说明）', (await L.qText('.render-host .diff-del', '旧版本说明')) === 1)
C.check('M14 纯新增段（消息通知模块）', (await L.qText('.render-host .diff-ins', '消息通知模块')) >= 1)
C.check('M14 词级修改（与权限）', (await L.qText('.render-host .diff-ins', '与权限')) === 1)
try { await waitForElement('.render-host .ref-file-block', { timeout: 8 }).catch(() => {}) } catch {}
C.check('M14 嵌入卡片 ≥2', (await L.q('.render-host .ref-file-block')) >= 2)
try { await waitForElement('.render-host .ref-embed-diff-badge', { timeout: 8 }).catch(() => {}) } catch {}
C.check('M14 嵌入「内容有改动」角标', (await L.q('.render-host .ref-embed-diff-badge')) >= 2)

// mermaid：滚动到图（IO 懒加载）→ 节点级标注
await js(`(() => { const el = document.querySelector('.render-main'); if (el) el.scrollTo(0, 2500) })()`)
await L.waitMs(2500)
try { await waitForElement('.render-host .preview svg, .render-host .mmd-zoomable svg', { timeout: 8 }).catch(() => {}) } catch {}
C.check('M14 mermaid 图渲染', (await L.q('.render-host .preview svg, .render-host .mmd-zoomable svg')) > 0)
await L.waitMs(1500)
C.check('M14 mermaid 修改节点（新节点绿 + 旧值红删除双节点）', (await L.qText('.render-host svg g.node.diff-node-add', '授信成功')) >= 1 && (await L.qText('.render-host svg g.node.diff-node-del', '支付成功')) >= 1)
C.check('M14 mermaid 新增节点（diff-node-add）', (await L.q('.render-host svg g.node.diff-node-add')) >= 1)
C.check('M14 mermaid 删除节点（diff-node-del）', (await L.q('.render-host svg g.node.diff-node-del')) >= 1)

// 批注抽屉（默认收纳：先展开再读卡）
await js(`document.querySelector('.ad-toggle.expand')?.click()`)
await L.waitMs(400)
try { await waitForElement('.annotation-drawer .ad-card', { timeout: 8 }).catch(() => {}) } catch {}
C.check('M14 批注抽屉「改动说明」卡 ≥5', (await L.qText('.annotation-drawer .ad-card .ad-card-title', '改动说明')) >= 5)
C.check('M14 批注卡含 mermaid 变更说明', (await js(`[...document.querySelectorAll('.annotation-drawer .ad-card')].map(c=>c.textContent).join('')`)).includes('流程图'))
await L.clickEl('.annotation-drawer .ad-card.read-only', 2, { label: '点批注卡' })
await L.waitMs(700)
C.check('M14 点击批注卡 → 连线出现', ((await L.attr('.annotation-connector-path', 'd')) || '').length > 10)
C.check('M14 批注卡激活态', (await L.q('.annotation-drawer .ad-card.active')) === 1)
await L.shot('/tmp/m12-render-diff.png')
await L.press('Escape')
await L.waitMs(400)

// 4. 会议纪要
await ensureSidebar()
await L.clickText('.section .ws-file', '会议纪要')
await L.waitMs(2500)
try { await waitForElement('.render-host .diff-ins', { timeout: 15 }).catch(() => {}) } catch {}
C.check('M14 会议纪要：新增议题（消息通知需求收集）', (await L.qText('.render-host .diff-ins', '消息通知需求收集')) >= 1)
C.check('M14 会议纪要：备注修改词级', (await L.qText('.render-host .diff-del', '不做')) === 1 && (await L.qText('.render-host .diff-ins', '下期排期')) === 1)
await L.press('Escape')
await L.waitMs(400)

// 5. 需求表
await ensureSidebar()
await L.clickText('.section .ws-file', '需求表')
await L.waitMs(2500)
try { await waitForElement('.render-host .diff-ins', { timeout: 15 }).catch(() => {}) } catch {}
C.check('M14 需求表：单元格级（待评审→评审中）', (await L.qText('.render-host .diff-del', '待')) >= 1 && (await L.qText('.render-host .diff-ins', '中')) >= 1)
C.check('M14 需求表：新增行（消息通知）', (await L.qText('.render-host .diff-ins', '消息通知')) >= 1)
await L.press('Escape')
await L.waitMs(400)

// 6. 文本模式（README）
await ensureSidebar()
await L.clickText('.section .ws-file', 'README.md')
await L.waitMs(1200)
await L.clickText('.diff-toolbar .mini', '文本')
await L.waitMs(400)
C.check('切文本模式', (await L.qText('.diff-toolbar .mini.active', '文本')) === 1)
C.check('分栏布局', (await L.q('.diff-row.split')) > 0)
C.check('词级高亮 word-del', (await L.q('.word-del')) >= 1)
C.check('词级高亮 word-add', (await L.q('.word-add')) >= 1)
C.check('hunk 还原按钮', (await L.q('.hunk-discard')) >= 1)

// 7. Esc 退出
await L.press('Escape')
await L.waitMs(400)
C.check('Esc 退出 diff', (await L.q('.git-diff-view')) === 0)

// 8. 无页面错误
C.check('无页面错误', (await L.errors()).length === 0)
cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
