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
│   │   ├── events/
│   │   └── assistance/      # completion / quick insert contracts（按需要建立）
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

## 5A. Legacy 用户可见功能完整性基线

本节是 2026-09-07 对 legacy `editor-app/` 做的功能遗漏审计结果。目的不是要求 v2 复制旧 UI，而是防止“架构大项已迁移”掩盖真实用户工作流丢失。除非后续通过明确决策标记为 `INTENTIONALLY DROPPED` / `DEFERRED`，下列能力必须在对应 Phase 拥有明确 Task 与验收条件，不能只留到 Phase 12 才发现。

| Capability / user workflow | Legacy evidence | v2 planned owner / phase | Coverage rule |
|---|---|---|---|
| Markdown raw/source 与 Live Preview 切换（`Ctrl+E`） | `editor/manager.ts`, `RefEditorMenu.vue` | P2A / CM6 presentation | 同一 CM6 state + 同一 Document authority；禁止恢复第二份 source textarea authority |
| `/` Quick Insert / command menu | Crepe block-edit, `editor/features.ts` | P2A command registry；P6/P8 provider | 必须有独立 CommandRegistry；模板/Mermaid 只是 provider |
| `@` / `[[` / `![[` 引用联想 | `editor/ref/menu/*` | P2A completion foundation + P4 reference provider | 三种 trigger 都要覆盖 |
| 中文全角触发符归一化 | `editor/ref/menu/core.ts` | P2A trigger core | `＠`、`！`、`【/［` 等行为不得因 CM6 迁移丢失 |
| 文件→对象 / heading 二级联想 | `ref/menu/core.ts`, `template/suggest-context.ts` | P4 + P8 template intelligence | file self / object / heading 必须是明确候选类型 |
| Mermaid 代码块中的 `@` 引用联想 | `editor/mermaid-ref.ts` | P6，复用 completion provider | 不复制一套独立联想业务逻辑 |
| 引用点击跳转、hover 信息、断链标红与重选 | `ref/app-plugin.ts`, `ref-tooltip.ts` | P4 | broken reference 必须可诊断、可修复 |
| 引用 rename 联动 | reference + tree ops | P4/P3 | rename 后入链引用按明确策略更新，不静默断链 |
| 文件树/系统文件管理器复制 → 编辑器粘贴引用 | `ref/clipboard-core.ts`, `ContextMenu.vue` | P4 + platform clipboard adapter | 支持 link/embed/read-only embed；目录粘贴路径文本 |
| 引用右键 link / editable embed / readonly embed 类型切换 | `RefEditorMenu.vue` | P4 editor adapter | 改的是 Markdown token / reference mode，不建立副本 |
| Editable / readonly / nested / circular embed | `editor/ref`, manager | P4 | 继承 CM6 Spike 与 production 多 projection 不变量 |
| Template 扫描、doctype、workspace/global domain | `template/service.ts` | P8 | 扫描失败降级；工作区优先级必须明确 |
| 基于模板新建文件 | `TemplatePicker.vue`, tree ops | P3 + P8 | 不是只支持 `/` 插入模板 |
| 模板 `rules.ts` | template + validate | P8 | validation provider |
| 模板 `suggest.ts` 静态/动态 `objectsFor(ctx)` | `template/service.ts`, `suggest-context.ts` | P8 + P4 completion | 动态对象上下文需覆盖 heading/task/table/ref 等需要的结构查询 |
| 模板 `export.ts` | template/export | P9 | custom exporter provider |
| `{{placeholder}}` 占位符点击/键盘整体替换 | `ref/placeholder.ts` | P8 + CM6 decoration | 属于 editing assistance，不改变 Markdown contract |
| 图片粘贴落盘 / inline fallback | `editor/image-paste.ts` | P3 attachment pipeline | root-images / same-dir / file-images / inline 策略需显式决定 |
| 相对路径图片显示、预览、复制、树定位、系统定位 | `image-paste.ts`, `RefEditorMenu.vue`, `ImagePreviewModal.vue` | P3/P11 | renderer 失败不得修改 source path |
| Markdown Table 二维编辑 / clipboard / IME | `editor/table` + CM6 Spike | P5 | ADR-0005，不回退到嵌套 PM |
| Annotation 创建、线程回复、resolve、代码块批注 | `annotations/`, `AnnotationDrawer.vue` | P6 | Decoration 不是数据 authority |
| Annotation drawer 宽度/展开策略、定位/连线 | `AnnotationDrawer.vue`, settings | P6/UI settings | UX parity 独立验收 |
| Mermaid preview、错误 fallback、`/` 模板 | `editor/mermaid.ts`, `mermaid-diagrams.ts` | P6 + P2A command registry | source 永远保留 |
| 全局全文 Search | `search/`, `SearchPanel.vue` | P8 | grouped hits、case option、缓存/刷新 |
| Search 精确 occurrence 跳转 + 编辑器高亮 | `SearchPanel.vue`, manager search hooks | P8 + CM6 adapter | 原子/Widget 命中也需有可解释 fallback |
| Replace current / replace all | `SearchPanel.vue` | P8 application command | 与 dirty/open documents 的冲突策略必须显式 |
| Outline 点击跳转 / active tracking / resize/autofit | `OutlinePanel.vue` | P8 | index 为派生状态 |
| Backlinks / reference health | reference index | P8/P10 | 来自 ReferenceGraph，不建立第二 truth |
| Validation 自动检查 / strict save gate / issue surface | `validate/` | P8 | save gate 属于 application policy |
| Git repo/branch/worktree/history/range comparison | `git/`, `GitPanel.vue` | P7 | 不只实现 diff renderer |
| Diff split/unified/render/source、hunk fold/navigation、file/hunk discard | `DiffView.vue`, render diff | P7 | raw change guarantee 优先于富渲染 |
| Git semantic Mermaid/Table/Embed diff + change explanation annotation | diff/render + annotations | P7/P6 | enhancement 可降级，不可吞 raw change |
| 全局搜索、Git、文件树之间的状态标记与入口 | `App.vue`, `FileTree.vue` | P3/P7/P8 UI | 不要求像素复制，但用户工作流必须可达 |
| PDF / DOCX / Markdown / template export，多文件独立格式 | `ExportModal.vue`, export | P9 | batch export 是明确能力 |
| Settings：主题、图标、auto-save、sidebar、outline、annotation、image paste、shortcuts | `state/settings.ts`, `SettingsModal.vue` | P3/P10/P11 UI settings | 每项可 redesign，但不能无记录消失 |
| 可配置快捷键 + 冲突检测 + 恢复默认 | settings + App key handling | P2A foundation + P3 settings | command id 与 keybinding 分离 |
| sidebar collapse/pin/resize、reveal current file、prev/next file | `App.vue`, FileTree | P3 | shell/navigation parity |
| file CRUD + drag move + reveal in system explorer | FileTree/tree ops/context menu | P3/P11 | platform-only capability 通过 adapter |
| last workspace restore | App/settings | P3/P11 | desktop recovery policy |
| Diagnostics report、error badge、timeline、DOM/doc/screenshot/path privacy selections | `diagnostics/`, settings | P10 | 正式 observability 能力 |
| Agent debug channel local/LAN + LAN exec restrictions | debug + settings | P10/P11 | 新协议不得直接继承 legacy 私有状态 |
| lite mode / WebView GPU & occlusion options | settings/Tauri | P11 | 作为 platform performance profile 重新评估 |

