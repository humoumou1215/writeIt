# Git SCM 视图复刻设计（VSCode 源代码管理面板）

> 目标：把 Git 面板改造为 VSCode「源代码管理」视图的对等物：**暂存区模型 + 提交输入框 + 分组文件列表 + 行内操作 + 右键菜单 + 分支切换器 + 远程同步**。
> 前置文档：`doc/git.md`（现有 Git 工作台全貌）、`editor-app/docs/git-workbench.md`（M11–M15 实现记录）。
> 本文是设计契约，实现按 Phase 0–6 推进（见 §9），每个 Phase 独立可交付。
>
> **R1 评审修订（2026-08-16，沙箱仓库实测核验）**：§0 五项 bug 已逐一在真实代码 + 临时 git 仓库中验证**全部属实**；新增 **#6 rename 显示方向颠倒 / numstat 花括号解析缺失**。正文同步修订：R1-1 提交安全（提交/amend 前保存 dirty tab、amend 已推送需 force-with-lease）、R1-2 冲突判定集合（含 AA/DD）、R1-3 冲突文件 combined-diff 解析、R1-4 三后端对拍测试。确认修订落地于 §0/§2/§4/§5/§6/§9；**待拍板建议**（stash 提前、ours/theirs 解决按钮）见 §11。

## 0. 前置修复（Phase 0，必须先做）

改造踩在现有 git 层上，以下已知 bug 会直接污染新功能，先修：

| # | 问题 | 位置 | 修法 |
|---|---|---|---|
| 1 | `discardHunk` 索引错位：前端 `-U3` hunk 序号 vs 后端 `-U0` 重取，数量/顺序不一致，可能还原错段落 | `lib.rs` / `dev-repo.ts` `discard-hunk` | 后端改用 `-U3` 提取（去掉 `--unidiff-zero`；上下文还能容错外部修改） |
| 2 | Rust 端词级 diff 没带 `-- path` 和 `from/to`，跑成了全仓 diff，token 跨文件误配 | `lib.rs git_diff_file` | 对齐 `dev-repo.ts` 的 `wargs` 逻辑 |
| 3 | Rust 端未跟踪文件 diff 为空 | `lib.rs` | 回迁 `gitDiffNoIndex('/dev/null', path)` |
| 4 | `run_git` 缺 `-c core.quotepath=false`；`git_show_commit` 的 diff-tree 非 `-z` → 中文路径统计丢失/打不开 | `lib.rs` | `run_git` 统一加 `-c core.quotepath=false`；diff-tree 加 `-z` |
| 5 | `discardFile`（checkout --）对未跟踪文件报错 | `lib.rs` / `dev-repo.ts` | 未跟踪 → 删除文件；其他 → 保持 `checkout --`（在 §4.3 新语义下它是正确的：index → worktree） |
| 6 | rename 显示方向颠倒 + numstat 花括号格式解析缺失（R1 实测发现） | `lib.rs` / `dev-repo.ts` | `-z` 下 rename 两记录顺序为 `XY <新路径>` NUL `<旧路径>`（**non-z 才是 old→new**），现有 `parse_porcelain` 拼出「新 → 旧」，方向反了；且 `git diff --cached --numstat` 的 rename 输出是 `0 0 dir a/{ol d.md => new file.md}`（含引号转义），`parts[2]` 精确匹配必然 miss → rename 文件行数恒为 -1。修法：-z 第二段 = `renameFrom`；三处 numstat 统一解析花括号/引号格式取新路径 |

## 1. 总体布局（复刻 VSCode SCM）

```
┌────────────────────────────────────────┐
│ ⓘ main ▾        ↑2 ↓1  [⟳] [⋯更多]      │  ① 状态条：分支（点击=切换器）/ ahead-behind / 同步 / 菜单
├────────────────────────────────────────┤
│ ┌ 提交消息（Enter 换行，Ctrl+Enter 提交）┐ │  ② 提交输入框
│ └──────────────────────────────────────┘ │
│ [✓ 提交 ▾]                              │  ③ 提交按钮（下拉：提交并推送 / 修改上一提交）
├────────────────────────────────────────┤
│ ▾ 暂存的更改 · 2        [−全部取消暂存]   │  ④ Staged 区（空则隐藏）
│   M 会议纪要.md   笔记/          +2 −1   │
│ ▾ 更改 · 5              [＋全部暂存] [⋯] │  ⑤ Changes 区
│   M README.md                    +8 −9   │
│   ? 新笔记.md                     +12 −0  │
│   D 旧稿.md                              │
│ ▾ 历史 · 50（提交图，保留现有实现）        │  ⑥ 历史（本产品特色，VSCode 没有）
└────────────────────────────────────────┘
```

