# Git 工作台（M11）— 设计文档

> 状态：**设计定稿（v3，2026-08-15 与用户拍板）** ｜ 里程碑：M11a–M11d、M12、M13、M14
> 前置知识：`design.md` §6.7（保存/写回）、§11（viewMode/sourceMode 架构）、`features.ts`（Crepe featureConfigs）、`fs/` 三实现、批注抽屉模式
> 关联：`raw/milkdown-srouce/`（Crepe `setReadonly` 已验证：`view.setProps({ editable })`，渲染照常仅禁编辑）

---

## 1. 背景与目标

WriteIt 是本地目录式 Markdown 笔记应用（Tauri + Vue + Crepe）。用户核心诉求：

1. **看 git 历史**——谁在什么时候改了什么；
2. **看某个文件的 diff 改动**——尤其含 **mermaid 图**、**块嵌入引用（`![[` / file_block）** 的文件，纯文本 diff 无法看出"图变了什么"；
3. 在文件树位置有一个**更重的仓库级入口**（分支/工作区/历史），而非轻量单文件视图。

定位：**仓库级 Git 工作台**（侧边栏面板 + 编辑区 diff 视图，文本/渲染双模式）。不做完整 git 客户端：暂存区概念不引入；提交/push/pull 不在范围内。

### 范围界定