### 功能覆盖治理规则

- “References migrated” 不能自动代表 reference completion、clipboard、broken-ref recovery、rename linkage、embed interaction 全部完成。
- “Templates migrated” 不能自动代表 new-from-template、slash insertion、placeholder、`rules.ts`、`suggest.ts`、`export.ts` 全部完成。
- “Search migrated” 必须分别验收 search、precise navigation/highlight、replace。
- Phase 12 只负责**确认和关闭**能力，不应成为首次发现遗漏的阶段。
- 当旧行为不适合 v2 时，可以 `REDESIGNED` / `INTENTIONALLY DROPPED`，但必须在 `LEGACY_FEATURE_MAP.md` 与 STATUS/ADR（必要时）留下明确决策。

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
| Reference syntax/index | `editor/ref` | `core/reference` | REWRITE |
| Reference completion `@` / `[[` / `![[` | `editor/ref/menu` | `application/assistance` + CM6 adapter | REDESIGN |
| Reference entity completion (file/object/heading) | ref menu + template suggest | reference/template providers | PARTIAL REUSE |
| Reference clipboard/context-menu workflows | `ref/clipboard-core.ts`, `RefEditorMenu.vue` | application command + clipboard adapter | REDESIGN |
| Editable / readonly Embed | manager/ref | projection | REWRITE |
| Slash `/` quick insert | Crepe block-edit / `features.ts` | command registry + CM6 adapter | REDESIGN |
| Source / Live Preview toggle | manager/source mode | CM6 presentation state | REDESIGN |
| Table | editor/table | core/table + CM6 widget | PARTIAL REUSE |
| Image / attachment paste & preview | `editor/image-paste.ts` | attachment application + platform binary FS | PARTIAL REUSE |
| Annotation | annotations + editor plugin | core/annotation | REDESIGN |
| Mermaid | editor/mermaid + mermaid-ref | CM6 widget + command/completion provider | PARTIAL REUSE |
| Diff | editor/diff | core/diff + review UI | REWRITE |
| Git workbench | git + GitPanel/DiffView | platform/git + review application | REUSE BOUNDARY |
| Validation | validate | core/validation | PARTIAL REUSE |
| Template domains / doctype | template/service | template application | REDESIGN |
| Template rules/suggest/export/placeholder | template + placeholder | providers + derived services | REVIEW |
| Search + precise jump + replace | search + SearchPanel | index/search + application commands | REVIEW |
| Outline / Backlinks | editor/outline + reference index | derived index | REWRITE |
| Export (batch PDF/DOCX/MD/custom) | export + ExportModal | platform/export | REVIEW |
| Diagnostics / Agent debug | diagnostics/debug | observability | REDESIGN |
| Settings / shortcuts / themes / shell layout | settings + UI | UI/application/platform | REDESIGN/PORT |

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
LEGACY_FEATURE_MAP.md
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