已确认的产品决策：
- ② 提交输入框固定在面板顶部（VSCode 位置）。
- 无 staged 点提交 → 默认弹确认「是否暂存全部并提交？」（对齐 VSCode smartCommit）。
- **不自动 fetch**：网络请求仅在用户手动 sync 时发生；面板加载只本地计算 ahead/behind（离线安全）。
- ⑥ 历史保留在 SCM 面板内；**分支不再作为面板常驻区块**，仅保留状态条分支按钮 + 弹出式切换器（查看/搜索/切换，见 §5.6）。

- ⑥ 是 writeIt 已有能力（提交图），保留并收纳在折叠区，不删。
- 顶部追加「平铺/树形」切换（VSCode 的 list toggle）：默认**平铺**（VSCode 默认），树形复用现有 `buildChangeTree`。

## 2. 数据模型

### 2.1 GitFileStatus 拆 XY 双码

```ts
export interface GitFileStatus {
  path: string            // R 状态 = 新路径
  /** Y 码：工作区状态（'M'|'A'|'D'|'U'|'?'|'R'|'C'）；' ' = 无 */
  status: string          // 兼容字段 = worktree 有码则 worktree 码，否则 index 码（旧 UI 仍可用）
  indexStatus: string     // X 码（' ' = 未暂存）
  worktreeStatus: string  // Y 码（' ' = 无工作区改动）
  renameFrom?: string     // R：旧路径（显示 "旧 → 新"）
  added: number           // Changes 区行数 = index..worktree numstat
  deleted: number
  /** staged 行数 = HEAD..index numstat（仅 staged 区显示用） */
  indexAdded: number
  indexDeleted: number
}
```

- 数据源：`git status --porcelain=v1 -z` 的 XY 码（现有 `parse_porcelain` 只取单码，需改造：**保留两个码**）。rename/复制在 `-z` 下的两记录顺序为 `XY <新路径>` NUL `<旧路径>`（**与 non-z 的 `old -> new` 相反**，见 §0 #6）——改版取**第二段为 `renameFrom`**。
- 行数：`git diff --numstat`（unstaged）+ `git diff --cached --numstat`（staged）各跑一次，按 path 匹配；**rename 的 numstat 输出为花括号/引号格式（实测 `0 0 dir a/{ol d.md => new file.md}`），匹配前必须先解析取新路径（§0 #6）**；未跟踪文件读磁盘行数（现有逻辑保留）；冲突（U/AA/DD）文件跳过 numstat（显示 -）。
  > ⚠️ **行数是语义变更（R1 声明）**：现在显示「vs HEAD 总量」，改后 Staged 区 = HEAD..index、Changes 区 = index..worktree，双态文件两区各显各自增量——对齐 VSCode 没错，但数字会比现在小，老用户可见，测试断言需同步。
- 分组由前端派生（不存后端）：
  - **Staged**：`indexStatus` ∈ {M,A,D,R,C}（`?` 永不进 staged）
  - **Changes**：`worktreeStatus` ∈ {M,A,D,U,R,C,?}
  - **Merge（冲突，R1-2）**：任一码含 `U` **或 (X,Y)∈{(A,A),(D,D)}** → 单独「合并更改」分组（见 §8。实测 add/add 冲突 = `AA`、delete/delete = `DD`，**均不含 U**，纯 U 判定会漏——AA 恰是笔记仓库常见冲突：双方新建同名文件）
  - 同一文件可同时出现在两个区（X=M, Y=M：staged 一部分后又改）

### 2.2 后端接口扩展（GitBackend）

