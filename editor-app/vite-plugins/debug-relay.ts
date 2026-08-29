// ============================================================
// debug-relay.ts —— Vite dev server 调试中继（Agent 调试通道的 dev 模式传输）
//   两个 WS 端点：
//     /__debug/client  浏览器页面反向连接（局域网可达；页面 attach 后被动收命令）
//     /__debug/agent   Agent CLI 连接（默认仅 localhost；WRITEIT_DEBUG_LAN=1 开放 + token）
//   中继职责：客户端注册表、命令路由（选目标 client）、pending 超时、事件广播。
//   协议：NDJSON 帧。请求帧 {id,cmd,args}；回复帧 {id,ok,data|error}。
//   `clients` / `use` 由中继本地处理，其余命令路由给选定 client。
// ============================================================
import type { Plugin } from 'vite'
import { WebSocketServer } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'

interface ClientConn {
  id: string
  ws: WebSocket
  ua: string
  url: string
  backend: string
  deviceLabel: string
  attachedAt: number
  alive: boolean
}

const clients = new Map<string, ClientConn>()
/** agent socket → 唯一 id（pending key 用，防多 agent 同 id 冲突） */
const agentIds = new Map<WebSocket, string>()
const agents = new Set<WebSocket>()
/** pending 请求：`agentId:id` → { agent socket, timer } */
const pending = new Map<string, { agent: WebSocket; timer: NodeJS.Timeout }>()
const REQUEST_TIMEOUT = 10_000

let clientSeq = 0
let agentSeq = 0
let autoClient: string | null = 'auto' // null = 不路由（等 use）；'auto' = 最新 attach

// ---------- 工具 ----------

