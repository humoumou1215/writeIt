// 单套件运行器（ego-lite，禁 playwright）
// 用法：node tests/e2e/_run-one.js <suite-name>     例如 node tests/e2e/_run-one.js ref-e2e
// 等价于 run-all.js 跑单个套件；需先启动 dev server :5173。
// 注：每套件末尾会 completeTaskSpace(keep:false) 关闭标签；若套件崩溃遗留，可手动跑
//   ego-browser nodejs < tests/e2e/_cleanup-spaces.ego.js  释放空间。
const { spawn } = require('node:child_process')
const { readFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { homedir } = require('node:os')

const here = __dirname
const name = process.argv[2]
if (!name) {
  console.error('用法: node tests/e2e/_run-one.js <suite-name>')
  process.exit(1)
}
const file = join(here, `${name}.js`)
if (!existsSync(file)) {
  console.error(`套件不存在: ${file}`)
  process.exit(1)
}

const EGO = process.env.EGO_BROWSER_BIN || join(homedir(), '.local/bin/ego-browser')
// 拼接：注入 __EGO_DIR → _egolite-lib.js 源码 → 用例源码
const body =
  `const __EGO_DIR = ${JSON.stringify(here)}\n` +
  readFileSync(join(here, '_egolite-lib.js'), 'utf8') + '\n' +
  readFileSync(file, 'utf8')
const p = spawn(EGO, ['nodejs'], {
  stdio: ['pipe', 'pipe', 'inherit'],
})
p.stdin.end(body)
p.on('close', (code) => process.exit(code ?? 1))