```ts
interface GitBackend {
  // 现有全部保留 +
  stage(paths: string[]): Promise<void>          // git add -A -- <paths>（-A 覆盖删除；对冲突文件 = 标记已解决）
  unstage(paths: string[]): Promise<void>        // git reset -q HEAD -- <paths>（实测无 HEAD 首次提交仓库同样可用，**不需要** git rm --cached 特判）
  commit(message: string, opts?: { amend?: boolean; stageAll?: boolean }): Promise<{ hash: string }>
  discardWorktree(paths: string[]): Promise<void>  // 见 §4.3；批量=逐个执行
  revertToHead(paths: string[]): Promise<void>   // staged 区「还原到 HEAD」（R1 已确认并入 Phase 3）：reset -q HEAD + checkout -- 组合，破坏性，前端 danger confirm（VSCode staged 区 discard 的第三语义，§4.3）
  resolveMerge(path: string, side: 'ours' | 'theirs'): Promise<void>  // git checkout --ours/--theirs -- <path>；**待 §11 拍板**，未采纳则不实现
  fetch(): Promise<void>
  pull(): Promise<void>                          // git pull --no-rebase（diverged 报错透传）
  push(): Promise<void>
  aheadBehind(): Promise<{ ahead: number; behind: number } | null>  // null=无 upstream
  createBranch(name: string, from?: string): Promise<void>   // git branch <name> [from]；不切换
  renameBranch(from: string, to: string): Promise<void>
  deleteBranch(name: string): Promise<void>      // git branch -D（danger confirm 在前端）
  ignore(path: string): Promise<void>            // 追加一行到 .gitignore（无则创建）
}
```

三后端（tauri / dev / mock）同步实现——**这是既往 bug 的根因（dev 修了 tauri 没修），本次起以本文档为对齐契约，任一后端改动必须三端同步**。`run_git`（Rust）与 `git()`（dev）统一注入 `-c core.quotepath=false`。

## 3. 状态层（store.ts）

```ts
interface GitPanelState {
  // 保留：tab / repo / log / selectedCommit / commitFiles / range / loading / error / version
  // 移除：branches / branchFilter（常驻分支区块已删；过滤/搜索收敛到 BranchPicker 局部状态，懒加载）
  status: GitFileStatus[]        // 原始列表（兼容 gitMark）
  staged: GitFileStatus[]        // 派生：indexStatus 有码
  unstaged: GitFileStatus[]      // 派生：worktreeStatus 有码或 ?
  merge: GitFileStatus[]         // 派生：含 U ∪（AA/DD）冲突（R1-2，§2.1）
  aheadBehind: { ahead: number; behind: number } | null
  commitMessage: string
  viewMode: 'flat' | 'tree'      // localStorage 记忆（writeit.gitPanel.view.v1）
  hasRemote: boolean             // 决定 sync 按钮显隐
  // 分支数据不再常驻：BranchPicker 打开时调 git.branches() 现取（懒加载）
}
```

## 4. 关键语义：diff 基准随分区变化（本次改造的核心）

### 4.1 DiffBase 重构

```ts
export type DiffBase =
  | { kind: 'unstaged'; label: string }                        // index..worktree（Changes 区点击）
  | { kind: 'staged'; label: string }                          // HEAD..index（Staged 区点击）
  | { kind: 'worktree'; label: string }                        // HEAD..worktree（旧入口：文件树角标/标签右键——兼容保留）
  | { kind: 'range'; from: string; to: string; label: string } // 历史（不变）
```

后端 `diffFile(path, base)` 按 kind 组装：
- `unstaged` → `git diff -U3 -- <path>`
- `staged` → `git diff --cached -U3 -- <path>`
- `worktree` → `git diff HEAD -U3 -- <path>`
- `range` → `git diff -U3 <from> <to> -- <path>`

**冲突文件（Merge 区点击，R1-3）**：`git diff` 对未合并文件输出 combined 格式（实测 `diff --cc` + `@@@ -1,2 -1,2 +1,6 @@@` 三列头 + 冲突标记），现有 `parse_unified_diff`/`parse_word_groups` 均不适用（word-diff 对这种文件无意义，词级会按冲突标记行解析出垃圾）。Merge 区走专用 `parse_combined_diff`（按 `@@@` 头 + `-`/`+`/` ` 前导解析，渲染冲突段与标记行），**不跑 word-diff**；未解决前跳过 numstat。

**兼容性洞察**：用户从不 stage 时 index==HEAD，`unstaged` 与 `worktree` 输出完全相同 → 老用户无感，新语义不破坏笔记场景。

### 4.2 词级 diff / renderData 跟随

- `--word-diff=porcelain` 命令加同样的 rev 参数与 `-- path`（修 bug #2 顺带完成）。
- `loadRenderData` 旧版本来源：
  - `unstaged` → `git show :path`（index blob）
  - `staged` → `git show HEAD:path`
  - `worktree` / `range` → 不变
  - 未跟踪文件 `unstaged` → 旧版为空文档（现有降级逻辑保留）

