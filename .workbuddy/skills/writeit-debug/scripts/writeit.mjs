#!/usr/bin/env node
// ============================================================
// writeit.mjs —— WorkBuddy 侧「WriteIt 现场勘查」调试壳
//
//   定位：功能对齐 .pi/extensions/writeit-debug/index.ts（pi 扩展注册的
//   writeit 工具），但**不改动 .pi 下任何文件**。本壳只做三件事：
//     1) 定位项目根（找 editor-app/scripts/writeit-cli.mjs）
//     2) 挑选 node ≥22（全局 WebSocket 是 ws 中继的前提）
//     3) 参数透传给 writeit-cli.mjs（协议实现的唯一出处）
//
//   用法（skill 加载后用绝对路径调用）：
//     node <root>/.workbuddy/skills/writeit-debug/scripts/writeit.mjs status
//     node ...mjs instances
//     node ...mjs clients
//     node ...mjs --client c3 refs         # 指定页面 client
//     node ...mjs --instance w123-… tabs   # 指定 Tauri 实例
//     node ...mjs --json tabs              # 机器读
//     node ...mjs shot                     # 自动落盘到 <root>/.workbuddy/tmp/shots/
//     node ...mjs logs --n 100
//
//   环境变量：
//     WRITEIT_ROOT  项目根（缺省自动向上查找）
//     WRITEIT_NODE  node 可执行文件（缺省自动挑 ≥22 的）
//
//   退出码透传自 writeit-cli.mjs（0 成功 / 1 失败 / 2 用法错误）
// ============================================================
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const IS_WIN = process.platform === 'win32'
const NODE_EXE = IS_WIN ? 'node.exe' : 'node'

// ---------- 定位项目根 ----------
function findRoot() {
  const env = process.env.WRITEIT_ROOT
  if (env && existsSync(path.join(env, 'editor-app', 'scripts', 'writeit-cli.mjs'))) return env
  let dir = HERE
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, 'editor-app', 'scripts', 'writeit-cli.mjs'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

// ---------- 挑选 node（≥22 才有全局 WebSocket，ws 中继必需） ----------
function nodeCandidates() {
  const list = []
  if (process.env.WRITEIT_NODE) list.push(process.env.WRITEIT_NODE)
  list.push(process.execPath)
  const base = path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'versions')
  try {
    // 倒序：高版本优先
    const versions = readdirSync(base).sort().reverse()
    for (const v of versions) {
      list.push(path.join(base, v, NODE_EXE))
      list.push(path.join(base, v, 'bin', NODE_EXE))
    }
  } catch {
    /* 无托管 node，忽略 */
  }
  return list
}

function nodeMajor(bin) {
  return new Promise((resolve) => {
    if (!existsSync(bin)) return resolve(null)
    let out = ''
    let p
    try {
      p = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return resolve(null)
    }
    p.stdout.on('data', (d) => (out += String(d)))
    p.on('error', () => resolve(null))
    p.on('close', () => {
      const m = out.match(/v(\d+)/)
      resolve(m ? Number(m[1]) : null)
    })
  })
}

async function pickNode() {
  for (const bin of nodeCandidates()) {
    const major = await nodeMajor(bin)
    if (major !== null && major >= 22) return { bin, major }
  }
  return { bin: process.execPath, major: null }
}

// ---------- argv 里找子命令（对齐 CLI 的 parseArgv 容错逻辑） ----------
const VALUE_FLAGS = new Set(['--host', '--port', '--token', '--client', '--instance', '--out', '--path', '--n', '--since'])

function scanArgv(argv) {
  let cmd = null
  let cmdIndex = -1
  let hasOut = false
  let clientId = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') {
      hasOut = true
      i++
      continue
    }
    if (a === '--client') {
      clientId = argv[i + 1] ?? null
      i++
      continue
    }
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a) || (argv[i + 1] && !argv[i + 1].startsWith('--'))) i++
      continue
    }
    if (cmd === null) {
      cmd = a
      cmdIndex = i
    }
  }
  return { cmd, cmdIndex, hasOut, clientId }
}