P2 的架构 gate / remediation 仍按 `STATUS.md` 和对应 Architecture Review 执行。新增功能任务不得绕过当前 P2-AR blocker。

### Phase 2A — Editing Assistance & Source UX Foundation（P2-AR2 通过后、P3 前）

该阶段解决“编辑器输入体验”的公共机制，不提前实现完整 Reference/Template/Mermaid 业务。所有 provider 最终通过 DocumentStore mutation 修改 Markdown。

- **P2A-00 — Feature map sync**：把本 SPEC 的功能完整性基线同步进 `LEGACY_FEATURE_MAP.md`，拆开 broad umbrella capability；不改变已经完成的 P0 历史状态。
- **P2A-01 — Command Registry**：建立 editor/application command contract（id、label、group、keywords、availability、execute），command 与 keybinding 分离。
- **P2A-02 — Slash Quick Insert Surface**：输入 `/` 打开可过滤菜单，支持键盘上下、Enter、Escape、鼠标选择；先接基础 Markdown commands，Template/Mermaid provider 后续接入。
- **P2A-03 — Completion Engine**：建立 trigger detection、anchored suggestion UI、provider contract、query filtering、selection/apply 生命周期；支持 `@`、`[[`、`![[`。
- **P2A-04 — IME / full-width trigger normalization**：覆盖 legacy 中文输入法触发行为，至少验证 `＠`、`！`、`【/［` 等 1:1 归一化不会改写 source。
- **P2A-05 — Raw Source / Live Preview Toggle**：保留 `Ctrl+E` 工作流，但 v2 不建立第二个 textarea authority；同一 CM6 Document 在 raw source presentation 与 Live Preview decorations/widgets 间切换，selection/history/source 均连续。
- **P2A-06 — Keybinding Foundation**：command id → configurable keybinding；支持冲突检测所需的纯逻辑，实际 Settings UI 在 P3 完成。

#### Phase 2A Acceptance

- `/`、`@`、`[[`、`![[` 的 trigger/UI foundation 有 browser integration 测试。
- provider logic 可脱离 CM6 单测；CM6 adapter 只负责触发、定位、UI 与 apply bridge。
- Live Preview toggle 不产生第二份 Markdown authority，不通过 parse→serialize 切换模式。
- IME composition 期间不能误提交 trigger 或破坏输入。

#### Phase 2A User Acceptance Remediation Gate