| 版本 | 内容 |
|---|---|
| **v1（M11a–M11c）** | Git 面板（分支查看/工作区/历史/**范围对比 a..b**）；编辑区 diff 视图；文本模式（分栏/统一/词级）；**渲染模式（单栏融合，默认）** |
| **v1.5（M11d）** | 还原（整文件/单 hunk）；分支切换（checkout）；标签右键菜单；状态栏分支徽标 |
| **M12/M13** | 浏览器演示模式（mock git 后端）；渲染模式重构（单 Crepe + 组合 md） |
| **M14** | 全内联标记；mermaid 节点级 DOM 标注；批注复用存量抽屉；mock 真实化 |
| **v2** | 历史提交细节页；文件级历史时间线；渲染↔文本映射增强 |

## 2. 决策记录（已拍板）

| # | 决策 | 说明 |
|---|---|---|
| D1 | 工作区 vs HEAD（`git diff HEAD`），不引入暂存区 | 笔记应用无 staging 心智 |
| D2 | diff 是第三种视图模式，重构 `sourceMode` 为 `viewMode` | 复用容器隐藏/实例保留架构 |
| D3 | 进入 diff 视图前**自动保存**当前文件 | git diff 反映磁盘状态，避免困惑；工具栏明示「基于已保存内容」 |
| D4 | **进 diff 视图默认渲染模式**（用户拍板） | 对 md 文件；文本模式可切换 |
| D5 | 渲染模式 = **单栏融合视图**（用户拍板） | 块级 diff + 双 doc 渲染提取合并，颜色块表达改动 |
| D6 | 历史范围对比 `a..b` 进 v1（用户拍板） | Shift+点击 选两提交 |
| D7 | 分支切换、还原操作归 v1.5（用户拍板） | 危险操作，需处理未提交改动 |
| D8 | 数据层走 git CLI（延续 `git_user_name`），不引入 git2 | 避免 Windows 交叉编译负担 |
| D9 | Git 仅 tauri 后端可用；mock/web 隐藏/禁用 | 与 `git_user_name` 现状一致 |

## 3. 入口与布局

### 3.1 侧边栏

```
icon-col（46px）：📁 文件目录 · 🔀 Git · ⚙️ 设置 · ⌨️ 快捷键
content-col：顶部小 tab「📁 文件 | 🔀 Git」切换（记忆上次选择）
```

- 非 git 仓库 / mock / web 后端：Git 图标灰置，点击 toast 说明（「当前目录不是 Git 仓库，可在终端 git init」）
- 其他入口：文件树右键文件「Git 改动」（直接打开该文件 diff）；快捷键 `Ctrl+Shift+D`（当前活动文件）

### 3.2 Git 面板（三区块纵向排布）

```
┌─ Git 面板 ────────────────────────┐
│ ⟳ 刷新   ⓘ main ● 3 未提交        │  ← 仓库状态条
├─ 分支 ────────────────────────────┤
│ ● main（当前）                     │
│   feature/xxx                      │  ← 点击 = 查看该分支（v1：仅展示）
│   ⚑ origin/main                   │  ← 切换 = v1.5（危险确认）
├─ 工作区 ──────────────────────────┤
│ M  src/notes/a.md    +12 −3        │  ← 状态色块 M/U/A/D，点击 → 编辑区 diff
│ A  src/notes/b.md    +45 −0        │     （工作区 vs HEAD）
│ D  src/old.md        −8            │
├─ 历史 ────────────────────────────┤
│ 🔒 a1b2c3d  3天前  优化图表         │  ← 提交列表（hash/相对时间/信息）
│ 🔒 e4f5g6h  5天前  新增嵌入引用      │
│ …                                  │
└────────────────────────────────────┘
```

### 3.3 历史交互流（核心场景）

1. **单提交**：点击提交 → 展开变更文件列表（M/A/D + 行数统计）→ 点文件 → 编辑区 diff（**commit vs 父提交**），工具栏显示对比基准
2. **范围对比（v1）**：`Shift+点击` 第一个提交 → 再点第二个 → 面板顶部出现范围条 `a1b2c3d..e4f5g6h`（✕ 清除）→ 点文件 diff = `a..b`
3. 工作区文件点击 → diff（工作区 vs HEAD）

## 4. 编辑区 diff 视图

### 4.1 视图模型

`Tab.viewMode: 'wysiwyg' | 'source' | 'diff'`（重构现有 `sourceMode: boolean`；openTab 初始化、切标签保持、saveTab/校验前 ensureDocSynced 逻辑沿用）。进入 diff 前自动保存。

### 4.2 工具栏

```
📄 src/notes/a.md   [工作区 vs HEAD｜a1b2c3d↔父提交｜a..b]  ● main
   +12 −3  ·  3 处改动
┌──────────────────────────────────────────────┬──────────────┐
│ ◀ 上一处 (Shift+F7)  ▶ 下一处 (F7)  ·  1/3    │ 模式▾ 视图▾   │
│                                              │ 还原…(v1.5) ✕ │
└──────────────────────────────────────────────┴──────────────┘
```

- **模式 ▾**：`渲染`（默认）/ `文本`（对 md；txt 无渲染模式直接文本）
- **视图 ▾**：`分栏`（默认）/ `统一`（仅文本模式）
- **✕ / Esc**：退出回原视图（保留光标位置）

### 4.3 文本模式

- 分栏：左右行号对齐；删除红 / 新增绿（主题色板）；行级 + **词级高亮**（word-diff porcelain 解析）
- hunk 折叠：「⋯ N 行相同」点击展开；当前 hunk 顶部描边（primary 色）
- 统一模式：`-`/`+` 前缀单列

### 4.4 渲染模式（单栏融合视图，核心差异化）

**目标**：渲染后的 markdown 单栏视图，改动处用颜色块表达——mermaid 图、块嵌入卡片的变化一眼可见。

```
┌─ 单栏融合视图 ────────────────────────────────┐
│ # 需求清单                                    │
│ ┌─────────┐  ← 新增块：绿底 + 左侧绿条          │
│ │ 新段落…   │                                  │
│ └─────────┘                                  │
│ ┌─────────┐  ← mermaid 图变化：旧图红框+「已删  │
│ │ (旧图)   │    除」角标 / 新图绿框+「已新增」   │
│ └─────────┘                                  │
│ 引用 [[a#标题]]   ← 未变：正常显示              │
│ ┌─────────┐  ← 修改块：旧块红底划线 + 新块绿底   │
│ │ 旧内容    │    上下拼接，细分隔线              │
│ │ 新内容    │                                  │
│ └─────────┘                                  │
└──────────────────────────────────────────────┘
```

**技术方案**：

```
① 解析        旧 md / 新 md → mdast（remark，带 position.start.line）
② 块级 diff    对两版块序列做 LCS 对齐 → 每位置 old-only / new-only / both / modified
③ 渲染        两个隐藏 readonly Crepe 各渲染完整 doc（复用 features.ts：mermaid/嵌入/批注只读全开）
④ 提取合并     按对齐结果从两 doc DOM 按序提取块节点 clone 进单栏容器
⑤ 着色        未变=正常 · 新增=绿底 · 删除=红底划线 · 修改=旧红+新绿拼接
⑥ 词级（增强）  modified 块内再做行/词 diff → <del>/<ins> 划线高亮（M11c 后半段）
```

**为什么可行**：
- mdast 节点自带 `position`（remark 默认保留），块序列稳定，LCS 对齐比行级语义化——改 mermaid 图 = 「一个代码块整体变化」而非散乱行增减
- Crepe 渲染块节点（`h1/p/ul/table/pre`、mermaid 图、`.file-block-view`）与 mdast 块序列**顺序一一对应**，按序遍历提取，无需行号反查
- mermaid / 嵌入引用两侧都是完整 Crepe 渲染 → 图、卡片照常渲染只做整体提取；**图/卡片无文本可划线，用红/绿边框 + 底色 + 角标表达改动**

**颜色方案**（CSS 变量 `--diff-add-bg` 等随主题注入，深浅色适配）：

| 块状态 | 底色 | 附加 |
|---|---|---|
| 未变 | 正常 | — |
| 新增 | 绿 10% 底 | 左侧绿条 |
| 删除 | 红 10% 底 | 左侧红条 + 文本划线 |
| 修改 | 旧=红底划线，新=绿底 | 上下拼接 + 细分隔线 |
| mermaid/嵌入 变化 | 红/绿边框 + 角标 | 不划线 |

**风险与降级**：

| 风险 | 对策 |
|---|---|
| 隐藏容器 → IntersectionObserver 懒加载不触发（CodeMirror/mermaid 不初始化） | 渲染 doc 挂离屏可见容器（`position:fixed; left:-9999px`，尺寸存在）确保 IO 触发；实现时验证 |
| mermaid/代码块异步渲染完成前提取 | 等渲染完成（事件/轮询）再组装；未完成块显示 placeholder（现有兜底） |
| 连续多修改块 LCS 错位 | 权重调优 + 行号辅助纠偏；v1 接受近似 |
| 双 Crepe 渲染性能 | 渲染模式按需创建（进入才建，退出销毁）；大文档（>500 行）提示性能警告 |
| readonly Crepe 挂载失败 | 自动降级文本模式 + 顶栏提示 |
| 旧版本嵌入引用目标不存在 | 弱化显示「⚠️ 目标不存在（旧版本）」（当前树为准的近似） |

**新旧版本对应**：工作区 vs HEAD（旧=HEAD，新=磁盘）；commit diff（旧=父版本，新=提交版本）；a..b（旧=a，新=b）。

## 5. 数据层（Rust，git CLI，`--no-color` + `-z` + UTF-8；中文路径 `core.quotepath=false`）

| 命令 | 返回 | 用途 |
|---|---|---|
| `git_repo_info()` | `{ isRepo, branch, headHash }` | 面板状态条 / 非 git 判定 |
| `git_branches()` | `[{ name, isCurrent, remote, aheadBehind }]` | 分支区 |
| `git_status()` | `[{ path, status, added, deleted }]` | 工作区列表（porcelain -z） |
| `git_log(limit)` | `[{ hash, author, date, message }]` | 历史列表 |
| `git_show_commit(hash)` | `{ hash, author, date, message, files: [{path, status, added, deleted}] }` | 提交详情 / 变更文件 |
| `git_diff_file(path, base)` | `{ hunks, wordTokens }` | 文本 diff；`base='HEAD' \| '<sha>' \| '<shaA>..<shaB>'` |

性能：单文件 diff 同步；>5000 行截断 + 提示。面板数据缓存 + ⟳ 刷新（复用 treeVersion 失效思路）。

## 6. 快捷键（新增进 SHORTCUT_DEFS，可自定义/冲突检测）

| 功能 | 默认 |
|---|---|
| 打开当前文件 Git 改动 | `Ctrl+Shift+D` |
| 下一处 / 上一处改动 | `F7` / `Shift+F7` |
| 切换分栏/统一 | `Ctrl+Shift+U` |
| 切换 渲染/文本 | `Ctrl+Shift+R` |
| 退出 diff 视图 | `Esc` |

## 7. 边界与降级汇总

| 场景 | 处理 |
|---|---|
| 非 git 仓库 / mock / web | Git 图标灰置 + toast；diff 入口禁用 |
| 文件 dirty | 进入 diff 前自动保存（saveActiveTab） |
| 历史中文件已删除/重命名 | diff 显示「文件已删除」空态；rename 状态 v1.5 追踪 |
| 渲染模式性能/失败 | 降级文本模式 + 提示 |
| 旧版本嵌入引用目标不存在 | 弱化显示 ⚠️ |
| diff 视图中 Ctrl+S | 重新拉取 diff 快照；外部改动 → ⟳ 手动刷新 |

## 8. 里程碑拆解

```
M11a  ✅ Rust 命令（repo_info/branches/status/log/show_commit/diff_file 含 a..b + show_file）
      ✅ viewMode 重构（sourceMode → wysiwyg/source/diff 三态）+ Git 面板（三区块 + 范围对比 UI + 双面板 tab）
      ✅ diff 视图最简版（文本模式行级 + 工具栏 + F7/Esc + 自动保存进入 + 浏览器降级）
M11b  ✅ 文本模式：分栏/统一（Ctrl+Shift+U）、词级高亮（porcelain 合并）、hunk 折叠、导航计数
M11c  ✅ 渲染模式（默认）：mdast 块级 diff + 双 readonly Crepe 提取 + 单栏融合着色
      ✅ mermaid 渲染 + 嵌入卡片 + 修改对配对 + 降级双栏链
M11d  ✅ 还原（整文件 + 单 hunk，仅工作区 diff，危险确认 + 标签联动刷新）
      ✅ 分支切换（未提交改动警告 + 关闭旧分支标签 + 面板/树刷新）
      ✅ 标签右键菜单（Git 改动/关闭）+ 状态栏分支徽标
```

依赖顺序：M11a → M11b → M11c（渲染模式依赖文本 diff 的行号/词级结果做块级对齐校验）。

### M11b 实现记录（文本模式完善，2026-08-15）

- **Rust 词级**：`git_diff_file` 增加 `--word-diff=porcelain` 解析合并——`parse_word_groups`（token 流，`~` 行 = 行边界；跳过 diff 头部元行）+ `groups_to_rows`（del+add 同组展开 2 行）+ **按 (kind, text) 匹配合并**（词级「line3→line3 new」被识别为纯新增，行数不一致时用文本+类型匹配而非顺序索引，匹配不上行级降级）；`DiffLine.words`（Option<Vec<DiffWord>>）；单测 9/9（含**真实 git 集成测试**：临时仓库 init/commit/diff 验证合并）
- **DiffView.vue 重构**：分栏（默认，左旧右新 grid 4 列）/统一（Ctrl+Shift+U）双布局；词级渲染（words 序列 → word-add/del span）；hunk 折叠（连续 ctx > 10 折叠为「⋯ 相同 N 行」点击展开）；导航计数「n/N」；行号计算（ctx/del/add 分别）
- **测试**：git-m11a-e2e 扩展至 40（词级 word-del/add、mermaid 修改对词级、折叠条、统一切换、导航计数）

### M11c 实现记录（渲染模式：单栏融合，2026-08-15）

- **`editor/render-diff.ts`**（新）：轻量 mdast 块扫描（parseBlocks：heading/fence/table/list/quote/hr/paragraph，按行收集）+ LCS 块对齐（alignBlocks，同 type+text 为 same）+ 双 readonly Crepe 渲染提取（createRenderLayer 隐藏层 `opacity:0.01` 保 IO 触发 + `setReadonly(true)` + `registerRefStringify` + `resolveRefs` await 1.5s 容错）+ 单栏融合组装（buildMerged：**连续 del 段 + add 段按序配对成 rd-mod**，避免 LCS 连续修改错配）+ 降级双栏全文（renderSplitFallback）
- **`components/RenderDiff.vue`**（新）：渲染到**独立 scratch 容器**（不依赖组件生命周期，避免异步渲染期间组件卸载丢失结果）→ 完成后迁移到 host；host 常驻 + overlay 状态；render watch `flush:'post' + immediate`（重挂载即渲染）
- **DiffView.vue**：模式切换（渲染/文本，默认渲染 D4，Ctrl+Shift+R）+ 渲染模式分支
- **`loadRenderData`**（manager.ts）：懒加载两版本内容（worktree → fs.readFile 新 / git.showFile 旧；commit/range → git.showFile 双侧）；`buildRenderRefCfg` 导出（渲染层引用 chip 打开复用 openRefTarget）
- **Rust**：`git_show_file(path, rev)` 命令（rev: HEAD/sha/sha^）
- **关键坑**：① 渲染 Crepe 缺 `registerRefStringify` → Cannot handle unknown node fileRef；② ProseMirror 虚拟光标/gapcursor 是首个子元素需过滤；③ 物化/行尾产生的空段落块需过滤（保持与 parseBlocks 块序一致）；④ `![[` 嵌入**必须独立成段**才是 fileBlock（remark-ref 整段匹配，段内 `![[` 按 file_ref）；⑤ watch 无 immediate → 重挂载不渲染；⑥ e2e 用 `Ctrl+Shift+R` 触发浏览器刷新 → 改点工具栏按钮；⑦ playwright `isVisible` 对 Crepe 元素不可靠 → boundingBox
- **测试**：git-m11a-e2e 扩展至 **49**（默认渲染模式、rd-same/rd-mod/rd-del、mermaid svg 渲染、嵌入卡片、修改对配对、降级链）；全量 24 套件全绿

### M11d 实现记录（还原/分支切换/标签右键/状态栏徽标，2026-08-15）

- **Rust**：`git_discard_file`（checkout -- path）/ `git_discard_hunk`（重新 -U0 diff → `extract_hunk_patch` 提取单 hunk → `git apply --reverse --unidiff-zero` stdin 应用）/ `git_checkout_branch`；单测 11/11（含 extract 边界 + **discard_hunk 真实集成**：双 hunk 逐个反向应用验证）
- **manager.ts**：`discardFileDiff` / `discardHunkDiff`（ConfirmDialog danger 确认 → 还原 → `reloadTabFromDisk`（读磁盘 replaceAll + savedContent/dirty 重置 + 清 tab.diff）→ `setViewMode('wysiwyg')` 退出 diff → `refreshGitPanel()`）；`switchGitBranch`（未提交改动数量警告 → checkout → 关闭所有标签 → 刷新树/面板）；`reloadTabFromDisk` 源码模式先退出
- **store**：`gitPanel.version`（面板刷新钩子）+ `tabContextMenu`（标签右键）
- **UI**：DiffView 工具栏「还原…」+ hunk-meta「↩ 还原此段」（仅工作区 diff `canDiscard`）；GitPanel 分支行 hover「⇄」切换（`switchGitBranch`）+ version watch 自动刷新；TabBar 右键 → `TabContextMenu.vue`（Git 改动/关闭）；状态栏 `.git-badge`（ⓘ branch，GitPanel 加载后可用）
- **测试**：git-m11a-e2e 扩展至 **60**（状态栏徽标、还原确认/退出 diff/toast、hunk 还原按钮、标签右键 → diff、分支切换 → 徽标更新）；全量 24 套件全绿

### M12 实现记录（浏览器演示模式，2026-08-15）

### M14 实现记录（全内联标记 + mermaid DOM 标注 + 批注复用 + mock 真实化，2026-08-16）

**背景**：用户 4 点反馈——① 纯 del/add 段与整行重写也用 `{--删词--}{++增词++}` 表达；② mermaid 图看不出删除/新增节点；③ 右侧批注卡不该另起抽屉（DiffNotePanel），应复用存量批注体系（连线/定位）；④ mock 示例是手写的、与真实 git diff 不符，要用真实数据。

**① 组合规则全内联化（diff-compose.ts）**：
- `handleSeg` 重写：纯 del 段 → 每行 `{--行--}`；纯 add 段 → 每行 `{++行++}`；整行重写 → `{--旧行--}{++新行++}`；有共同部分修改对保留词级合并（splitCommon / mergeWordsFallback）
- 删除 ```` ```diff-del/diff-add ```` fenced code 路径（annotateDiffCodeBlocks 移除；RenderDiff 的 diff-code-* 样式移除）
- 表格行纯 add/del：**逐单元格标记**（`| {++消息通知++} | ... |`）——整行包 `{++..++}` 会被 GFM 表格解析器吃掉（remark 表续行）
- 表格修改对：锚点改存变更单元格值（渲染层按 value 定位）
- 卡片文案：空 del → `新增"X"`；空 add → `删除"X"`（不再 `修改""为"X"`）

**② mermaid 节点级（不用 classDef/id:::class 语法，用户拍板）**：
- `mermaid-diff.ts`：`extractFlowchartNodes` 按边分隔符（`-->`/`---`/`==>`/`-.->`）拆段解析——支持带边标签行（`B -- 是 --> C[...]`）与 `A -->|label| B`；有形状定义优先、裸 id 不覆盖；`mergeFlowchart`/`mergeState` 合并源码 = 新源码 + **删除节点原定义行加回**（保留边，无标注语法）
- `render-diff.ts` `applyMermaidAnnotations`：渲染后按节点 id 定位 SVG `<g class="node|state">`（id 形如 `mmd-N-flowchart-A-0`，子串匹配）加 class：add 绿 / del 红（虚线+划线）/ mod 黄；sequence 保留消息文本标注
- 样式：RenderDiff.vue `:deep(.diff-node-*)` 覆盖 rect/circle/nodeLabel（mermaid 内联 style 需 !important）

**③ 批注复用存量体系（删 DiffNotePanel.vue）**：
- `Annotation.source?: 'validation' | 'diff'` 字段；diff 改动说明 = 运行时批注（level=info，source=diff，persist=false）
- RenderDiff.vue：渲染完成后 notes → Annotation[]（锚点 pos = 渲染 doc 中 diffDel/diffIns 节点按 value 匹配；mermaid 按 code_block 语言）→ `setRuntimeAnnotations(tabId, list)` → **存量批注抽屉展示**（「改动说明」📝 只读卡）；`registerRenderInstance(tabId, crepe)` 注册渲染实例；onBeforeUnmount 注销 + 清 runtime（不残留 wysiwyg）
- AnnotationDrawer.vue：diff 模式下（viewMode==='diff'）只显示 source=diff 批注；locate/drawConnector 改用渲染 Crepe（coordsAtPos + 滚动 .render-main）；点击卡 = 激活 + 连线 + 平滑滚动；折叠胶囊计数含 info；diff 模式隐藏「重新校验」按钮
- `remark-inline.ts` 修复两个解析 bug：① 整行/整段单标记被 `parts.length > 1` 拒绝（`{--> 旧版本说明...--}` 原样输出）→ 改 `parts.some(p => p.type !== 'text')`；② 标记内容含 markdown 语法时被强调先拆开（`{++**词级**++}` → text"{++"+strong+"++}高亮"）→ 文本末尾未闭合标记跨节点向后合并（flattenText 按源码还原 strong→`**..**` 等）
- 嵌入块「内容有改动」角标（场景 A）：render-diff 渲染后对比 git.status()，源文件有未提交改动 → 卡片右上角黄标（`.ref-embed-diff-badge`）

**④ mock 真实化（真实 git diff 数据）**：
- `tests/scratch/gen-mock-git.js`：/tmp 建真实 git 仓库（Git演示/README.md 含 mermaid/嵌入/词级/纯删除 + 笔记/会议纪要.md 嵌入块内容调整 + 数据/需求表.md 表格单元格级；两提交 + feature 分支 + 工作区改动）→ 真实 `git diff`（unified + word-diff=porcelain）→ node 版解析器（照搬 Rust parse_unified_diff/parse_word_groups/groups_to_rows）→ 输出静态 TS
- `src/git/mock-data.ts`（新）：版本内容 + hunks + 仓库元信息（DEMO_* 导出）；`src/git/mock.ts` 重写（文件路径 Git演示/ 前缀，diffFile 按路径分发 hunks，commit diff 走 README_COMMIT_HUNKS）；`src/fs/mock.ts` MOCK_EXTRA 加 Git演示 文件（树可见、内容一致）
- 中文路径 -z NUL 解析 + `core.quotepath=false`（numstat）；**嵌入/引用路径用完整 `Git演示/...` 前缀**（resolveRefs 按 mock 工作区根解析）
- 坑：Git演示/笔记/会议纪要.md 与 fs 演示 笔记/会议记录.md 基名冲突 → 改名 会议纪要（menu-e2e/m4b-e2e 的过滤断言适配）

**测试**：git-m11a-smoke 重写 35 断言（面板 3 文件/渲染内联/mermaid 节点 class/嵌入角标/抽屉批注卡/会议纪要词级/需求表单元格/Esc）；git-m11a-e2e 61 断言（M13 渲染断言迁移到新体系：抽屉卡、无 diff-code-*）；menu-e2e 26（过滤适配）；全量 24 套件全绿

**遗留**：diff 内容含 `**加粗**` 跨节点合并已处理（flattenText 还原源码）；mermaid 合并源码的删除节点保留原边；批注卡位置在渲染 doc（coordsAtPos）非严格字符级。

### M14 修复记录（用户反馈两问题，2026-08-16）

1. **批注卡点击不滚动**：`locateDiff` 滚动 `.render-main`，但该容器自身几乎不溢出（maxScroll≈8）——实际滚动容器是 `.diff-body.render`（maxScroll≈1193）。修复：`findDiffScrollContainer` 从 `.render-host` 向上遍历取**溢出量最大的滚动祖先**（与存量 `scrollToPos` 同公式：`scrollTop + (coords.top - rect.top) - clientHeight*0.2`）。
2. **切换文件后抽屉残留上一文件批注**：`refresh()` 里 `getActiveInstance()` 在新标签编辑器异步挂载期间返回 null → 静默 return 且无重试 → 抽屉保持旧内容；挂载完成后无事件触发刷新。修复：① null 时 200ms 去重轮询重试；② manager 新增 `onEditorMounted`（`mountEditor` 完成后通知），AnnotationDrawer 订阅并刷新。
3. **测试适配**：M15 并行改动把图标列第一个按钮改为「文件树切 tab」（`onFilesIcon`）——git 测试的 `ensureSidebar` 点第一个图标会把 git 面板切到 files 而隐藏；改点第 2 个图标（Git）展开并保持 git 面板。

**背景**：Git 功能此前仅 tauri 可用，vite dev（浏览器）无法预览 diff 效果。M12 让浏览器 mock 模式完整可用——内置「演示笔记」示例仓库，直接查看 git diff 预期效果。

- **git 层 proxy 重构**（src/git/）：类型提取至 `types.ts`；`index.ts` 变 proxy（`GitBackend` 接口 + 后端选择：tauri → invoke；mock → 内置仓库；web 真实目录 → 禁用）；`mock.ts` 新增（示例仓库：README.md 含 mermaid 新旧对比/`![[` 嵌入/引用/需求清单词级变化/**纯删除块**/多提交/双分支；内存态，discard/checkout 可改，刷新重置）
- **联动**：`isGitAvailable()` = 后端非 null（浏览器 mock 也 true）；`fs.useRealDirFs` 切 web 时 `disableGitForRealDir()`；`gitBackendKind()`/`isMockGit()` 导出
- **工作区数据源统一**：`readWorktreeFile(path)`（mock → `git.showFile(path, 'WORKTREE')`；否则 fs.readFile）——接入 openGitDiff 打开 tab（openTab 加 contentOverride 参数）、loadRenderData 新版本、reloadTabFromDisk、buildRenderRefCfg（渲染层嵌入/引用物化读取）
- **GitPanel**：错误文案改「当前模式不可用」
- **示例效果**（`npm run dev` → 🔀 Git）：工作区 2 文件（README 14+/5-、会议记录 2+/1-）；默认渲染模式看 mermaid 图/嵌入卡片/纯删除块红底划线；切文本看分栏/词级；历史 2 提交 + Shift+点击范围对比；⇄ 切换 feature 分支；还原演示
- **测试**：git-m11a-smoke 重写为 21 断言（浏览器 mock 完整流程：面板/渲染融合/mermaid/嵌入/词级/hunk 还原按钮）；git-m11a-e2e 60/60 不变（tauri 注入流程）；全量 24 套件全绿

