可以直接进入 **GO 后的正式实施阶段**。

我看过当前仓库后，最先应该改的确实不是代码，而是**仓库认知结构**。现在根 `AGENTS.md` 仍然告诉 Pi “`editor-app` 是开发主线”，并长期携带 Crepe、ego-lite、旧调试钩子和大量旧架构踩坑；这会和我们刚刚确定的 v2 方向正面冲突。([GitHub][1]) 当前根 README 也仍然把 Crepe/每标签实例描述为主架构。([GitHub][2])

我建议新实现目录正式定名为 **`writeit-v2/`**。暂时**不要移动 `editor-app/`**：它是价值很高的 legacy reference，可以查行为、测试、fixture 和算法，但 v2 **绝不能 runtime import 它**。这样既保留你已经投入的工作，也避免把旧架构拖进新核心。

下面两份可以直接落仓库。

# WriteIt — Agent Instructions

## 项目主线

当前正式开发主线是：

`writeit-v2/`

它是基于 **Markdown-first + CodeMirror 6** 的新一代 WriteIt。

`editor-app/` 是旧版实现，只作为：

* 行为参考
* 需求参考
* fixture / 测试案例参考
* 已解决问题与边界案例参考

除用户明确要求修复旧版外，不再向 `editor-app/` 增加新架构或新功能。

---

## 开始任务前

处理 v2 任务时先读：

1. `writeit-v2/docs/IMPLEMENTATION_SPEC.md`
2. `writeit-v2/docs/STATUS.md`
3. 当前任务涉及的 ADR / feature spec
4. `LEGACY_FEATURE_MAP.md` 中对应旧实现位置（如需要）

不要为了“了解项目”无目的遍历整个 `editor-app/`。

---

## 核心架构不变量

以下规则不得通过局部实现绕过：

1. **Markdown 是长期数据合同。**
2. **DocumentStore 是运行时 Document 内容权威。**
3. 同一 Document 只有一份权威 Markdown + revision。
4. CM6 EditorView、Embed、Diff View 等都是 Projection，不拥有第二份权威内容。
5. 不认识的 Markdown 可以降级为普通文本，但不能因为打开/保存而丢失。
6. Rich Preview 失败只能降级显示，不能损坏 Markdown。
7. Git Diff 的保证层直接比较 Markdown source；语义渲染只能增强，不能吞掉变化。
8. `writeit-v2/` 禁止 runtime import `editor-app/`。
9. Core/domain 代码禁止依赖 Vue、DOM、CodeMirror、Tauri。
10. 不用 timeout/sleep 作为状态同步协议。

如果实现需要违反上述规则，停止实现并把问题升级为架构决策。

---

## 新旧代码边界

### `writeit-v2/`

可正常修改，是当前开发主线。

### `editor-app/`

Legacy reference。

允许读取和研究。

如果旧代码中有值得复用的算法：

* 优先提炼行为和测试；
* 可以复制小型纯逻辑实现；
* 不允许通过跨目录 import 形成运行时依赖；
* 在 `LEGACY_FEATURE_MAP.md` 记录来源和处理方式。

### `raw/`

只读，不修改、移动或删除。

### `wiki/`

仅知识库任务时处理；普通 v2 开发不要维护。

### `.pi/`

Pi 项目级工具、skills、prompts。

现有 `writeit-debug` 面向 legacy `editor-app`，不要假定其协议适用于 v2。

---

## 工作方式

* 与用户使用中文交流。
* 一次只执行 SPEC 中一个明确 Task ID，除非用户明确要求批量执行。
* 修改前先检查相关实现、测试和当前 `git status`。
* 不覆盖或回滚用户已有未提交修改。
* 不因为顺手而扩展任务范围。
* 架构决策必须通过 ADR，而不是藏在实现代码里。
* 发现旧版行为与 SPEC 冲突时，以 v2 SPEC / ADR 为准，并记录差异。

完成任务时报告：

* 修改了什么
* 为什么
* 运行了哪些验证
* 测试结果
* 尚存风险
* 下一建议 Task ID

除非用户明确要求，不自动提交 Git commit。

---

## 测试原则

v2 不继承旧版“所有业务依赖 ego-lite E2E”的模式。

优先顺序：

1. pure unit tests
2. integration tests
3. browser integration
4. 少量关键 E2E