2026-09-07 的用户验收在 baseline `30d56e3` 上发现 popup 滚动/定位、Slash 分组、Reference 模式切换、IME/生命周期、line-ending fidelity 和 keybinding round-trip 缺口。规范化复现证据与完整任务合同见 [P2A User Acceptance Review](./P2A_ACCEPTANCE_REVIEW.md)。

进入 P3 前必须按单 Task 执行并通过：

```text
P2A-R01 Caret popup positioning and visible selection
P2A-R02 Slash command group navigation
P2A-R03 Reference completion mode switching
P2A-R04 Popup IME, editability, and lifecycle safety
P2A-R05 Line-ending source fidelity
P2A-R06 Keybinding recorder round-trip edge cases
P2A-AR1 Re-run Phase 2A acceptance gate
```

在 P2A-AR1 得出 PASS 前，P3 保持 HOLD。P2A-00 至 P2A-06 的实现历史仍记为完成，但不能据此宣称 Phase 2A 已通过用户验收。

## 9. Phase 3 — Workspace + Persistence

建立可工作的最小 WriteIt：打开 workspace → 文件树 → 打开 Markdown → tab → 编辑 → save → close → reopen。优先浏览器/mock backend，Tauri 暂缓。

建议拆为：

- **P3-01 Workspace tree**：recursive tree、create file/dir、rename、delete、drag move、tree refresh。
- **P3-02 Tabs & navigation**：多标签、active tab、dirty indicator、关闭未保存确认、next/prev tab、按树序 next/prev file、reveal current file。
- **P3-03 Persistence policy**：manual save、configurable auto-save delay、dirty、save conflict、external file change、close/reopen。
- **P3-04 Workspace recovery/settings shell**：last workspace、sidebar collapse/pin/resize、基础 settings persistence；desktop restore 通过 platform adapter 完成。
- **P3-05 Shortcut Settings UI**：展示 command/keybinding、录制、自定义、冲突检测、恢复默认；包括 editor-specific command（如 table add-row）。
- **P3-06 Attachment/Image Pipeline**：扩展明确的 binary FS port；图片 paste 支持 `root-images` / `same-dir` / `file-images` / `inline`（若 v2 决定删减必须显式记录），写盘失败可安全 fallback；Markdown 只保存相对 path 或明确 inline data。
- **P3-07 Image Projection UX**：相对路径解析显示、preview、复制图片、在 workspace tree 定位；系统文件管理器 reveal 留给 P11 adapter。Renderer/read failure 不得改写 Markdown path。
- **P3-08 Create from Template hook**：先建立“基于模板新建”的 application seam，真正 Template catalog/provider 在 P8 接入；不得把 template 逻辑硬编码进 tree component。

external file change、dirty、save conflict、rename 和 delete 属于 application/platform，不进入 CM6 extension。

## 10. Phase 4 — Reference Graph + Embed

Reference 不能只验收 parser/graph；必须覆盖 legacy 的输入、导航、恢复和剪贴板工作流。

- **P4-01 Reference syntax & resolution**：`[[A.md]]`、`[[A.md#Heading]]`、`![[A.md]]`、readonly embed 表达；路径补扩展名/工作区 basename 搜索策略要有明确测试。
- **P4-02 ReferenceIndex / ReferenceGraph / Backlink facts**：增量或可重建派生索引，不成为 Markdown authority。
- **P4-03 Reference Completion Provider**：接入 P2A Completion Engine；`@` / `[[` / `![[` 搜索 workspace file/dir，隐藏目录策略明确。
- **P4-04 Entity Completion**：选中文件后提供 file-self + object 或 heading 二级候选；动态 object provider 接 P8 Template Suggestion。
- **P4-05 Navigation & health**：点击打开、heading/object fragment jump、hover/tooltip、broken reference 检测、断链重选；broken state 可进入 diagnostics。
- **P4-06 Rename linkage**：文件 rename 对 incoming references 的更新/冲突/失败策略明确且可测试。
- **P4-07 Reference Clipboard Workflow**：应用内文件树复制与系统 `file://` clipboard 输入；Ctrl+V 默认 link，右键可 paste as editable embed / readonly embed；目录粘贴路径文本；多文件行为明确。
- **P4-08 Reference Context Actions**：打开引用、复制引用 syntax、link/embed/readonly 模式切换。
- **P4-09 Embed Projection**：editable/read-only、multi projection、nested、circular、revision、undo、close/reopen、stale、lifecycle；Spike 是证据，不替代 production 测试。

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

