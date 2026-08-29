// ============================================================
// _rpc-client.mjs —— 调试通道 RPC 客户端（CLI 与 Pi extension 共用）
//   传输：Tauri TCP（node:net）/ dev 中继 WS（node ≥22 全局 WebSocket）
//   发现：env > --host/--port > tauri 发现文件 > 默认 dev 中继
//   一帧一行 JSON；事件帧 type:'event'（{event, data}），回复帧 {id, ok, data|error}
// ============================================================
import { createConnection } from 'node:net'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_DEV_PORT = process.env.WRITEIT_DEV_PORT || '5173'
const ENV_HOST = process.env.WRITEIT_DEBUG_HOST || ''
const ENV_PORT = process.env.WRITEIT_DEBUG_PORT || ''

// ---------- 发现 ----------

export function appDataDebugFileCandidates() {
  const home = os.homedir()
  const list = []
  if (process.platform === 'win32' && process.env.APPDATA) {
    list.push(path.join(process.env.APPDATA, 'com.writeit.app', 'debug.json'))
  }
  if (process.platform === 'darwin') {
    list.push(path.join(home, 'Library', 'Application Support', 'com.writeit.app', 'debug.json'))
  }
  list.push(path.join(home, '.writeit', 'debug.json'))
  list.push(path.join(home, '.config', 'com.writeit.app', 'debug.json'))
  return list
}

export async function readDebugFile() {
  for (const p of appDataDebugFileCandidates()) {
    try {
      const raw = await readFile(p, 'utf8')
      return { path: p, info: JSON.parse(raw) }
    } catch {
      /* try next */
    }
  }
  return null
}

export function registryDir() {
  // 与 appDataDebugFileCandidates 同源：根目录下 debug_instances/
  const home = os.homedir()
  const cands = []
  if (process.platform === 'win32' && process.env.APPDATA) cands.push(path.join(process.env.APPDATA, 'com.writeit.app', 'debug_instances'))
  if (process.platform === 'darwin') cands.push(path.join(home, 'Library', 'Application Support', 'com.writeit.app', 'debug_instances'))
  cands.push(path.join(home, '.writeit', 'debug_instances'))
  cands.push(path.join(home, '.config', 'com.writeit.app', 'debug_instances'))
  for (const c of cands) {
    try {
      if (fs.statSync(c).isDirectory()) return c
    } catch {
      /* try next */
    }
  }
  return null
}

/** 进程是否存活（POSIX/Windows 通用：kill 0 探测） */
export function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e?.code === 'EPERM' // 存在但无权限 → 算存活
  }
}

