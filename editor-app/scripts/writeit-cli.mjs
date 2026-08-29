#!/usr/bin/env node
// ============================================================
// writeit-cli.mjs —— WriteIt 调试通道命令行（Agent 现场勘查用）
//   用法示例：
//     writeit-cli status | tabs | md [--path x] | refs | dom | shot --out p.png
//     writeit-cli logs --n 100 | console --n 100 | events --since 30
//     writeit-cli run save | run open notes/a.md | exec "1+1"
//     writeit-cli watch                # 事件实时流
//     writeit-cli --host 192.168.x.x --port 9527 tabs
//     writeit-cli --json tabs          # 机器读
//   错误非零退出。零依赖（node ≥22 提供全局 WebSocket）。
// ============================================================
import { writeFile } from 'node:fs/promises'
import {
  resolveTarget,
  openSession,
  rpcRequest,
  readDebugFile,
  listInstances,
} from './_rpc-client.mjs'

// ---------- argv 解析 ----------

function parseArgv(argv) {
  const opts = { host: null, port: null, token: null, json: false, client: null, out: null, path: null, n: null, since: null, instance: null, ws: false, tcp: false }
  const args = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') opts.json = true
    else if (a === '--host' && argv[i + 1]) opts.host = argv[++i]
    else if (a === '--port' && argv[i + 1]) opts.port = argv[++i]
    else if (a === '--token' && argv[i + 1]) opts.token = argv[++i]
    else if (a === '--client' && argv[i + 1]) opts.client = argv[++i]
    else if (a === '--instance' && argv[i + 1]) opts.instance = argv[++i]
    else if (a === '--ws') opts.ws = true
    else if (a === '--tcp') opts.tcp = true
    else if (a === '--out' && argv[i + 1]) opts.out = argv[++i]
    else if (a === '--path' && argv[i + 1]) opts.path = argv[++i]
    else if (a === '--n' && argv[i + 1]) opts.n = Number(argv[++i])
    else if (a === '--since' && argv[i + 1]) opts.since = Number(argv[++i])
    else if (a.startsWith('--')) {
      // 未知 flag：跳过值（容错）
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) i++
    } else args.push(a)
  }
  return { opts, args }
}

async function finalizeTarget(session) {
  // ws 中继：先发 use，再发 relay.info（探测）
  const info = await session.request('relay.info', {}).catch(() => null)
  return info
}

// ---------- 输出 ----------

function outJson(v) {
  process.stdout.write(JSON.stringify(v, null, 2) + '\n')
}

function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)))
  const fmt = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ')
  const lines = [fmt(headers), fmt(widths.map((w) => '-'.repeat(w))), ...rows.map(fmt)]
  return lines.join('\n')
}

function fmtRefs(data) {
  if (!data || typeof data !== 'object') return JSON.stringify(data, null, 2)
  const out = []
  for (const [realPath, e] of Object.entries(data)) {
    out.push(`\n${realPath}  ver=${e.version} truth=${e.truthLen ?? -1} disk=${e.diskLen ?? -1}`)
    for (const v of e.views ?? []) {
      out.push(
        `  ${v.kind === 'block' ? `块 ${v.block}` : '文档标签'}  tab=${v.tab}  last=${v.lastLen ?? -1}  ${v.stale ? 'stale=TRUE ←' : 'stale=false'}`
      )
    }
  }
  return out.join('\n') || '(空 registry)'
}

/** M4：docstore.inspect 格式化（取代 refs.registry；见 spec §6.3） */
function fmtDocstore(data) {
  if (!data || typeof data !== 'object') return JSON.stringify(data, null, 2)
  if (!data.models?.length) return '(空 DocStore)'
  const out = []
  for (const m of data.models) {
    const dirtyMark = m.dirty ? '●' : ' '
    out.push(`\n${m.realPath}  rev=${m.rev} diskRev=${m.diskRev} ${dirtyMark}dirty  fab=${m.consistent ? 'ok' : 'MISMATCH'}${m.parseDegraded ? ' degraded' : ''}${m.diskAligned ? '' : ' disk#unverified'}`)
    out.push(`  blocks=${m.blocks?.length ?? 0}  subscribers=${m.subscribers?.length ?? 0}`)
    for (const s of m.subscribers ?? []) {
      const kind = s.kind === 'block' ? `块 ${s.blockId}` : s.kind === 'doc' ? '文档标签' : '快照'
      out.push(`  ${kind}  tab=${s.tabId ?? '-'}  rev=${s.rev}/${m.rev}  ${s.stale ? 'stale=TRUE ←' : 'ok'}`)
    }
  }
  return out.join('\n')
}

function fmtTabs(tabs) {
  return table(['id', 'path', 'kind', 'view', 'dirty', 'active'], tabs.map((t) => [t.id, t.path, t.kind ?? 'editor', t.viewMode, t.dirty ? '●' : '', t.active ? '*' : '']))
}

function fmtLogs(entries) {
  return table(
    ['t', 'level', 'area', 'msg'],
    entries.map((e) => [new Date(e.t).toISOString().slice(11, 23), e.level, e.area, (e.msg ?? '').slice(0, 160)])
  )
}