### M11a 实现记录（2026-08-15）

**Rust（lib.rs，cargo check + 7 单测全绿）**：
- 6 个命令：`git_repo_info` / `git_branches`（for-each-ref，%1f 分隔）/ `git_status`（porcelain -z + numstat + untracked wc -l）/ `git_log`（%1f 字段 + %1e 记录，limit + branch 过滤）/ `git_show_commit`（log -1 + diff-tree name-status -M + numstat）/ `git_diff_file(path, from?, to?)`（from=None → worktree vs HEAD；from=sha → sha..to；-U3 unified 解析）
- 解析逻辑提取纯函数：`parse_unified_diff` / `parse_porcelain` / `parse_hunk_header` + `#[cfg(test)]` 7 个单测（hunk 头缺省行数/零行范围、多 hunk、元行忽略、porcelain 中文路径、rename 双记录）
- 中文路径：`-z` 原样输出不转义（porcelain）；`core.quotepath` 未特殊处理（for-each-ref/name-status 默认不转义路径）

**viewMode 重构（sourceMode → 三态）**：
- `store.ts`：`Tab.sourceMode: boolean` → `Tab.viewMode: 'wysiwyg'|'source'|'diff'`；`Tab.diff`（diff 数据缓存：path/base/hunks/added/deleted/exists/loading）；`state.gitPanel`（tab/branches/status/log/selectedCommit/commitFiles/range/branchFilter/loading/error）
- `manager.ts`：`setSourceMode` → `setViewMode(tabId, mode)`（三态互斥切换，diff↔source 先 ensureDocSynced，保留 diff 数据切回秒开）；新增 `openGitDiff(path, base)`（自动保存 dirty → 加载 diff → 切视图；base 相同直接切）/ `closeGitDiff` / `openActiveGitDiff`（Ctrl+Shift+D）
- 全仓库清理 `sourceMode` 引用（App.vue 状态栏 badge 等）；`annotations/card.ts` Ctrl+R 守卫改 viewMode

