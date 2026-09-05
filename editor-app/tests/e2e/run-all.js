// E2E 回归汇总：依次执行全部正式套件（需 dev server :5173 + ego-lite）
// 用法：npm run test:e2e
// 浏览器驱动：ego-browser nodejs（【禁止 playwright】），每个套件文件是纯 ego-lite 脚本，
// 由本运行器 pipe 进 ego-browser 的 stdin 执行；共享辅助库经环境变量 EGOLITE_LIB 注入。
// app-e2e 最后跑（会清空 demo-shots/）
const { spawn } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { homedir } = require('node:os')

const here = __dirname
// ego-browser 可执行文件：优先环境变量，其次 ~/.local/bin（ego lite 安装默认位置），最后 PATH
const EGO = process.env.EGO_BROWSER_BIN || join(homedir(), '.local/bin/ego-browser')
// 释放所有遗留 task space（防内存堆积；每个测试遗留的未关闭空间）。
// 这项清理会连接浏览器并可能等待服务端，不能在每个成功套件后重复执行。
function cleanupSpaces() {
  const started = Date.now()
  try {
    const { spawnSync } = require('node:child_process')
    const script = readFileSync(join(here, '_cleanup-spaces.ego.js'), 'utf8')
    const r = spawnSync(EGO, ['nodejs'], { input: script, encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'ignore', 'ignore'] })
    return { ms: Date.now() - started, timedOut: r.error?.code === 'ETIMEDOUT', code: r.status }
  } catch (e) {
    return { ms: Date.now() - started, timedOut: false, code: null, error: e?.message || String(e) }
  }
}

