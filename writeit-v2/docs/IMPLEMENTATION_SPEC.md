# WriteIt v2 — Target Architecture & Migration SPEC

**Status: ACCEPTED FOR IMPLEMENTATION**  
**Architecture Gate: CM6 Architecture Spike = GO**

## 1. 项目目标

在当前仓库新建 `writeit-v2/`，实施下一代 WriteIt。v2 不是对 `editor-app/` 的持续重构，而是在同一仓库内建立新的架构边界，并逐步吸收旧项目已经验证的产品行为、用户体验、fixture、边界案例、测试知识和可复用纯算法。

目标不是把旧代码翻译成 CM6，而是在保留 WriteIt 产品价值的同时，重新建立清晰的数据所有权、模块职责、测试边界和可诊断架构。

## 2. 核心技术方向

- Vue 3
- TypeScript
- Vite
- CodeMirror 6
- Markdown-first
- Vitest
- Playwright（少量 browser integration / E2E）
- Tauri 2（后期通过 Platform Adapter 接入）

v2 核心不引入 Milkdown、Crepe、ProseMirror 或 ego-lite。它们可以继续存在于 legacy `editor-app/`。

## 3. 核心领域原则

### 3.1 Persistent Contract

Markdown 文件是长期数据合同。WriteIt 必须与 Git、外部文本编辑器和其他 Markdown 软件保持良好互操作。

### 3.2 Runtime Authority

运行期间 `DocumentStore` 是 Document 内容权威。概念模型为：

```ts
Document {
  id
  path
  markdown
  revision
  persistedRevision
}
```

实际类型可以演进，但语义不得改变。一个 Document 只有一份权威 Markdown 和 revision，所有 source mutation 都必须有明确 origin。

### 3.3 Projection

主编辑器、Embed editor、只读 Preview、Diff View、Mermaid Preview 和 Table Widget 都是 Projection。Projection 可以拥有 selection、focus、DOM、editor state、displayedRevision 和 scroll state，但不能成为保存数据时的权威来源。

## 4. Target Architecture

依赖方向：

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

Core 不知道 CM6、Vue、Tauri 或 DOM。Core/domain 代码必须保持平台和 UI 无关。

推荐目录：

```text
writeit-v2/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md
├── docs/
│   ├── IMPLEMENTATION_SPEC.md
│   ├── STATUS.md
│   ├── REPOSITORY_INVENTORY.md
│   ├── LEGACY_FEATURE_MAP.md
│   ├── GLOSSARY.md
│   └── adr/
├── src/
│   ├── core/
│   │   ├── document/
│   │   ├── reference/
│   │   ├── table/
│   │   ├── annotation/
│   │   ├── diff/
│   │   └── validation/
│   ├── application/
│   │   ├── commands/
│   │   ├── queries/
│   │   └── events/
│   ├── editor/
│   │   └── cm6/
│   │       ├── extensions/
│   │       ├── widgets/
│   │       └── projection/
│   ├── platform/
│   │   ├── filesystem/
│   │   ├── git/
│   │   ├── export/
│   │   └── tauri/
│   ├── observability/
│   │   ├── events/
│   │   ├── diagnostics/
│   │   └── debug/
│   └── ui/
│       ├── workspace/
│       ├── editor/
│       ├── review/
│       └── components/
└── tests/
    ├── unit/
    ├── integration/
    ├── browser/
    ├── e2e/
    └── fixtures/
```

目录可以按实际代码适度调整，禁止为了匹配目录树创建大量空目录。

## 5. Legacy Dependency Rule

`editor-app/` 是 reference implementation，不是依赖库。v2 禁止：

```ts
import { something } from '../../editor-app/src/...'
```

允许阅读旧实现、提取需求/fixture/测试场景、复制小型纯逻辑算法并在 v2 中重新实现。复制旧代码时必须回答：它属于哪个新边界；是否携带旧状态模型；能否脱离旧 editor manager 工作；是否有测试证明行为。需要时在 `LEGACY_FEATURE_MAP.md` 记录来源和处理方式。