### 4.3 discard 语义（VSCode 对齐）

| 操作 | 语义 | 命令 |
|---|---|---|
| Changes 区「放弃更改」 | worktree ← index | `git checkout -- <path>`；未跟踪 → 删文件 |
| Changes 区 hunk 还原 | 只回滚该 hunk（worktree 层） | `git diff -U3 -- path` 提取 hunk + `git apply --reverse` |
| Staged 区「取消暂存」 | index ← HEAD（**不碰 worktree**） | `git reset -q HEAD -- <path>` |
| Staged 区「还原到 HEAD」（R1） | index ← HEAD **且** worktree ← HEAD（清掉所有层改动） | `git reset -q HEAD -- <path>` + `git checkout -- <path>`（`revertToHead`） |

危险确认：放弃更改（文件级/hunk 级）与**还原到 HEAD**（清 worktree + staged，破坏性）保留现有 ConfirmDialog；**取消暂存不确认**（无破坏性，VSCode 也不确认）。

## 5. 组件与交互细节

### 5.1 状态条（①）

- 分支名（`ⓘ main`）：点击 → **分支切换器**（§5.6）；无 upstream 不显示同步图标；detached 显示 `(分离 HEAD)`。
- ahead/behind：`↑2 ↓1`（有 upstream 且非 0 才显示；任一为 0 只显示另一个）。
- 同步按钮 `⟳`：`pull` 成功后自动 `push`（VSCode sync 语义）；无 remote 隐藏。
- 刷新按钮保留。
- 「⋯更多」菜单：拉取 / 推送 / 获取(fetch) / 输入框：上一次提交消息。分支操作（新建/删除/重命名）不在菜单里重复，统一收敛在 BranchPicker（§5.6）。

### 5.2 提交输入框 + 按钮（②③）

- `textarea`，1–4 行自适应，placeholder「提交消息（Ctrl+Enter 提交）」；Enter=换行，Ctrl/Cmd+Enter=提交（面板内全局监听）。
- 提交按钮右侧 `▾` 下拉：**提交** / **提交并推送**（无 remote 隐藏）/ **修改上一提交**（amend，需确认 + 消息预填上一提交 message）。
- 提交逻辑：
  0. **（R1-1）先保存所有 dirty tab**（复用 saveTab；commit 操作的是磁盘状态，编辑器未保存内容不在 git 视野内——不保存会导致「提交了磁盘旧版、编辑器仍挂未保存标记」，用户以为内容丢了）；
  1. 消息空 → toast「请输入提交消息」，聚焦输入框；
  2. 无 staged 且有 unstaged → ConfirmDialog「没有暂存的更改。是否暂存全部更改并提交？」（**已确认：默认弹确认**，不走静默 stage-all）；确认 → stage 全部后提交；
  3. 无任何更改 → toast；
  4. 成功 → toast「已提交 abc1234」、清空输入框、`refreshGitPanel()`、历史区置顶展开新提交；**联动清单（R1 补齐）**：`clearGitMark()` → `applyGitMark(status)` 重打角标（只 apply 不清旧标会残留）；已打开的 diff tab 若 base 涉及已提交文件 → 标记过期或重拉；历史区滚动置顶；
  5. git 报「身份未配置」→ toast 提示「请在 git 中配置 user.name/user.email」（不在应用内做配置项，Phase 6 再议）。
- amend 的 `stageAll` 组合：确认文案「将把当前全部暂存内容并入上一提交，历史不可见地改写」。
- **amend 已推送提交（R1-1）**：输入框置灰提示「该提交已推送，修改并推送需强制推送」；确认文案追加「若已推送到远程，后续推送将使用 force-with-lease」。实现：amend 后若该提交有 upstream，`push` 路径改走 `git push --force-with-lease`（危险 confirm 后执行；无 remote 无影响）。普通 push 会 non-fast-forward 被拒（实测）。

### 5.3 分区与文件行（④⑤）

**分区头**：`▾ 更改 · N` + 右侧 hover 按钮（`＋全部暂存` / `−全部取消暂存`，当前区适用才显示）。折叠状态 localStorage 记忆（扩展现有 SECTIONS_KEY）。

**文件行（新组件 `ScmFileRow.vue`，替代 GitChangeTree 的文件行职责）**：

