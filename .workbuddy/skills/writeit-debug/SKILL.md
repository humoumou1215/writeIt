---
name: writeit-debug
description: WriteIt 编辑器运行时问题的现场勘查工具。用户报告引用不同步、渲染/布局异常、保存失败、报错、标签状态不对，或要求查看某个 client/实例的状态与详细信息时使用。核心原则：就地勘查（writeit CLI），不要求用户复现。
description_zh: "WriteIt 运行时现场勘查：查看指定 client/实例的标签、文档、引用同步、DOM、日志、截图"
description_en: "On-site inspection of a running WriteIt editor instance (tabs, markdown, ref-sync, DOM, logs, screenshot) for a given client or instance"
version: 1.0.0
display_name: "writeit-debug"
display_name_en: "writeit-debug"
visibility: "private"
agent_created: true
---

# WriteIt 现场勘查手册（WorkBuddy 版）

> 等价能力：pi 侧是 `.pi/extensions/writeit-debug/index.ts` 注册的 `writeit` 工具。
> 本 skill 是 **WorkBuddy 侧的同功能替代**，**不读取也不修改 `.pi/` 下任何文件**——
> 两者共用同一份协议实现 `editor-app/scripts/writeit-cli.mjs`（唯一出处），所以行为一致。

## 调用方式

所有命令都通过壳脚本执行（**cwd 固定为项目根 `D:\project\writeIt`**）：

```bash
node .workbuddy/skills/writeit-debug/scripts/writeit.mjs <命令> [options]
```

壳脚本负责：定位项目根 → 挑 node ≥22（ws 中继需要全局 WebSocket）→ 参数透传给 CLI → 退出码透传。

- 环境变量可选：`WRITEIT_ROOT`（项目根）、`WRITEIT_NODE`（指定 node 可执行文件）
- 不带命令执行 = 打印用法；失败退出码 1

运行环境：
- **桌面版（Tauri）**：用户在设置页「🔌 调试通道」开启后自动读发现文件/实例注册表
- **dev 模式**：vite dev server（5173）运行且有页面打开时自动连中继；不用填 host

## 多实例 / 多客户端怎么选目标（最重要）

面对「多个 WriteIt 进程 + 多个打开的网页页面」时，**绝不瞎猜目标，先列再指**：

1. **多 Tauri 进程**：先
   ```bash
   node .workbuddy/skills/writeit-debug/scripts/writeit.mjs instances
   ```
   得到 instanceId / pid / mode / port / root（用户设置页也有「实例标识」）；指认时用 `--instance <instanceId>`。
2. **多网页客户端**：先
   ```bash
   node .workbuddy/skills/writeit-debug/scripts/writeit.mjs clients
   ```
   表带 id / device / url / backend；指认时用 `--client c3`。
   - ⚠️ vite 中继**无「默认焦点」**：`status`/`tabs`/`refs`/`dom`/`md` 等连接型命令**每次必须显式带 `--client`**，否则报 `no attached client (is a page open?)`。`instances`/`clients` 是直通命令，不需要。
   - ⚠️ 页面刷新后 client id 会变（如 c3→c4）：本壳内置校验，id 失效时报 `bad client: <id>` 并列可用 id（退出码 1），重新 `clients` 取新 id 即可。
     > 底层 `writeit-cli.mjs` 会把 `use` 失败 `.catch` 掉并**静默 fallback** 到中继当前 attached 的页面——多页面时 = 悄悄勘查错目标。本壳用一次前置 `clients` 校验堵住这个洞，行为与 pi 扩展版（直接报 `bad client`）一致，所以**请用本壳而不是直接调 writeit-cli.mjs**。
3. **跨机器 vite / VM**：`--host <ip> --port <n>`，必要时加 `--ws` / `--tcp`。
4. 用户未给标识、且列表多于一个时：**把列表摆给用户问清楚**，不要默认连「最新」。

## 命令表