/** 扫描实例注册表：返回存活实例列表（多 tauri 进程并存场景） */
export async function listInstances() {
  const dir = registryDir()
  const out = []
  if (!dir) return out
  const { readdir, rm } = await import('node:fs/promises')
  let entries = []
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  for (const f of entries) {
    if (!f.endsWith('.json') || f === 'instances.json') continue
    try {
      const info = JSON.parse(await readFile(path.join(dir, f), 'utf8'))
      if (pidAlive(info.pid)) {
        out.push({ ...info, file: path.join(dir, f) })
      } else {
        // 僵尸注册（进程已退出未清理）→ 顺手删
        try {
          await rm(path.join(dir, f))
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
  return out
}

const fs = await import('node:fs')

/**
 * 解析目标。返回：
 *   { transport:'tcp', host, port, token }  桌面 TCP（tauri debug server）
 *   { transport:'ws', url }                 vite 中继
 *   { transport:'auto', tcp?, ws? }         显式 host+port 但未知类型 → 连时先 TCP 后 WS
 * 优先级：显式 opts（transport/host/port/instance）> env WRITEIT_DEBUG_HOST/PORT > tauri 注册表/发现文件 > dev 中继
 */
export async function resolveTarget(opts = {}) {
  const { host, port, token, transport, instance } = opts

  // 实例指认：从注册表找对应 instanceId
  if (instance) {
    const list = await listInstances()
    const hit = list.find((i) => i.instanceId === instance)
    if (!hit) throw new Error(`未找到存活的实例 ${instance}（可在设置页查看实例标识）`)
    return { transport: 'tcp', host: host ?? '127.0.0.1', port: hit.port, token: hit.token ?? '', instanceId: instance }
  }

  // 显式传输类型
  if (transport === 'ws') {
    return { transport: 'ws', url: `ws://${host ?? '127.0.0.1'}:${port ?? DEFAULT_DEV_PORT}/__debug/agent`, from: 'explicit' }
  }
  if (transport === 'tcp') {
    const info = await readDebugFile()
    return {
      transport: 'tcp',
      host: host ?? '127.0.0.1',
      port: Number(port ?? info?.info?.port ?? 9527),
      token: token ?? info?.info?.token ?? '',
    }
  }

  // host+port 给了但没指定类型：自动（默认先 TCP，失败 WS）
  if (host && port) {
    const info = await readDebugFile()
    return {
      transport: 'auto',
      tcp: { host, port: Number(port), token: token ?? info?.info?.token ?? '' },
      ws: { url: `ws://${host}:${port}/__debug/agent` },
    }
  }

  // 只给 host：读发现文件用其 token/port（TCP；若该端口是 vite 则自动回落）
  if (host) {
    const info = await readDebugFile()
    const p = port ?? info?.info?.port ?? 9527
    return {
      transport: 'auto',
      tcp: { host, port: Number(p), token: info?.info?.token ?? '' },
      ws: { url: `ws://${host}:${p}/__debug/agent` },
    }
  }

  // env 覆盖（跨机器 vite / VM 场景）：WRITEIT_DEBUG_HOST/PORT
  if (ENV_HOST) {
    const p = ENV_PORT || DEFAULT_DEV_PORT
    return { transport: 'ws', url: `ws://${ENV_HOST}:${p}/__debug/agent`, from: 'env' }
  }

  // tauri 注册表：多实例时默认连「最新注册」的存活实例；注册表为空再回落单点发现文件
  const instances = await listInstances()
  if (instances.length > 0) {
    const latest = instances.sort((a, b) => (b.at || '').localeCompare(a.at || ''))[0]
    return { transport: 'tcp', host: '127.0.0.1', port: latest.port, token: latest.token ?? '', instanceId: latest.instanceId, from: 'registry' }
  }

  // 单点发现文件（向后兼容旧版）
  const info = await readDebugFile()
  if (info) {
    return {
      transport: 'tcp',
      host: opts.tauriHost ?? '127.0.0.1',
      port: info.info.port,
      token: info.info.token ?? '',
      instanceId: info.info.instanceId ?? '',
      fromFile: info.path,
    }
  }

  // 默认 dev 中继
  return { transport: 'ws', url: `ws://127.0.0.1:${DEFAULT_DEV_PORT}/__debug/agent`, from: 'vite-relay' }
}

// ---------- TCP 会话 ----------

export class TcpSession {
  constructor({ host, port, token }) {
    this.host = host
    this.port = port
    this.token = token ?? ''
    this.sock = null
    this.buffer = ''
    this.pending = new Map() // id → {resolve, reject, timer}
    this.eventCbs = new Set()
    this.closed = false
    this.seq = 0
  }

  async connect() {
    if (this.sock) return
    const sock = createConnection({ host: this.host, port: this.port })
    this.sock = sock
    sock.setNoDelay(true)
    sock.on('data', (chunk) => this.onData(chunk))
    sock.on('close', () => this.onClose())
    sock.on('error', (e) => this.onError(e))
    await new Promise((resolve, reject) => {
      sock.once('connect', resolve)
      sock.once('error', reject)
      sock.setTimeout(3000, () => reject(new Error(`连接超时: ${this.host}:${this.port}`)))
    })
    // auth
    await this.request('auth', { token: this.token }, { timeoutMs: 3000 })
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8')
    let idx
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (line) this.handleLine(line)
    }
  }

  handleLine(line) {
    let frame
    try {
      frame = JSON.parse(line)
    } catch {
      return
    }
    if (frame && typeof frame.event === 'string') {
      // 事件帧
      const ev = frame.event === 'push' ? frame.payload : frame
      for (const cb of [...this.eventCbs]) {
        try {
          cb(ev)
        } catch {
          /* ignore */
        }
      }
      return
    }
    if (frame && typeof frame.id === 'number') {
      const p = this.pending.get(frame.id)
      if (p) {
        clearTimeout(p.timer)
        this.pending.delete(frame.id)
        if (frame.ok) p.resolve(frame.data)
        else p.reject(new Error(frame.error || 'command failed'))
      }
    }
  }

  onClose() {
    this.closed = true
    this.failAll(new Error('连接已关闭'))
  }

  onError(e) {
    this.failAll(e)
  }

  failAll(err) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  request(cmd, args = {}, { timeoutMs = 15000, signal } = {}) {
    const id = ++this.seq
    const frame = JSON.stringify({ id, cmd, args })
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error('已取消'))
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener?.('abort', onAbort)
        this.pending.delete(id)
        reject(new Error(`请求超时 (${timeoutMs}ms): ${cmd}`))
      }, timeoutMs)
      signal?.addEventListener?.('abort', onAbort)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.sock.write(frame + '\n')
      } catch (e) {
        clearTimeout(timer)
        signal?.removeEventListener?.('abort', onAbort)
        this.pending.delete(id)
        reject(e)
      }
    })
  }

  onEvent(cb) {
    this.eventCbs.add(cb)
    return () => this.eventCbs.delete(cb)
  }

  close() {
    this.closed = true
    this.sock?.destroy()
    this.sock = null
  }
}