// ---------- client 前置校验 ----------
// 为什么需要：writeit-cli.mjs 里 `use {client}` 的失败被 .catch(() => {}) 吞掉，
// 会静默 fallback 到中继当前 attached 的 client —— 多页面场景下 = 悄悄勘查错目标。
// pi 扩展版（不 catch）会直接报 `bad client`；本壳补上等价校验，保证行为一致。
function preflightClient(bin, cli, root, argv, clientId) {
  const probe = argv.slice()
  // 去掉 --client <id>
  for (let i = probe.length - 1; i >= 0; i--) {
    if (probe[i] === '--client') probe.splice(i, 2)
  }
  // 剔除后索引会位移，必须重新扫描子命令位置再替换成 clients
  const s = scanArgv(probe)
  if (s.cmdIndex >= 0) probe[s.cmdIndex] = 'clients'
  else probe.push('clients')
  if (!probe.includes('--json')) probe.push('--json')

  const r = spawnSync(bin, [cli, ...probe], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (r.status !== 0) return // 非 ws 中继 / 连不上：交给主命令自己报错，不干扰

  let list
  try {
    list = JSON.parse(r.stdout ?? '')
  } catch {
    return // 输出不可解析（如老后端无 clients 命令）：放过
  }
  if (!Array.isArray(list) || list.length === 0) return

  if (!list.some((c) => c && String(c.id) === String(clientId))) {
    console.error(`[writeit] bad client: ${clientId}`)
    console.error('可用 client（页面刷新后 id 会变，请重新 clients 取新 id）：')
    for (const c of list) {
      console.error(`  ${c.id}  ${c.deviceLabel || ''} → ${c.url}${c.backend ? ` [${c.backend}]` : ''}`)
    }
    process.exit(1)
  }
}

const HELP = `writeit —— WriteIt 现场勘查（WorkBuddy 版，等价于 pi 的 writeit 工具）

用法:
  node ${path.relative(process.cwd(), path.join(HERE, 'writeit.mjs')).replace(/\\/g, '/')} <命令> [options]

命令:
  instances                 本机存活 Tauri 实例表（不连接）
  clients                   vite 中继上的页面 client 表
  status                    连接信息 + 后端 + 标签数（含 relay/clients 概览）
  tabs | md | selection     标签表 / 文档 markdown / 选区
  refs | docstore | broken  引用注册表 / M4 DocStore 视图 / 断链
  dom | editor | perf       DOM 几何快照 / 编辑器探针 / 渲染节奏
  git | logs | console      git 状态 / 业务日志 / 前端 console
  events | watch            事件时间线 / 实时事件流（Ctrl-C 退出）
  shot                      截图（默认落盘 .workbuddy/tmp/shots/shot-<ts>.png）
  mockfs | run | exec       mock FS 状态 / 语义操作 / 逃生舱 JS
  raw '<json>'              透传任意 RPC 帧

常用 options:
  --client <id>   指定页面 client（vite 中继无默认焦点，连接型命令必带）
  --instance <id> 指定 Tauri 实例
  --host <ip> --port <n> [--ws|--tcp]   跨机 / VM 场景
  --json          机器读原始 JSON
  --path <p> --n <n> --since <seq> --out <file>

提示: 多目标并存时先 instances / clients 列表，再指认——不要猜。`

async function main() {
  const root = findRoot()
  if (!root) {
    console.error('[writeit] 找不到项目根（editor-app/scripts/writeit-cli.mjs 不在任何上级目录）。')
    console.error('         设环境变量 WRITEIT_ROOT=<项目根> 再试。')
    process.exit(2)
  }

  const argv = process.argv.slice(2)
  const { cmd, cmdIndex, hasOut, clientId } = scanArgv(argv)

  if (!cmd) {
    console.error(HELP)
    process.exit(2)
  }

  // 截图：未指定 --out 时自动落盘到 .workbuddy/tmp/shots/（绝对路径，便于 Read 读图）
  let shotFile = null
  if ((cmd === 'shot' || cmd === 'screenshot') && !hasOut) {
    const dir = path.join(root, '.workbuddy', 'tmp', 'shots')
    mkdirSync(dir, { recursive: true })
    shotFile = path.join(dir, `shot-${Date.now()}.png`)
    argv.push('--out', shotFile)
  }

  const { bin, major } = await pickNode()
  if (major === null) {
    console.error(`[writeit] 未找到 node ≥22（当前用 ${bin}）。ws 中继需要全局 WebSocket；`)
    console.error('         设 WRITEIT_NODE=<node≥22 路径> 再试。')
  }

  const cli = path.join(root, 'editor-app', 'scripts', 'writeit-cli.mjs')

  // 指定了 --client：先校验 id 存在，避免静默 fallback 到别的页面
  if (clientId && cmd !== 'clients' && cmd !== 'instances') {
    preflightClient(bin, cli, root, argv, clientId)
  }

  const child = spawn(bin, [cli, ...argv], { stdio: 'inherit', cwd: root })

  child.on('error', (e) => {
    console.error(`[writeit] 启动 CLI 失败: ${e.message}`)
    process.exit(1)
  })
  child.on('close', (code) => {
    if (shotFile && code === 0) {
      // 追加一行绝对路径，方便 Read 工具直接读图
      console.log(`SHOT_FILE=${shotFile.replace(/\\/g, '/')}`)
    }
    process.exit(code ?? 0)
  })
}

main().catch((e) => {
  console.error(`[writeit] 失败: ${e?.message ?? e}`)
  process.exit(1)
})
