# Spec：WriteIt Agent 调试通道（debug channel）

> 状态：**v1.1 已实现（M1–M4 + 多实例/多客户端/跨机支持；Linux dev 链路端到端验证通过）**；本文件为设计基准与后续维护参考。
> 背景动机：① Agent 需要直接勘查用户正在使用的 app 现场（免复现）；② ego-lite e2e 重、且无法探查"用户手动打开的界面"；③ 为后续 Phase 2 引用模型层重构提供问题取证工具。

## 0. 已确认决策（2026-08 落地）

6. **v1.1 多实例/多客户端/跨机（2026-08-28）**：
   - **① Tauri 实例注册表**：`app_config_dir/debug_instances/<instanceId>.json`（instanceId=`w{pid}-{hex8}`，启动即注册、关闭即删；CLI 扫描目录 + pid 探活，僵尸文件顺手清理）。设置页展示实例标识 + pid + 复制按钮——用户把这份标识发给 Agent，Agent 用 `instance` 参数指认。`debug.json` 单点发现文件保留作向后兼容。
   - **② relay 设备标识**：attach 帧带 `deviceLabel`（URL `?deviceLabel=` / localStorage `writeit.deviceLabel` 可覆盖，默认 平台+视口）；`clients` 输出带设备列；CLI/工具用 `client` 参数显式指认，不再依赖"最新"的隐式选择。
   - **③ 跨机器 vite**：env `WRITEIT_DEBUG_HOST`/`PORT` 覆盖默认中继地址；CLI `--host/--port/--ws/--tcp`；工具 `transport`（auto/tcp/ws）+ host/port。`auto` = 同 host:port 先 TCP（带发现文件 token）后 WS。
   - **④ 会话感知**：extension 取消目标缓存，每次执行重新 `resolveTarget()`（实例/页面列表随时变）；新增 `instances`（本机注册表扫描，不连接）。

---

1. **VM 验证方式**：M3 用 `tauri dev` 在 VM 上验证（不每轮打包 NSIS）。
2. **Token 展示**：设置页展示明文 token + 复制按钮（方便人工介入环节）。发现文件仍写。
3. **exec 逃生舱**：新增设置 `debugLanExecDisabled`（默认 true）——lan 模式下 exec 拒绝执行；local/dev 不受限，可在设置解除。
4. **Pi 接入**：extension（writeit 工具，结构化参数）为主 + skill（排查手册）为辅。实现中验证：工具在真实 pi 会话内连 live 实例取 refs/tabs 成功。
5. **实现期偏差（记录）**：
   - CLI 风格别名（status/tabs/refs/md/dom/logs/…）由 CLI 与 extension 各自映射到后端命令；extension 内置 ALIASES 表。
   - `exec` 采用「表达式优先、语句块兜底」求值语义（裸表达式会正确返回值）。
   - screenshot 需先清洗现代 CSS `color(srgb…)`（html2canvas 不支持），否则 crepe 标题色直接炸。
   - 事件推送前端 ring buffer 为主；CLI `watch` 实时、`events.since` 轮询两种消费方式均已验证。

---

## 0. 目标 / 非目标

**目标**

1. Agent（Pi）能对**正在运行的 WriteIt 实例**执行只读侦查（状态/文档/引用同步/渲染/DOM/日志/截图）与少量语义操作（保存/打开/切视图）。
2. 两条传输链路，共用同一套协议与前端命令注册表：
   - **Tauri 桌面版**：Rust 壳内置 TCP debug server（VM 场景，SSH 进 VM 跑 CLI）；
   - **浏览器 dev 模式**：vite dev server 做中继（Agent 与 vite 同在 A 机，局域网设备 B 打开网页，Agent 经 vite 反向连接调试 B）。
3. Pi 接入：项目级 extension 注册 `writeit` 工具 + 项目级 skill（排查手册）。

**非目标（本期不做）**

- 不替代 e2e 回归套件（ego-lite 仍是回归主力）；
- 不做多客户端并发编辑/协同语义（那是 Phase 2 模型层的事，本通道只做"看"和"操作"）；
- 不做写文件类命令（操作走应用语义层 `action.run`，写文件由 app 自己的保存流程完成）。

---

## 1. 总体架构

