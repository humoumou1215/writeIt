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
  'embed-topbar-e2e',             // 嵌入激活后：全局顶栏真实格式化投影，不能误写宿主
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
// task space 数量严格等于 worker 数；每个 Node 进程只承载一个有界微批。
const workers = Math.min(5, Math.max(1, Number.parseInt(process.env.E2E_WORKERS || '5', 10) || 1))
const batchTimeoutMs = Math.max(60000, Number.parseInt(process.env.E2E_BATCH_TIMEOUT_MS || '150000', 10) || 150000)
const batchWeightMs = Math.max(20000, Number.parseInt(process.env.E2E_BATCH_WEIGHT_MS || '70000', 10) || 70000)
const batchMaxSuites = Math.max(1, Math.min(8, Number.parseInt(process.env.E2E_BATCH_MAX_SUITES || '5', 10) || 5))
const ISOLATED_SUITES = new Set(['ref-e2e', 'export-e2e'])

function suiteWeight(name) {
  const source = readFileSync(join(here, `${name}.js`), 'utf8')
  let weight = 3000
  for (const re of [/L\.waitMs\((\d+)\)/g, /L\.(?:freshApp|reloadApp|resetMockFs|openApp)\([^\n]*?,\s*(\d+)\)/g]) {
    let match
    while ((match = re.exec(source))) weight += Number(match[1])
  }
  // 实测渲染/嵌入套件包含异步 Mermaid/Crepe settle，源码中的固定等待会低估成本；
  // 用保守权重先调度重套件，避免它们集中在末尾形成长尾。
  const measured = {
    'git-m11a-smoke': 90000,
    'git-m11a-e2e': 85000,
    'embed-indep-verify-e2e': 70000,
    'nested-ref-e2e': 60000,
    'mermaid-ref-e2e': 55000,
    'embed-sync-composite-e2e': 50000,
    'drag-e2e': 45000,
  }[name]
  return measured ?? weight
}

function packSuites(names) {
  const jobs = []
  for (const name of [...names].sort((a, b) => suiteWeight(b) - suiteWeight(a))) {
    if (ISOLATED_SUITES.has(name)) {
      jobs.push({ weight: suiteWeight(name), names: [name], isolated: true })
      continue
    }
    const weight = suiteWeight(name)
    let target = jobs.find((job) => !job.isolated && job.names.length < batchMaxSuites && job.weight + weight <= batchWeightMs)
    if (!target) {
      target = { weight: 0, names: [] }
      jobs.push(target)
    }
    target.names.push(name)
    target.weight += weight
  }
  return jobs
}

function wrapSuite(name) {
  return `\nawait __runE2ESuite(${JSON.stringify(name)}, async () => {\n${readFileSync(join(here, `${name}.js`), 'utf8')}\n})\n`
}