const SUITES = [
  'ref-e2e',      // M1 引用语法与节点
  'nested-ref-e2e', // 多层块嵌入回归（递归物化 + 保存不写空）
  'menu-e2e',     // M2 触发菜单
  'm3-e2e',       // M3 文件树联动
  'm4-e2e',       // M4 模板机制
  'm4b-e2e',      // M4 实体级
  'm4c-e2e',      // M4 路径显示/跳转
  'm5-e2e',       // M5 校验三通道
  'm5-strict',    // M5 strict 门禁
  'm6-e2e',       // M6 批注 round-trip
  'm6-toolbar',   // M6 Toolbar/Ctrl+R
  'm6c-e2e',      // M6 抽屉/评论线程
  'm6d-e2e',      // M6 嵌入块批注写回 round-trip（双重转义回归）
  'm6e-e2e',      // M6 代码块整块批注（变体 D：mermaid 内批注自动升级）
  'source-e2e',   // M7 源码查看模式（Ctrl+E 切换）
  'drag-e2e',     // M7 文件树拖拽移动 + 瞄准定位
  'm7-apidoc-e2e',// M7 接口文档：动态对象 objectsFor + findCodeBlocks
  'xxljob-e2e',   // M7 xxljob：一文件一任务校验 + 属性对象引用
  'm8-db-e2e',    // M8 数据库：字段对象 objectsFor + 表清单↔字段表一致性
  'm9-placeholder-e2e', // M9 占位符：{{}} decoration 渲染（代码块内保留字面）
  'mermaid-zoom-e2e', // Mermaid 预览放大查看（悬停放大镜 + Lightbox + ESC）
  'mermaid-ref-e2e', // M9 Mermaid 代码块 @ 联想 + 文本级引用跳转
  'export-e2e',     // M10 导出：默认 PDF/DOCX/MD + 设置导出页签 + export.ts 自定义
  'git-m11a-e2e',
  'git-m18-fixture-e2e',   // M18 确定性渲染管线 fixture（prefill/NodeView/settle/data-dnote/折叠卡）   // M11 Git 工作台：面板/历史/范围对比/diff 视图（IPC mock 全流程）
  'git-m11a-smoke', // M11 浏览器降级：Git 图标灰置 + toast + 面板错误提示
  'search-e2e',     // 全局搜索面板：全文搜索/跳转/快捷键/收起
  'scroll-e2e',     // 切 tab 滚动位置保持（display:none 清 scrollTop → 切换点保存/恢复）
  'refs-footer-e2e', // 引用/被引用 底部展示区：点击 chip 打开目标文件（回归 b3be328 后打开失败）
  'paste-ref-e2e',   // 复制文件粘贴为引用（Ctrl+V 链接）+ 编辑器右键菜单（三种粘贴/类型切换）
  'table-enhance-e2e', // 表格增强：单元格换行 round-trip / Shift+Enter 新增行 / 动态列宽
  'table-width-e2e',   // 表格列边界稳定、真实拖拽、活动编辑器自动列宽
  'table-clipboard-e2e', // Excel HTML/TSV 逐格粘贴与 TSV 引号/换行
  'embed-sync-p1-e2e',      // 嵌入同步回归①：last-wins 止血 / 双块对称 / 写回守卫（真实输入补强）
  'embed-sync-p2-e2e',      // 嵌入同步回归②：registry 单一事实来源 / blockId / 跨标签
  'embed-sync-caret-regress-e2e', // 嵌入同步：NodeView 不重建（光标/输入落点回归）
  'embed-sync-realinput-e2e',     // 用户 4 问题全链路（真实键盘输入：重复/光标/保存消失/回流）
  'embed-sync-composite-e2e',     // registry 复合 + 边界（多宿主/链式/环/只读/并发/写回）
  'embed-indep-verify-e2e', // 嵌入同步独立重验证：registry 严格断言（磁盘/块全等、并发分叉、只读、跨宿主）
  'embed-indep-verify2-e2e', // 嵌入同步独立重验证②：关闭重开/reload 持久化/无源标签写回/真实输入
  'embed-sync-alwaysalign-e2e', // 嵌入同步 V2 回归：docstore 全量同步（去增量映射）+ 源脏标记（双 bug 修复验证）
  'embed-save-race-e2e',        // P0：输入后立即保存 + 连续保存串行化
  'embed-nested-writeback-e2e', // P0：A→B→C 最深层编辑回写/重载
  'embed-shared-complex-e2e',    // 静态投影：A→B×2、B→C/D、A→C、旁路标签与共享收敛
  'embed-failure-recovery-e2e', // P0/P2：写入/原子写/rename 故障恢复
  'embed-cas-conflict-e2e',     // P0/P1：CAS 外部冲突拒绝覆盖
  'embed-projection-lifecycle-e2e', // P1：投影重建订阅生命周期
  'embed-external-change-e2e',  // P0：外部磁盘变更保存保护
  'annotations-overlap-e2e',// 批注 v8：重叠/嵌套/同文多条/跨行 + 旧文件兼容
  'diagnostics-e2e', // 问题诊断包：logger/双入口/生成 zip/异常提示红点（D1-D3，2026-08-22）
  'tabbar-overflow-e2e', // 标签栏布局：独立滚动区/右端固定/滚轮横滚/末标签点击
  'app-e2e',      // 综合（清空 demo-shots/）
]
const requestedSuites = process.env.E2E_SUITES
  ? process.env.E2E_SUITES.split(',').map((name) => name.trim()).filter(Boolean)
  : null
const unknownSuites = requestedSuites?.filter((name) => !SUITES.includes(name)) || []
if (unknownSuites.length) {
  console.error(`未知 E2E 套件: ${unknownSuites.join(', ')}`)
  process.exitCode = 2
  process.exit()
}
const suitesToRun = requestedSuites || SUITES
const workers = Math.max(1, Number.parseInt(process.env.E2E_WORKERS || '2', 10) || 1)
// 仅这些已验证不共享页面状态、跨标签或输出文件的套件进入 worker 池。
// 其余套件显式串行：包括嵌入同步/保存竞态、导出、Git、诊断和综合套件。
const SERIAL_SUITES = new Set([
  'export-e2e', 'git-m11a-e2e', 'git-m18-fixture-e2e', 'git-m11a-smoke',
  'diagnostics-e2e', 'app-e2e',
  ...SUITES.filter((name) => name.startsWith('embed-')),
])
const PARALLEL_SAFE_SUITES = new Set([
  'ref-e2e', 'm3-e2e', 'm4-e2e', 'm4b-e2e', 'm4c-e2e',
  'drag-e2e', 'm7-apidoc-e2e', 'xxljob-e2e', 'm8-db-e2e', 'm9-placeholder-e2e',
  'scroll-e2e', 'refs-footer-e2e', 'paste-ref-e2e',
  'table-enhance-e2e', 'table-width-e2e', 'table-clipboard-e2e', 'tabbar-overflow-e2e',
])