```
场景一：Tauri 桌面版（VM，SSH 可达）
┌─ VM (Windows) ────────────────────────────────┐
│ Rust 壳                                        │
│  debug server: 127.0.0.1:9527（默认）           │
│  或 0.0.0.0（内网模式，需 token）               │
│  发现文件: %APPDATA%/com.writeit.app/debug.json│
│         │ emit/listen (Tauri event)           │
│  Webview ←→ src/debug/（命令注册表，唯一执行体） │
└───────┬───────────────────────────────────────┘
        │ NDJSON over TCP
        ▼
  writeit-cli（SSH 会话内执行）⇄ Pi extension（writeit 工具）

场景二：浏览器 dev 模式（A 机 = vite + Agent；B 机 = 局域网设备）
┌─ A 机 ─────────────────────────────┐   ┌─ B 机 ──────────────┐
│ vite dev server (:5173, host:true) │◄──┤ 浏览器打开           │
│  ├─ WS /__debug/client  ◄──────────┼───┤ 页面内 src/debug/    │
│  │   （B 的页面反向连回 vite）        │   │ wsTransport 主动连接 │
│  ├─ WS /__debug/agent（仅 localhost）│   └────────────────────┘
│  └─ 中继路由 + 客户端注册表           │
└───────┬────────────────────────────┘
        │ NDJSON over WebSocket（localhost）
        ▼
  writeit-cli / Pi extension（与 vite 同机）
```

两条链路的关键对称性：

- **前端命令注册表是唯一执行体**，传输层（tauri event / WebSocket）只是搬运工；
- CLI 与 Pi extension 共用一个 RPC 客户端模块（`scripts/_rpc-client.mjs`），协议实现只写一遍。

场景二成立的前提：B 能加载 A 的页面 ⇒ B 必能反向 WS 连回 A（同源、无 CORS 问题）。CLI 只需连 A 机 localhost，不需要可达 B——**中继反转了连接方向**，规避了 B 不可入站的问题。

---

## 2. 协议（NDJSON，两种传输通用）

一帧一行 JSON。帧类型：

### 请求（CLI/Agent → server/relay）

```json
{"id":1,"cmd":"tabs.list","args":{}}
{"id":2,"cmd":"doc.markdown","args":{"path":"notes/a.md"}}
```

### 响应（回传）

```json
{"id":1,"ok":true,"data":[...]}
{"id":2,"ok":false,"error":"tab not found: notes/a.md"}
```

超时：server/relay 侧 5s 无响应回 `{"ok":false,"error":"timeout"}`；CLI 侧 10s 放弃。

### 鉴权

- **Tauri TCP**：首帧必须 `{"id":0,"cmd":"auth","args":{"token":"..."}}`，token 来自发现文件；失败断连。localhost 模式也要求 token（防同机其他用户进程乱入，成本为零）。
- **dev relay**：`/__debug/agent` 端点**仅绑定 localhost**（CLI 与 vite 同机），无需 token；如需开放给局域网其他 Agent，设 `WRITEIT_DEBUG_LAN=1`（此时强制 token，token 写入 `node_modules/.writeit/debug-token` 并打印到 vite 控制台）。`/__debug/client` 端点对局域网开放（B 机浏览器要用），但 client 端点只能被动接收命令帧、上报事件，不能主动发起任意请求——被恶意页面连上的最坏后果是"替别人执行了读命令并回传"，dev 环境可接受。

### 事件（前端 → 通道 → 订阅者）

事件由前端 `events.ts` 产生并维护**带序号的内存环形缓冲（1000 条）**：

```json
{"seq":42,"event":"tab.activated","at":"...","data":{"path":"notes/a.md"}}
{"seq":43,"event":"log.error","at":"...","data":{"msg":"..."}}
```

- CLI `watch`：长连接，新事件实时推送（Tauri TCP 直推；relay 经 WS 转发）；
- 无长连接能力的一端（如 Pi 工具）用命令轮询：`{"cmd":"events.since","args":{"seq":37}}` → 返回 seq>37 的缓冲切片。**缓冲放前端，两种传输零额外实现。**

### 事件类型（v1）

| 事件 | 触发 |
|---|---|
| `tab.opened` / `tab.activated` / `tab.closed` | manager 标签生命周期 |
| `tab.dirty` | 脏标记翻转 |
| `toast` | 全局 toast（含 error） |
| `log.error` / `log.warn` | diagnostics logger |
| `refs.broadcast` | registry 广播执行（realPath + 各视图 stale 结果）——Phase 2 取证金矿 |
| `fs.backend` | FS 后端切换 |
| `git.status` | git 面板刷新 |