**UI**：
- `App.vue`：icon-col 加 🔀（非 tauri 灰置 + toast）；content-col 双面板 tab「📁 文件 | 🔀 Git」（v-show 切换，GitPanel 常驻挂载）；shortcutActions 加 gitDiff（Ctrl+Shift+D）；onMenuAction 加 gitDiff（文件树右键「Git 改动」）
- `GitPanel.vue`：状态条（⟳/分支 badge/未提交数）+ 范围对比条（a..b + ✕）+ 分支区（点击过滤历史）+ 工作区（状态色块 M/A/D/?/R + 行数）+ 历史（点击展开变更文件 → 点文件 diff commit vs 父提交；**Shift+点击两提交 = 范围对比**；HEAD 自动展开）
- `DiffView.vue`：工具栏（路径/base 标签/+−统计/上一处下一处/关闭）+ hunk 分组行级渲染（行号 + 红/绿/上下文）+ F7/Shift+F7 导航 + Esc 退出 + 空态（加载中/文件已删除/无改动）
- `EditorPane.vue`：diff 模式隐藏 Crepe 容器（DiffView 接管，v-show 跟随 viewMode）
- `settings.ts`：SHORTCUT_DEFS 加 gitDiff（Ctrl+Shift+D）

**测试**：
- `git-m11a-e2e.js`（29 断言）：**浏览器注入 Tauri IPC mock**（`__TAURI_INTERNALS__.invoke` 模拟含 mermaid/引用的 git 仓库）→ 面板三区块/HEAD 展开/工作区 diff/commit diff/范围对比/viewMode 三态互斥/Esc/行号
- `git-m11a-smoke.js`（10 断言）：浏览器降级（图标灰置 + toast + 面板错误 + Ctrl+Shift+D 守卫）
- 既有回归：app-e2e（图标序号更新：⚙️ nth(1)→nth(2)；快捷键 11→12 项）、source-e2e 26/26 等全绿

