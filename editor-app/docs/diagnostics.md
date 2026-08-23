# 诊断包（Diagnostics）— 设计文档

> 状态：**设计定稿（2026-08-19 与用户拍板）** ｜ 里程碑：D1–D3
> 背景：应用进入试用期，用户在**渲染 / 动画行为不符合预期**时往往无法具体描述问题。目标是把「问题取证」做成产品功能：用户只点一个按钮，应用自动收集环境、状态、日志、现场证据，打包成 zip 发给开发者即可复现定位。
> 关联：`design.md` §11（调试钩子）、`export/service.ts`（落盘通道）、`fs/` 三实现、`MenuIcon.vue`（图标）

---

## 1. 背景与目标

试用用户遇到的「渲染/动画不符合预期」通常**不抛异常**——只是界面表现不对（元素没出现、错位、动画没播完、mermaid 没渲染出来）。这类问题靠文字描述几乎无法复现。本功能的核心思路：

> **用户只需要知道「点一下按钮」，证据由应用自己收集。** 诊断 = 现场取证，不是让用户填表。

### 范围界定

| 版本 | 内容 |
|---|---|
| **D1** | LogBus（环形日志 + console 代理 + 全局 error/unhandledrejection 捕获）+ 自动异常提示 toast |
| **D2** | 采集器（环境/设置/应用状态）+ 诊断探针（渲染健康/几何/动画/DOM）+ jszip 打包落盘 + 诊断对话框 + 双入口按钮 + 关键管线埋点 |
| **D2.5** | **分层探针体系 + AI 阅读增强**：monitor（FPS/长任务/渲染计数）、diff 标注实测（红/绿计算色）、color-mix 兼容探测、editor 文档健康（引用/断链/标签）；输出 00-summary.md（AI 摘要）+ 08-probes.json（紧凑分层探针）+ manifest.index |
| **D3** | Tauri `diagnostics_info` 命令 + Rust panic hook（闪退取证）+ `scripts/parse-diagnostics.mjs` 解析器 + diagnostics-e2e 回归 |

### 产品定位（用户视角）

- 图标列「🩺」与状态栏「诊断」两处入口（用户拍板：**两处都要**）
- 对话框：一句话引导 + **可选**描述（预置填空模板）+ 一个大按钮「生成诊断包」
- 生成 zip 保存到本地（Tauri 保存对话框 / 浏览器下载），用户经微信/邮件发给开发者
- 全局异常自动 toast 提示「已记录，可生成诊断包」（需防抖防刷屏）

## 2. 决策记录（已拍板）

| # | 决策 | 说明 |
|---|---|---|
| D1 | **路径信息、文档内容、截图等默认勾选包含**，用户手动取消 | 复现优先；弹窗内逐项展示可取消，隐私由用户掌控 |
| D2 | 入口两处：图标列按钮 + 状态栏按钮 | 可见性优先 |
| D3 | 操作轨迹（时间轴）默认开启 | 复现时序类问题（打开→切标签→渲染错位）价值最高 |
| D4 | Rust panic hook 本轮做 | Windows 用户「闪退」反馈最难查，panic 落盘是唯一证据 |
| D5 | 全局异常自动弹窗提示（防抖） | 让「说不清」的用户也被引导留证据 |
| D6 | 不采集按键日志、不录音、不上传任何内容 | 全部本地落盘，用户亲手发送；未来上传后端需单独决策 |

### 隐私模型

- **默认包含**：完整路径、活动文档内容、截图、DOM 快照、操作轨迹（与 D1 一致）
- 所有「包含项」在生成弹窗内**逐项勾选可见**，取消即排除
- 设置页「诊断」组：总开关、自动异常提示、操作轨迹记录（用户可关）
- 诊断包不包含：localStorage 业务数据、按键序列、剪贴板、其它用户文档

## 3. 用户交互

### 3.1 入口

```
icon-col（46px）：📁 文件 · 🔀 Git · 🔍 搜索 · ⚙️ 设置 · ⌨️ 快捷键 · 📤 导出 · 🩺 诊断 ← 新增
statusbar：… ⓘ 分支 · 源码模式 · 自动保存 … | 🩺 诊断（有未查看异常时带红点）
```

### 3.2 诊断对话框（ReportModal）