### relay 专有命令（由中间件自身处理，不下发浏览器）

```json
{"cmd":"clients"} → {"ok":true,"data":[{"id":"c1","ua":"Chrome/...","url":"http://A:5173/?repo=1","backend":"dev","attachedAt":"..."}]}
{"cmd":"use","args":{"client":"c1"}} → 选定后续命令的路由目标
{"cmd":"use","args":{"client":"auto"}} → 自动选最新 attach 的客户端（CLI 默认行为）
```

Tauri 链路无此命令（单 webview，天然唯一）。

---

## 3. 前端：`src/debug/` 模块

```
src/debug/
├── registry.ts     # registerCommand(name, fn) + execute(cmd, args)；纯分发，不含业务
├── commands.ts     # 命令实现（薄封装现有探针/钩子，见 §4）
├── events.ts       # 事件产生 + 环形缓冲 + since 查询；store watch / logger / toast 挂钩
├── transport.ts    # 传输抽象：onRequest(cmd,args)→Promise<result>；attach 后自动开始
├── tauri-transport.ts   # listen('debug://request') + invoke('debug_reply')（仅 Tauri 环境）
└── ws-transport.ts      # WebSocket 连 vite /__debug/client（仅 dev 且 vite 可达时）
```

- `main.ts` 装配：Tauri 环境 → tauri-transport；`import.meta.env.DEV` → ws-transport；生产浏览器构建两个都不挂（tree-shake 掉，不进 bundle）。
- 命令执行统一 try/catch，异常 → `{ok:false, error:stack摘要}`，绝不影响 app 主流程。
- **循环依赖纪律**：`src/debug/` 只准 import（diagnostics 探针、state、manager 导出函数），**反向禁止**（manager 等不得 import debug；events.ts 通过 store/logger 的现有可 watch 对象取数，不深插业务模块）。

## 4. 命令清单（v1）

### A. 侦查（只读）

| 命令 | 数据来源 | 说明 |
|---|---|---|
| `app.info` | fs.kind / `__APP_VERSION__` / uptime / liteMode / webviewArgs | 环境确认 |
| `tabs.list` | `__diagGetTabs`（现成） | |
| `doc.markdown {path?}` | `__editorGetMarkdown` / 按 path 取 | 缺省=当前标签 |
| `doc.selection` | PM `view.state.selection` | 光标/选区文本 |
| `refs.registry` | `registryDiag()`（现成） | 引用同步现场（stale 视图表） |
| `refs.broken` | `getBrokenPaths()`（现成） | 断链清单 |
| `dom.snapshot` | `collectDomSnapshot()`（现成） | 面板几何/折叠/动画/裁剪 |
| `editor.probe` | `collectEditorProbe()`（现成） | 文档结构健康 |
| `perf.monitor` | `getMonitorSnapshot()`（现成） | 渲染节奏 |
| `git.status` | gitPanel state | SCM 现场 |
| `logs.tail {n}` | `logEntries`（现成） | 业务日志 |
| `console.tail {n}` | **新增**：console 拦截环（500 条，dev 一直挂） | 前端报错现场 |
| `events.since {seq}` | events.ts 缓冲 | 事件轮询 |
| `screenshot {path?}` | html2canvas → PNG base64（依赖已有） | 截图（dev 与 Tauri 均可用） |
| `mockfs.state` | `__mockFsDebug`（现成） | mock 排障 |

### B. 操作（应用语义层，不模拟 DOM 事件）

```json
{"cmd":"action.run","args":{"action":"save"}}
{"cmd":"action.run","args":{"action":"open","path":"notes/a.md"}}
{"cmd":"action.run","args":{"action":"viewMode","mode":"source"}}
{"cmd":"action.run","args":{"action":"closeTab","tabId":3}}
```

实现 = 直调 manager 已导出的 `saveActiveTab` / `openTab` / `toggleSourceMode` / `closeTab`。v1 白名单就这四个（够用为先，防误触面最小）。

### C. 逃生舱

```json
{"cmd":"exec","args":{"js":"window.__editorDebug().length"}}
```