function run(name) {
  return new Promise((resolve) => {
    // 拼接：注入 __EGO_DIR → _egolite-lib.js 源码 → 用例源码
    const body =
      `const __EGO_DIR = ${JSON.stringify(here)}\n` +
      readFileSync(join(here, '_egolite-lib.js'), 'utf8') + '\n' +
      readFileSync(join(here, `${name}.js`), 'utf8')
    const p = spawn(EGO, ['nodejs'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    const started = Date.now()
    const heartbeat = setInterval(() => {
      process.stdout.write(`\n  … ${name} 已运行 ${Math.round((Date.now() - started) / 1000)}s`)
    }, 15000)
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.stdin.end(body)
    p.on('close', (code, signal) => {
      clearInterval(heartbeat)
      resolve({ name, code, signal, out, ms: Date.now() - started })
    })
  })
}

const results = []
async function runOne(name) {
  process.stdout.write(`▶ ${name} … `)
  const r = await run(name)
  const m = /结果: (\d+) 通过 \/ (\d+) 失败/.exec(r.out)
  const summary = m
    ? Number(m[2]) === 0
      ? `✅ ${m[1]}/${m[2]}`
      : `❌ ${m[1]}/${m[2]}`
    : r.code === 0
      ? '✅ done'
      : `❌ code=${r.code}`
  process.stdout.write(`${summary} (${(r.ms / 1000).toFixed(1)}s${r.signal ? `, ${r.signal}` : ''})\n`)
  if (!m && r.code !== 0) {
    console.log(r.out.split('\n').slice(-8).join('\n'))
  }
  return { ...r, summary }
}

async function runBatch(names) {
  const batch = await Promise.all(names.map(runOne))
  results.push(...batch)
  if (batch.some((r) => r.code !== 0 || r.signal || /❌/.test(r.summary))) {
    const recovery = cleanupSpaces()
    console.log(`  批次异常后清理：${(recovery.ms / 1000).toFixed(1)}s${recovery.timedOut ? '（超时）' : ''}`)
  }
}

async function main() {
const runStarted = Date.now()
console.log(`E2E 回归：${suitesToRun.length}/${SUITES.length} 个套件，workers=${workers}`)
// 清除上一次异常中断留下的测试空间，再开始本轮回归。
const initialCleanup = cleanupSpaces()
console.log(`清理历史 task space：${(initialCleanup.ms / 1000).toFixed(1)}s${initialCleanup.timedOut ? '（超时）' : ''}`)
for (let i = 0; i < suitesToRun.length;) {
  if (workers === 1 || !PARALLEL_SAFE_SUITES.has(suitesToRun[i])) {
    await runBatch([suitesToRun[i++]])
    continue
  }
  const batch = []
  while (i < suitesToRun.length && batch.length < workers && PARALLEL_SAFE_SUITES.has(suitesToRun[i])) {
    batch.push(suitesToRun[i++])
  }
  await runBatch(batch)
}

console.log('\n===== E2E 汇总 =====')
let fail = 0
for (const r of results) {
  const ok = /✅/.test(r.summary)
  if (!ok) fail++
  console.log(`${ok ? '✅' : '❌'} ${r.name}: ${r.summary}`)
}
console.log(fail === 0 ? '\n全部通过 🎉' : `\n${fail} 个套件未通过 ❌`)
const totalMs = Date.now() - runStarted
const slow = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5)
console.log(`总耗时：${(totalMs / 1000).toFixed(1)}s；最慢套件：${slow.map((r) => `${r.name} ${(r.ms / 1000).toFixed(1)}s`).join('，')}`)
console.log('\n释放遗留 task space…')
const finalCleanup = cleanupSpaces()
console.log(`最终清理：${(finalCleanup.ms / 1000).toFixed(1)}s${finalCleanup.timedOut ? '（超时）' : ''}`)
process.exit(fail === 0 ? 0 : 1)
}
void main()