**关键实现细节**：
1. 进入 diff 前**自动保存**（git diff 反映磁盘，避免困惑）；diff 数据缓存于 tab.diff，切回秒开
2. `parse_porcelain` rename 双记录（`R old\0new\0`）→ 显示 `old → new`；untracked 行数 wc -l
3. `git_show_commit` 用 diff-tree name-status + numstat 双通道（rename 路径 `old => new` 取 new）
4. 测试坑：展开的 commit 中心点落在 commit-files 区（ws-file @click.stop 吞事件）→ 点 `.commit-row`；打开文件自动收纳侧边栏 → 点面板前先展开
5. playwright `isVisible()` 对 Crepe `.milkdown` 返回 false 但 boundingBox 正常（元素实际可见）→ 断言用 boundingBox

## 9. 测试计划

`tests/e2e/git-diff-e2e.js`（+ 拆分 git-panel-e2e / git-diff-e2e / git-render-e2e）：

- **fixture**：shell 现场建临时 git 仓库（git init + 多次提交 + 工作区改动；**含 mermaid 文件 + 块嵌入引用文件**；中文路径文件）
- 面板：三区块渲染、分支列表、工作区状态色、历史展开、**范围对比（Shift+点击 → a..b）**
- diff 文本模式：内容正确、词级高亮、导航计数、分栏/统一切换、hunk 折叠、Esc 退出
- diff 渲染模式：单栏融合、**mermaid 图块红/绿边框 + 角标、嵌入卡片变化角标、修改块 del/ins 划线**、空状态
- 边界：非 git 提示、mock/web 下 Git 面板隐藏（不破坏 app-e2e）、dirty 自动保存
- Rust `cargo check`（Linux 环境只能 check，打包在 Windows 执行）

## 10. 缺口 / 待办

- 渲染模式双 Crepe 的 IO 懒加载规避（M11c 实现首日验证项）
- 大 diff 虚拟滚动（>5000 行）
- 分支切换的未提交改动处理（stash 提示/确认，M11d）
- 文件重命名追踪（git status R 状态，M11d）
- 渲染↔文本映射增强（v2：渲染视图点击定位到对应文本 hunk）
