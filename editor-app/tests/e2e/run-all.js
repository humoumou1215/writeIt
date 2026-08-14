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
  const summary = m ? `✅ ${m[1]}/${m[2]}` : r.code === 0 ? '✅ done' : `❌ code=${r.code}`
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