`table-core` 不依赖 CM6。Markdown 修改限制在当前 table region，编辑 cell 禁止重写整个文件。Production acceptance 至少重新覆盖 Spike 的 click、keyboard navigation、rectangle selection、TSV/HTML clipboard、multi-cell paste、undo/redo、row/column add-delete、IME、source switch safety；办公软件扩展矩阵和大表格性能是 post-GO quality work。

- row/column reorder、column resize 若未在首版实现，必须在 Feature Map 中显式 `DEFERRED`，不能遗漏。
- `Shift+Enter` 等 table command 通过统一 Command/Keybinding 体系注册，不建立 table 私有快捷键配置系统。

## 12. Phase 6 — Annotation + Mermaid

### Annotation

- **P6-A01 Domain**：`Annotation`、`Thread`、`Comment`、`RangeAnchor`、`ResolvedState`；持久化格式另行明确，CM6 Decoration 不是 annotation 数据。
- **P6-A02 Create/anchor mapping**：选中文本添加批注；代码块内按 legacy 行为升级为整块/稳定 anchor（可 redesign，但需明确）。
- **P6-A03 Thread UX**：drawer/card、reply、Enter 发送 / Shift+Enter 换行、resolve/unresolve 权限策略、点击定位。
- **P6-A04 Drawer UX**：宽度、open policy（普通视图/diff 视图）、active card、anchor 连线/定位反馈。

### Mermaid

- **P6-M01 Source-backed preview**：fenced source → Widget；loading/error；失败 fallback source。
- **P6-M02 Preview/edit toggle**：进入源码编辑与预览切换不改写 fence。
- **P6-M03 Slash templates**：通过 P2A CommandRegistry 提供 legacy Mermaid 快速插入模板（具体模板集合可以调整，但必须有产品决策）。
- **P6-M04 Mermaid reference completion**：代码块内 `@` 联想复用 P2A/P4 completion provider，不复制业务逻辑。
- **P6-M05 Performance**：按需/可视区渲染等策略作为性能实现细节；不能因懒加载导致 source 或诊断失真。

## 13. Phase 7 — Git + Diff + Provenance

Git/Review 是完整工作台，不只是一张 Diff 组件。除“发生了什么变化”外，v2 还必须能够回答“这一行/这一段是谁在什么时候提交的、属于哪个 commit”。

- **P7-01 Git Repository Port**：repo info、branch、worktree status、history、file content/diff、file history、blame；browser mock 与 Tauri adapter 分离。Git blame 使用机器可解析结果（实现可基于 `git blame --line-porcelain` 或等价库/API），Core/UI 不直接解析人类可读 CLI 文本。
- **P7-02 Workbench Navigation**：仓库状态、branch picker/filter/switch、worktree file list、history/commit file list。
- **P7-03 Comparison Targets**：worktree vs HEAD、commit diff、Shift/显式 two-commit range comparison。
- **P7-04 Raw Diff Guarantee**：`Raw Diff → Semantic Enhancement → Renderer`；每一个 raw change 至少存在 raw representation。
- **P7-05 Text Diff UX**：split/unified、line + word highlight、hunk fold、F7/Shift+F7 navigation、current/total count。
- **P7-06 Discard/Revert**：editable target 才允许 discard file / discard hunk；必须有确认与失败处理。
- **P7-07 Rich/Semantic Diff**：Table/Mermaid/Embed 等 enhancement；失败只能 degraded to source diff。
- **P7-08 Change Explanation**：若保留 legacy “改动说明” annotation/cards，作为 review-derived annotation 明确建模，不混入 source authority。
- **P7-09 Workspace Integration**：文件树 Git 状态、当前文件 Git diff 入口、快捷键。
- **P7-10 Git Blame / Annotate Data Model**：建立按 Markdown source line/range 返回的 provenance 结果，至少包含 `commitId`、author name/email、author time、可选 committer time、commit summary、original path/line（若可得）和 final line range。Blame 是 Git 派生数据，不进入 Document authority，不允许为了计算 blame 改写或保存 Document。
- **P7-11 IDEA-style Editor Blame UX**：编辑区或 gutter 右键提供 `Annotate with Git Blame` / `Show Git Blame`；开启后在 CM6 gutter 显示每行最近一次已提交修改的作者与时间，支持关闭。hover/click 至少显示 commit hash、author、时间、subject；点击 commit 可以进入 Commit Detail / Git Log / 对应 diff。显示字段可后续配置，但首版至少有 Author + Date。
- **P7-12 Working-tree / Dirty Semantics**：当前 Document 与 Git baseline 不一致时，不得把尚未提交的行错误归因给旧 commit。新增/修改但未提交的 source line/range 必须明确显示 `Uncommitted` / `Local changes`；未保存的 DocumentStore source 也不能为了 blame 被隐式写盘。对未改动且可可靠映射的行继续显示已提交 blame；映射失败时必须 degraded/unknown，而不是猜测作者。
- **P7-13 File History / Document Provenance**：当前文档提供 `Show File History`，列出实际触及该文件的 commits，至少显示 author、date/time、commit id、summary；选择 commit 可查看该版本或该 commit 对该文件的 diff。若 Git backend 支持，rename history 应使用等价于 `--follow` 的策略或明确标记历史在 rename 处中断。
- **P7-14 Blame Options / Provenance Quality**：参考 IDE annotate 体验，允许后续提供 Ignore Whitespace、Detect Movements Within File、Detect Copies/Movements Across Files、author time vs commit time 等选项。它们可以是 quality follow-up，但 GitBlamePort 的设计不得阻止这些能力。