```
[M] 会议纪要.md        笔记/    +2 −1   (↩)(⋯)
 ↑状态   ↑basename    ↑dim目录  ↑统计   ↑hover 行内按钮
```

- 状态字母色块沿用现有色板（M 橙 / A 绿 / D 红 / ? 灰 / U 紫红 / R 蓝紫），R 显示 `旧名 → 新名`（title 提示全路径对）。
- 点击行 = 打开该区对应语义的 diff（§4.1）+ `revealInTree`（现有联动保留）。
- **hover 行内按钮**（VSCode 顺序）：
  - Changes 区：`放弃更改 ↩`（danger 色，confirm）、`暂存 ＋`、`打开文件`（小图标）；
  - Staged 区：`取消暂存 －`；
  - Merge 区：`标记已解决 ✓`（= stage）；`用当前版本`/`用对方版本`（= `resolveMerge` ours/theirs：`--ours`=当前分支 HEAD 侧、`--theirs`=被合入分支侧；**待 §11 拍板**，未采纳则仅保留 ✓ 与 combined-diff 查看）。
- 行内按钮 12px，仅 hover 显示（现有 `.actions` 模式）。
- 目录路径显示 `dirname(path)`，dim 色，右对齐在文件名后（VSCode 布局：名称左、目录右侧灰字）。树形模式下目录聚合逻辑复用 `buildChangeTree`。

### 5.4 右键菜单（GitFileContextMenu）

新建独立菜单（不复用文件树 `ContextMenu.vue`——它绑死 fs 语义；但复用其视觉样式与 Teleport 模式）。state 加 `scmMenu: null | { x, y, target: { section: 'staged'|'changes'|'merge', path: string } }`。

菜单项（按区动态）：

| 项 | 说明 |
|---|---|
| 打开文件 | openTab（现有） |
| 打开更改 | openGitDiff（该区语义） |
| 暂存 / 取消暂存 | 按 section |
| 放弃更改 | 仅 Changes 区，danger + confirm |
| 用当前/对方版本解决 | 仅 Merge 区（`resolveMerge` ours/theirs，待 §11 拍板） |
| 忽略（.gitignore） | 仅 `?` 状态；ignore 后刷新 |
| 复制路径 | clipboard |
| 在文件管理器中显示 | 现有 revealInExplorer |

### 5.5 键盘

- `Ctrl+Enter` 提交（面板聚焦时）；输入框内自动。
- 文件行 `Enter` 打开 diff（Tab 可聚焦行，补 `tabindex`/`role="treeitem"` 基本可达性）。
- 现有 `F7/Esc` diff 内导航不变。

### 5.6 分支切换器（BranchPicker.vue）——分支功能的唯一入口

面板中**不再有常驻分支区块**（原分支列表区块移除，含其搜索框），分支能力收敛为一个入口：状态条的分支按钮。

- 点击状态条分支名（`ⓘ main`）→ Teleport 弹层（复用 contextmenu 视觉），结构：
  - 顶部搜索框（原面板 branchQuery 逻辑迁入，防抖 150ms；Esc 清空）
  - 本地分支列表（当前分支高亮 `●`，其余 `○`；hover 显示 `⇄ 切换`）
  - 远程分支分组（`origin/*`，`⚑`；点击 = 取对应短名 `git checkout <短名>`（git DWIM 自动建跟踪分支），仅存在于该远程时直接 checkout 全名）
  - 底部固定操作行：`＋ 新建分支…`（PromptDialog 输入名字，从当前 HEAD 创建并切换）
- 行尾 ⋯（或右键）：重命名 / 删除（非当前分支；删除 danger confirm）。
- 分支列表数据**打开弹层时调 `git.branches()` 现取**（面板加载不再拉分支列表，减少常驻开销）；打开后自动聚焦搜索框。
- `Esc` / 点击遮罩关闭。
- 切换流程复用现有 `switchGitBranch`（dirty 确认 + 关闭旧分支标签 + 刷新）。
- 原「分支点击 = 过滤历史」交互废弃（分支过滤需求弱；看其他分支历史 → 切过去即可，历史区默认当前分支）。
- detached HEAD 显示 `(分离 HEAD)`，点击弹层仍可用（提示当前无分支）。

### 5.7 新增基础组件