Document、revision、reference graph、table core、diff guarantee、validation 等业务规则必须尽量脱离浏览器测试。

真实浏览器只验证必须依赖浏览器的：

* IME
* clipboard
* focus
* DOM/widget lifecycle
* 浏览器级快捷键
* 关键用户旅程

任何测试失败都不允许通过单纯增加固定等待时间掩盖。

---

## 验证

对 `writeit-v2/` 做修改后，至少执行与任务相关的：

```bash
cd writeit-v2

npm run test
npm run typecheck
npm run build
```

需要浏览器行为时再运行 browser/E2E suite。

不要因为修改 v2 而默认运行旧 `editor-app` 的完整 ego-lite E2E。

---

## Legacy 修改

如果任务明确要求修改 `editor-app/`，先阅读：

`editor-app/AGENTS.md`

其中保存旧版 Crepe / ego-lite / debug 等专用规则。

不要把这些 legacy 规则重新写回根 `AGENTS.md`。

这个版本的核心目的是让根 `AGENTS.md` 只留下**长期稳定、不应该忘记的约束**。这和 Pi 的设计非常契合：Pi 会持续加载项目 `AGENTS.md`，而 Skills/其他文档适合按需读取。([GitHub][3])

下面是正式实施 SPEC。

# WriteIt v2 — Target Architecture & Migration SPEC

Status: **ACCEPTED FOR IMPLEMENTATION**

Architecture Gate:

`CM6 Architecture Spike = GO`

---

# 1. 项目目标

在当前 WriteIt 仓库中新建：

```text
writeit-v2/
```

实施下一代 WriteIt。

新版本不是对 `editor-app/` 做持续重构，而是在同一仓库内建立新的架构边界，并逐步从旧项目吸收已经验证的：

* 产品行为
* 用户体验
* fixture
* 边界案例
* 测试知识
* 可复用纯算法

最终目标不是“把旧代码翻译成 CM6”。

目标是：

> 在保留 WriteIt 已有产品价值的前提下，重新建立清晰的数据所有权、模块职责、测试边界和可诊断架构。

---

# 2. 核心技术方向

当前接受的基础方向：

```text
Vue 3
TypeScript
Vite

CodeMirror 6
Markdown-first

Vitest
Playwright（少量 browser integration / E2E）

Tauri 2
后期通过 Platform Adapter 接入
```

v2 不引入：

```text
Milkdown
Crepe
ProseMirror
ego-lite
```

作为核心依赖。

Legacy `editor-app/` 可以继续保留这些依赖。

---

# 3. 核心领域原则

## 3.1 Persistent Contract

Markdown 文件是长期数据合同。

WriteIt 必须与：

* Git
* 外部文本编辑器
* 其他 Markdown 软件

保持良好互操作。

---

## 3.2 Runtime Authority

运行期间：

```text
DocumentStore
```

是 Document 内容权威。

概念模型：

```ts
Document {
  id
  path
  markdown
  revision
  persistedRevision
}
```

实际类型可以演进，但语义不得改变。

---

## 3.3 Projection

以下都是 Projection：

```text
主编辑器
Embed editor
只读 Preview
Diff View
Mermaid Preview
Table Widget
```

Projection 可以拥有：

* selection
* focus
* DOM
* editor state
* displayedRevision
* scroll state

但不能成为保存数据时的权威来源。

---

# 4. Target Architecture

目标依赖方向：

```text
                     UI
                     │
                     ▼
               Application
                     │
                     ▼
                   Core
              ┌──────┼──────┐
              │      │      │
              ▼      ▼      ▼
           Editor    FS     Git
           Adapter  Adapter Adapter
```

核心原则：

```text
Core 不知道 CM6
Core 不知道 Vue
Core 不知道 Tauri
Core 不知道 DOM
```

---

# 5. 推荐目录

