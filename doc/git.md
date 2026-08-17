# Git 工作台（M11–M15）

> 核心代码：`editor-app/src/git/`（mock 演示后端）+ `components/GitPanel.vue`（面板）+ `DiffView.vue` / `RenderDiff.vue`（diff 视图）+ `editor/diff-compose.ts`（组合器）+ `editor/mermaid-diff.ts`（mermaid 节点级）+ `src-tauri/src/lib.rs`（Rust git 命令）。
> 设计文档：`editor-app/docs/git-workbench.md`（M11a–M15 完整实现记录）。
> 一句话：**仓库级 Git 工作台——侧边栏面板（分支/工作区/历史）+ 编辑区 diff 视图（文本/渲染双模式），渲染模式把 diff 变成看得懂的 Markdown 融合视图**。

## 1. 入口与面板

- **入口**：图标列 🔀（SVG 组件）恒开 Git 面板；文件树/标签右键「Git 改动」；快捷键 `Ctrl+Shift+D`（当前活动文件）。
- **面板三区块**（纵向）：

| 区块 | 内容 | 交互 |
|---|---|---|
| 仓库状态条 | 分支徽标 ⓘ + 未提交文件数 | ⟳ 刷新；← 返回文件树 |
| 分支 | main / feature / origin 列表 | 点击 = 过滤历史；⇄ = 切换分支（危险确认） |
| 工作区 | 状态色块（M 橙 / A 绿 / D 红 / ? 灰）+ 行数统计 | 点击 → 编辑区 diff（工作区 vs HEAD） |
| 历史 | 提交列表（hash/相对时间/信息） | 点击展开变更文件 → 点文件 diff（commit vs 父提交）；**Shift+点击两提交 = 范围对比 a..b**（顶部范围条 ✕ 清除）；HEAD 自动展开 |

- **进入 diff 前自动保存**当前文件（git diff 反映磁盘状态，避免困惑）。

## 2. 文本模式（DiffView.vue）

- **分栏**（默认，左旧右新行号对齐）/ **统一**（`Ctrl+Shift+U`）双布局。
- **行级 + 词级高亮**：整行红/绿底色；修改对内的变更词再细分（`--word-diff=porcelain` 解析合并，Rust 侧按 (kind, text) 匹配合并）。
- **hunk 折叠**：连续相同行 > 阈值折叠为「⋯ 相同 N 行」点击展开；当前 hunk 顶部 primary 描边。
- **导航**：`F7` / `Shift+F7` 上一处/下一处改动，计数「n/N」；`Esc` 退出 diff。
- **还原**：工具栏「还原…」（整文件）+ hunk 头部「↩ 还原此段」（仅工作区 diff；危险确认 → git checkout / git apply --reverse → 标签重载 → 面板刷新）。

## 3. 渲染模式（默认，单 Crepe 组合 md）——核心差异化

**目标**：mermaid 图、嵌入卡片、词级修改在渲染后的 Markdown 里一眼可见。替代早期「双 Crepe + DOM 提取融合」，改为**单 readonly Crepe 渲染一份组合 md**（diff 标记内嵌）。

### 组合规则（diff-compose.ts）

| diff 行 | 组合 md | 渲染效果 |
|---|---|---|
| ctx 行 | 原样 | 正常 |
| 纯 del 段 | 每行 `{--旧行--}`（表格行逐单元格） | 红底划线（span.diff-del） |
| 纯 add 段 | 每行 `{++新行++}` | 绿底（span.diff-ins） |
| 修改对（有共同前缀/后缀） | `{--删词--}{++增词++}` 行内 | 红底划线 + 绿底 |
| 修改对（整行重写） | `{--旧行--}{++新行++}` | 同上 |
| 表格修改对 | 单元格级 `\| {--旧--}{++新++} \|` | 单元格级标注 |
| mermaid fence | 新源码 + 删除节点原行加回 | 渲染后 DOM 标注（见下） |
| 嵌入 `![[path]]` | 原样（源文件有改动 → 卡片右上角「内容有改动」角标） | 卡片 + 角标 |

