// E2E 回归汇总：依次执行全部正式套件（需 dev server :5173 + playwright）
// 用法：npm run test:e2e
// app-e2e 最后跑（会清空 demo-shots/）
const { spawn } = require('node:child_process')
const { join } = require('node:path')

const here = __dirname
const SUITES = [
  'ref-e2e',      // M1 引用语法与节点
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
  'source-e2e',   // M7 源码查看模式（Ctrl+E 切换）
  'drag-e2e',     // M7 文件树拖拽移动 + 瞄准定位
  'm7-apidoc-e2e',// M7 接口文档：动态对象 objectsFor + findCodeBlocks
  'xxljob-e2e',   // M7 xxljob：一文件一任务校验 + 属性对象引用
  'm8-db-e2e',    // M8 数据库：字段对象 objectsFor + 表清单↔字段表一致性
  'm9-placeholder-e2e', // M9 占位符：{{}} decoration 渲染（代码块内保留字面）
  'mermaid-zoom-e2e', // Mermaid 预览放大查看（悬停放大镜 + Lightbox + ESC）
  'mermaid-ref-e2e', // M9 Mermaid 代码块 @ 联想 + 文本级引用跳转
  'app-e2e',      // 综合（清空 demo-shots/）
]

function run(name) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(here, `${name}.js`)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
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
process.exit(fail === 0 ? 0 : 1)
}
void main()