### Git Blame / Provenance invariants

1. **Source-line fact**：blame 的定位对象始终是 Markdown source line/range，不是富文本 DOM node、Widget DOM 或渲染后的 HTML。
2. **No false attribution**：无法可靠映射的 dirty/local line 必须显示 local/unknown，不能显示一个看似可信但实际来自旧 source line 的作者。
3. **Projection-only UI**：CM6 gutter 只是 provenance Projection；关闭 blame 不改变 Markdown、selection history 或 Git 状态。
4. **Live Preview compatibility**：raw source 模式优先提供逐行 annotation。Live Preview 若用 Widget 替换多行 source，可显示该 source range 的紧凑 provenance marker/summary；点击可展开详情或切回 source 定位。不得因为 Widget 折叠而把多行错误归成一个 commit。
5. **Commit drill-down**：从 line blame 到 commit detail/diff 的导航必须使用 commit id，不依赖当前 gutter 文本解析。
6. **Performance/caching**：blame/file-history 可以按 `(repo, path, revision/options)` 缓存并在 HEAD/worktree/path 变化时失效；不得每次光标移动都重新执行完整 Git blame。

### Git Blame / Provenance acceptance

至少覆盖：

- 在已提交文件上右键开启 blame，连续多行来自不同 commits 时 gutter 显示正确不同作者/时间。
- hover/click 某行能看到对应 commit id、author、date、summary，并能打开该 commit 对应详情/diff。
- 当前文档存在 local/uncommitted 修改时，修改行显示 local/uncommitted，未改动行的历史作者不被整体抹掉。
- 新增的未提交行不能被错误归因到相邻旧行的 commit。
- 关闭/重新开启 blame 不修改 Markdown source，也不新增 DocumentStore revision。
- `Show File History` 至少可回答“这个文档曾由哪些用户、在什么时间、通过哪些 commits 修改过”。
- 非 Git workspace、untracked file、Git command failure 有明确空态/错误态，不影响编辑。

建议提供 `rawChangeCount`、`representedChangeCount`、`degradedChangeCount`，并允许诊断显示例如 `18/18 changes represented; 2 degraded to source diff`。

## 14. Phase 8 — Derived Services + Template Intelligence

Outline、Search、Backlinks、Validation、Template rules、Suggestions 都是 Document 的派生结果，不得为了这些功能建立第二份 Document authority。

### Search / Replace