- 标记语法 `{--..--}` / `{++..++}`（pandoc 风格）由 `diff-nodes/remark-inline.ts` 解析为 diffDel / diffIns 节点；转义 `\{--` 输出字面；**内容含 markdown 语法时跨节点合并**（如 `{++**词级**++}` 被强调拆开 → 按源码还原拼接）。
- 表格行纯增删**逐单元格标记**（整行包标记会被 GFM 表格解析器吃掉）。

### mermaid 节点级（渲染后 DOM 标注，不用 classDef 语法）

- `mermaid-diff.ts` 解析 flowchart / sequence / stateDiagram：新增 / 删除 / 修改（标签变化）节点；合并源码 = **新版本源码 + 删除节点原定义行加回**（保留边，无标注语法侵入）。
- `render-diff.ts` `applyMermaidAnnotations` 渲染完成后按节点 id 定位 SVG `<g>` 加 class：**新增绿 / 删除红（虚线+划线）/ 修改黄**；sequence 按消息文本定位。
- 注意：mermaid 预览是 IntersectionObserver 懒加载，滚动到图才渲染——标注轮询补标（400ms/1.2s/2.5s）。

### 批注复用存量体系（M14）

- 组合结果自动生成**改动说明**（notes）→ 转 `Annotation[]`（`source:'diff'`，level=info）→ `setRuntimeAnnotations` 进**存量批注抽屉**（与校验违规/人工批注同一抽屉，「改动说明」📝 只读卡）。
- 点击卡片 = 激活 + 连线（抽屉左缘 → 锚点）+ 平滑滚动到改动位置；diff 模式下定位/连线切换到渲染 Crepe（`coordsAtPos` + 滚动 `.render-main`）。
- 退出 diff 自动清理（不残留到 wysiwyg 编辑器）。

## 5b. 文件树与面板强化（M15）

**目标**：改动看得见的文件树——主文件树 git 角标；变更列表树形化；面板可用性（区块折叠/分支搜索/提交图）。

### 主文件树 git 角标

- 工作区 git status（不只面板打开时，App 启动即拉一次）→ `state.gitMark = { files: path→状态, dirs: 目录路径→聚合状态 }`（`git/mark.ts`，复用 buildChangeTree 聚合）。
- `FileTree.vue` 节点渲染角标小圆点（M 橙 / A 绿 / D 红 / ? 灰 / R 紫）：文件 = 自身状态；目录 = 子级聚合（仅含有改动子级的祖先目录，含 D 最醒目）。
- 有改动文件 hover 行尾出现「Git 改动」按钮 → 直接打开工作区 diff（单击行为保持正常打开编辑，不劫持）；右键菜单「Git 改动」原有。
- 打开 diff 时 `revealInTree(path, 8000)` 联动主文件树定位高亮（长保持，切回文件树仍可见）。

### 变更列表树形化（`components/GitChangeTree.vue`）

- 工作区 status / 提交变更 files 由扁平列表升级为**可折叠目录树**（`git/change-tree.ts` 构建）：目录行聚合状态色板 + `+N −M` 合计，仅创建有改动文件的祖先目录（无空目录）。
- 目录点击折叠/展开；文件点击 → 打开 diff（工作区 vs HEAD / commit vs 父 / a..b 范围）。默认全展开；刷新重置。

### 面板布局与可用性

