# Git 工作台（M11–M17）

> ⚠️ **渲染边界裁决请优先读规范：`doc/git-diff-rules.md`（M16 抽象准则）**。M17 起渲染改走「文档结构级 diff + 装饰」（`editor/diff-deco.ts`），不再注入 `{--..--}` 标记；规则文书保留为**行为契约**（规则 1–8 的对外效果不变，语义边界大幅减少）。

> 核心代码：`editor-app/src/git/`（mock 演示后端）+ `components/GitPanel.vue`（面板）+ `DiffView.vue` / `RenderDiff.vue`（diff 视图）+ `editor/diff-deco.ts`（结构级 diff 核心）+ `editor/render-diff.ts`（渲染管线）+ `editor/mermaid-diff.ts`（mermaid 节点级）+ `src-tauri/src/lib.rs`（Rust git 命令）。
> 设计文档：`editor-app/docs/git-workbench.md`（M11a–M15 完整实现记录）。
> M15：变更文件树 + 提交图 + 分支搜索；M16：嵌入引用徽标/源文件摘要、mermaid 边标签修复；M17：弃用「markdown 字符串注入 marker」管线，改为文档结构级 diff + ProseMirror 装饰。
> 业务仓库为真实 Git 仓库（vite dev 默认「消金业务合作平台」，Vite Node 中间件桥接 fs/git）。
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
  - M16 修正：unified diff 用 `-U3` 上下文，单 hunk 内 ctx 段最多 6 行 → 原阈值 10 永不触发（死功能）；改阈值 3（`FOLD_THRESHOLD=3, FOLD_KEEP=2`），同一 hunk 内被两次修改夹住的 ctx 段（>3 行）可折叠。
- **导航**：`F7` / `Shift+F7` 上一处/下一处改动，计数「n/N」；`Esc` 退出 diff。
- **还原**：工具栏「还原…」（整文件）+ hunk 头部「↩ 还原此段」（仅工作区 diff；危险确认 → git checkout / git apply --reverse → 标签重载 → 面板刷新）。

## 3. 渲染模式（默认，单 Crepe — 文档结构级 diff + 装饰）——核心差异化

**目标**：mermaid 图、嵌入卡片、词级修改在渲染后的 Markdown 里一眼可见。

**M17 重构**：旧管线把 `{--..--}`/`{++..++}` 标记直接注入 markdown 字符串（`diff-compose.ts`），为防 GFM 解析破坏堆了十几类语义边界正则（表格分隔行/列表引用标题 marker/元字符 LCS/栅栏漏斗/嵌入行/段落空行…），`remark-inline.ts` 还要反向合并被解析器拆散的标记，批注锚点靠渲染后值匹配猜位置——边界场景难以穷举。
**新管线只做三件事**：

1. **结构级 diff**：用 `@milkdown/plugin-diff` 的 `computeDocDiff(oldDoc, newDoc)`（LCS + ChangeSet，字符级 token 含 mark 编码）对「新文档为底」的全文做 diff，得到精确 `fromB/toB`（渲染 doc 坐标）。
2. **装饰**：新增范围 → `Decoration.inline`（`.diff-ins` 绿）/ 块级 `Decoration.node`（`.diff-ins-block`）；删除范围 → `Decoration.widget` 把旧文本原位插回（`.diff-del` 红划线；块级 `.diff-del-block`）。`buildDiffDecorations` 构建后经 transaction meta 注入。
3. **批注卡位置直接记录**：note 自带精确 `from/to`，`RenderDiff.vue` 不再值匹配（规则 8 由数据结构保证）。

语法外壳（列表/引用/标题/强调/链接、表格单元格、段落独立性）由 markdown 解析器天然处理——**此前十几条边界规则自然消失**。文本模式（`DiffView.vue`）不走此管线，仍用 Rust `--word-diff=porcelain` 的 words 逐行渲染，保持不变。

保留的少量语义规则（合计 < 60 行，均有充分理由）：

| 规则 | 位置 | 理由 |
|---|---|---|
| 表格分隔行（两侧都只含 `-`/`:`）跳过 | `diff-deco.ts isSepRowText` | 列宽对齐格式化的内容噪音 |
| mermaid 栅栏走节点级 | `patchMermaidFences` 预合并源码 + `applyMermaidAnnotations` | 节点/消息级标注比文本标记更有意义 |
| file_block 卡片不标文本；删除引用 → 红色占位行 | `diff-deco.ts` 语义规则 3 | 卡片本体由徽标系统表达 |

### mermaid 节点级（渲染后 DOM 标注，不用 classDef 语法）### mermaid 节点级（渲染后 DOM 标注，不用 classDef 语法）