```text
writeit-v2/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md
│
├── docs/
│   ├── IMPLEMENTATION_SPEC.md
│   ├── STATUS.md
│   ├── REPOSITORY_INVENTORY.md
│   ├── LEGACY_FEATURE_MAP.md
│   ├── GLOSSARY.md
│   │
│   └── adr/
│       ├── 0001-markdown-contract.md
│       ├── 0002-document-authority.md
│       ├── 0003-editor-projections.md
│       ├── 0004-codemirror-primary-editor.md
│       ├── 0005-table-engine.md
│       └── 0006-diff-guarantee.md
│
├── src/
│   ├── core/
│   │   ├── document/
│   │   ├── reference/
│   │   ├── table/
│   │   ├── annotation/
│   │   ├── diff/
│   │   └── validation/
│   │
│   ├── application/
│   │   ├── commands/
│   │   ├── queries/
│   │   └── events/
│   │
│   ├── editor/
│   │   └── cm6/
│   │       ├── extensions/
│   │       ├── widgets/
│   │       └── projection/
│   │
│   ├── platform/
│   │   ├── filesystem/
│   │   ├── git/
│   │   ├── export/
│   │   └── tauri/
│   │
│   ├── observability/
│   │   ├── events/
│   │   ├── diagnostics/
│   │   └── debug/
│   │
│   └── ui/
│       ├── workspace/
│       ├── editor/
│       ├── review/
│       └── components/
│
└── tests/
    ├── unit/
    ├── integration/
    ├── browser/
    ├── e2e/
    └── fixtures/
```

目录可以根据实际代码适度调整。

禁止为了匹配此树而创建大量空目录。

---

# 6. Legacy Dependency Rule

`editor-app/` 是 reference implementation，不是依赖库。

禁止：

```ts
import { something } from "../../editor-app/src/..."
```

允许：

1. 阅读旧实现。
2. 提取需求。
3. 提取 fixture。
4. 提取测试场景。
5. 复制小型、纯逻辑、无旧架构依赖的算法。
6. 在 v2 中重新实现。

复制旧代码时必须回答：

```text
它属于哪个新边界？
它是否仍携带旧状态模型？
它能否脱离旧 editor manager 工作？
有没有测试证明行为？
```

不能为了“减少工作量”把旧 manager / registry / Crepe 上下文整体搬进来。

---

# 7. Phase 0 — Repository Reset

这是正式实施的第一阶段。

**Phase 0 不实现产品功能。**

目标：

> 先让人和 Pi 都能明确知道仓库里哪些是新世界、哪些是旧世界、哪些只是资料。

---

## P0-01 — Repository Inventory

只调查，不搬动代码。

生成：

```text
writeit-v2/docs/REPOSITORY_INVENTORY.md
```

记录当前顶层：

```text
editor-app/
raw/
wiki/
.pi/
.workbuddy/
.github/
README.md
AGENTS.md
KB.md
其他实际存在文件
```

每个目录标记：

```text
ACTIVE-V2
LEGACY
REFERENCE
TOOLING
KNOWLEDGE
GENERATED
CANDIDATE-REMOVE
```

同时调查：

* 是否有重复 skill；
* 是否有废弃 docs；
* 是否存在已生成但被提交的产物；
* `.workbuddy` 当前是否仍被任何工具引用；
* `.pi` 哪些资源是 legacy 专用；
* README 中哪些描述已经过时。

### 验收

不得因为“看起来没用”直接删除文件。

先形成 inventory。

---

# 8. P0-02 — Agent Context Split

替换根：

```text
AGENTS.md
```

为精简版本。

把当前只适用于旧应用的：

* Crepe 经验
* ego-lite 规则
  -旧 debug hooks
  -旧 manager 特殊约定

移动至：

```text
editor-app/AGENTS.md
```

这一步是“移动知识”，不是删除知识。

### 验收

根 `AGENTS.md`：

* 不再宣称 `editor-app` 是主线；
* 不包含 Crepe 实现细节；
* 不包含 ego-lite 详细踩坑；
* 明确 `writeit-v2/` 为主线。

---

# 9. P0-03 — Pi Workflow

建立：

```text
.pi/prompts/v2-task.md
.pi/prompts/v2-status.md
```

## `v2-task`

用户以后可以：

```text
/v2-task P2-03
```

它应该提示 Pi：

1. 阅读根 `AGENTS.md`。
2. 阅读 `IMPLEMENTATION_SPEC.md`。
3. 阅读 `STATUS.md`。
4. 找到 Task ID。
5. 只执行该 Task。
6. 运行规定验证。
7. 更新 STATUS。
8. 汇报修改、测试、风险。
9. 不自动开始下一个 Task。

推荐模板逻辑：