- 区块顺序调整为 **工作区 → 分支 → 历史**；三区可折叠收纳（chevron，localStorage `writeit.gitPanel.sections.v1` 记忆）。
- 分支区块新增**搜索框**（大仓库分支多时按名过滤）。
- 历史区渲染**提交图**（`git/graph.ts` lane 算法：`o` 提交 / `+` 合并 / `|` 延续 / `\`、`/` 分叉与汇聚），提交数据 Rust 侧 `git_log` 增加 `%P` 父提交（`GitCommit.parents`）。

## 4. 数据层（Rust，git CLI）

`src-tauri/src/lib.rs` 全部走 git CLI（`--no-color` + `-z` + UTF-8；中文路径 `core.quotepath=false`）：

| 命令 | 用途 |
|---|---|
| `git_repo_info` / `git_branches` / `git_status` / `git_log` / `git_show_commit` | 面板数据（porcelain -z NUL 解析、for-each-ref %1f 分隔、diff-tree name-status+numstat） |
| `git_diff_file(path, from?, to?)` | unified（`-U3`）+ `--word-diff=porcelain` 双通道解析合并 → hunks + words |
| `git_show_file(path, rev)` | 取某版本内容（渲染模式旧版本；rev=HEAD/sha/sha^） |
| `git_discard_file` / `git_discard_hunk` | 还原（checkout -- / 提取单 hunk 补丁 git apply --reverse） |
| `git_checkout_branch` | 切换分支（未提交改动确认由前端做） |

## 5. 浏览器演示模式（mock，vite dev 直接看效果）

- `git/mock-data.ts`：**真实 git diff 数据**（`tests/scratch/gen-mock-git.js` 在服务器建真实 git 仓库 → 跑真实 `git diff` → 程序化生成静态 TS，勿手改）。
- 演示仓库 `Git演示/`（文件树可见，与 fs mock 内容一致）：
  - `README.md` —— mermaid 节点修改/新增/删除、词级修改、纯删除块、需求清单、嵌入引用；
  - `笔记/会议纪要.md` —— 嵌入块内容调整（备注词级 + 议题新增）；
  - `数据/需求表.md` —— 表格单元格级改动；
  - 4 提交（2 条主线 + feature 分叉 + Alice 合并）+ `feature/图表优化` 分支（演示提交图分叉/合并）。
- 交互：🔀 打开面板 → 工作区点文件 → 默认渲染模式；切「文本」看分栏/词级；历史点提交/Shift+范围对比；⇄ 切分支；还原演示。
- 内存态：discard / checkout 会改状态，刷新页面重置；设置页「🔄 刷新 Mock 示例数据」恢复示例。

## 6. 关键文件

| 文件 | 职责 |
|---|---|
| `src/git/mock-data.ts` | 演示仓库真实数据（内容/hunks/元信息，自动生成；M15：4 提交带 parents） |
| `src/git/mock.ts` / `index.ts` | mock 后端实现 / GitBackend proxy（tauri → mock → 禁用） |
| `src/git/mark.ts` | 主文件树角标数据（工作区 status → files/dirs 聚合 Map） |
| `src/git/change-tree.ts` | 变更文件树构建（目录聚合状态色板 + 行数合计） |
| `src/git/graph.ts` | 提交图 lane 算法（o/+ / 竖线 / 分叉汇入） |
| `components/GitPanel.vue` | 面板三区块（折叠/搜索/提交图） + 范围对比 + 分支切换 |
| `components/GitChangeTree.vue` | 变更文件可折叠树（工作区/提交 files 共用） |
| `components/FileTree.vue` | 主文件树：git 角标 + hover 快捷 diff 按钮 |
| `components/DiffView.vue` | diff 视图：工具栏 + 文本模式（分栏/统一/词级/折叠/导航/还原） |
| `components/RenderDiff.vue` | 渲染模式：组合 md 渲染 + 批注注入 + 降级双栏 |
| `components/AnnotationDrawer.vue` | 存量批注抽屉（diff 改动说明卡 + 连线/定位） |
| `editor/diff-compose.ts` | diff → 组合 md（行级/词级/表格/嵌入/mermaid） |
| `editor/diff-nodes/` | `{--..--}`/`{++..++}` 解析（remark-inline）+ diffDel/diffIns 节点 |
| `editor/mermaid-diff.ts` | mermaid 节点级 diff（flowchart/sequence/state） |
| `editor/render-diff.ts` | 单 Crepe 渲染组合 md + mermaid DOM 标注 + 嵌入角标 |
| `src-tauri/src/lib.rs` | Rust git 命令（面板/diff/还原/分支；M15：`git_log` 带 `%P` 父提交） |

## 7. 边界与降级

| 场景 | 处理 |
|---|---|
| 非 git 仓库 / web 真实目录 | Git 图标灰置 + toast；diff 入口禁用 |
| 渲染模式失败 | 降级双栏全文对比（renderSplitFallback）+ 顶栏提示 |
| 文件 dirty | 进入 diff 前自动保存 |
| 历史中文件已删除 | diff 显示「文件已删除」空态 |
| 大文件 | 文本模式 hunk 折叠；渲染模式无虚拟滚动（v2 项） |