- **P8-S01** workspace full-text search、case sensitivity、结果按文件分组、缓存/失效策略。
- **P8-S02** occurrence-precise navigation：打开文件、定位命中、CM6 highlight/current highlight；Widget/atomic region 必须有可解释 fallback。
- **P8-S03** replace selected / replace all：application command，写入 DocumentStore/FS 的顺序明确；对 dirty/open document 不允许像 legacy 一样靠隐式跳过，必须给出显式冲突策略和用户反馈。
- **P8-S04** 键盘 UX：Enter 跳转、上下选择、Esc 收起/清空的具体 UX 可 redesign，但必须可用。

### Outline / Backlinks

- **P8-I01** Outline index + panel：heading hierarchy、点击 jump、active heading tracking；宽度/open/autofit 为 UI state。
- **P8-I02** Backlinks/reference health：来自 ReferenceGraph；可跳转到 source reference。

### Validation

- **P8-V01** rule execution + issues。
- **P8-V02** automatic validation + issue presentation。
- **P8-V03** strict save gate：属于 application save policy；不得让 CM6 plugin 决定能否持久化。

### Template System

- **P8-T01 Template Catalog**：`.template/` + `doctype:`；workspace/global domain 与覆盖优先级明确；tree change 可 rescan；扫描失败降级。
- **P8-T02 Create/Insert Template**：接 P3 create-from-template 与 P2A slash command；插入后仍通过正常 Markdown/Reference 流程处理。
- **P8-T03 Template Placeholder**：`{{...}}` source-backed decoration；点击/键盘进入时可以整体选择替换，code fence 等例外行为明确。
- **P8-T04 `rules.ts` Provider**：接 Validation。
- **P8-T05 `suggest.ts` Provider**：静态 objects + 动态 `objectsFor(ctx)`；`SuggestContext` 至少覆盖 legacy 真实需要的 paragraph、heading、task、table、file/object ref 结构查询，具体 API 可 redesign。
- **P8-T06 Completion Integration**：P4 entity completion 使用 Template suggestion provider；无 suggest 时 fallback heading entities。
- **P8-T07 `export.ts` Metadata/Provider**：只建立与 P9 exporter 的 contract，不在 Template service 里直接导出。

## 15. Phase 9 — Export

重新评估 exporter，但以下 legacy 能力必须逐项决策：

- **P9-01 Markdown export**。
- **P9-02 PDF export**。
- **P9-03 DOCX export**。
- **P9-04 Template/custom `export.ts` provider**。
- **P9-05 Batch export**：多文件选择，每文件可以选择不同格式，输出文件名/失败结果明确。

每个 Exporter 通过明确的 `DocumentSnapshot` 和 `ExportContext` 输入工作，不把当前 CM6 DOM 作为唯一输出来源。

## 16. Phase 10 — Observability / Diagnostics

这是正式架构组成部分，而不是只做 Debug Panel。

至少实现：

- Document / Projection diagnostics、Event timeline、Error ring、Performance samples、Diff coverage、Reference health。
- 用户可生成诊断报告/包；是否包含 screenshot、DOM、document content、full path 需要显式选择并保留 privacy/redaction policy。
- 可选异常提示/badge 与 timeline tracking。
- Debug Panel 应能回答某 Document 的 revision、persisted revision、Projection 列表、stale/degraded/source-fresh 状态、最后修改者和最后保存时间。

等 v2 Diagnostics 稳定后，再处理 `.pi/extensions/writeit-debug` 和 `.pi/skills/writeit-debug`。不得直接搬运旧协议；届时可升级 `writeit` tool 或建立 `writeit-v2` tool，提供 `documents`、`projections`、`timeline`、`diff.health`、`refs.health`、`performance`、`screenshot` 等语义诊断 API。

Agent debug channel 的 `off/local/lan`、LAN 下高风险 exec 限制属于新协议的安全设计项，需显式决策而不是复制 legacy 行为。

## 17. Phase 11 — Tauri + Desktop Platform

仅在 browser architecture 稳定后接入 Tauri 2。FileSystem、Binary/Attachment IO、Git、Window、Dialogs、Export、Diagnostics storage 分别实现 adapter；Tauri command 不得直接进入 Document Core。

Desktop parity 至少审查：

- 打开/恢复上次 workspace。
- “在系统文件管理器中显示”文件/目录/图片。
- Window/titlebar 等平台 shell。
- Windows/macOS packaging。
- legacy lite mode、WebView2 GPU blacklist / occlusion options 是否仍有必要；若保留，建模为 platform performance profile，不进入 editor/core。
- debug local/LAN transport 与权限限制。