页面上下文 eval 任意 JS，返回值 JSON 化（不可序列化则 `String()`）。保证通道永远够用；`registry.ts` 不注册新命令也不至于卡死。

---

## 5. 传输一：Rust TCP server（Tauri）

`src-tauri/src/debug_server.rs`（新文件，~250 行，std 线程版，不引 tokio）：

- **生命周期**：tauri command `debug_server_control(mode: 'off'|'local'|'lan')`，由前端设置页触发（设置新增「调试通道」区：关闭/仅本机/内网 + 状态显示 + token 展示）。`local` 绑 127.0.0.1，`lan` 绑 0.0.0.0。
- **发现文件**：启动/切模式时写 `%APPDATA%/com.writeit.app/debug.json`：`{pid, port, token, mode}`；关闭时删除。端口从 9527 起占用则 +1。
- **帧循环**：accept → 读行 → auth 校验（未 auth 的非 auth 帧直接断）→ `app.emit_to("main", "debug://request", {id, cmd, args})` → 挂起 pending map（5s 超时）。前端 `invoke("debug_reply", {id, ok, data})` → 写回对应连接。**事件下发**：前端 `invoke("debug_emit", {event})` → Rust 向所有已 auth 连接推事件帧（CLI watch 用；Pi 工具不用，走 events.since 轮询）。
- **CSP**：tauri.conf.json 目前 `csp: null`，无需变更；不额外暴露 IPC 权限（capabilities 不动，`debug_reply`/`debug_emit` 是普通 command）。

## 6. 传输二：vite 中继（dev 模式）

`vite-plugins/debug-relay.ts`（新插件，~200 行，`server` 钩子）：

- **端点**：
  - `WS /__debug/client`：浏览器 attach 帧 `{type:"attach", ua, url}` → 注册进 clients map（id=c1,c2…），断连即注销；收 `{type:"reply",...}` 按 id 路由回 agent 连接；收 `{type:"event",...}` 广播给所有 agent 连接。
  - `WS /__debug/agent`：绑定 localhost（校验 `req.socket.remoteAddress`）；收 NDJSON 请求帧：`clients`/`use` 本地处理，其余转发给选定 client（`use auto` = 最新 attach），pending 5s 超时。
- **开关**：默认启用（仅 dev server，本来就不该在生产暴露）；`WRITEIT_DEBUG_OFF=1` 关闭。`host: true` 已有，B 机可达性现成。
- **前端**：`ws-transport.ts` 在 dev 模式启动即连 `ws://${location.host}/__debug/client`，指数退避重连（页面热更新/刷新后自动恢复 attach）。
- 现有 e2e 跑 dev server：中间件零侵入（只新增两个 WS 端点），不影响现有用例。

## 7. CLI：`scripts/writeit-cli.mjs`（零依赖）

```
连接解析顺序：--host/--port 显式指定 > 项目内 dev token 文件（dev relay）> 尝试 localhost:9527+
子命令：
  status            连通性 + app.info + clients（relay）
  tabs / md [--path] / selection / refs / broken
  dom / editor / perf / git / mockfs
  logs [--n 100] / console [--n 100] / events [--since N]
  watch             长连接实时事件流（Ctrl-C 退出）
  shot [--out p.png]
  run <action> [args…]   # run save / run open notes/a.md / run viewMode source
  exec "<js>"
  raw '<json>'      # 整帧透传（Pi extension 用）
全局：--json（机器读）/ --client <id> / --timeout <ms>；错误非零退出
```

- TCP 用 `node:net`；WS 用 Node ≥22 全局 `WebSocket`（项目 node 版本要求已满足 vite 7 线）。
- 人读输出做轻量表格化（refs 输出 stale 视图表，见 §10 示例）。

`scripts/_rpc-client.mjs`：可复用 RPC 客户端（connect/auth/请求-响应/事件订阅），CLI 与 Pi extension 共同 import，协议实现单一出处。

---

## 8. Pi 接入

### 8.1 Extension（机制层，主要接入）