```text
执行 WriteIt v2 任务 $1。

先读取：
@AGENTS.md
@writeit-v2/docs/IMPLEMENTATION_SPEC.md
@writeit-v2/docs/STATUS.md

只执行 $1，不自动扩展到后续任务。

如需参考 legacy，先从 LEGACY_FEATURE_MAP 找对应文件，
不要无目的遍历 editor-app。

完成后运行该任务要求的验证，
更新 STATUS.md，并汇报：
files changed / tests / risks / next task。
```

---

# 10. P0-04 — Legacy Feature Map

生成：

```text
LEGACY_FEATURE_MAP.md
```

至少盘点：

| Capability     | Legacy Location             | v2 Owner                | Strategy       |
| -------------- | --------------------------- | ----------------------- | -------------- |
| FileSystem     | editor-app/src/fs           | platform/fs             | REUSE DESIGN   |
| Document state | editor/manager + docstore   | core/document           | REWRITE        |
| Multi tabs     | state + manager             | ui/application          | REDESIGN       |
| References     | editor/ref                  | core/reference          | REWRITE        |
| Editable Embed | manager/ref                 | projection              | REWRITE        |
| Table          | editor/table                | core/table + CM6 widget | PARTIAL REUSE  |
| Annotation     | annotations + editor plugin | core/annotation         | REDESIGN       |
| Mermaid        | editor/mermaid              | CM6 widget              | PARTIAL REUSE  |
| Diff           | editor/diff                 | core/diff + review UI   | REWRITE        |
| Git            | git                         | platform/git            | REUSE BOUNDARY |
| Validation     | validate                    | core/validation         | PARTIAL REUSE  |
| Template       | template                    | feature/application     | REVIEW         |
| Search         | search                      | index/search            | REVIEW         |
| Outline        | editor/outline              | index                   | REWRITE        |
| Export         | export                      | platform/export         | REVIEW         |
| Diagnostics    | diagnostics/debug           | observability           | REDESIGN       |
| Themes         | UI                          | UI                      | DEFER/PORT     |

每项必须记录：

```text
KEEP BEHAVIOR
COPY PURE CODE
REWRITE
DROP
DEFER
```

---

# 11. P0-05 — Safe Cleanup

完成 Inventory 后才允许清理。

原则：

### 不移动

```text
editor-app/
raw/
wiki/
```

原因：

大规模移动产生 Git 噪音，却没有架构收益。

### 可以处理

* 已确认无引用的重复工具目录；
* 明确生成产物；
* 已失效的 README 描述；
* AGENT / AGENTS 名称错误引用；
* obsolete docs。

删除前用：

```bash
rg "<filename|dirname>" .
git log -- <path>
```

确认用途。

不确定则保留并标记。

---

# 12. P0 Exit Criteria

Phase 0 完成必须满足：

```text
writeit-v2/
docs/IMPLEMENTATION_SPEC.md
docs/STATUS.md
docs/REPOSITORY_INVENTORY.md
docs/LEGACY_FEATURE_MAP.md

根 AGENTS.md 已精简
editor-app/AGENTS.md 已建立
Pi v2 task prompt 可用
根 README 明确 v1/v2 状态
```

然后才允许开始 Core。

---

# 13. ADR Initial Set

Phase 0 建立以下 ADR。

## ADR-0001

**Markdown Is The Persistent Data Contract**

Status: Accepted

---

## ADR-0002

**DocumentStore Is Runtime Content Authority**

Status: Accepted

---

## ADR-0003

**Editor Views Are Projections**

Status: Accepted

---

## ADR-0004

**CodeMirror 6 Is The Primary Editor Architecture**

Status: Accepted

Spike result: GO.

---

## ADR-0005

**Markdown Table Uses WriteIt Table Core + CM6 Widget**

Status: Accepted

---

## ADR-0006

**Diff Guarantee Layer Operates On Markdown Source**

Status: Accepted

---

# 14. Phase 1 — Foundation

目标：

> 建立与 UI 和 CM6 无关的 Document 世界。

---

## P1-01 — Document types

实现：

```text
DocumentId
DocumentPath
Revision
DocumentSnapshot
DocumentState
```

---

## P1-02 — DocumentStore

支持：

```text
load
get
applyChange
subscribe
revision
dirty state
persistedRevision
```

要求：

所有 source mutation 有明确 origin。