| 命令 | 后端 RPC | 用途 |
|---|---|---|
| `instances` | —（本机扫描） | 存活 Tauri 实例表 |
| `clients` | `clients` | vite 中继页面 client 表 |
| `status` | `app.info` | 连接/后端/root/标签数，ws 模式附 relay 与 clients 概览 |
| `tabs` | `tabs.list` | 标签表（id/path/kind/view/dirty/active） |
| `md` | `doc.markdown` | 文档 markdown（`--path` 指定，缺省当前标签） |
| `selection` | `doc.selection` | 当前选区 |
| `refs` | `refs.registry` | 引用注册表（stale 视图表） |
| `docstore` | `docstore.inspect` | M4 DocStore 视图（rev/stale/一致性，**优先于 refs**） |
| `broken` | `refs.broken` | 断链列表 |
| `dom` | `dom.snapshot` | 面板几何 / 折叠 / 裁剪 overflowClipped |
| `editor` | `editor.probe` | 编辑器内部探针 |
| `perf` | `perf.monitor` | 渲染节奏 / CPU |
| `git` | `git.status` | git 状态 |
| `logs` | `logs.tail` | 业务日志（`--n`） |
| `console` | `console.tail` | 前端 console 环（`--n`） |
| `events` | `events.since` | 事件时间线（`--since <seq>`） |
| `watch` | 事件订阅 | 实时事件流，Ctrl-C 退出 |
| `shot` | `screenshot` | 截图落盘 PNG |
| `mockfs` | `mockfs.state` | mock FS 状态 |
| `run <action> [k=v]` | `action.run` | save/open/viewMode/activate/closeTab |
| `exec '<js>'` | `exec` | 逃生舱（只读优先；桌面版 lan 模式默认禁用） |
| `raw '<json>'` | 任意 | 透传 RPC 帧 `{"cmd":...,"args":{...}}` |

通用 options：`--client` `--instance` `--host` `--port` `--token` `--ws` `--tcp` `--json` `--path` `--n` `--since` `--out`

## 标准勘查流程

1. **确认目标**：`instances` / `clients` 列表 → 用 `--instance` / `--client` 指认 → `status`
   - 看 fsBackend（tauri/mock/dev）与 tabs 数；失败 = 通道没开/没连上，提示用户开开关。
2. **引用同步问题**（"A 里嵌 B 两处，改一处另一处不动"）：
   - `docstore`（M4 优先；找 `stale=TRUE` 的订阅者 = 失步方）`/ refs`
   - `events --since <seq>` → 找最近 `refs.broadcast` 事件（applied / skipped 及原因）
   - `md` 取宿主内容对质
3. **渲染 / 布局异常**：
   - `dom` 看几何与裁剪 → `shot` 落盘 PNG → **用 Read 工具读图**确认视觉
   - `perf` 看渲染节奏（VM 软渲染高 CPU 相关）
4. **报错 / 异常**：`console --n 100` → `logs --n 100` → `events`
5. **需要操作现场**（**先与用户确认**）：`run save|open|viewMode|closeTab ...`

## docstore / refs 输出解读

```
notes/b.md  rev=7 diskRev=7 ●dirty  fab=ok
  blocks=3  subscribers=2
  块 blk_1a  tab=tab2  rev=7/7  ok
  块 blk_2f  tab=tab2  rev=5/7  stale=TRUE ←    ← 失步订阅者
```

- `rev` = 内存内容版本；`diskRev` = 落盘版本；`●dirty` = 有未保存编辑；`fab=MISMATCH` = 一致性校验失败
- 订阅者三态：`ok` / `stale=TRUE`（落后于真相，未传播或被跳过）/ `truth=-1`（源文件未惰性加载，通常无害）
- 常见组合：
  - 单个嵌入块 stale → 该块有本地未传播编辑（冲突保留），或广播被折叠/只读跳过
  - 源 doc 标签 stale → 源标签有未保存编辑（最后保存者胜，跳过覆盖）
  - 全部 stale 且真相已更新 → 广播未被应用（版本或定位问题）
- 保存冲突与「同源多处嵌入内容不一致」由 writeback 提示，配合 `logs` 找 warn

## 截图

```bash
node .workbuddy/skills/writeit-debug/scripts/writeit.mjs --client c3 shot
```

默认落盘到 `.workbuddy/tmp/shots/shot-<ts>.png`，末尾打印 `SHOT_FILE=<绝对路径>`；
**再用 Read 工具读该 PNG**（Read 支持图片）。自定义路径用 `--out <file>`。

## 原则

- **勘查优先于提问**：先给证据（数据 + 截图）再让用户操作，不要求用户复现。
- 不写文件、不修改用户内容；`run`（语义操作）与 `exec` 前**先与用户确认**。
- 拿不准的字段，用 `exec` 只读探测。
- 底层协议只在 `editor-app/scripts/writeit-cli.mjs` / `_rpc-client.mjs` 实现一份；本 skill 是薄壳，不要另起一份协议实现。