```
┌─ 问题诊断 ─────────────────────────────────────┐
│ 遇到渲染/动画异常？生成一个诊断包发给开发者即可。  │
│ （无需你描述细节，应用会自动收集现场证据）         │
│                                                │
│ 问题描述（可选）                                 │
│ [ 我在 ____________ 时遇到 ____________，        │
│   预期 ____________，实际 ____________ ]         │
│                                                │
│ 将包含（可取消勾选，取消即不打包）：               │
│ ☑ 截图（当前界面）  ☑ 界面结构快照（DOM）         │
│ ☑ 当前文档内容      ☑ 完整文件路径               │
│ ☑ 操作轨迹（最近操作时间轴）   ◆ 环境/设置/日志   │
│                                                │
│ [ 复制要点 ]            [ ⚡ 生成诊断包 ]          │
└────────────────────────────────────────────────┘
```

- 「复制要点」：环境摘要 + 最近异常 + 当前文件 → 剪贴板一段文字（微信先文字沟通用）
- 生成中：状态行 + 进度（截图 → 打包 → 保存）
- 完成后：成功 toast + 保存路径；失败显示原因（可重试）
- ◆ 环境/设置/日志 恒包含（无害），不提供取消

### 3.3 自动异常提示

- `window error / unhandledrejection` → 写入日志环（error 级）→ 若开关开且距上次提示 > 8s → toast「应用遇到异常，已记录到诊断日志（🩺）」+ 状态栏异常红点亮起
- 用户点击 🩺 后红点熄灭（视为已查看）

## 4. 诊断包内容（schemaVersion 1）

```
writeit-diagnostics-YYYYMMDD-HHMMSS.zip
├── manifest.json      schemaVersion / 生成时间 / app 版本 / 宿主 / 文件清单 / 勾选项
├── 01-environment.json app 版本·构建时间·宿主(tauri|web|mock|dev)·OS·arch·WebView UA·
│                       屏幕·DPR·字体系列·prefers-reduced-motion·语言·时区·内存(JS heap)
├── 02-settings.json   主题/图标集/自动保存/快捷键/侧栏宽度/批注用户名/诊断设置等
├── 03-app-state.json  标签数/每标签(路径·视图模式·脏)·活动文件·git 分支·模板 doctype 列表
├── 04-events.log      环形日志：时间戳|级别|来源|消息（console + 全局异常 + 业务埋点）
├── 05-timeline.jsonl  操作轨迹（结构化：时间/动作/目标/耗时，最近 1000 条）
├── 06-snapshot.svg     界面 SVG 快照（foreignObject 内嵌 DOM，浏览器可直接打开；勾选项）
├── 07-document.md     活动文档 markdown（勾选项，默认勾选）
├── 08-dom-snapshot.json 诊断探针采样（勾选项，默认勾选）
└── 09-notes.md        用户描述 + 预置上下文（当前文件/视图/最近异常时间）
```

## 5. 诊断探针（核心——专治「渲染/动画说不清」）

`probes.ts` 生成时**同步采样**（秒级、零侵入）：

| 探针 | 采集 | 对症 |
|---|---|---|
| 渲染健康 | 活动编辑器 doc 节点数/nodeSize、最近 markdownUpdated→渲染完成耗时（埋点）、parse/渲染失败计数（日志） | 渲染卡顿/缺失 |
| 几何采样 | `.editor-pane` rect、scrollTop/Height、mermaid 预览 SVG 存在性+尺寸+rect、抽屉/大纲/菜单/浮窗 rect 与 data-show | 布局错位、「该出现没出现」 |
| 动画状态 | `document.getAnimations()` 前 30 个：name/playState/duration/currentTime + 系统 reduced-motion + `prefers-reduced-motion` | 动画没播完/抖动/不生效 |
| 运行痕迹 | `window.__editorDebug()` 活动实例、`__mockFsDebug()` mock 摘要（可用时） | 数据层参照 |

### 关键管线埋点（logBus.event）

- `mermaid:render` 成功/失败/耗时/源码片段（截断）
- `tab:open` 打开耗时/路径；`tab:close`；`tab:activate`
- `save` 成败/耗时；`export` 成败/耗时
- `validate:run` 违规计数
- `app:boot` 启动完成时间（关键：首屏渲染慢）

埋点见 §8 修改清单，全部为「加一行」式低侵入调用。

## 6. 落盘与开发者侧