---

## P1-03 — History

建立 per-document history。

必须证明：

```text
A Tab
B→A
C→A
```

可以操作同一 Document history。

---

## P1-04 — Event Timeline

从第一天建立：

```text
DocumentLoaded
DocumentChanged
DocumentPersisted
ProjectionAttached
ProjectionUpdated
ProjectionDetached
ProjectionStale
```

不要求复杂 Event Sourcing。

只是建立可观察事实。

---

## P1-05 — Persistence Port

定义：

```ts
FileSystemPort
```

Core 不知道：

```text
Tauri
FileSystemAccess API
localStorage
```

先实现：

```text
MemoryFileSystem
```

用于测试。

---

# 15. Phase 2 — CM6 Editor Surface

目标：

```text
DocumentStore
      ↕
CM6 Projection
```

---

## P2-01

单 Document / 单 View。

---

## P2-02

user transaction → DocumentStore。

---

## P2-03

DocumentStore update → Projection。

必须使用 origin/storeSync 防回环。

---

## P2-04

multi-view same document。

---

## P2-05

projection revision / stale detection。

---

## P2-06

基础 Live Preview：

* emphasis
* headings
* links

未知语法不增强即可。

---

# 16. Phase 3 — Workspace + Persistence

建立真正可以工作的最小 WriteIt：

```text
打开 workspace
→ 文件树
→ 打开 Markdown
→ tab
→ 编辑
→ save
→ close
→ reopen
```

优先使用浏览器/mock backend。

Tauri 暂缓。

这一阶段必须实现：

```text
external file change
dirty
save conflict
rename
delete
```

但逻辑进入 application/platform，不进入 CM6 extension。

---

# 17. Phase 4 — Reference Graph + Embed

建立：

```text
[[A.md]]
[[A.md#Heading]]
![[A.md]]
```

核心：

```text
ReferenceParser
ReferenceIndex
ReferenceGraph
EmbedProjection
```

必须重新覆盖 CM6 Spike 中：

```text
multi projection
nested
circular
revision
undo
close/reopen
stale
lifecycle
```

Spike 是证据，不是生产代码正确性的替代品。

---

# 18. Phase 5 — Table Engine

正式迁移 Spike Table。

核心结构：

```text
core/table/
  parser
  serializer
  model
  selection
  operations
  clipboard

editor/cm6/widgets/table/
```

必须保持：

```text
table-core 不依赖 CM6
```

Markdown 修改限制在：

```text
当前 table region
```

禁止因为编辑一个 cell 重写整个文件。

---

# 19. Phase 6 — Annotation + Mermaid

## Annotation

Domain：

```text
Annotation
Thread
RangeAnchor
ResolvedState
```

Projection：

```text
CM6 Decoration
```

不要让 CM6 decoration 本身成为 annotation 数据。

---

## Mermaid

结构：

```text
Markdown fence
     ↓
Mermaid Projection
```

源码始终存在。

Renderer 出错时：

```text
fallback to source
```

---

# 20. Phase 7 — Git + Diff

这是 v2 的核心产品能力之一。

必须分三层：

```text
Raw Diff
   ↓
Semantic Enhancement
   ↓
Renderer
```

## Guarantee invariant

每一个 raw change：

必须至少存在：

```text
Raw representation
```

语义增强可以：

```text
Table Diff
Mermaid Diff
Embed Diff
```

但 enhancement failure 不允许删除 raw change。

建议建立：

```text
rawChangeCount
representedChangeCount
degradedChangeCount
```

Diagnostics 可以展示：

```text
18/18 changes represented
2 degraded to source diff
```

---

# 21. Phase 8 — Derived Services

以下能力全部理解为 Document 的派生结果：

```text
Outline
Search
Backlinks
Validation
Template rules
Suggestions
```

原则：

> 不允许为了这些功能把额外数据模型升级为第二 Document authority。

---

# 22. Phase 9 — Export

重新评估旧：

```text
PDF
DOCX
Markdown
export.ts
```

每个 Exporter 通过明确输入工作：

```text
DocumentSnapshot
ExportContext
```

不要抓当前 CM6 DOM 作为唯一输出来源。

---

# 23. Phase 10 — Observability / Diagnostics

这是正式架构组成部分，不是临时 debug code。

至少实现：