function clampHost(ip: string): boolean {
  // 允许 loopback（IPv4/IPv6/::ffff 前缀）
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

function reply(agent: WebSocket, id: number, payload: { ok: boolean; data?: unknown; error?: string }): void {
  if (agent.readyState !== agent.OPEN) return
  agent.send(JSON.stringify({ id, ok: payload.ok, data: payload.data ?? null, error: payload.error ?? null }))
}

function replyToClient(client: ClientConn, id: number, cmd: string, args: Record<string, unknown>, aid: string): void {
  if (client.ws.readyState !== client.ws.OPEN) return
  client.ws.send(JSON.stringify({ id, cmd, args, aid }))
}

function latestClient(): ClientConn | null {
  let best: ClientConn | null = null
  for (const c of clients.values()) {
    if (!best || c.attachedAt > best.attachedAt) best = c
  }
  return best
}

function currentTarget(): ClientConn | null {
  if (autoClient === 'auto') return latestClient()
  if (autoClient) return clients.get(autoClient) ?? null
  return null
}

// ---------- 端点处理 ----------

function handleAgentMessage(socket: Socket, raw: string, isLocalhost: boolean, agent: WebSocket): void {
  let frame: { id?: number; cmd?: string; args?: Record<string, unknown> }
  try {
    frame = JSON.parse(raw)
  } catch {
    agent.send(JSON.stringify({ ok: false, error: 'invalid json frame' }))
    return
  }
  if (typeof frame.id !== 'number' || typeof frame.cmd !== 'string') return

  // 中继本地命令
  if (frame.cmd === 'clients') {
    reply(agent, frame.id, {
      ok: true,
      data: [...clients.values()].map((c) => ({
        id: c.id,
        ua: c.ua,
        url: c.url,
        backend: c.backend,
        deviceLabel: c.deviceLabel || '',
        attachedAt: c.attachedAt,
        alive: c.alive,
      })),
    })
    return
  }
  if (frame.cmd === 'use') {
    const c = frame.args?.client
    if (typeof c === 'string' && (c === 'auto' || clients.has(c))) {
      autoClient = c
      reply(agent, frame.id, { ok: true, data: { target: c } })
    } else {
      reply(agent, frame.id, { ok: false, error: `bad client: ${String(c)}` })
    }
    return
  }
  if (frame.cmd === 'relay.info') {
    reply(agent, frame.id, {
      ok: true,
      data: { isLocalhost, lan: process.env.WRITEIT_DEBUG_LAN === '1', clientCount: clients.size, autoClient },
    })
    return
  }

  // 路由到目标 client
  const target = currentTarget()
  if (!target) {
    reply(agent, frame.id, { ok: false, error: 'no attached client (is a page open?)' })
    return
  }
  const agentKey = agentIds.get(agent) ?? '?'
  const key = `${agentKey}:${frame.id}`
  const timer = setTimeout(() => {
    pending.delete(key)
    if (agent.readyState === agent.OPEN) {
      agent.send(JSON.stringify({ id: frame.id, ok: false, error: `timeout (${REQUEST_TIMEOUT}ms)` }))
    }
  }, REQUEST_TIMEOUT)
  pending.set(key, { agent, timer })
  replyToClient(target, frame.id, frame.cmd, frame.args ?? {}, agentKey)
}

function handleClientMessage(client: ClientConn, raw: string): void {
  let frame: {
    type?: string
    ua?: string
    url?: string
    backend?: string
    deviceLabel?: string
    aid?: string
    payload?: { id?: number; ok?: boolean; data?: unknown; error?: string }
  }
  try {
    frame = JSON.parse(raw)
  } catch {
    return
  }
  if (frame.type === 'attach') {
    client.ua = frame.ua ?? ''
    client.url = frame.url ?? ''
    client.backend = frame.backend ?? ''
    client.deviceLabel = frame.deviceLabel ?? ''
    client.alive = true
    return
  }
  if (frame.type === 'reply' && typeof frame.payload?.id === 'number') {
    const key = frame.aid ? `${frame.aid}:${frame.payload.id}` : null
    const req = key ? (pending.get(key) ?? null) : null
    if (req) {
      clearTimeout(req.timer)
      pending.delete(key)
      reply(req.agent, frame.payload.id, {
        ok: Boolean(frame.payload.ok),
        data: frame.payload.data,
        error: frame.payload.error,
      })
    }
    return
  }
  if (frame.type === 'event') {
    // 广播给所有在线的 agent
    for (const a of agents) {
      if (a.readyState === a.OPEN) a.send(JSON.stringify({ event: 'push', payload: frame.payload }))
    }
    return
  }
}

// ---------- 插件 ----------

export default function debugRelay(): Plugin {
  return {
    name: 'writeit:debug-relay',
    apply: 'serve',
    configureServer(server) {
      if (process.env.WRITEIT_DEBUG_OFF === '1') return
      const wss = new WebSocketServer({ noServer: true })

      server.httpServer?.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
        const url = (req.url ?? '').split('?')[0]
        let isAgent = false
        if (url === '/__debug/agent') {
          isAgent = true
        } else if (url !== '/__debug/client') {
          return // 非调试端点，交给 vite 默认处理
        }
        // agent 端点默认仅 localhost
        if (isAgent && process.env.WRITEIT_DEBUG_LAN !== '1') {
          const ip = req.socket.remoteAddress ?? ''
          if (!clampHost(ip)) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
            socket.destroy()
            return
          }
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req)
        })
      })

      wss.on('connection', (ws, req) => {
        const url = (req.url ?? '').split('?')[0]

        if (url === '/__debug/agent') {
          const aid = `a${++agentSeq}`
          agentIds.set(ws, aid)
          agents.add(ws)
          ws.on('message', (data) => {
            handleAgentMessage(req.socket, String(data), clampHost(req.socket.remoteAddress ?? ''), ws)
          })
          const cleanup = () => {
            agents.delete(ws)
            agentIds.delete(ws)
            for (const [k, r] of pending) {
              if (r.agent === ws) {
                clearTimeout(r.timer)
                pending.delete(k)
              }
            }
          }
          ws.on('close', cleanup)
          ws.on('error', cleanup)
          return
        }

        if (url === '/__debug/client') {
          const id = `c${++clientSeq}`
          const conn: ClientConn = {
            id,
            ws,
            ua: '',
            url: '',
            backend: '',
            attachedAt: Date.now(),
            alive: true,
          }
          clients.set(id, conn)
          ws.on('message', (data) => {
            handleClientMessage(conn, String(data))
          })
          ws.on('close', () => {
            clients.delete(id)
            // 该 client 的 pending 请求因无法定位哪条属于它 → 统一由超时兜底（10s）
          })
          ws.on('error', () => clients.delete(id))
          return
        }
      })

      server.httpServer?.on('close', () => wss.close())
    },
  }
}