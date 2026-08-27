// 远程 CPU 采样：连接 Windows 上 WebView2 的 remote-debugging 端口，Profiler 采样后输出热点函数
// 用法: node /tmp/probe-win.mjs http://<win-ip>:9222 [采样秒数]
const target = process.argv[2] || 'http://127.0.0.1:9222' // 内网单机：默认本机 9222
const seconds = parseInt(process.argv[3] || '15', 10)

const list = await fetch(target + '/json').then((r) => r.json()).catch((e) => {
  console.error('无法连接 ' + target + '。请确认：环境变量 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 已设置、writeIt 已完全重启（结束所有 msedgewebview2.exe）、页面已打开。原始错误: ' + e.message)
  process.exit(1)
})
const page = list.find((t) => t.type === 'page')
if (!page) {
  console.error('未找到 page target:', JSON.stringify(list.map((t) => ({ type: t.type, url: t.url }))))
  process.exit(1)
}
console.log('已连接 target 类型=' + page.type + ' url=' + page.url.slice(0, 100))

const ws = new WebSocket(page.webSocketDebuggerUrl)
let msgId = 0
const pend = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id)
    pend.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
})
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId
  pend.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params }))
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

await send('Profiler.enable')
await send('Profiler.start')
console.log('采样中 ' + seconds + 's（请保持应用空闲、不要操作）…')
await new Promise((r) => setTimeout(r, seconds * 1000))
const { profile } = await send('Profiler.stop')
ws.close()

const { nodes, samples, timeDeltas } = profile
const cf = new Map()
for (const n of nodes) cf.set(n.id, n.callFrame)
const acc = new Map()
for (let i = 0; i < samples.length; i++) {
  const id = samples[i]
  const dt = timeDeltas[i] || 0
  if (!dt) continue
  const f = cf.get(id)
  if (!f) continue
  const url = (f.url || 'native').replace(/^.*\/(src\/|node_modules\/)/, '$1').slice(0, 90)
  const key = (f.functionName || '(anonymous)') + ' @ ' + url
  acc.set(key, (acc.get(key) || 0) + dt)
}
const total = [...acc.values()].reduce((a, b) => a + b, 0)
console.log('sampledTotalMs=' + Math.round(total / 1000) + '  samples=' + samples.length)
console.log('TOP 20:')
for (const [k, v] of [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log('  ' + (v / total * 100).toFixed(1).padStart(5) + '%  ' + (v / 1000).toFixed(0).padStart(5) + 'ms  ' + k)
}