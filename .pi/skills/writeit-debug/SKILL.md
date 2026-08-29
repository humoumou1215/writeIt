---
name: writeit-debug
description: WriteIt 运行时问题现场勘查手册。用户报告编辑器引用不同步 / 渲染或布局异常 / 保存或报错等运行问题时加载。核心原则：就地勘查（writeit 工具），不要求用户复现。
---

# WriteIt 现场勘查手册

配套工具：`writeit`（本项目 .pi/extensions 注册的 Pi 工具）。运行环境：
- **桌面版（Tauri）**：用户在设置页「🔌 调试通道」开启后，工具自动读发现文件/实例注册表连接；SSH 场景用 `host` 参数指向 VM 本机。
- **dev 模式**：vite dev server（5173）运行且页面已打开时自动连中继；`host` 不填即可。

## 多实例 / 多客户端怎么选目标（v1.1）

面对「多个 WriteIt 进程 + 多个打开的网页页面」时，绝不瞎猜目标，先列再指：

1. **多 Tauri 进程**：先 `writeit instances`（本机存活实例表，含 instanceId/pid/mode/port/root），用户设置页也有「实例标识」；用户说"看 instance w123-…"时，用 `instance` 参数：`{command:"status", instance:"w123-…"}`。
2. **多网页客户端**：先 `writeit clients`（表带 📺 设备名/url/backend）；用 `client` 参数指认：`{command:"refs", client:"c3"}`。
   - ⚠️ vite 中继**无「默认焦点」**：`status`/`tabs`/`refs`/`dom`/`md` 等连接型命令**每次必须显式带 `client`**；工具只是**单帧内**先 `use` 再发命令（无持久状态），不带会报 `no attached client (is a page open?)`。`clients`/`instances` 是直通命令，不需要。
   - ⚠️ 页面刷新后 client id 会变（如 c122→c124）：报 `bad client: xxx` 时重新 `writeit clients` 拿新 id。
3. **跨机器 vite / VM**：`host` + `port`，必要时 `transport`：`{command:"tabs", host:"192.168.x.x", port:5173, transport:"ws"}`。也可用环境变量 `WRITEIT_DEBUG_HOST`/`PORT`。
4. 用户未给任何标识、且列表多于一个时：把 `instances` / `clients` 结果摆给用户，问清楚目标是哪个，再指认——不要默认连"最新"。

## 何时用

用户说"现在界面上…没同步 / 渲染不对 / 报错了"，且无法或不想复现。
先勘查现场再提问，按下面的流程走。

## 标准流程

1. **确认实例**：`writeit status`
   - 看 fsBackend（tauri/mock/dev）与 tabs 数。失败=通道没开/没连上，检查提示语让用户开开关。
   - 多实例/多页面并存时，先按上面「选目标」节确认 instance / client 再 status。
2. **引用同步问题**（用户说"A 里嵌 B 两处，改一处另一处不动"）：
   - `writeit refs.registry` → 找 `stale=true` 的视图（失步方）
   - `writeit events.since {seq}` → 找最近 `refs.broadcast` 事件（applied / skipped 及原因）
   - `writeit doc.markdown`（宿主）/ 按需 `path` 对质内容
   - 命令行等价：`cli refs`、`cli events`、`cli md`
3. **渲染 / 布局异常**：
   - `writeit dom.snapshot` → 面板几何 / 折叠 / 裁剪（overflowClipped）
   - `writeit screenshot` → PNG 落盘 → read 工具读图看现场
   - `writeit perf.monitor` → 渲染节奏（VM 软渲染高 CPU 相关可看 perf + lite 模式）
4. **报错 / 异常**：
   - `writeit console.tail {n}` → 前端 console 环
   - `writeit logs.tail {n}` → 业务日志（diag）
   - `writeit events.since` → toast / log.error 时间线
5. **需要操作现场**（与用户确认后）：
   - `writeit action.run {action:"save|open|viewMode|closeTab", ...}`
   - 逃生舱 `writeit exec {js:"..."}`：查询任意状态；桌面版 lan 模式默认禁用（设置可关）。

## refs.registry 输出解读

```
realPath     ver  truthLen  views
notes/b.md    7     1203     tab2#blk_1a  stale=false
                             tab2#blk_2f  stale=true   ← 失步视图
                             doc:tab5     stale=true
```

- `ver` = 内容版本（每次编辑提交 +1）；`truthLen` = 内存真相长度（-1 = 尚未物化）
- 视图三态：
  - stale=false → 与真相一致，正常
  - stale=true → 视图落后于真相（该视图有未传播编辑 / 广播被跳过）
  - truth=-1 → 源文件还没被惰性加载（通常没问题）
- 常见组合与含义：
  - 某嵌入块 stale、其余正常 → 该块有本地未传播编辑（冲突保留），或广播时被折叠/只读跳过
  - 源 doc 标签 stale → 源标签有用户未保存编辑（最后保存者胜，跳过覆盖）
  - 全部 stale 且真相已更新 → 广播未被应用（版本或定位问题）
- 保存类冲突与「同源多处嵌入内容不一致」由 writeback 提示，配合 `logs.tail` 找 warn。

## 原则

- 勘查优先于提问；先给证据（数据 + 截图）再让用户操作。
- 不写文件、不修改用户内容；`action.run` 操作前先与用户确认。
- 拿不准的字段，用 `writeit exec` 探测（只读优先）。