## 6. Phase 0 — Repository Reset

Phase 0 不实现产品功能，目标是让人和 Pi 清楚区分新世界、旧世界和资料。

### P0-01 — Repository Inventory

只调查，不移动代码。生成 `writeit-v2/docs/REPOSITORY_INVENTORY.md`，记录真实存在的顶层目录和文件，包括 `editor-app/`、`raw/`、`wiki/`、`.pi/`、`.workbuddy/`、`.github/`、README、AGENTS、KB 及其他实际存在项，并标记：`ACTIVE-V2`、`LEGACY`、`REFERENCE`、`TOOLING`、`KNOWLEDGE`、`GENERATED` 或 `CANDIDATE-REMOVE`。

同时调查重复 skill、废弃 docs、已生成且被提交的产物、`.workbuddy` 是否仍被工具引用、`.pi` 中的 legacy 资源以及 README 过时描述。不得仅因“看起来没用”删除文件。

### P0-02 — Agent Context Split

根 `AGENTS.md` 保持精简并明确 `writeit-v2/` 为主线；旧版 Crepe、ego-lite、debug hooks、manager 等专用规则放入 `editor-app/AGENTS.md`。这是移动知识，不是删除知识。

### P0-03 — Pi Workflow

建立 `.pi/prompts/v2-task.md` 和 `.pi/prompts/v2-status.md`。`v2-task` 应提示 Pi 读取根 `AGENTS.md`、SPEC、STATUS 和必要的 feature map，找到 Task ID，只执行该任务，运行验证，更新 STATUS，汇报结果，不自动开始下一任务。

推荐调用形式：

```text
/v2-task P2-03
```

### P0-04 — Legacy Feature Map

生成根目录 `LEGACY_FEATURE_MAP.md`，至少记录：

| Capability | Legacy Location | v2 Owner | Strategy |
|---|---|---|---|
| FileSystem | `editor-app/src/fs` | `platform/filesystem` | REUSE DESIGN |
| Document state | `editor/manager` + docstore | `core/document` | REWRITE |
| Multi tabs | state + manager | ui/application | REDESIGN |
| References | `editor/ref` | `core/reference` | REWRITE |
| Editable Embed | manager/ref | projection | REWRITE |
| Table | editor/table | core/table + CM6 widget | PARTIAL REUSE |
| Annotation | annotations + editor plugin | core/annotation | REDESIGN |
| Mermaid | editor/mermaid | CM6 widget | PARTIAL REUSE |
| Diff | editor/diff | core/diff + review UI | REWRITE |
| Git | git | platform/git | REUSE BOUNDARY |
| Validation | validate | core/validation | PARTIAL REUSE |
| Template | template | feature/application | REVIEW |
| Search | search | index/search | REVIEW |
| Outline | editor/outline | index | REWRITE |
| Export | export | platform/export | REVIEW |
| Diagnostics | diagnostics/debug | observability | REDESIGN |
| Themes | UI | UI | DEFER/PORT |

每项最终只能归为 `KEEP BEHAVIOR`、`COPY PURE CODE`、`REWRITE`、`DROP` 或 `DEFER`。

### P0-05 — Safe Cleanup

完成 Inventory 后才允许清理。不要移动 `editor-app/`、`raw/`、`wiki/`。只处理已确认无引用的重复工具、明确生成产物、失效 README 描述、错误的 AGENT/AGENTS 引用和 obsolete docs。删除前使用 `rg` 和 `git log -- <path>` 确认用途；不确定则保留并标记。

### P0-06 — Initial ADRs

#### Goal

把 Phase 0 已接受的架构方向写成可追溯、可执行、可被后续 ADR 取代但不能被局部实现静默绕过的决策记录。

#### Allowed scope

