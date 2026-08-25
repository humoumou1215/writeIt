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
// 释放所有遗留 task space（防内存堆积；每个 <- 测试遗留的未关闭空间）
function cleanupSpaces() {
  try {
    const { spawnSync } = require('node:child_process')
    const script = readFileSync(join(here, '_cleanup-spaces.ego.js'), 'utf8')
    spawnSync(EGO, ['nodejs'], { input: script, encoding: 'utf8', timeout: 60000 })
  } catch (e) { /* 清理失败不影响结果 */ }
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
  'embed-sync-p1-e2e',      // 嵌入同步回归①：last-wins 止血 / 双块对称 / 写回守卫（真实输入补强）
  'embed-sync-p2-e2e',      // 嵌入同步回归②：registry 单一事实来源 / blockId / 跨标签
  'embed-sync-caret-regress-e2e', // 嵌入同步：NodeView 不重建（光标/输入落点回归）
  'embed-sync-realinput-e2e',     // 用户 4 问题全链路（真实键盘输入：重复/光标/保存消失/回流）
  'embed-sync-composite-e2e',     // registry 复合 + 边界（多宿主/链式/环/只读/并发/写回）
  'embed-indep-verify-e2e', // 嵌入同步独立重验证：registry 严格断言（磁盘/块全等、并发分叉、只读、跨宿主）
  'embed-indep-verify2-e2e', // 嵌入同步独立重验证②：关闭重开/reload 持久化/无源标签写回/真实输入
  'annotations-overlap-e2e',// 批注 v8：重叠/嵌套/同文多条/跨行 + 旧文件兼容
  'diagnostics-e2e', // 问题诊断包：logger/双入口/生成 zip/异常提示红点（D1-D3，2026-08-22）
  'app-e2e',      // 综合（清空 demo-shots/）
]

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
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.stdin.end(body)
    p.on('close', (code) => resolve({ name, code, out }))
  })
}

const results = []
async function main() {
for (const name of SUITES) {
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
  process.stdout.write(summary + '\n')
  if (!m && r.code !== 0) {
    // 崩溃：打印尾部日志
    console.log(r.out.split('\n').slice(-8).join('\n'))
  }
  results.push({ ...r, summary })
}

console.log('\n===== E2E 汇总 =====')
let fail = 0
for (const r of results) {
  const ok = /✅/.test(r.summary)
  if (!ok) fail++
  console.log(`${ok ? '✅' : '❌'} ${r.name}: ${r.summary}`)
}
console.log(fail === 0 ? '\n全部通过 🎉' : `\n${fail} 个套件未通过 ❌`)
console.log('\n释放遗留 task space…')
cleanupSpaces()
process.exit(fail === 0 ? 0 : 1)
}
void main()
