// 轻量单测 runner（E1 自带脚手架，零新依赖）：
//   esbuild 把 TS 纯模块 bundle 成 cjs → node:assert 跑断言矩阵。
// 用法：npm run test:unit（含全量旧套件可在 CI 合并跑）
const { buildSync } = require('esbuild')
const { mkdirSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..', '..')
const cacheDir = join(__dirname, '.cache')
mkdirSync(cacheDir, { recursive: true })

const modules = {
  'embed-chain': ['src/editor/ref/embed-chain.ts'],
}
for (const [name, entry] of Object.entries(modules)) {
  buildSync({
    entryPoints: entry.map((e) => join(root, e)),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: join(cacheDir, `${name}.cjs`),
    logLevel: 'silent',
  })
}

const tests = readdirSync(__dirname).filter((f) => f.endsWith('.test.cjs') && !f.startsWith('_'))
let failed = 0
for (const t of tests) {
  process.stdout.write(`▶ ${t}\n`)
  try {
    require(join(__dirname, t))
    process.stdout.write(`  ✓ pass\n`)
  } catch (e) {
    failed++
    process.stdout.write(`  ✗ fail: ${e && e.message}\n`)
  }
}
if (failed) {
  process.stderr.write(`\nunit: ${failed} suite(s) failed\n`)
  process.exit(1)
}
process.stdout.write('\nunit: all pass\n')