`​.pi/extensions/writeit-debug/index.ts`（项目级，随仓库走）：

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { StringEnum } from "@earendil-works/pi-ai"
import { rpc } from "../../../editor-app/scripts/_rpc-client.mjs"  // 单一协议实现

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "writeit",
    label: "WriteIt Debug",
    description: "检查/操作正在运行的 WriteIt 编辑器实例（桌面版 TCP 或 dev 页面）。用于现场勘查：标签、文档内容、引用同步状态、DOM/渲染、日志、截图，以及 save/open 等语义操作。",
    promptSnippet: "Inspect or drive a running WriteIt editor instance (tabs, markdown, ref-sync state, DOM, logs, screenshot)",
    promptGuidelines: [
      "用户报告 WriteIt 运行时问题时，先用 writeit 工具勘查现场（status → refs/tabs/dom/logs），而不是让用户复现。",
    ],
    parameters: Type.Object({
      command: StringEnum(["status","tabs.list","doc.markdown","doc.selection","refs.registry","refs.broken","dom.snapshot","editor.probe","perf.monitor","git.status","logs.tail","console.tail","events.since","screenshot","action.run","exec"] as const),
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      host: Type.Optional(Type.String({ description: "目标主机（默认 localhost；SSH 场景即 VM 本机）" })),
      port: Type.Optional(Type.Number()),
    }),
    async execute(_id, params, signal) {
      // rpc() 内部：连接（dev token 文件 / 9527 起扫描）→ 发帧 → 等响应
      const res = await rpc(params, { signal })
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], details: {} }
    },
  })
}
```

要点：

- 工具是**薄壳**：结构化参数 → 一帧 RPC → JSON 文本回传；连接发现/重试/token 全在 `_rpc-client.mjs`。
- `screenshot` 回 base64——工具返回 text；如需"看图"，Agent 用 CLI 落盘 PNG 后走 read 工具读图（spec 验证项之一）。
- 失败要**可诊断**：连不上时返回「发现文件不存在/端口不通/token 失配」三者之一的具体原因，Agent 才能引导用户开开关。

### 8.2 Skill（手册层，辅助）

`​.pi/skills/writeit-debug/SKILL.md`（项目级）：

```markdown
---
name: writeit-debug
description: WriteIt 运行时问题现场勘查手册。用户报告编辑器引用同步/渲染/保存等运行问题时加载。
---
# WriteIt 现场勘查
## 何时用
用户说"现在界面上…没同步/渲染不对/报错了"→ 不要求复现，直接 writeit 工具看现场。
## 标准流程
1. status → 确认实例与后端（tauri/mock/dev）
2. 同步问题：refs.registry（stale 视图）+ events.since（最近 refs.broadcast）+ doc.markdown 对照
3. 渲染问题：dom.snapshot + screenshot
4. 报错：console.tail + logs.tail
5. 需要操作现场：action.run（先跟用户确认）
## 输出解读
（refs.registry 字段表、常见 stale 组合的含义 …）
```

**分工**：extension 让模型"能做"，skill 让模型"知道什么时候做、怎么读结果"。二者都项目级，随仓库分发，Agent 换机器即插即用。

---

## 9. 安全边界（汇总）

| 面 | 措施 |
|---|---|
| Tauri TCP 默认 | 关闭；开启后 localhost + token |
| 内网模式 | 显式开关 + token 必验 + 设置页红字提示 |
| dev relay agent 端点 | 默认仅 localhost；开放需 env 显式开启 + token |
| dev relay client 端点 | 局域网开放但被动（只收命令帧/上报告），dev 环境接受 |
| exec 命令 | 任意 JS——与"用户在 DevTools console 敲"同级风险，文档写明；内网模式下可在设置里禁 exec（v1.1 可选） |
| e2e/生产 bundle | ws-transport 仅 DEV 挂载；commands.ts 引用现有探针，体积增量可忽略 |

## 10. 典型勘查流（验收基准之一）

用户报告：A.md 嵌 B.md 两处，编辑其中一处，另一处与 B 标签不实时同步。

```bash
$ writeit-cli status
connected: tauri (pid 1234) backend=tauri lite=false
$ writeit-cli refs
realPath     ver  truthLen  views
notes/b.md    7     1203     tab2#blk_1a  stale=false
                             tab2#blk_2f  stale=true   ← 落后视图
                             doc:tab5     stale=true