- **PromptDialog.vue**：单行文本输入弹窗（复用 ConfirmDialog 骨架：store 加 `prompt: null | { title, placeholder, value, resolve }`），用于分支名等。
- **ScmFileRow.vue**、**BranchPicker.vue**（见上）。
- MenuIcon 需新增：`stage(＋) / unstage(－) / discard(↩) / sync(⟳⇅) / check(✓)`；Phase 1–2 先用文本符号（现有代码风格大量使用 ▸⇄✕ 文本符），Phase 6 统一补三套图标集（line/soft/gradient）。

## 6. 同步（fetch/pull/push）细节

- `aheadBehind`：`git rev-list --left-right --count @{upstream}...HEAD`（无 upstream → null，UI 隐藏 sync）。**输出左=behind、右=ahead**（左列 = upstream 独有提交数，右列 = HEAD 独有），映射为 `{ ahead: 右, behind: 左 }`，勿做反。
- 时机：面板加载 / 提交后 / 手动刷新时**本地计算**（**已确认：不自动网络 fetch**；fetch 仅发生在用户点 sync 或菜单「拉取(fetch)」时）。离线安全。
- sync：`pull` → 成功 → `push` → 刷新；pull 冲突（diverged）→ 错误原文 toast + 建议菜单里手动处理（merge/rebase 不做 UI，Phase 6 再议）。
- push 首次（无 upstream）→ `git push -u origin <branch>`。

## 7. mock 后端演示支持

`mock.ts` 实现内存版：`stage`（status 的 XY 码搬移 Y→X）、`unstage`（X→Y）、`commit`（log 头部插入新提交 + 清空 staged + worktree 快照提升为 v2）、`discardWorktree`/`revertToHead`（现有逻辑/组合）、sync/createBranch 等返回空操作或演示数据。**演示集必须覆盖（R1）**：① 一个「双态文件」（X=M, Y=M，两区同时显示且各显各自增量）；② 一个 staged-only（X=M, Y=' '）；③ 至少一次 rename（`renameFrom` 展示「旧 → 新」，并验证 -z 顺序非反）。演示仓库价值 = 无桌面环境验证 UI 全流程，语义保真即可，不做严格 git 模拟。

## 8. 边界与降级

| 场景 | 行为 |
|---|---|
| 浏览器 web 模式 | 现状不变：面板显示「不可用」 |
| 非 git 仓库 | 现状不变 |
| 合并冲突（U/AA/DD，R1-2） | 「合并更改」分组 + 行内「标记已解决（stage）」；**冲突判定 = 任一码含 U ∪ {(A,A),(D,D)}**；点击文件走 combined-diff 专用解析（R1-3：`@@@` 三列头 + 冲突段，不跑 word-diff/numstat）；不内置冲突编辑器（用户手改）；ours/theirs 快捷解决待 §11 拍板 |
| detached HEAD | 分支显示 `(分离)`；提交允许；切换器可用 |
| 首次提交仓库（无 HEAD） | `unstage` 用 `git reset -q HEAD --`（实测无 HEAD 同样可用，**无需** `git rm --cached` 特判，见 §2.2）；diff 语义退化为 staged=`--cached` vs 空树 |
| 大量改动（>500 文件） | 不虚拟滚动（笔记仓库规模），仅 toast 提示统计 |
| `.gitignore` 不存在 | `ignore()` 创建之（fs 层已有能力） |
| git 可执行文件缺失 | run_git 报错原文透传 toast（现状） |

## 9. 实施阶段（每阶段独立可交付、可演示）