function runBatch(names, lane) {
  return new Promise((resolve) => {
    // 一个 lane 只启动一次 ego-browser Node；每个用例包进独立 async 作用域。
    const body =
      `const __EGO_DIR = ${JSON.stringify(here)}\n` +
      `const __EGO_LANE = ${JSON.stringify(`lane-${lane}`)}\n` +
      `const __EGO_BATCH = true\n` +
      readFileSync(join(here, '_egolite-lib.js'), 'utf8') + '\n' +
      `const __e2eBatchResults = []\n` +
      `const __runE2ESuite = async (name, fn) => {\n` +
      `  const started = Date.now(); let code = 0; let summary = null; const failures = []\n` +
      `  const priorLog = globalThis.cliLog\n` +
      `  globalThis.cliLog = (...args) => { const line = args.map(String).join(' '); const m = /结果: (\\d+) 通过 \\/ (\\d+) 失败/.exec(line); if (m) summary = { pass: Number(m[1]), fail: Number(m[2]) }; if (line.startsWith('❌')) failures.push(line); return priorLog(...args) }\n` +
      `  for (let attempt = 0; attempt < 2; attempt++) { try { await fn(); code = 0; break } catch (e) { if (e?.__e2eSuiteExit) { code = e.code; if (code === 0) break } else { code = 1; if (attempt === 1) priorLog('❌ ' + name + ' 未捕获异常: ' + (e?.stack || e)) } } }\n` +
      `  globalThis.cliLog = priorLog\n` +
      `  __e2eBatchResults.push({ name, code, summary, failures, ms: Date.now() - started })\n` +
      `}\n` +
      names.map(wrapSuite).join('') +
      `\ncliLog('__E2E_BATCH_RESULTS__' + JSON.stringify(__e2eBatchResults))\n` +
      `realProcessExit(__e2eBatchResults.some(r => r.code !== 0) ? 1 : 0)\n`
    const p = spawn(EGO, ['nodejs'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    const started = Date.now()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      p.kill('SIGTERM')
      setTimeout(() => p.kill('SIGKILL'), 5000).unref()
    }, batchTimeoutMs)
    const heartbeat = setInterval(() => {
      process.stdout.write(`\n  … lane-${lane}（${names.length} 套件）已运行 ${Math.round((Date.now() - started) / 1000)}s`)
    }, 15000)
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.stdin.end(body)
    p.on('close', (code, signal) => {
      clearInterval(heartbeat)
      clearTimeout(timeout)
      const marker = /__E2E_BATCH_RESULTS__(\[[^\n]+\])/.exec(out)
      let suites = []
      if (marker) {
        try { suites = JSON.parse(marker[1]) } catch { /* 统一按批次失败报告 */ }
      }
      resolve({ lane, names, code, signal, timedOut, out, suites, ms: Date.now() - started })
    })
  })
}

const results = []
async function collectBatch(batch) {
  process.stdout.write(`▶ lane-${batch.lane}: ${batch.names.join(', ')}\n`)
  const run = await runBatch(batch.names, batch.lane)
  if (run.suites.length !== batch.names.length) {
    const summary = run.timedOut ? `❌ timeout>${Math.round(batchTimeoutMs / 1000)}s` : `❌ batch code=${run.code}`
    for (const name of batch.names) results.push({ name, ms: run.ms, summary, out: run.out })
    console.log(run.out.split('\n').slice(-16).join('\n'))
    return
  }
  for (const suite of run.suites) {
    const s = suite.summary
    const summary = s ? (suite.code === 0 && s.fail === 0 ? `✅ ${s.pass}/${s.fail}` : `❌ ${s.pass}/${s.fail}`) : suite.code === 0 ? '✅ done' : `❌ code=${suite.code}`
    results.push({ ...suite, summary, out: run.out })
    process.stdout.write(`  ${summary} ${suite.name} (${(suite.ms / 1000).toFixed(1)}s)\n`)
    if (!summary.startsWith('✅') && suite.failures?.length) console.log(suite.failures.slice(-12).join('\n'))
  }
}

async function runLane(lane, queue) {
  while (queue.length) {
    const job = queue.shift()
    if (!job) return
    await collectBatch({ lane, names: job.names })
  }
}

async function main() {
const runStarted = Date.now()
console.log(`E2E 回归：${suitesToRun.length}/${SUITES.length} 个套件，workers=${workers}`)
// app-e2e 会清空共享截图目录，必须最后独占运行；其余套件在隔离 lane 中动态分配。
const exclusive = suitesToRun.filter((name) => name === 'app-e2e')
const regular = suitesToRun.filter((name) => name !== 'app-e2e')
const jobs = packSuites(regular)
console.log(`调度：${jobs.length} 个微批，batch≤${batchMaxSuites} suites / weight≤${batchWeightMs}ms`)
await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, (_, i) => runLane(i + 1, jobs)))
if (exclusive.length) await collectBatch({ lane: 1, names: exclusive })

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
console.log(`保留 ${workers} 个固定 E2E lane 供下轮复用（不触发空间删除弹窗）`)
process.exit(fail === 0 ? 0 : 1)
}
void main()