$ writeit-cli events --since 30
… refs.broadcast realPath=notes/b.md origin=tab2#blk_1a applied=1 skipped=1 …
$ writeit-cli md --path notes/a.md   # 宿主内容对质
```

三步定位：哪个视图 stale → 广播时是 applied 还是 skipped（skipped 原因在事件 data 里）→ 宿主/源内容对照。全程无复现。

---

## 11. 里程碑与验收

> 实现状态：**M1 ✅ M2 ✅ M3（前端侧 ✅；Rust 侧代码完成，待 VM `tauri dev` 验证）M4 ✅（extension+skill 已建，真实 pi 会话验证通过）**
> 备注：本环境无 cargo——Rust 侧无法本地编译验证，代码经人工审查；VM 验证项留给用户（见下）。

| 里程碑 | 内容 | 验收（全部必须过） |
|---|---|---|
| **M1 通道最小闭环（dev relay）** | `src/debug/`（registry/transport/ws/commands 仅 `app.info`+`exec`）+ vite 中继插件 + CLI（status/tabs…走 exec 也能用）+ `_rpc-client.mjs` | ① Linux：`npm run build` 绿 + 现有 e2e 抽查（app-e2e、ref-e2e）绿；② vite dev 开页面，CLI `status`/`exec` 通；③ **用另一台局域网设备（或手机）打开 `http://A:5173`，CLI 能看到该 clients 并路由命令**——场景 2 端到端验证 |
| **M2 侦查命令全量 + 事件** | A 类 15 命令 + console 拦截环 + events 环形缓冲 + `watch` | ① 每命令在 dev relay 链路出数正确（含 mock/dev/web 三后端各抽一个）；② 事件：开关标签/触发 toast → watch 实时可见、events.since 可补拉 |
| **M3 Tauri TCP + 操作** | Rust debug_server + 设置页开关（off/local/lan）+ 发现文件 + `action.run` + `screenshot` | ① `cargo check` 绿；② Windows VM（SSH）：打包 exe 开 local 模式 → SSH 内 CLI 全命令通、`shot` 出图；③ lan 模式：A 机经内网连 VM 的 CLI 通、token 错误被拒 |
| **M4 Pi 接入** | extension（writeit 工具）+ skill + 联调 | ① pi 内让 Agent"看看现在编辑器开着哪些标签"→ 正确调用工具返回；② 人为制造 stale 现场（M1 的 A/B 嵌入场景）→ Agent 用 writeit 工具独立定位出落后视图；③ 服务关闭时工具返回可诊断错误，Agent 能引导开启；④ `screenshot` 落盘 → read 工具读图成功 |

顺序理由：M1/M2 全程 Linux 可验证（不等 Windows 环境），先把协议与命令层磨稳；M3 只剩 Rust 传输；M4 是薄壳。

## 12. 风险与开放问题

1. **VM 打包节奏**：M3 验收需要往 VM 传一个新包。若打包不便，可先用 `tauri dev` 在 VM 里跑（VM 有 node 环境即可）——需要你确认 VM 上跑 dev 是否可行。
2. **`action.run` 的并发安全**：命令在页面上下文同步执行，与用户手动操作可能交错。v1 接受（操作类命令本就低频），返回值带上操作前后 dirty 状态便于判断。
3. **html2canvas 在软渲染 VM 上的成本**：`screenshot` 可能瞬时高 CPU。接受（手动触发、低频）；必要时 lite 模式下降级为 DOM 文本快照。
4. **多浏览器 client 抢答**：relay 下多页面同时 attach 时 `use auto` 取最新。若 B 机多标签页各算一个 client——按"页面"而非"设备"粒度处理，v1 接受，CLI `clients` 可显式指定。
5. **开放问题**：① 事件里 `refs.broadcast` 需要在 manager 的广播执行器里埋点，会轻微碰 Phase 1 要拆的文件——接受少量提前触碰（就 3 行埋点）；② token 展示在设置页还是只写文件？倾向只写文件+设置页给路径（少一个 UI 状态）。

---

## 13. 交付物清单

```
editor-app/
├── src/debug/{registry,commands,events,transport,tauri-transport,ws-transport}.ts
├── src-tauri/src/debug_server.rs            # + lib.rs 挂 command/装配
├── vite-plugins/debug-relay.ts              # + vite.config.ts 注册
├── scripts/writeit-cli.mjs
├── scripts/_rpc-client.mjs
├── .pi/extensions/writeit-debug/index.ts    # Pi 工具
├── .pi/skills/writeit-debug/SKILL.md        # Pi 手册
└── specs/agent-debug-channel.md             # 本文档
```