| Phase | 内容 | 交付物 |
|---|---|---|
| **0** | §0 六项 bug 修复（quotepath / word-diff 路径 / untracked diff / U0-U3 错位 / discardFile 未跟踪 / **rename 方向 + numstat 花括号解析**）+ 防御测试（Rust 单测补 rename -z 顺序、numstat 花括号、combined diff 解析） | 现有面板正确性 |
| **1** | 数据层：XY 双码 status + 双 numstat + `stage/unstage/discardWorktree/revertToHead/commit` 三后端 + 单测（Rust `git_parse_tests` 扩展 + dev-repo 桩）+ **三后端对拍（R1-4）**：同一场景序列（stage→编辑→numstat→hunk-discard→conflict）在 dev（真实仓库）跑一遍、Rust 集成测试跑同命令串，断言输出一致 | 后端能力就绪，UI 不变 |
| **2** | UI 骨架：状态条/提交输入框（顶部）/三分区/ScmFileRow/hover 行内按钮/DiffBase 语义重构（§4，含 manager.ts 改造）/右键菜单/**移除常驻分支区块**；Merge 区 combined-diff 视图（R1-3） | 核心复刻完成 |
| **3** | 提交流程完整化（**R1-1：提交/amend 前保存全部 dirty tab**、smart commit 确认、amend + 已推送 force-with-lease 守卫、提交后联动清单：清角标→重 apply / open diff 失效 / 历史置顶）+ 刷新联动（角标在非 git tab 也刷新） | 可日用 |
| **4** | 同步：fetch/pull/push/ahead-behind（**左 behind 右 ahead 映射**）/sync 按钮/无 remote 降级 | 远程仓库可用 |
| **5** | 分支管理：BranchPicker（切换/搜索/新建/删除/重命名）/PromptDialog | 分支操作完整 |
| **6** | 增强项：菜单收纳（⋯）、gitignore 入口、图标三套补齐、多选批量操作、**stash（若 §11 拍板提前则并入 Phase 3.5）**、merge/rebase 辅助（另立设计） | 打磨 |

## 10. 受影响文件清单（实施索引）

| 文件 | 改动 |
|---|---|
| `src/git/types.ts` | GitFileStatus XY 双码 / DiffBase 重构 / 新接口类型 |
| `src/git/index.ts` | GitBackend 扩展 + Proxy 透传新方法 |
| `src/git/mock.ts` | 新接口内存实现（§7） |
| `src/git/dev.ts` | 新接口转发 `/__repo/git/*` |
| `vite-plugins/dev-repo.ts` | 新 action + status 双码/双 numstat + Phase 0 修复（含 #6 rename 方向/numstat 花括号、combined diff 解析）+ 对拍测试参考实现 |
| `src-tauri/src/lib.rs` | 新 git_* 命令 + status 双码/双 numstat + Phase 0 修复（含 `run_git` quotepath、#6、`parse_combined_diff`） |
| `src/state/store.ts` | GitPanelState 重构 + scmMenu/prompt state |
| `src/components/GitPanel.vue` | 重写为 SCM 布局（状态条/输入框/三分区/历史） |
| `src/components/ScmFileRow.vue`（新） | 文件行（行内操作） |
| `src/components/BranchPicker.vue`（新） | 分支切换器 |
| `src/components/PromptDialog.vue`（新） | 文本输入弹窗 |
| `src/components/GitFileContextMenu.vue`（新） | SCM 右键菜单 |
| `src/components/GitChangeTree.vue` | 保留树形模式复用；文件行职责迁移到 ScmFileRow |
| `src/editor/manager.ts` | openGitDiff/loadRenderData/discard 系列适配 DiffBase 语义；switchGitBranch 保留 |
| `src/git/mark.ts` / `FileTree.vue` | 角标数据源适配双码（status 兼容字段不变则几乎不动） |

## 11. 明确不做（本期）

- rebase 交互式 UI、cherry-pick、stash 管理界面（VSCode 也非默认可见）
- 提交内 diff 的多文件批量 staging（hunk 级 stage，VSCode 有——依赖 hunk→stage 映射，复杂度高，另立设计）
- 图形化 merge 冲突解决器（但「用当前/对方版本」快捷解决成本极低，见 11.1）
- 子模块支持

### 11.1 R1 待拍板建议（评审提出，未并入契约；拍板后转正并回填 §2.2/§5.3/§5.4/§9）

> 说明：**revertToHead（staged 区「还原到 HEAD」）已确认并入 Phase 3**（§2.2/§4.3 已定稿），此处仅留档；下表两项待拍板。

| 建议 | 价值 | 成本 | 建议落点 |
|---|---|---|---|
| **stash 提前**：Phase 6 已列 stash 管理界面，但分支切换 dirty 场景（§5.6 确认流程）直接受益——切分支前「暂存改动」一步到位，否则用户只能选提交/丢弃 | 高（笔记用户高频换分支） | 低（`git stash push -u` 存 + 恢复列表：一条读 + 一条写接口） | Phase 3.5 或随 Phase 5 分支功能 |
| **合并快捷解决** `resolveMerge`（ours/theirs）：§2.2/§5.3/§5.4 已预留接口与按钮位 | 高（非 git 用户遇冲突高频诉求 = 要哪边；AA/DD 冲突收录后场景更多） | 极低（每条 `git checkout --ours/--theirs`） | Phase 2 Merge 分组顺手带出 |