// ---------- WS 会话（dev 中继） ----------

export class WsSession {
  constructor(url) {
    this.url = url
    this.ws = null
    this.pending = new Map()
    this.eventCbs = new Set()
    this.closed = false
    this.seq = 0
  }

  async connect() {
    if (typeof WebSocket === 'undefined') {
      throw new Error('当前 Node 无全局 WebSocket（需要 Node ≥ 22）')
    }
    const ws = new WebSocket(this.url)
    this.ws = ws
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error(`WS 连接超时: ${this.url}`)), 4000)
      ws.onopen = () => {
        clearTimeout(to)
        resolve()
      }
      ws.onerror = (e) => {
        clearTimeout(to)
        reject(new Error(`WS 连接失败: ${this.url} (${e?.message ?? ''})`))
      }
    })
    ws.onmessage = (ev) => this.handleFrame(ev.data)
    ws.onclose = () => this.failAll(new Error('WS 已关闭'))
    ws.onerror = () => this.failAll(new Error('WS 错误'))
  }

  handleFrame(raw) {
    let frame
    try {
      frame = JSON.parse(String(raw))
    } catch {
      return
    }
    if (frame && frame.event === 'push' && frame.payload) {
      for (const cb of [...this.eventCbs]) {
        try {
          cb(frame.payload)
        } catch {
          /* ignore */
        }
      }
      return
    }
    if (frame && typeof frame.id === 'number') {
      const p = this.pending.get(frame.id)
      if (p) {
        clearTimeout(p.timer)
        this.pending.delete(frame.id)
        if (frame.ok) p.resolve(frame.data ?? null)
        else p.reject(new Error(frame.error || 'command failed'))
      }
    }
  }

  failAll(err) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  request(cmd, args = {}, { timeoutMs = 15000, signal } = {}) {
    const id = ++this.seq
    const frame = JSON.stringify({ id, cmd, args })
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error('已取消'))
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener?.('abort', onAbort)
        this.pending.delete(id)
        reject(new Error(`请求超时 (${timeoutMs}ms): ${cmd}`))
      }, timeoutMs)
      signal?.addEventListener?.('abort', onAbort)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.ws.send(frame)
      } catch (e) {
        clearTimeout(timer)
        signal?.removeEventListener?.('abort', onAbort)
        this.pending.delete(id)
        reject(e)
      }
    })
  }

  onEvent(cb) {
    this.eventCbs.add(cb)
    return () => this.eventCbs.delete(cb)
  }

  close() {
    this.closed = true
    this.ws?.close()
    this.ws = null
  }
}

// ---------- 统一入口 ----------

/** 按目标打开会话（TCP 自动 auth；auto = 先 TCP 后 WS） */
export async function openSession(target) {
  if (target.transport === 'ws') {
    const s = new WsSession(target.url)
    await s.connect()
    return s
  }
  if (target.transport === 'tcp') {
    const s = new TcpSession({ host: target.host, port: target.port, token: target.token })
    await s.connect()
    return s
  }
  if (target.transport === 'auto') {
    // 先试 TCP（可能有 token 鉴权）；失败再试 WS
    const errs = []
    if (target.tcp) {
      try {
        const s = new TcpSession({ host: target.tcp.host, port: target.tcp.port, token: target.tcp.token })
        await s.connect()
        return s
      } catch (e) {
        errs.push(`tcp: ${e.message}`)
      }
    }
    const s = new WsSession(target.ws.url)
    try {
      await s.connect()
      return s
    } catch (e) {
      errs.push(`ws: ${e.message}`)
      throw new Error(`连接失败（${errs.join('；')}）`)
    }
  }
  throw new Error(`未知 transport: ${target.transport}`)
}

/** 一次性请求（自动连接/关闭；signal 可中止） */
export async function rpcRequest(target, cmd, args, opts = {}) {
  const s = await openSession(target)
  try {
    return await s.request(cmd, args, opts)
  } finally {
    s.close()
  }
}