- `writeit-v2/docs/adr/`
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`（仅补全 P0-06 任务合同）
- 为保持决策证据一致而更新 `experiments/cm6-spike/` 的结论性文档和 `STATUS.md`

不得实现产品代码或开始 P0-07。

#### Read first

- `fromChatgptWeb.md` 中的 ADR Initial Set
- 本 SPEC 的核心领域原则和对应后续 Phase
- `experiments/cm6-spike/SPIKE-REPORT.md`（ADR-0004、ADR-0005）
- `writeit-v2/docs/STATUS.md`

#### Implementation requirements

建立以下 ADR，状态均为 Accepted：

1. [ADR-0001 — Markdown Is The Persistent Data Contract](adr/ADR-0001-markdown-persistent-data-contract.md)
2. [ADR-0002 — DocumentStore Is Runtime Content Authority](adr/ADR-0002-document-store-runtime-content-authority.md)
3. [ADR-0003 — Editor Views Are Projections](adr/ADR-0003-editor-views-are-projections.md)
4. [ADR-0004 — CodeMirror 6 Is The Primary Editor Architecture](adr/ADR-0004-codemirror-6-primary-editor-architecture.md)（Spike result: GO）
5. [ADR-0005 — Markdown Table Uses WriteIt Table Core + CM6 Widget](adr/ADR-0005-markdown-table-core-and-cm6-widget.md)
6. [ADR-0006 — Diff Guarantee Layer Operates On Markdown Source](adr/ADR-0006-diff-guarantee-on-markdown-source.md)

每份 ADR 至少记录 status、acceptance date、context、decision、consequences、alternatives、deferred decisions 和 related decisions；引用实验结论的 ADR 必须链接对应 evidence。ADR-0004 的 GO 是最终架构决定；更广的办公软件兼容性和性能观察属于后续非阻断验证。

#### Tests

- 静态检查六份 ADR 均存在且状态为 Accepted。
- 检查 ADR 相对链接可解析。
- 检查 SPEC、Spike 结论、ADR 和 STATUS 对 GO/Accepted 的陈述一致。
- 本任务仅修改文档，不要求运行 v2 产品测试。

#### Acceptance criteria

- 六份 ADR 与上述标题、状态和核心架构不变量一致。
- 决策证据、已知代价和暂缓细节明确，不把未决定的实现细节伪装成已接受决策。
- ADR 有索引；后续不兼容决定必须通过 superseding ADR，而不是静默改写历史。
- `STATUS.md` 真实反映 P0-06 的完成状态和仍存在的非阻断风险。

#### Out of scope

- v2 工程骨架或产品功能。
- 扩大 CM6 Spike 的办公软件兼容矩阵。
- 实现 Deferred decisions 中的 API、算法或 UI。

### P0-07 — Scaffold

建立 `writeit-v2/` 的最小可运行工程骨架和必要配置，但不在此阶段实现产品功能。

### Phase 0 Exit Criteria

必须具备：

```text
writeit-v2/docs/IMPLEMENTATION_SPEC.md
writeit-v2/docs/STATUS.md
writeit-v2/docs/REPOSITORY_INVENTORY.md
writeit-v2/docs/LEGACY_FEATURE_MAP.md
根 AGENTS.md 已精简
editor-app/AGENTS.md 已建立
Pi v2 task prompt 可用
根 README 明确 v1/v2 状态
```

## 7. Phase 1 — Foundation

建立与 UI、CM6 无关的 Document 世界：

- **P1-01 Document types**：`DocumentId`、`DocumentPath`、`Revision`、`DocumentSnapshot`、`DocumentState`。
- **P1-02 DocumentStore**：支持 `load`、`get`、`applyChange`、`subscribe`、revision、dirty state、`persistedRevision`；所有 source mutation 有明确 origin。
- **P1-03 History**：per-document history，必须证明 A Tab、B→A、C→A 可以操作同一 Document history。
- **P1-04 Event Timeline**：建立 `DocumentLoaded`、`DocumentChanged`、`DocumentPersisted`、`ProjectionAttached`、`ProjectionUpdated`、`ProjectionDetached`、`ProjectionStale` 等可观察事实，不要求复杂 Event Sourcing。
- **P1-05 Persistence Port**：定义 `FileSystemPort`，Core 不知道 Tauri、File System Access API 或 localStorage；先实现用于测试的 `MemoryFileSystem`。

完成 P1 后进行 Architecture Review，再进入 P2。

## 8. Phase 2 — CM6 Editor Surface

建立 `DocumentStore ↔ CM6 Projection`：

- **P2-01** 单 Document / 单 View。
- **P2-02** user transaction → DocumentStore。
- **P2-03** DocumentStore update → Projection，使用 origin/storeSync 防止回环。
- **P2-04** 同一 Document 的 multi-view。
- **P2-05** projection revision / stale detection。
- **P2-06** 基础 Live Preview（emphasis、headings、links）；未知语法只需不增强，不得破坏。

## 9. Phase 3 — Workspace + Persistence

建立可工作的最小 WriteIt：打开 workspace → 文件树 → 打开 Markdown → tab → 编辑 → save → close → reopen。优先浏览器/mock backend，Tauri 暂缓。

必须处理 external file change、dirty、save conflict、rename 和 delete；这些逻辑属于 application/platform，不进入 CM6 extension。

## 10. Phase 4 — Reference Graph + Embed

建立 `[[A.md]]`、`[[A.md#Heading]]`、`![[A.md]]`，以及 `ReferenceParser`、`ReferenceIndex`、`ReferenceGraph`、`EmbedProjection`。需要覆盖 multi projection、nested、circular、revision、undo、close/reopen、stale 和 lifecycle。Spike 是证据，不替代生产代码测试。

## 11. Phase 5 — Table Engine

正式迁移 Table：

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

`table-core` 不依赖 CM6。Markdown 修改限制在当前 table region，编辑 cell 禁止重写整个文件。

## 12. Phase 6 — Annotation + Mermaid

Annotation domain 包括 `Annotation`、`Thread`、`RangeAnchor`、`ResolvedState`；CM6 Decoration 只是 Projection，不是 annotation 数据。

Mermaid 由 Markdown fence 产生 Mermaid Projection，源码始终保留。Renderer 出错时 fallback to source。

## 13. Phase 7 — Git + Diff

Diff 分为：

```text
Raw Diff → Semantic Enhancement → Renderer
```

每一个 raw change 至少存在 raw representation。Table Diff、Mermaid Diff、Embed Diff 等语义增强失败时不能删除 raw change。建议提供 `rawChangeCount`、`representedChangeCount`、`degradedChangeCount`，并允许诊断显示例如 `18/18 changes represented; 2 degraded to source diff`。

## 14. Phase 8 — Derived Services

Outline、Search、Backlinks、Validation、Template rules、Suggestions 都是 Document 的派生结果，不得为了这些功能建立第二份 Document authority。

## 15. Phase 9 — Export

重新评估 PDF、DOCX、Markdown 等 exporter。每个 Exporter 通过明确的 `DocumentSnapshot` 和 `ExportContext` 输入工作，不把当前 CM6 DOM 作为唯一输出来源。

## 16. Phase 10 — Observability / Diagnostics

这是正式架构组成部分。至少实现 Document diagnostics、Projection diagnostics、Event timeline、Error ring、Performance samples、Diff coverage 和 Reference health。Debug Panel 应能回答某 Document 的 revision、persisted revision、Projection 列表、stale 状态、最后修改者和最后保存时间。

等 v2 Diagnostics 稳定后，再处理 `.pi/extensions/writeit-debug` 和 `.pi/skills/writeit-debug`。不得直接搬运旧协议；届时可升级 `writeit` tool 或建立 `writeit-v2` tool，提供 `documents`、`projections`、`timeline`、`diff.health`、`refs.health`、`performance`、`screenshot` 等语义诊断 API。

## 17. Phase 11 — Tauri

仅在 browser architecture 稳定后接入 Tauri 2。FileSystem、Git、Window、Dialogs、Export、Diagnostics storage 分别实现 adapter；Tauri command 不得直接进入 Document Core。

## 18. Phase 12 — Feature Parity Review

逐项关闭 `LEGACY_FEATURE_MAP.md`。每项只能处于 `MIGRATED`、`REDESIGNED`、`INTENTIONALLY DROPPED` 或 `DEFERRED`，不能为 `UNKNOWN`。重点检查 workspace、tabs、save、source fidelity、refs、editable embed、table、annotation、validation、templates、Mermaid、Git、diff、search、outline、export、diagnostics、themes、keyboard shortcuts 和 external file changes。

## 19. Final Cutover

v2 成为主产品前不移动 `editor-app/`。最终是否将 legacy 移到 `legacy/editor-app/`，以及是否把 `writeit-v2/` 重命名为 `editor-app/`，都是 Cutover Decision，不能现在预先决定。

## 20. Test Architecture

目标是大量 Core Unit、中量 Integration、少量 Browser、极少 E2E。

### Unit

覆盖 DocumentStore、revision、history、table-core、reference graph、diff guarantee、validation、search/index，不创建浏览器。

### Integration

覆盖 DocumentStore + FileSystem、DocumentStore + ReferenceGraph、DocumentStore + Diff。

### Browser

只覆盖 CM6 transaction、Widget、focus、IME、clipboard、selection 和 lifecycle。

### E2E

只保留关键旅程，例如：

- open → edit → save → reopen
- B embeds A → 通过 B 编辑 A → A tab sync → save → reopen
- Git change → source diff complete → semantic enhancement

v2 不依赖 ego-lite。

## 21. Source Fidelity Gate

建立 permanent golden corpus。每次重要编辑器修改必须验证：

```text
open → no edit → save
```

bytes unchanged；只修改一个词时，Git Diff 不得出现无关的全文 rewrite。

## 22. STATUS.md 约定

STATUS 是实施期间的短文档，不写成开发日志。格式：

```markdown
# WriteIt v2 Status

Current phase: P0
Current task: P0-01

## Completed
- [x] ...

## Active
- [ ] P0-01

## Blocked
None

## Recent decisions
- ADR-0004 accepted

## Known risks
- ...

## Next
P0-02
```

## 23. Pi Task Contract

每个任务应能在一次 Pi 工作周期完成，并包含：

```text
Goal
Allowed scope
Read first
Implementation requirements
Tests
Acceptance criteria
Out of scope
```

避免“重构整个编辑器”之类无法验收的任务，改用例如 `P4-03 — Multi-projection propagation` 的小任务。

## 24. Pi 执行纪律

```text
Read → Inspect → Implement → Test → Update STATUS → Report
```

小型实现选择可以自行选择并记录；会改变 ADR 的选择必须停止并提出决策；Legacy 行为不清晰时查 `LEGACY_FEATURE_MAP.md` 和旧测试。不要先无目的搜索整个旧项目，也不要自动开始下一个 Task。

## 25. 第一批推荐执行顺序

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

完成 P1 后进行一次 Architecture Review，不要一口气进入 P2。

## 26. Definition of Success

- **数据**：可以明确回答一份 Document 谁说了算。
- **依赖**：可以明确回答为什么 Table 不需要知道 Tauri。
- **Projection**：可以解释 B 中的 A 为什么不会拥有 A 的副本。
- **Diff**：可以证明 Renderer 坏了也不会漏变化。
- **Debug**：可以直接看到哪个 Document / Projection / revision 出了问题。
- **Testing**：大部分业务 bug 不需要完整桌面应用即可复现和验证。
- **Editor**：未来替换 CM6 时，不需要重写 Document、Git、Validation、Reference、Export 或 Diagnostics。

达到这些条件，才算 WriteIt 架构重构完成。