- **打包**：`jszip`（已在依赖）`generateAsync({type:'blob'})`
- **结构（D2.5 演进）**：新增 `00-summary.md`（AI 摘要）+ `08-probes.json`（分层探针，紧凑 JSON 省 token），manifest 增 `index`（文件名+大小+用途，AI 阅读索引）。schemaVersion=2。
- **截图方案（2026-08-22 实现修正）**：~~html2canvas~~ → **SVG foreignObject 快照**。
  实测 html2canvas 1.4.1 不支持 `color-mix()`（应用样式大量使用，直接抛错）；
  且 Chrome 对含 foreignObject 的 SVG drawImage 后 canvas 必被 taint（SecurityError），
  data-URI 位图化超大 DOM 还会卡死 → 直接输出 `06-snapshot.svg`（foreignObject 内嵌 DOM、
  由真实渲染引擎绘制、可文本搜索、浏览器直接打开）——100% 可靠且对「渲染不对」类问题价值最高。
- **落盘**：tauri → 复用 `save_binary`（绝对路径）；web/mock → `downloadBlob`（export/service.ts 同款）
- **复制要点**：`navigator.clipboard.writeText`（Tauri WebView 支持；失败降级提示）
- **解析器** `scripts/parse-diagnostics.mjs`：接受 zip 或已解压目录 → 内置极简 ZIP 解析（deflate/store，Node 内置 zlib）→ 打印人类可读摘要：环境、异常列表、操作时间轴、崩溃日志、还原提示

## 7. 设置项（state/settings.ts 新增「诊断」组）

```ts
diagEnabled: true        // 诊断功能总开关（关闭后入口隐藏/禁用）
diagAutoPrompt: true     // 全局异常自动 toast 提示
diagTrackTimeline: true  // 操作轨迹记录
// —— 生成弹窗的「上次选择」记忆 ——
diagIncludeSnapshot: true  // 截图
diagIncludeDom: true       // DOM 快照
diagIncludeDoc: true       // 文档内容
diagIncludePaths: true     // 完整路径（false → basename 脱敏）
```

## 8. 文件结构与修改清单

```
src/diagnostics/
├── logger.ts        # LogBus 环形缓冲（日志 2000 条 / 轨迹 1000 条）+ console 代理 + 全局异常 + 自动提示（幂等安装）
├── probes.ts        # 渲染/动画/几何/DOM 探针（同步采样）
├── collector.ts     # 五层采集（environment/settings/app-state/dom/日志轨迹导出文本）
├── pack.ts          # jszip 打包 + 落盘（tauri save_binary / web downloadBlob）+ 复制要点
├── ReportModal.vue  # 诊断对话框
└── index.ts         # openReportModal() / bootDiagnostics() / __diagnostics 调试钩子
```

**修改点**：

| 文件 | 改动 |
|---|---|
| `main.ts` | 顶部 `bootDiagnostics()`（最早安装 logger） |
| `state/settings.ts` | 诊断设置组（§7） |
| `state/store.ts` | `diagOpen: boolean` |
| `components/MenuIcon.vue` | `'diagnostics'` 图标（三套风格，听诊器/急救包语义） |
| `App.vue` | 图标列按钮 + 状态栏入口（异常红点）+ ReportModal 挂载 |
| `editor/manager.ts` | 埋点：tab open/close/activate、save、toggleSource、gitDiff |
| `editor/mermaid.ts` | 埋点：renderPreview 成功/失败/耗时 |
| `export/service.ts` | 埋点：导出成功/失败 |
| `vite.config.ts` | `define` 注入 `__APP_VERSION__` / `__BUILD_TIME__` |
| `src-tauri/src/lib.rs` | `diagnostics_info` 命令 + `install_panic_hook()`（panic → `writeit-panic.log`） |
| `scripts/parse-diagnostics.mjs` | 诊断包解析器（新） |
| `tests/e2e/diagnostics-e2e.js` | e2e + run-all.js 注册 |

## 9. Rust 侧（D3）

```rust
#[tauri::command]
fn diagnostics_info() -> serde_json::Value {
    // { os, arch, family, appVersion: env!("CARGO_PKG_VERSION"),
    //   locale: env LANG/.SystemDefaultLangID 等（尽力而为）, exeDir }
}

pub fn install_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // 追加写 app_dir/writeit-panic.log（时间 + panic 信息 + 栈回溯）
        prev(info); // 保持原有行为
    }));
}
```

## 10. e2e（diagnostics-e2e）