- `mermaid-diff.ts` 解析 flowchart / sequence / stateDiagram：新增 / 删除 / 修改（标签变化）节点；合并源码 = **新版本源码 + 删除节点原定义行加回**（保留边，无标注语法侵入）。
- **M16 边标签修复**：flowchart 边标签前缀剥离正则 `^\|\[[^|]*\]\|` 误匹配带方括号内容，真实语法 `A -->|label| B` 的 `|label|` 无法剥离 → 带标签边另一端的节点（如 `C -->|失败| E` 的 E）从未被提取 → 节点级 diff 静默失效。改为 `^\|[^|]*\|`。
- **M16b 二元语义（去黄）**：flowchart/sequence/state 全部取消「修改（黄）」标注与统计——同 id 标签变化视为节点仍在（不标不打扰）；删除节点/消息以原行加回渲染（红虚线划线）；sequence 删除消息也加回图底部并红标，消息文本精确匹配（避免前缀包含误命中）。批注卡只报「新增 N / 删除 N」。
- **M16c 修改＝删+增**：flowchart/state 的标签修改节点渲染为「节点绿（新值）+ 下方红划线旧值小字」（体现删除后新增），统计并入删/增各 1；state 删除状态连过渡线一起加回（不孤立）；sequence 删除消息按 LCS 对齐顺序插回原位（先删旧线再增新线）、支持 participant 参与者行增删标注（新增绿/删除红 + 加回 merged）。
- `render-diff.ts` `applyMermaidAnnotations` 渲染完成后按节点 id 定位 SVG `<g>` 加 class：**新增绿 / 删除红（虚线+划线）/ 修改黄**；sequence 按消息文本定位。
- 注意：mermaid 预览是 IntersectionObserver 懒加载，滚动到图才渲染——标注轮询补标（400ms/1.2s/2.5s）。

### 嵌入引用徽标与源文件改动摘要（M16，对应上文「嵌入」行）

- **引用行本身的变化**（来自当前文件 hunks）：**新增引用（绿）** 卡片徽标；**移除的引用以缩略红行展示**（`{--移除引用：[[path]]--}` 1 行，非卡片）+「移除了引用」批注卡。M16b：取消「引用变更（黄）」概念（`![[A]]`→`![[B]]` = 删 A + 增 B）。
- **源文件工作区有改动**（`git.status()`）：卡片头部「内容有改动」（黄）角标 + 卡片底部**内嵌源文件改动摘要**（仅变化行 +/-，mermaid 结构变化概要 1 行，跳过表格分隔行噪音）。旧实现路径匹配写死 `.endsWith('/'+p)` 导致无扩展名引用路径永远匹配不上 → 角标从未生效（M16 修复）。
- **M16c base 传参（可选）**：摘要改为基于当前 diff 的对比基准 `from..to` 计算（而不只看工作区脏文件）——工作区（`null..HEAD`）与历史提交对比（`sha^..sha`）统一；08 场景里被嵌入的 05/06 图在本次提交有改动 → 当前文件也显示其改动摘要。
- **M16c 批注锚点 used 去重 + 类型区分**：computeNotePositions 按 del/add 区分 diffDel/diffIns（新增卡只配 diffIns、删除卡只配 diffDel），同值多卡按文档顺序分配不同位置（used 去重），「新增/移除引用」卡定位到 file_block 卡片节点。
- 摘要按 `git.diffFile(changedPath)` 计算；仅覆盖工作区未提交改动（历史提交对比场景下工作区干净则不显示——此时嵌入内容差异在变更文件自身 diff 中呈现）。

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

## 5c. 真实仓库调试（dev-repo，M15）

**vite dev 下用真实仓库数据调试**（默认，不用 mock）：内容库已迁至独立 git 仓库 `/Users/huyongsheng/project/消金业务合作平台`，由 Vite Node 中间件（`vite-plugins/dev-repo.ts`）直连：

- **默认即真实仓库**：`npm run dev:repo` → 打开 `http://localhost:5173/` 即为真实数据；设置页「数据源」可切 Mock 演示（或 URL `?backend=mock` 快速覆盖）；`?backend=dev` 回到真实仓库。
- 文件系统：`/__repo/fs/*` 走 `node:fs/promises` 读内容库（防越界、`.git` 不展示）；git：`/__repo/git/*` 走真实 git CLI（命令参数/解析规则与 lib.rs 一致：porcelain -z、for-each-ref %1f、diff-tree -z --root -M、-U3 + --word-diff=porcelain 双通道、-U0 hunk 反打 `<` stdin 管道）。
- 仓库根可用环境变量 `WRITEIT_DEV_REPO` 覆盖（任意目录）。
- 优势：M15 的变更树 / 提交图 / 文件树角标直接看**真实改动史**；还原、切换分支真实生效。

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
| `editor/diff-deco.ts` | 结构级 diff 核心：computeDocDiff → 装饰 + 批注卡（含 mermaid fence 预合并、语义小规则） |
| `editor/mermaid-diff.ts` | mermaid 节点级 diff（flowchart/sequence/state） |
| `editor/render-diff.ts` | 单 Crepe 渲染新 doc + diff 装饰注入 + mermaid DOM 标注 + 嵌入角标 + 降级双栏 |
| `src-tauri/src/lib.rs` | Rust git 命令（面板/diff/还原/分支；M15：`git_log` 带 `%P` 父提交） |

## 7. 边界与降级

| 场景 | 处理 |
|---|---|
| 非 git 仓库 / web 真实目录 | Git 图标灰置 + toast；diff 入口禁用 |
| 渲染模式失败 | 降级双栏全文对比（renderSplitFallback）+ 顶栏提示 |
| 文件 dirty | 进入 diff 前自动保存 |
| 历史中文件已删除 | diff 显示「文件已删除」空态 |
| 大文件 | 文本模式 hunk 折叠；渲染模式无虚拟滚动（v2 项） |