```text
Document diagnostics
Projection diagnostics
Event timeline
Error ring
Performance samples
Diff coverage
Reference health
```

Debug Panel 应能回答：

```text
A.md 当前 revision？
persisted revision？
哪些 Projection？
哪些 stale？
最后谁修改？
最后什么时候保存？
```

---

# 24. Pi Debug Integration

等 v2 Diagnostics 稳定以后，再处理现有：

```text
.pi/extensions/writeit-debug
.pi/skills/writeit-debug
```

不要直接把旧协议搬过来。

目标是让未来 Pi 可以调用稳定的**语义诊断 API**：

```text
documents
projections
timeline
diff.health
refs.health
performance
screenshot
```

而不是依赖内部 DOM 或 manager 私有状态。

届时决定：

```text
升级 writeit tool
```

或者建立：

```text
writeit-v2 tool
```

切换前 legacy debug 仍只服务 `editor-app`。

---

# 25. Phase 11 — Tauri

只有 browser architecture 稳定后再接入：

```text
Tauri 2
```

Port：

```text
FileSystem
Git
Window
Dialogs
Export
Diagnostics storage
```

分别实现 adapter。

不要让 Tauri command 直接进入 Document Core。

---

# 26. Phase 12 — Feature Parity Review

把 `LEGACY_FEATURE_MAP.md` 逐项关闭。

每项只能处于：

```text
MIGRATED
REDESIGNED
INTENTIONALLY DROPPED
DEFERRED
```

不能：

```text
UNKNOWN
```

重点检查：

* workspace
* tabs
* save
* source fidelity
* refs
* editable embed
* table
* annotation
* validation
* templates
* Mermaid
* Git
* diff
* search
* outline
* export
* diagnostics
* themes
* keyboard shortcuts
* external file changes

---

# 27. Final Cutover

只有在 v2 已经成为主产品后，才讨论：

```text
editor-app/
```

是否移动为：

```text
legacy/editor-app/
```

在此之前：

**不移动。**

最终是否把：

```text
writeit-v2/
```

重命名为：

```text
editor-app/
```

也是 Cutover Decision，而不是现在决定。

---

# 28. Test Architecture

目标不是追求固定百分比，但大致遵循：

```text
大量 Core Unit
中量 Integration
少量 Browser
极少 E2E
```

---

## Unit

覆盖：

```text
DocumentStore
revision
history
table-core
reference graph
diff guarantee
validation
search/index
```

不创建浏览器。

---

## Integration

覆盖：

```text
DocumentStore + FileSystem
DocumentStore + ReferenceGraph
DocumentStore + Diff
```

---

## Browser

只覆盖：

```text
CM6 transaction
Widget
focus
IME
clipboard
selection
lifecycle
```

---

## E2E

只保留关键旅程，例如：

```text
open → edit → save → reopen
```

```text
B embeds A
→ edit A through B
→ A tab sync
→ save
→ reopen
```

```text
Git change
→ source diff complete
→ semantic enhancement
```

v2 不依赖 ego-lite。

---

# 29. Source Fidelity Gate

建立 permanent golden corpus。

每次重要编辑器修改必须验证：

```text
open
→ no edit
→ save

bytes unchanged
```

以及：

```text
change one word
```

Git Diff 不得出现无关全文 rewrite。

---

# 30. STATUS.md

这是 Pi 实施期间非常重要的短文档。

格式保持简单：

```markdown
# WriteIt v2 Status

Current phase: P2
Current task: P2-03

## Completed
- [x] P0-01
- [x] P0-02
...

## Active
- [ ] P2-03

## Blocked
None

## Recent decisions
- ADR-0004 accepted

## Known risks
- ...

## Next
P2-04
```

不要把 STATUS 写成开发日志。

---

# 31. Pi Task Contract

每个任务应该能够在一次 Pi 工作周期中完成。

Task 必须包含：

```text
Goal
Allowed scope
Read first
Implementation requirements
Tests
Acceptance criteria
Out of scope
```

避免：

```text
“重构整个编辑器”
```

这样的任务。

应该变成：

```text
P4-03 — Multi-projection propagation
```

---

# 32. Pi 的执行纪律

开始任务：

```text
Read
→ Inspect
→ Implement
→ Test
→ Update STATUS
→ Report
```

禁止：