## 18. Phase 12 — Feature Parity Review

逐项关闭 `LEGACY_FEATURE_MAP.md`。每项只能处于 `MIGRATED`、`REDESIGNED`、`INTENTIONALLY DROPPED` 或 `DEFERRED`，不能为 `UNKNOWN`。

### Phase 12 hard rule

不能用一个 broad row 关闭多个用户工作流。例如：

- `References=MIGRATED` 不代表 completion / clipboard / broken recovery / rename / type switch / embed 全部完成。
- `Templates=MIGRATED` 不代表 new-from-template / slash / placeholder / rules / dynamic suggest / export 全部完成。
- `Search=MIGRATED` 不代表 precise jump/highlight / replace 完成。
- `Git/Diff=MIGRATED` 不代表 branch/history/range/discard/navigation/rich fallback/blame/file-history provenance 完成。

最终 parity checklist 至少逐项包含：

```text
workspace tree CRUD / drag move / reveal
tabs / dirty / close confirm / next-prev navigation
manual save / autosave / external change / conflict
raw source ↔ Live Preview toggle
configurable shortcuts / conflict detection
/ quick insert
@ / [[ / ![[ completion
file → object / heading completion
full-width IME trigger compatibility
reference click / tooltip / broken recovery / rename linkage
file-manager/tree clipboard → reference paste
reference link/embed/readonly type switch
editable / readonly / nested / circular embed
table editing / clipboard / IME
image paste strategies / relative display / preview / copy / reveal
annotation create / thread / reply / resolve / code-block anchor / drawer UX
Mermaid preview / source fallback / slash templates / @ completion
global search / precise jump+highlight / replace
outline / backlinks
validation / strict save gate
template catalog / new-from-template / slash insert / placeholder / rules / dynamic suggest / export
Git repo/branch/worktree/history/range
IDEA-style Git blame gutter / author+time / commit drill-down / dirty-local attribution / file history
diff source guarantee / split-unified / rich-text / hunk navigation / discard / semantic fallback
PDF / DOCX / Markdown / custom / batch export
diagnostics report / privacy selections / error badge / performance
themes / icon style / sidebar / outline / annotation / image / autosave settings
lite/platform performance options
Tauri desktop file-manager reveal / packaging
```

Phase 12 的职责是确认已经迁移、明确 redesign/drop/defer 和执行最终用户旅程验收；不应在这里首次设计核心功能。

## 19. Final Cutover

v2 成为主产品前不移动 `editor-app/`。最终是否将 legacy 移到 `legacy/editor-app/`，以及是否把 `writeit-v2/` 重命名为 `editor-app/`，都是 Cutover Decision，不能现在预先决定。

## 20. Test Architecture

目标是大量 Core Unit、中量 Integration、少量 Browser、极少 E2E。

### Unit

覆盖 DocumentStore、revision、history、table-core、reference graph、diff guarantee、validation、search/index，不创建浏览器。

### Integration

覆盖 DocumentStore + FileSystem、DocumentStore + ReferenceGraph、DocumentStore + Diff。

### Browser

覆盖必须依赖真实编辑器/浏览器行为的 CM6 transaction、Widget、focus、IME、clipboard、selection 和 lifecycle；另外覆盖 `/`/reference completion popup、raw/Live Preview toggle、search highlight、image paste 等 adapter 行为。业务 provider/core 逻辑仍优先 unit/integration。

### E2E

只保留关键旅程，例如：

- open → edit → save → reopen
- B embeds A → 通过 B 编辑 A → A tab sync → save → reopen
- Git change → source diff complete → semantic enhancement
- `/` quick insert → execute command → Markdown source correct
- `@`/`[[`/`![[` completion → choose target/entity → Markdown source correct
- image paste → attachment persisted/fallback → Markdown path correct → reopen
- global search → precise jump → replace selected/all with explicit dirty/conflict behavior

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
- **Feature parity**：旧版高频用户工作流必须逐项 `MIGRATED` / `REDESIGNED` / `INTENTIONALLY DROPPED` / `DEFERRED`，不能因为 umbrella capability 名称相同就视为完成。

达到这些条件，才算 WriteIt 架构重构完成。