- 打开诊断弹窗 → 勾选项默认全开 → 「复制要点」含环境摘要 → 生成 → 捕获 blob → 解包断言：
  - zip 内 9 个文件齐全、manifest schemaVersion=1
  - 02-settings.json 含主题；03-app-state.json 含标签；04-events.log 含 boot/mermaid 事件
  - 取消「文档内容」勾选 → 07-document.md 不存在
  - 全局异常（`window.dispatchEvent(new ErrorEvent('error'))`）→ toast 出现 + 日志含捕获
- 全量 21+ 套件回归 + `npm run build`

## 12. D2.5 分层探针与 AI 阅读（2026-08-22 实现记录）

### 12.1 改造动因

1. 用户反馈：diff 视图 mermaid 渲染「少 1 个红色节点」——旧探针只能几何/动画，**无法回答「红节点渲染了几个、样式是否真的生效」**；
2. 系统性审视：App 分多层面（环境/编辑器/引用/渲染/UI/性能/兼容性），应分层取证；
3. AI agent 阅读诊断包：原来单 JSON 无索引、定位难、token 浪费。

### 12.2 分层探针（08-probes.json，schema=2，紧凑 JSON 省 token）

| 层 | 探针 | 回答什么 |
|---|---|---|
| `ui` | 几何/面板/动画/mermaid 预览（旧 DOM 快照演进，新增 `overflowClipped`、预览 `errorText`） | 布局错位、元素没出现、内容被裁剪 |
| `diff` | **节点级标注实测**：扫描 `g.diff-node-add/del/mod` → 每节点 label/计算后 fill/stroke/color/删除线/rect 存在性 → `trulyRedDels`/`trulyGreenAdds`/`styleFailed` | **「红/绿节点到底渲染了几个、颜色是否生效」（实测 computed 样式）** |
| `editor` | 活动 doc 引用统计（file_ref/object_ref/file_block/annotation/table，经 `editor.action` 同步扫 doc）+ 断链数（`getBrokenPaths`）+ 多标签健康 | 引用断链、文档结构健康 |
| `compat` | **WebView CSS 兼容探测**：`color-mix()` 支持性（动态元素实测）+ 应用内 color-mix 用例数 | color-mix 不支持的 WebView → 填充色失效（少红/少绿根因） |
| `monitor` | 随启动后台采样：FPS（rAF，<24 样本视为噪音 `insufficient`）、长任务、markdownUpdated 渲染计数 | 动画卡顿、长任务、编辑渲染频率 |

### 12.3 AI 阅读协议（面向 agent：省 token + 索引）

- **`00-summary.md`（~1.5KB）**：第一眼——版本/宿主/当前文件；异常 top；**关键结论**（探针推论：红节点实测数、color-mix、断链、帧率、长任务、mermaid 渲染统计）；分层指标表（层|指标|状态|细节来源）；最近操作；**文件索引（阅读顺序①…⑪ + 用途）**。AI 读 manifest + summary 即可定位。
- **compact JSON**：状态/探针类 JSON 无缩进（省 25–40% token）；日志/时间线行截断。
- **manifest.index**：`[{f: 文件名, b: 字节, d: 用途}]`。

### 12.4 关键坑与决策

1. **milkdown Editor 取 doc**：`crepe.editor.state` 不存在——doc 在 ProseMirror view，必须 `editor.action(ctx => ctx.get(editorViewCtx).state.doc)`（同步）★ 初版 `editor.state.doc` 为空；
2. **循环依赖**：probes 不 import editor 层（manager/app-plugin）——index.ts 注册 window 桥（`__diagGetBroken`/`__diagGetTabs`/`__diagGetInstanceCount`）；manager 渲染计数直接依赖 `monitor`（单向无环）；
3. **fps 噪音**：短时运行采样 <24 个时 `avgFps=null`（`insufficient`），避免误报；
4. 探针全部同步、不修改 DOM。

### 12.5 回归

- diagnostics-e2e 31/31（新断言：11 文件 / schema=2 / index / 分层探针字段 / 摘要内容）+ `npm run build`；
- 实测失败场景：`trulyRedDels < del.length` 且 `styleFailed>0` → 摘要自动提示「先查 compat.colorMix」。（本仓库现有 red/green 场景验收见 `验收场景/git-diff/*`，需要在颜色失效浏览器复现时由 compat 层给出证据）

## 13. 未来工作（v2）

- 上传后端（需单独决策：加密传输、服务端解析、工单号）
- 会话级录制（rrweb 类）重型复现——v1 用操作轨迹近似
- 诊断包自动随崩溃保留（异常后不弹窗，直接保存一份到 app data）