```text
Read SPEC
→ 顺手实现三阶段
```

如果发现设计缺口：

* 小型实现选择：自行选择并记录。
* 会改变 ADR 的选择：停止，提出决策。
* Legacy 行为不清晰：查 `LEGACY_FEATURE_MAP` 和旧测试。
* 不要先问用户“旧代码在哪里”。

---

# 33. 第一批推荐执行顺序

直接按以下顺序交给 Pi：

```text
P0-01 Repository Inventory
P0-02 Agent Context Split
P0-03 Pi Workflow
P0-04 Legacy Feature Map
P0-05 Safe Cleanup
P0-06 Create Initial ADRs
P0-07 Scaffold writeit-v2

P1-01 Document Types
P1-02 DocumentStore
P1-03 Document History
P1-04 Event Timeline
P1-05 FileSystem Port
```

完成 P1 后进行一次 Architecture Review。

不要一口气进入 P2。

---

# 34. 第一个 Pi 指令

完成本 SPEC 与新 AGENTS 落盘之后，建议第一次正式执行：

```text
/v2-task P0-01
```

如果 prompt template 尚未建立，则直接：

```text
读取 @AGENTS.md 和
@writeit-v2/docs/IMPLEMENTATION_SPEC.md。

执行 P0-01 Repository Inventory。

这一任务只调查和生成 REPOSITORY_INVENTORY.md，
不要移动、删除或重构现有代码。

检查真实仓库状态，不根据 SPEC 猜测目录存在性。
完成后汇报发现，但不要自动开始 P0-02。
```

---

# 35. Definition of Success

这次重构最终是否成功，不以：

```text
“CM6 已经替换 Crepe”
```

为标准。

成功标准是：

### 数据

可以明确回答：

> 一份 Document 谁说了算？

---

### 依赖

可以明确回答：

> 为什么 Table 不需要知道 Tauri？

---

### Projection

可以明确回答：

> B 中的 A 为什么不会拥有 A 的副本？

---

### Diff

可以证明：

> Renderer 坏了也不会漏变化。

---

### Debug

可以直接看到：

> 哪个 Document / Projection / revision 出了问题。

---

### Testing

大部分业务 bug：

> 不需要启动完整桌面应用才能复现和验证。

---

### Editor

未来即使有一天：

```text
CM6 → Other Editor
```

也不需要再次重写：

```text
Document
Git
Validation
Reference
Export
Diagnostics
```

达到这些条件，才算这次 WriteIt 架构重构真正完成。

### 关于 Pi，我还建议一个执行习惯

不要把整份 SPEC 每次重新复制给 Pi。Pi 本身支持 `AGENTS.md` 自动上下文、项目级 prompt templates、skills 和 `@文件`引用，非常适合这种长期迁移工程。([GitHub][4])

所以实际使用可以非常简单：

```text
cd writeIt
pi
```

第一次让它执行 **P0-01**。P0-03 完成以后，后面基本就是：

```text
/v2-task P0-02
/v2-task P0-03
...
```

每次只给 Pi 一个有明确完成条件的小任务。这样它即使经历 session 切换或 context compaction，也可以从 `AGENTS.md + STATUS.md + Task ID` 很快恢复，不需要依赖它“记住我们之前聊过什么”。

我尤其建议**不要先整理/搬迁整个 `editor-app`**。第一步只做 Inventory，然后把旧项目冻结成 reference。这样新 v2 从第一天就是干净边界，同时你过去投入的代码、测试和踩坑记录一行也不会浪费。

[1]: https://github.com/humoumou1215/writeIt/blob/master/AGENTS.md "writeIt/AGENTS.md at master · humoumou1215/writeIt · GitHub"
[2]: https://github.com/humoumou1215/writeIt "GitHub - humoumou1215/writeIt · GitHub"
[3]: https://github.com/brahdian/pi_coding_agent/blob/main/packages/coding-agent/docs/quickstart.md?utm_source=chatgpt.com "pi_coding_agent/packages/coding-agent/docs/quickstart.md at main · brahdian/pi_coding_agent · GitHub"
[4]: https://github.com/mudrii/pi-mono-docs/blob/main/04-pi-coding-agent.md?utm_source=chatgpt.com "pi-mono-docs/04-pi-coding-agent.md at main · mudrii/pi-mono-docs · GitHub"