// ---------- 主流程 ----------

async function main() {
  const { opts, args } = parseArgv(process.argv.slice(2))
  const cmd = args[0]
  if (!cmd) {
    console.error('用法: writeit-cli <命令> [options]\n  instances|clients|status|tabs|md|selection|refs|docstore|broken|dom|editor|perf|git|logs|console|events|watch|shot|mockfs|run|exec|raw')
    console.error('  多实例: --instance <id>（writeit-cli instances 查看）；多页面: --client <id>；跨机 vite: --host <ip> --port 5173 --ws')
    process.exit(2)
  }

  // 一次性命令 vs watch/events
  const oneshot = cmd !== 'watch'
  // instances：不连接，直接扫描本机 tauri 实例注册表（+可选 ws 中继 clients）
  if (cmd === 'instances') {
    const insts = await listInstances()
    if (opts.json) {
      outJson(insts)
    } else if (!insts.length) {
      process.stdout.write('(本机无存活 WriteIt TCP 实例；vite dev 中继请用 clients 查看)\n')
    } else {
      const rows = insts.map((i) => [i.instanceId, i.pid, i.mode, i.port, i.root ?? ''])
      process.stdout.write(table(['instanceId', 'pid', 'mode', 'port', 'root'], rows) + '\n')
      process.stdout.write('连接指定实例：writeit-cli --instance <instanceId> <命令>\n')
    }
    process.exit(0)
  }

  const target = await resolveTarget({
    host: opts.host,
    port: opts.port,
    token: opts.token,
    instance: opts.instance,
    transport: opts.ws ? 'ws' : opts.tcp ? 'tcp' : undefined,
    tauriHost: opts.host,
  })

  let session
  try {
    session = await openSession(target)

    // ws 中继：选 client（--client 或自动）
    if (target.transport === 'ws') {
      const clientArg = opts.client ?? 'auto'
      await session.request('use', { client: clientArg }, { timeoutMs: 3000 }).catch(() => {})
    }

    // 通用 JSON 帧（用于透传 / raw 模式）
    const frame = { id: 0, cmd, args: {} }
    // ---------- 命令路由 ----------
    switch (cmd) {
      case 'status': {        const info = await session.request('app.info', {})
        const origin = target.instanceId ? ` instance=${target.instanceId}` : target.fromFile ? ` (发现文件: ${target.fromFile})` : ''
        const lines = [`connected: ${target.transport}${origin}`]
        lines.push(`transport: ${target.transport}`)
        if (info?.version) lines.push(`version: ${info.version} (${info.buildTime ?? ''})`)
        lines.push(`fsBackend: ${info?.fsBackend}  root: ${info?.rootName ?? '(未打开)'}`)
        lines.push(`liteMode: ${info?.liteMode}  uptime: ${info?.uptimeSec ?? '?'}s  tabs: ${info?.tabs ?? '?'}`)
        if (target.transport === 'ws') {
          const relay = await finalizeTarget(session)
          lines.push(`relay: localhostOk=${relay?.isLocalhost} lan=${relay?.lan} clients=${relay?.clientCount ?? '?'}`)
          if (relay?.clientCount) {
            const clients = await session.request('clients', {})
            for (const c of clients ?? []) lines.push(`  client ${c.id}: ${c.deviceLabel || c.ua.slice(0, 40)} → ${c.url} [${c.backend}]`)
          }
        }
        process.stdout.write(lines.join('\n') + '\n')
        break
      }
      case 'clients': {
        const cs = await session.request('clients', {})
        if (opts.json) outJson(cs)
        else if (!cs?.length) process.stdout.write('(无已连接页面 client)\n')
        else {
          const rows = cs.map((c) => [c.id, c.deviceLabel || '', c.url, c.backend])
          process.stdout.write(table(['id', 'device', 'url', 'backend'], rows) + '\n')
          process.stdout.write('指定目标：writeit-cli --client <id> <命令>\n')
        }
        break
      }
      case 'relay': {
        const d = await finalizeTarget(session)
        if (opts.json) outJson(d)
        else process.stdout.write(JSON.stringify(d, null, 2) + '\n')
        break
      }
      case 'tabs':
        outJsonOrTable(opts, await session.request('tabs.list', {}), fmtTabs, (t) => t)
        break
      case 'md': {
        const data = await session.request('doc.markdown', opts.path ? { path: opts.path } : {})
        if (opts.json) outJson(data)
        else process.stdout.write((data ?? '') + '\n')
        break
      }
      case 'selection':
        outJsonOrTable(opts, await session.request('doc.selection', {}), (d) => JSON.stringify(d, null, 2), (d) => d)
        break
      case 'refs': {
        // M4（spec §6.3）：refs.registry 已 deprecated，由 docstore.inspect 接管
        outJsonOrTable(opts, await session.request('refs.registry', {}), fmtRefs, (d) => d)
        break
      }
      case 'docstore': {
        outJsonOrTable(opts, await session.request('docstore.inspect', {}), fmtDocstore, (d) => d)
        break
      }
      case 'broken':
        outJsonOrTable(opts, await session.request('refs.broken', {}), (d) => (d?.length ? d.join('\n') : '(无断链)'), (d) => d)
        break
      case 'dom': {
        const d = await session.request('dom.snapshot', {})
        if (opts.json) outJson(d)
        else process.stdout.write(JSON.stringify(d, null, 2) + '\n')
        break
      }
      case 'editor':
        outJsonOrTable(opts, await session.request('editor.probe', {}), (d) => JSON.stringify(d, null, 2), (d) => d)
        break
      case 'perf':
        outJsonOrTable(opts, await session.request('perf.monitor', {}), (d) => JSON.stringify(d, null, 2), (d) => d)
        break
      case 'git':
        outJsonOrTable(opts, await session.request('git.status', {}), (d) => JSON.stringify(d, null, 2), (d) => d)
        break
      case 'logs':
        outJsonOrTable(opts, await session.request('logs.tail', { n: opts.n ?? 50 }), fmtLogs, (d) => d)
        break
      case 'console':
        outJsonOrTable(opts, await session.request('console.tail', { n: opts.n ?? 50 }), fmtLogs, (d) => d)
        break
      case 'events': {
        const d = await session.request('events.since', { seq: opts.since ?? 0 })
        if (opts.json) outJson(d)
        else {
          process.stdout.write(`lastSeq=${d.last}\n`)
          for (const e of d.events ?? []) process.stdout.write(`${e.seq}  ${e.event}  ${e.at}  ${JSON.stringify(e.data ?? {})}\n`)
        }
        break
      }
      case 'shot': {
        const d = await session.request('screenshot', {})
        if (!d || typeof d !== 'string') throw new Error('screenshot 返回异常')
        const b64 = d.replace(/^data:image\/png;base64,/, '')
        const out = opts.out ?? 'writeit-shot.png'
        await writeFile(out, Buffer.from(b64, 'base64'))
        process.stdout.write(`saved: ${out} (${Buffer.from(b64, 'base64').length} bytes)\n`)
        break
      }
      case 'mockfs':
        outJsonOrTable(opts, await session.request('mockfs.state', {}), (d) => JSON.stringify(d, null, 2), (d) => d)
        break
      case 'run': {
        const action = args[1]
        if (!action) throw new Error('run 需要 action（save/open/viewMode/activate/closeTab）')
        const kv = {}
        // 位置参数映射：open 的第 2 个位置参数 = path；其余支持 key=value
        if (action === 'open' && args[2] && !args[2].includes('=')) kv.path = args[2]
        for (const a of args.slice(2)) {
          const i = a.indexOf('=')
          if (i > 0) kv[a.slice(0, i)] = a.slice(i + 1)
        }
        const data = await session.request('action.run', { action, ...kv })
        if (opts.json) outJson(data)
        else process.stdout.write(JSON.stringify(data, null, 2) + '\n')
        break
      }
      case 'exec': {
        const js = args.slice(1).join(' ')
        if (!js) throw new Error('exec 需要 js 代码')
        const data = await session.request('exec', { js })
        if (opts.json) outJson(data)
        else process.stdout.write(typeof data === 'string' ? data + '\n' : JSON.stringify(data, null, 2) + '\n')
        break
      }
      case 'raw': {
        const raw = args[1]
        if (!raw) throw new Error('raw 需要 JSON（{"cmd":...,"args":{...}}）')
        const parsed = JSON.parse(raw)
        const data = await session.request(parsed.cmd, parsed.args ?? {})
        if (opts.json) outJson(data)
        else process.stdout.write(JSON.stringify(data, null, 2) + '\n')
        break
      }
      case 'watch': {
        const off = session.onEvent((ev) => {
          process.stdout.write(`${ev.seq ?? ''}  ${ev.event}  ${ev.at ?? ''}  ${JSON.stringify(ev.data ?? {})}\n`)
        })
        console.error(`[writeit] 监听事件流 (${target.transport})… Ctrl-C 退出`)
        await new Promise((resolve) => {
          const stop = () => {
            off()
            resolve()
          }
          process.on('SIGINT', stop)
          process.on('SIGTERM', stop)
        })
        break
      }
      default:
        throw new Error(`未知命令: ${cmd}`)
    }
  } catch (e) {
    console.error(`[writeit] 失败: ${e.message}`)
    process.exit(1)
  } finally {
    if (oneshot) session?.close()
    else serverKeepAlive()
  }
}

function serverKeepAlive() {
  // 主动 close 交给 watch 的 stop；此处仅防止进程立即退
}

function outJsonOrTable(opts, data, fmtHuman, fmtJson = (d) => d) {
  if (opts.json) outJson(fmtJson(data))
  else process.stdout.write(fmtHuman(data) + '\n')
}

// 让未处理的 promise rejection 显示出来
process.on('unhandledRejection', (e) => {
  console.error('[writeit] unhandled:', e?.message ?? e)
  process.exit(1)
})

main().catch((e) => {
  console.error(`[writeit] 失败: ${e.message}`)
  process.exit(1)
})