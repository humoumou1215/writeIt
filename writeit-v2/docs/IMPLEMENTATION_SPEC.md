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
│   ├── UX_SPEC.md                 # 用户可直接阅读的界面与交互约定
│   ├── PHASE_GATE_CHECKLIST.md    # 每个阶段完成前的固定验收表
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
| Settings：主题、图标、auto-save、sidebar、outline、annotation、image paste、shortcuts | `state/settings.ts`, `SettingsModal.vue` | P3/P10/P11 UI settings | 每项可 redesign，但不能无记录消失；设置界面遵循 UX_SPEC 的简体中文与左侧分组大纲合同 |
| 可配置快捷键 + 冲突检测 + 恢复默认 | settings + App key handling | P2A foundation + P3 settings | command id 与 keybinding 分离 |
| sidebar collapse/pin/resize、reveal current file、prev/next file | `App.vue`, FileTree | P3 | shell/navigation parity；reveal 入口为文件树/工作区对象右键菜单且键盘可达 |
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

## 5B. UX / 产品体验合同

从 P5 开始，架构规则与用户体验规则分开管理：

- `IMPLEMENTATION_SPEC.md`：回答“功能由谁负责、数据怎么流动、哪些边界不能破坏、Agent 这一任务具体做什么”。
- `UX_SPEC.md`：回答“用户看到什么、按钮放哪里、什么时候出现、点击/键盘操作后发生什么、Live Preview 怎么显示”。
- `PHASE_GATE_CHECKLIST.md`：回答“一个 Phase 做完以后，进入下一阶段前固定检查什么”。

`UX_SPEC.md` 必须优先使用普通用户能理解的中文。需要保留英文名时，第一次出现必须解释，例如 `Live Preview（实时预览）`、`Raw Source（源码模式）`、`Widget（编辑区里的交互控件）`。

### UX 决策规则

1. 涉及页面布局、按钮位置、菜单入口、快捷操作、Live Preview 显示方式的任务，Agent 开始前必须读取 `UX_SPEC.md` 对应章节。
2. 未在 `UX_SPEC.md` 明确的视觉细节，Agent 可以做最小实现，但不得把临时选择写成不可改变的产品规则。
3. 会改变用户主要操作方式的选择，例如“表格行操作放在右键菜单还是永久按钮”，必须先写入 `UX_SPEC.md` 或由用户确认，不能由单个实现任务静默决定。
4. Figma 是可选的视觉参考，不是数据/架构真相。若使用 Figma，已确认的页面 Frame/链接可记录在 `UX_SPEC.md`；若 Figma 与文字规则冲突，先停止实现并更新其中一方，不允许自行猜测。
5. UI 美化不能以破坏 Markdown source、DocumentStore、undo/redo、selection、clipboard、IME（中文输入法组合输入）等行为为代价。

### P5 前 UX 基线工作

在 P4 remediation（修复审查问题）期间，可以并行完善 UX 文档和原型，但不应借此绕过 P4 gate：

- **UX-01 Workspace Shell Baseline**：主页面区域、侧边栏、tabs、工具入口、右侧面板的职责。
- **UX-02 Editor Presentation Baseline**：Raw Source / Live Preview 以及 heading、link、reference、embed、code、table、Mermaid 等显示规则。
- **UX-03 Interaction Baseline**：菜单、右键、popup、keyboard、hover、dangerous action confirmation 的统一规则。
- **UX-04 Optional Figma Reference**：只在需要视觉对比或复杂交互时建立 Figma 页面；没有 Figma 不影响开发。

这些任务主要修改文档/原型，不改变当前 P4 产品代码 gate。

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
- **P3-02 Tabs & navigation**：多标签、active tab、dirty indicator、关闭未保存确认、next/prev tab、按树序 next/prev file、reveal current file。reveal 的常驻入口按 `UX_SPEC.md` 放在文件树/工作区对象右键菜单中，并保持键盘可达，不恢复为 Header 常驻按钮。
- **P3-03 Persistence policy**：manual save、configurable auto-save delay、dirty、save conflict、external file change、close/reopen。手动保存命令、快捷键和状态反馈必须保留；实现不能以可见的常驻 `Save` 按钮为前提。
- **P3-04 Workspace recovery/settings shell**：last workspace、sidebar collapse/pin/resize、基础 settings persistence；设置面板的用户可见文本使用简体中文，并提供左侧设置分组大纲、右侧独立滚动内容和键盘/焦点导航；desktop restore 通过 platform adapter 完成。
- **P3-05 Shortcut Settings UI**：展示 command/keybinding、录制、自定义、冲突检测、恢复默认；包括 editor-specific command（如 table add-row）。命令 ID、keybinding 等内部标识可以保持英文，但所有面向用户的分组、命令名称、说明、状态和操作文本使用简体中文。
- **P3-06 Attachment/Image Pipeline**：扩展明确的 binary FS port；图片 paste 支持 `root-images` / `same-dir` / `file-images` / `inline`（若 v2 决定删减必须显式记录），写盘失败可安全 fallback；Markdown 只保存相对 path 或明确 inline data。
- **P3-07 Image Projection UX**：相对路径解析显示、preview、复制图片、在 workspace tree 定位；系统文件管理器 reveal 留给 P11 adapter。Renderer/read failure 不得改写 Markdown path。
- **P3-08 Create from Template hook**：先建立“基于模板新建”的 application seam，真正 Template catalog/provider 在 P8 接入；不得把 template 逻辑硬编码进 tree component。
- **P3-09 Demo corpus / debug fixtures**：默认浏览器演示工作区必须提供可重复加载的代表性 Markdown 数据集，不能只用一篇短文和两个空壳文件。数据集至少覆盖常规 Markdown（多级标题、段落、强调、链接、引用、列表、任务列表、代码块、表格、图片/附件占位和未知语法保留）、多层 Embed/Reference、重复引用、循环/断链/只读 Embed、长正文与多文件夹层级；数据应能支持 Outline、引用/被引用、Occurrence 角标、Search、Raw/Live、Tab、dirty/save 和右键菜单的手工调试。演示 seed 只是浏览器调试入口，不得成为新的 Markdown authority，也不能替代 core/integration 的独立 fixtures。

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

### P4-UX01 — Workspace / Navigation / Completion UX Follow-up

**Goal**

把已经完成的 P2A/P3/P4 基础能力调整到 2026-09-08 已确认的交互，不重写底层架构。

**Allowed scope**

- workspace shell / tabs / navigation application
- completion popup adapter
- Reference navigation adapter
- browser tests
- `UX_SPEC.md` / Feature Map 状态同步

**Read first**

- P2A completion / raw-source rules
- P3 tabs/navigation
- P4 reference navigation
- `UX_SPEC.md` 第 3、6、7、8 节

**Implementation requirements**

- 左侧栏可折叠、可 resize；自动收纳默认关闭并有明显开关。
- Search/Git 切换不销毁或重新创建当前 editor projection。
- 当前文档在 File Tree 和 Git changed-files 中持续轻量突出；reveal current file 的明显入口位于文件树/工作区对象右键菜单，并保持键盘可达，不新增 Header 常驻按钮。
- 默认演示工作区使用代表性复杂 Markdown corpus，覆盖多层/重复/循环 Embed、正常 Markdown 结构和多文件引用关系；不得以单一短 welcome 文档作为全部手工验收数据。
- tab 支持关闭和双击关闭，dirty 保护规则一致。
- 内部文档导航支持普通 tab 打开与 split（分屏）打开；同一文档在两个 pane 中仍共享 DocumentStore。
- popup 只由真实输入 trigger 触发，光标移动到旧 `@` / `[[...]]` 不触发。
- popup 在 Raw Source 和 Live Preview 都工作。
- 文件夹候选支持 Right 进入、Left 按真实浏览历史返回并恢复上一层选择。
- File Tree 拖动文件/目录 move 仍走统一 workspace mutation，不绕过 rename/persistence/reference 处理。

**Tests**

Playwright 覆盖 sidebar state、Search/Git 切换 editor continuity、double-click close + dirty confirm、split navigation、raw-mode popup、cursor-move-no-trigger、Left/Right folder navigation、tree drag move。

**Acceptance criteria**

用户可以在不丢编辑状态的情况下切换工作区工具，并用鼠标/键盘完成导航；任何 UX 调整不建立新的 Markdown 数据副本。

**Out of scope**

Outline 的组合内容、Annotation、Mermaid、Table。

### P4-UX02 — Reference / Embed / Image Presentation Follow-up

**Goal**

落实已确认的 Reference occurrence、Embed 外观和 Image 预览入口，同时保持已有 ReferenceGraph/Projection 规则。

**Allowed scope**

- Reference decorations / occurrence mapping
- Embed projection presentation
- Image projection controls
- browser tests
- derived contracts needed by P8 Backlinks

**Read first**

- P4-02、P4-05、P4-09
- P3-07
- `UX_SPEC.md` 第 5、9 节

**Implementation requirements**

- 每个 Reference 具体出现位置有独立、派生的 occurrence identity，可显示 `①②...`；编号不写入 Markdown。
- 同一源文件两次引用同一目标时必须保留两个可精确定位的位置，供 P8 Backlinks 使用。
- Embed 外观接近 blockquote：第一行显示真实 `![[...]]` 来源；readonly 状态同时显示。
- Embed 第一行在该 Embed 滚过窗口顶部时支持 sticky（吸顶）显示，直到 Embed 结束。
- nested Embed 用多层 `>` 视觉表示，但绝不把 `>` 写回 source。
- circular Embed 第一行仍显示来源，第二行显示循环提示并停止继续展开。
- Image 单击不直接 preview；hover 显示 Preview 图标等轻量按钮，普通单击只做 focus/光斑反馈。

**Tests**

Reference duplicate-occurrence、source edit 后 occurrence remap、nested/circular Embed、sticky header、readonly、Image hover/preview-icon/browser interaction。

**Acceptance criteria**

显示效果符合 UX_SPEC，Reference/Embed/Image 的视觉增强均不修改原 Markdown；重复 Reference 可以被后续 Backlinks 精确区分。

**Out of scope**

P8 Backlinks 面板、组合大纲/字数、Mermaid。

## 11. Phase 5 — Table Engine

Phase 5 正式迁移 Markdown Table。这里不再把 parser、serializer、selection 等每个小类拆成独立任务，而是按“用户能完成一段完整操作”来拆任务。

简单解释：

- **Table Core（表格核心）**：只处理 Markdown 表格文字和行列数据，不知道页面怎么画。
- **Projection（编辑显示层）**：把 Markdown 表格显示成用户可以点、选、编辑的表格界面。
- **Source region（源码区域）**：当前表格在 Markdown 文件中占据的那一小段文字。修改表格只能改这里，不能顺手重写整篇文档。

### P5 不可破坏的规则

1. `core/table` 不依赖 CM6、Vue、DOM 或 Tauri。
2. Markdown 仍是保存格式；表格 UI 不是第二份数据。
3. 编辑一个 cell（单元格）只能生成当前 table region 的最小 Markdown 修改，不允许把整篇文档重新序列化。
4. Raw Source（源码模式）与 Live Preview（实时预览）切换时，表格内容、撤销历史、光标/选择必须尽量连续。
5. IME（中文输入法组合输入）期间不能因为 Enter/Tab 等操作误提交半成品文字。
6. 表格快捷键统一注册到 CommandRegistry / Keybinding，不建立表格私有快捷键系统。
7. row/column reorder（行列拖动排序）和 column resize（列宽调整）是 P5 最终必须能力，不再作为可永久延后的功能。
8. cell 在 UI 中允许多行显示；Markdown source 必须使用明确、可读、可 Diff 的表示方式，默认候选为 `<br>`，不得把物理换行直接写进 table row 破坏表格结构。

### P5-00 — Table UX & Behavior Contract

**Goal**

先把“表格应该怎么用”写清楚，再写主要产品代码，避免 Pi 自己决定交互。

**Allowed scope**

- `docs/UX_SPEC.md` Table 章节
- `docs/IMPLEMENTATION_SPEC.md` 的 P5 小幅澄清
- 必要时更新 `LEGACY_FEATURE_MAP.md`
- 可选 Figma / 截图参考

**Read first**

- ADR-0005
- CM6 Table Spike 结论与测试场景
- legacy Table 用户操作
- `UX_SPEC.md`

**Implementation requirements**

至少确定：

- 什么时候显示成表格，什么时候显示原 Markdown。
- **单击 cell = 选中整个 cell，不显示光标；直接输入覆盖原内容。**
- **双击 cell = 进入文字编辑，显示光标，可追加/删除/选择文本。**
- cell 选中状态：`Enter` 移动到下一行对应 cell；`Tab/Shift+Tab` 前后移动。
- cell 编辑状态：`Enter` 插入 cell 内显示换行。
- cell 内换行的 Markdown 表示方式：默认评估并优先采用 `<br>`；必须用 legacy fixture / renderer 验证后写死合同，不能让 DOM 成为唯一换行数据。
- 如何选择一个 cell、连续区域、整行、整列。
- 添加/删除行列入口放在哪里。
- 复制粘贴文本、TSV、HTML/办公软件数据时如何处理多行 cell。
- 表格语法错误或不完整时如何安全退回源码。
- column resize、row reorder、column reorder 的操作方式和显示反馈；三者均属于 P5 必须能力。
- 列宽先作为显示状态，不得为了宽度无意义改写 Markdown；是否跨重启保存另行明确。

**Tests**

本任务以文档审查为主，不要求新增产品测试。

**Acceptance criteria**

用户阅读 `UX_SPEC.md` 后，可以回答“我点哪里、按什么键、会发生什么”；Pi 不需要自己发明核心表格操作。

**Out of scope**

不实现 Table Core 或 CM6 Table Widget。

### P5-01 — Table Core

**Goal**

一次建立可测试的表格文字模型：识别、解析、修改前定位、序列化。

**Allowed scope**

- `src/core/table/**`
- 对应 unit tests / fixtures

**Read first**

- ADR-0001、ADR-0005
- P5-00
- Table Spike 中可复用的纯算法/fixtures

**Implementation requirements**

- 识别 Markdown table 的 source range。
- parser → model → serializer 明确。
- 支持 alignment、空 cell、escaped pipe 等既定 Markdown 行为。
- 支持 P5-00 确认的 cell 内逻辑换行表示（默认候选 `<br>`）在 model 中作为换行语义，而不是普通不可解释字符串。
- malformed/incomplete table（不完整或错误表格）必须返回可解释结果或安全拒绝，不能“修复”用户源码。
- 对旧项目可复制的纯逻辑重新放入 v2 边界，不 import legacy runtime。

**Tests**

- parser/serializer golden corpus。
- CRLF/LF、中文、emoji、escaped characters。
- malformed table。
- `open → no edit → save` 不改变 bytes。

**Acceptance criteria**

Table Core 可脱离浏览器运行；同一输入得到稳定结果；未知/错误输入不会被偷偷重写。

**Out of scope**

CM6 UI、鼠标选择、clipboard。

### P5-02 — Table Editing Operations

**Goal**

建立用户编辑表格时真正使用的一组核心修改操作，并保证只改当前表格区域。

**Allowed scope**

- `src/core/table/**`
- 必要的 application command / SourceChange bridge
- unit/integration tests

**Read first**

- P5-01
- DocumentStore / History / SourceChange contract

**Implementation requirements**

至少覆盖：

- edit / replace cell
- cell logical newline mutation（按 P5-00 的 source 表示）
- add/delete row
- add/delete column
- row reorder
- column reorder
- alignment mutation
- 多 cell paste 所需的矩形数据写入基础
- 每个操作生成可定位、最小范围的 Markdown change
- undo/redo 仍由 DocumentStore history 统一处理

**Tests**

- 每种操作前后 Markdown 精确断言。
- 修改 table 前后的普通正文必须 byte-for-byte 不变。
- undo/redo round trip。
- multi-view 下修改不会产生第二份 table state。

**Acceptance criteria**

操作一张表格不会导致整篇 Markdown 重写；所有变更可撤销并通过正常 DocumentStore revision 流转。

**Out of scope**

最终视觉样式、办公软件 clipboard 适配。

### P5-03 — CM6 Table Projection

**Goal**

让用户在 Live Preview 中真正可以点击和编辑表格，同时保持 Markdown 为唯一保存数据。

**Allowed scope**

- `src/editor/cm6/widgets/table/**`
- 必要的 editor projection bridge
- browser tests

**Read first**

- P5-00 ~ P5-02
- `UX_SPEC.md` Table / Live Preview
- P2 projection rules

**Implementation requirements**

- 表格识别与 Widget 显示。
- 单击 cell 进入“选中、无光标”状态；直接输入覆盖 cell。
- 双击 cell 进入“编辑、有光标”状态。
- 两种状态的 Enter/Tab/Arrow 行为严格按 P5-00 / UX_SPEC。
- 编辑状态的 cell 支持多行显示。
- keyboard navigation。
- focus/selection lifecycle。
- Raw Source ↔ Live Preview 切换安全。
- Store 更新后 table projection 正确刷新；不得从 DOM 反向当作保存真相。
- malformed table 降级回 source，不吞内容。

**Tests**

真实 browser 覆盖 click、focus、Tab/Enter、切换模式、外部 Store update、undo/redo。

**Acceptance criteria**

用户可以完成“打开文档 → 点表格 → 修改 cell → 保存 → reopen”，Markdown 正确且无额外 rewrite。

**Out of scope**

矩形 clipboard 与高级行列控制。

### P5-04 — Table Selection, Clipboard & IME

**Goal**

完成表格最容易出问题的选择、复制粘贴和中文输入。

**Allowed scope**

- table selection / clipboard core
- CM6 table adapter
- browser tests / clipboard fixtures

**Read first**

- P5-00 ~ P5-03
- Spike clipboard/IME evidence

**Implementation requirements**

- cell / rectangle selection，并区分 cell-selected 与 text-editing 两种状态。
- TSV copy/paste；多行 cell 使用明确转义/HTML clipboard 策略，不能把一格拆成多行多 cell。
- HTML clipboard（能可靠支持的部分）。
- multi-cell paste，尺寸不一致时规则明确。
- WPS 作为最低兼容基线；Excel/Numbers 若当前测试环境可覆盖则加入代表性 fixture，不能因此无限扩大本任务。
- IME composition 期间不误触 table command。

**Tests**

Playwright 覆盖鼠标选择、键盘扩选、copy/paste、中文输入、undo/redo。

**Acceptance criteria**

普通表格编辑不会因中文输入或办公软件粘贴造成内容丢失、错位或整文重写。

**Out of scope**

无限覆盖所有 Office 版本；大表格极限性能优化。

### P5-05 — Table Commands & Advanced Controls

**Goal**

把用户常用的行列操作接入统一命令/快捷键体系，并完成 P5-00 已确认的 UI 控件。

**Allowed scope**

- CommandRegistry / Keybinding integration
- table context actions / controls
- settings exposure
- browser tests

**Read first**

- P5-00 ~ P5-04
- P2A CommandRegistry / Keybinding foundation
- `UX_SPEC.md` Table 章节

**Implementation requirements**

- add/delete row/column、row/column reorder 等 command 有稳定 command id。
- context menu、hover controls 或 toolbar 按 `UX_SPEC.md` 实现。
- row reorder / column reorder 有清楚拖拽插入位置，并走同一 Table Core mutation。
- column resize 可直接拖动，属于显示状态，不为调整宽度重写 Markdown。
- 快捷键冲突由已有 Keybinding foundation 处理。

**Tests**

command unit test + browser interaction test。

**Acceptance criteria**

同一操作从菜单/快捷键触发时走同一 application command，不出现两套逻辑。

**Out of scope**

未在 P5-00 接受的高级 spreadsheet 功能。

### P5-AR1 — Table Phase Gate

**Goal**

确认 P5 不只是“功能能跑”，而是真正满足 Table 的数据安全、编辑体验和 source fidelity 要求。

**Allowed scope**

- review report / remediation task list
- 必要的测试补充
- `STATUS.md`、`LEGACY_FEATURE_MAP.md`、`UX_SPEC.md` 状态同步

**Read first**

- P5-00 ~ P5-05
- ADR-0005
- `PHASE_GATE_CHECKLIST.md`
- Table Spike acceptance evidence

**Implementation requirements**

至少重新覆盖单击选 cell / 双击文字编辑、覆盖输入、两种 Enter 行为、cell 内换行、keyboard navigation、rectangle selection、TSV/HTML clipboard、multi-cell paste、undo/redo、row/column add-delete、row/column reorder、column resize、IME、source switch safety、multi-view 和 source fidelity。

**Tests**

运行 P5 unit/integration/browser tests，并补任何 Gate 才发现的 regression test。

**Acceptance criteria**

Gate 结果只能是：

- `PASS`：可进入 P6。
- `PASS WITH FOLLOW-UP`：只有明确非阻断质量项时可进入 P6。
- `CHANGES REQUIRED / HOLD`：存在数据丢失、authority、持久化、主要用户旅程 blocker 时必须先修复。

**Out of scope**

不在 Gate 中顺手开发 P6 功能。

## 12. Phase 6 — Annotation + Mermaid

Phase 6 包含两个用户可见能力，但仍共用编辑器基础设施。为了控制任务数量，按完整使用流程拆分，不再把每个小 UI 状态拆成独立 Task。

### P6-00 — Annotation / Mermaid UX Contract

**Goal**

在实现前确认批注面板、卡片、定位方式，以及 Mermaid 预览/源码切换的用户行为。

**Allowed scope**

- `docs/UX_SPEC.md`
- 必要的 `LEGACY_FEATURE_MAP.md`
- 若长期数据格式需要新决定，可准备 ADR 提案，但本任务不实现产品功能

**Read first**

- legacy Annotation/Mermaid 用户行为和 fixtures
- P2A CommandRegistry / Completion
- P4 Reference provider
- `UX_SPEC.md`

**Implementation requirements**

确认 Annotation 右侧 drawer、正文颜色 anchor 与卡片连线、active card、reply/resolve 行为、anchor 失效提示；确认 Mermaid 在 Live Preview 总是显示渲染图、source 默认折叠/可展开、实时重渲染、hover controls、Reference 点击导航、loading/error/source fallback、slash template 入口。

**Tests**

文档审查即可；若使用 Figma，只需附已确认 frame/link。

**Acceptance criteria**

Pi 可以从文档回答主要交互，不需要自己决定布局和关键按键行为。

**Out of scope**

Annotation/Mermaid 产品实现。

### P6-A01 — Annotation Data + Anchor

**Goal**

建立 Annotation、Thread、Comment、RangeAnchor、ResolvedState 及持久化/锚点规则。

**Allowed scope**

- `src/core/annotation/**`
- `src/application/**` 中必要的 annotation contract
- unit/integration tests
- 如持久化格式改变长期数据合同，则新增/更新 ADR

**Read first**

- ADR-0001~0003
- legacy annotation fixtures
- P6-00

**Implementation requirements**

Decoration 不是数据 authority；source edit 后 anchor mapping 有明确成功/失效状态；代码块 anchor 规则明确；删除/移动内容后不能把批注错误挂到无关文本。

**Tests**

anchor mapping、文档编辑前后、undo/redo、invalid anchor、多人/多线程基础模型（若模型支持）。

**Acceptance criteria**

批注数据可脱离 CM6 测试，编辑器只负责显示/定位；失效 anchor 不产生错误定位。

**Out of scope**

完整 drawer UI、未来远程协作后端。

### P6-A02 — Annotation Thread UX

**Goal**

一次完成创建批注、查看线程、回复、resolve/unresolve、点击定位的完整流程。

**Allowed scope**

- annotation application commands
- CM6 decorations / mapping bridge
- annotation drawer/card UI
- browser tests

**Read first**

- P6-00、P6-A01
- `UX_SPEC.md` Annotation 章节
- P2 projection lifecycle rules

**Implementation requirements**

选区创建、代码块规则、Enter 发送 / Shift+Enter 换行、active card、点击卡片自然滚动正文；正文使用颜色标记；失败 anchor 有明确提示而不是静默跳错位置；关闭 drawer 不改变 source。

**Tests**

真实 browser 用户旅程、source edit 后定位、multi-view source change、resolve/unresolve、reply keyboard。

**Acceptance criteria**

从创建到回复/解决全过程可用，关闭/打开 UI 不修改 Markdown，anchor 失效可被理解和恢复。

**Out of scope**

复杂权限体系、在线同步。

### P6-A03 — Annotation Drawer Layout & Review Integration

**Goal**

完成普通编辑和未来 Diff 场景需要的 drawer 布局、宽度、active card 和定位反馈。

**Allowed scope**

- annotation drawer/panel UI
- shared panel layout
- browser layout tests / screenshot baseline

**Read first**

- P6-00、P6-A02
- `UX_SPEC.md` Workspace / Context Panel / Annotation

**Implementation requirements**

面板不能遮挡到无法编辑；resize/open state 是 UI state，不进入 Document authority；多个 annotation 时 active 状态清楚；普通编辑与 review 模式的 open policy 明确；每个可定位批注卡片与正文 anchor 有正确连线，scroll/resize/source mapping 后重新计算；点击正文 anchor 与点击右侧卡片可以互相定位。

**Tests**

browser layout states、窄窗口、多卡片、resize/open-close；必要时少量 screenshot baseline。

**Acceptance criteria**

普通编辑、窄窗口、多个批注卡片时仍可完成编辑和定位，布局变化不新增 Document revision。

**Out of scope**

P7 Git Diff 本身。

### P6-M01 — Mermaid Source-backed Preview

**Goal**

完成 fenced Mermaid source → preview → edit/source fallback 的完整流程。

**Allowed scope**

- Mermaid source detection/render adapter/widget
- editor commands needed for preview/edit
- unit/browser tests

**Read first**

- P6-00
- ADR-0001~0003
- P2 Raw/Live Preview rules
- legacy Mermaid fixtures

**Implementation requirements**

source 永远保留；Live Preview 默认始终显示渲染图；source editor 默认折叠、可展开/折叠，展开编辑时图实时刷新；render error 显示错误并能查看 source；hover 显示轻量操作按钮，普通单击只做 focus/光斑反馈；未知/非法图不丢源码；异步 render 旧结果不能覆盖新 source。

**Tests**

正常、错误、快速连续编辑、旧 render 晚到、undo/redo、Raw/Live toggle、close/detach during render。

**Acceptance criteria**

Renderer 坏了仍能看到和编辑原 Mermaid source；切换和失败不产生无关 Markdown 修改。

**Out of scope**

slash template、reference completion、高级性能优化。

### P6-M02 — Mermaid Commands, Reference Completion & Performance

**Goal**

接入 slash templates、代码块内 `@` completion，并做首版必要的按需渲染。

**Allowed scope**

- CommandRegistry provider
- existing P4 completion provider integration
- Mermaid visibility/performance adapter
- unit/browser tests

**Read first**

- P6-M01
- P2A command/completion contracts
- P4 reference completion
- `UX_SPEC.md` Mermaid

**Implementation requirements**

复用 P2A CommandRegistry 和 P4 completion provider；不能复制第二套 reference completion 业务逻辑；Mermaid source 中可解析的 WriteIt 内部 Reference 在渲染图里仍保留可点击语义，点击按普通 tab / split 两种导航策略打开；broken reference 有明确反馈；性能优化不能造成 source/diagnostics 失真；不可见区渲染策略可延后但必须有明确理由。

**Tests**

command/completion unit + browser、渲染图内部 Reference 点击（普通打开/split/broken）、scroll/visibility 代表性测试、error fallback 不受性能策略影响。

**Acceptance criteria**

模板插入和引用联想最终仍产生正常 Markdown mutation；性能策略不会让用户看到过期图或丢 source。

**Out of scope**

极端大文档性能专项。

### P6-AR1 — Annotation + Mermaid Phase Gate

**Goal**

确认 Annotation 与 Mermaid 的 source authority、错误恢复和主要交互达到可进入 P7 的质量。

**Allowed scope**

review report、必要 regression tests、remediation task、STATUS/Feature Map/UX sync。

**Read first**

P6 全部 tasks、`PHASE_GATE_CHECKLIST.md`、对应 UX_SPEC。

**Implementation requirements**

重点检查 source authority、anchor correctness、renderer failure fallback、focus/keyboard/IME、async stale result、drawer 主要布局。

**Tests**

运行 P6 unit/integration/browser suite，并补真实 blocker 的回归用例。

**Acceptance criteria**

给出 PASS / PASS WITH FOLLOW-UP / CHANGES REQUIRED-HOLD，所有 blocker 有具体 task id。

**Out of scope**

不开始 P7 实现。

## 13. Phase 7 — Git + Diff + Provenance

Git/Review 是完整工作台，不只是一张 Diff 组件。核心要求是：任何富显示失败时，用户仍能看到真实 Markdown change；任何 Git blame（行作者信息）都不能把本地未提交内容错误算到旧 commit 上。

### P7-00 — Git / Diff UX & Port Contract

**Goal**

在实现前确认 Git 工作台入口、Diff 布局、Blame gutter（编辑器行旁作者/时间）和 File History 用户流程，同时冻结 Git adapter 的最小能力。

**Allowed scope**

- `UX_SPEC.md` Git/Diff/Blame
- Git port/interface 文档或类型草案
- Feature Map / ADR clarification

**Read first**

- ADR-0006
- legacy Git/Diff journeys
- `UX_SPEC.md`

**Implementation requirements**

确认 branch/worktree/history/range comparison、split/unified、discard、blame、file history 的页面入口；定义 GitRepositoryPort / GitBlamePort 需要的数据，不让 UI 解析人类可读 CLI 输出。

**Tests**

文档/type contract review；无需完整产品测试。

**Acceptance criteria**

后续任务不用重新讨论“从哪里进入、看到什么、Port 返回什么基本字段”。

**Out of scope**

真实 Git 命令实现、Diff UI。

### P7-01 — Git Repository Data + Browser Mock

**Goal**

提供 repo info、branch、worktree status、history、file diff/content、file history、blame 的平台边界和 browser/mock 实现。

**Allowed scope**

- platform/git port
- browser/mock adapter
- application query contracts
- tests

**Read first**

- P7-00
- architecture dependency rules

**Implementation requirements**

Core/UI 不直接执行 git command；错误/非 Git workspace 有明确结果；mock 可构造 rename、dirty、untracked、command failure；machine-readable result 在 adapter 内标准化。

**Tests**

adapter contract、error cases、mock fixtures、integration。

**Acceptance criteria**

后续 UI 可以只依赖统一 port，测试不要求本机一定有特定 Git 历史。

**Out of scope**

Workbench UI、discard。

### P7-02 — Workbench Navigation & Comparison Targets

**Goal**

完成 repo/branch/worktree/history 导航以及 worktree vs HEAD、commit、two-commit range comparison。

**Allowed scope**

- Git application queries/commands
- review/workbench UI
- browser tests

**Read first**

- P7-00、P7-01
- `UX_SPEC.md` Git Workbench

**Implementation requirements**

branch switch/filter、worktree file list、history/commit file list、comparison target model；当前 dirty Document 与 Git baseline 区分清楚；branch switch failure 不改变 UI 为假成功。

**Tests**

application + browser 用户旅程，含 empty/non-git/error state。

**Acceptance criteria**

用户可以从 workspace 到指定比较目标，不靠隐藏调试入口，错误状态明确。

**Out of scope**

完整 text diff renderer、discard。

### P7-03 — Raw/Text Diff Guarantee

**Goal**

一次完成 Raw Diff guarantee 和首版 split/unified 文本 Diff UX。

**Allowed scope**

- core/diff guarantee
- review diff application/UI
- tests/fixtures

**Read first**

- ADR-0006
- P7-01、P7-02
- `UX_SPEC.md` Diff

**Implementation requirements**

`Raw Diff → optional semantic enhancement → renderer`；每个 raw change 都必须能显示；line + word highlight、hunk fold/navigation、current/total；renderer failure 退回 source diff。

**Tests**

rawChangeCount == represented raw changes；semantic failure fixtures；browser split/unified/navigation；large representative diff 基本性能。

**Acceptance criteria**

不存在“因为富渲染失败而看不到真实修改”；raw source 始终是保证层。

**Out of scope**

Table/Mermaid rich diff、discard、blame。

### P7-04 — Discard/Revert + Workspace Integration

**Goal**

完成 file/hunk discard、确认与失败处理，并接入文件树 Git 状态、当前文件 diff 入口和快捷键。

**Allowed scope**

- Git destructive application commands
- workspace/review integration
- confirmation UI
- tests

**Read first**

- P7-01~03
- P3 persistence/dirty policy
- `UX_SPEC.md` Dangerous Actions

**Implementation requirements**

只有可编辑 target 能 discard；dirty/open Document 必须走明确冲突策略；失败不能让 UI 假装已回滚；file/hunk discard 后 Store/FS/Git status 一致。

**Tests**

成功/失败/dirty conflict/browser confirmation、partial hunk、external change where applicable。

**Acceptance criteria**

破坏性操作可追踪、可失败、不会静默丢本地工作。

**Out of scope**

rich diff、blame。

### P7-05 — Rich/Semantic Diff

**Goal**

在 Raw Diff 已可靠的基础上增强 Table/Mermaid/Embed 等显示。

**Allowed scope**

- semantic diff providers
- review renderer/UI
- annotation/change explanation integration if retained
- tests

**Read first**

- P7-03
- P5 Table、P6 Mermaid、P4 Embed contracts

**Implementation requirements**

增强失败只允许 degraded to source diff；raw change coverage 可诊断；Change Explanation 若保留，建模为 review-derived data，不进入 Markdown authority。

Mermaid semantic diff 额外要求：

- 至少能对已声明支持的图类型识别 added/removed nodes/edges。
- 绿色表示新增，红色表示删除；“修改”优先表达为旧结构红 + 新结构绿。
- 例如 flowchart 删除 B、增加 D 时，B 及相关 removed edges 为红，D 及 added edges 为绿。
- 每种 Mermaid diagram type 有明确 support matrix；无法可靠匹配 node identity 时必须退回 before/after 或 source diff，不能猜。
- Mermaid rich diff 只是增强层，Raw Diff 始终完整存在。

**Tests**

每类 enhancement 成功+失败 fallback、raw coverage assertions。

**Acceptance criteria**

rich renderer 永远不是 change existence 的唯一证据。

**Out of scope**

Blame/File History。

### P7-06 — Git Blame + File History

**Goal**

一次完成行作者/时间、commit drill-down、dirty/local semantics、file history。

**Allowed scope**

- GitBlame/FileHistory port data
- application mapping/cache
- CM6 gutter / review UI
- browser/integration tests

**Read first**

- P7-00、P7-01
- P2 Raw/Live Preview mapping rules
- `UX_SPEC.md` Blame

**Implementation requirements**

- provenance 定位对象是 Markdown source line/range。
- 至少返回 commitId、author name/email、author time、summary、original path/line（可得时）。
- 本地新增/修改行显示 `Uncommitted / Local changes`，不能借用相邻旧行作者。
- 未改动且能可靠映射的行继续显示历史作者。
- Live Preview 折叠多行时不得把整个 Widget 错归为一个 commit；必要时显示 compact marker 并可回源码查看。
- click/hover 用 commitId 打开 commit detail/diff。
- File History 至少显示 author、date/time、commit id、summary；rename history 支持 `--follow` 等价能力或明确提示中断。
- blame/history 可缓存，但 HEAD/path/options 变化必须失效，不能每次移动光标都重新跑完整 blame。

**Tests**

不同 commit 多行、dirty modification、new local line、untracked/non-git、toggle blame 不产生 DocumentStore revision、file history drill-down、cache invalidation。

**Acceptance criteria**

用户能够可靠回答“这一行是谁什么时候提交的”和“这个文件由谁在什么时候改过”，本地改动不被错误归因。

**Out of scope**

高级 movement/copy detection 可作为 quality follow-up，但 port 设计不得阻止。

### P7-AR1 — Git + Diff Phase Gate

**Goal**

确认 Git/Review 功能在真实失败路径下仍可靠，尤其是 raw diff 和 destructive operations。

**Allowed scope**

review report、regression tests、remediation tasks、docs/status sync。

**Read first**

P7 全部 tasks、ADR-0006、`PHASE_GATE_CHECKLIST.md`。

**Implementation requirements**

重点检查 raw change 100% representation、discard 数据安全、dirty/local blame、Git failure fallback、主要导航路径和基本性能。

**Tests**

运行 P7 unit/integration/browser/E2E（若已有），增加 blocker regression tests。

**Acceptance criteria**

给出明确 Gate 结果；任何 raw change omission、错误 discard、false blame attribution 均阻断 P8。

**Out of scope**

不开始 P8。

## 14. Phase 8 — Derived Services + Template Intelligence

Outline、Search、Backlinks、Validation、Template rules、Suggestions 都是从 Markdown 推导出来的结果，不能建立第二份 Document 数据。

### P8-00 — Search / Panel / Template UX Contract

**Goal**

确认 Search、左侧 Outline、Backlinks、状态栏组合统计、Validation issue、Template picker/placeholder 的位置和主要交互。

**Allowed scope**

`UX_SPEC.md`、Feature Map、必要的 command/provider contract clarification。

**Read first**

legacy Search/Outline/Template journeys、P2A commands/completion、P4 ReferenceGraph。

**Implementation requirements**

写清“在哪里搜、怎么跳、怎么替换、模板从哪里建/插入、错误在哪里看、面板怎么开关”。

**Tests**

文档审查。

**Acceptance criteria**

Pi 不需要自行设计 Search/Template 主工作流。

**Out of scope**

产品实现。

### P8-01 — Workspace Search + Precise Navigation

**Goal**

完成全文搜索、case sensitivity、按文件分组、缓存失效，以及精确跳到 occurrence 并高亮。

**Allowed scope**

search/index core/application、Search UI、CM6 highlight adapter、tests。

**Read first**

P8-00、P4 derived-index rules、`UX_SPEC.md` Search。

**Implementation requirements**

Widget/atomic region 命中无法精确定位时必须有解释性 fallback；open document 与 disk source 的选择策略明确；Document change/rename/delete 后 index 正确失效。

**Tests**

index unit、cache invalidation、browser precise jump/highlight、widget fallback。

**Acceptance criteria**

每个搜索结果都能稳定到达对应文档位置或明确说明为什么只能降级定位。

**Out of scope**

Replace。

### P8-02 — Replace with Dirty/Conflict Policy

**Goal**

完成 replace selected / replace all，并明确 dirty/open documents 的处理。

**Allowed scope**

search/replace application commands、persistence integration、UI、tests。

**Read first**

P8-01、P3 persistence/conflict policy、`UX_SPEC.md` Search/Replace。

**Implementation requirements**

替换必须通过 application command；不能隐式跳过 dirty 文件；批量失败给逐文件结果；不得覆盖未确认的外部修改；可撤销的 open-document replace 与 disk-only replace 边界明确。

**Tests**

open dirty、closed file、external conflict、partial failure、undo where applicable。

**Acceptance criteria**

用户知道哪些替换成功/失败，失败不会造成静默数据丢失。

**Out of scope**

模板功能。

### P8-03 — Outline + Backlinks + Composed Content Stats

**Goal**

完成 heading hierarchy、点击跳转、active tracking、Backlinks 精确 occurrence navigation，以及底部状态栏需要的组合字数/引用/Embed 统计。

**Allowed scope**

outline/backlink/composed-content derived services、左侧 Outline UI、Backlinks UI、status bar stats、CM6 navigation adapter、tests。

**Read first**

P8-00、P4 ReferenceGraph、P4-UX02 occurrence contract、`UX_SPEC.md` 第 3、5、9 节。

**Implementation requirements**

index 是派生状态；Outline 独立位于左侧，可与 File Tree/Annotation 同时显示；hover/current heading、正文滚动跟随、Outline 自身自动滚动、点击自然滚动均按 UX_SPEC。

建立 cycle-safe 的“组合内容”查询：当前 root document + 实际显示的 Embed 内容递归组成用户看到的结构，但不复制/保存到 root Markdown。组合内容至少供：
- word count；
- Reference / Embed count；
- Outline headings。

同一个 Embed 出现两次按两次用户可见内容计算；circular embed 在循环提示处停止。

Backlinks 必须保留具体 occurrence：A.md 两次引用 B.md 时，B 的 Backlinks 可显示 `A.md ① ②`，两个入口分别滚动到正确 source occurrence；Reference 正文角标与 Backlinks occurrence 使用同一派生定位依据。

source change 后 active heading/backlinks/stats 刷新；broken backlink 有明确状态。

**Tests**

index/composed-content unit、nested/circular/repeated Embed stats、source update、duplicate-reference occurrence、browser Outline follow-scroll/natural-scroll、Backlinks ①② precise navigation。

**Acceptance criteria**

大纲/反链/状态栏统计不会成为第二 truth；用户看到的 Embed 标题/字数得到一致体现；重复 Reference 可以精确跳到每一次实际出现位置。

**Out of scope**

Validation/Templates。

### P8-04 — Validation + Strict Save Gate

**Goal**

完成 rule execution、issue surface、automatic validation 和 strict save policy。

**Allowed scope**

core/validation、application save policy、issue UI、tests。

**Read first**

P3 persistence、P8-00、legacy validation behavior。

**Implementation requirements**

是否允许保存由 application policy 决定，不让 CM6 plugin 自己拦磁盘写入；规则失败有隔离；strict/non-strict 模式和用户反馈清楚。

**Tests**

rule failures、strict/non-strict save、issue navigation、validation stale result。

**Acceptance criteria**

Validation 可以阻止/提醒保存但不能成为 Markdown authority，规则崩溃不破坏编辑。

**Out of scope**

Template rules provider（P8-06 接入）。

### P8-05 — Template Catalog, Create/Insert & Placeholder

**Goal**

形成可用模板主流程：扫描 → 选择 → 新建/插入 → placeholder 替换。

**Allowed scope**

Template catalog/application、P3 create hook、P2A slash integration、placeholder decoration/UI、tests。

**Read first**

P8-00、P3-08、P2A CommandRegistry、legacy template fixtures。

**Implementation requirements**

`.template/` + doctype；workspace/global 优先级；tree change 可 rescan；扫描失败降级；接 create-from-template 和 slash；placeholder 是 source-backed decoration，整体替换但不建立第二 authority。

**Tests**

catalog priority/rescan/failure、create/insert、placeholder keyboard/click/browser、source fidelity。

**Acceptance criteria**

用户可以从模板新建/插入并继续正常编辑 Markdown；模板服务失败不会破坏现有文档。

**Out of scope**

rules.ts、dynamic suggest、最终 export。

### P8-06 — Template Rules, Dynamic Suggestion & Export Contract

**Goal**

接入 `rules.ts`、静态/动态 `suggest.ts`、P4 entity completion，并建立 `export.ts` 与 P9 的合同。

**Allowed scope**

Template provider contracts/application integration、P4 completion integration、P8 validation integration、tests。

**Read first**

P8-04、P8-05、P4 Entity Completion、legacy template suggest/rules/export。

**Implementation requirements**

`objectsFor(ctx)` 上下文覆盖 paragraph、heading、task、table、file/object ref 等实际需求；无 suggest 时 fallback heading；provider failure 隔离；Template service 不直接执行最终 export。

**Tests**

provider unit/integration、completion integration、rule provider failure、dynamic context fixtures。

**Acceptance criteria**

模板 intelligence 可替换/失败降级，不污染 Document authority，P9 有稳定 export provider contract。

**Out of scope**

实际 PDF/DOCX export。

### P8-AR1 — Derived Services Phase Gate

**Goal**

确认 Search/Replace/Outline/Validation/Template 在数据更新和失败场景下保持一致。

**Allowed scope**

review、regression tests、remediation、docs sync。

**Read first**

P8 全部 tasks、`PHASE_GATE_CHECKLIST.md`。

**Implementation requirements**

重点检查 Search 精确性、Replace 数据安全、Validation save policy、Template full journey、index freshness/provider failure。

**Tests**

运行全部 P8 tests；至少一个 E2E 覆盖 search → precise jump → replace 和 template create/insert。

**Acceptance criteria**

数据丢失、错误批量替换、stale index 导致错误写入均必须 HOLD。

**Out of scope**

不开始 P9。

## 15. Phase 9 — Export

### P9-00 — Export UX & Contract

**Goal**

确认单文件/多文件导出入口、格式选择、输出路径/文件名、失败结果展示；定义 `DocumentSnapshot + ExportContext` 输入。

**Allowed scope**

UX_SPEC Export、export port/contracts、Feature Map。

**Read first**

legacy ExportModal/exporters、P8 template export provider contract、ADR-0001。

**Implementation requirements**

定义 exporter 输入、输出结果、错误模型、batch item；不把当前 CM6 DOM 作为唯一输出来源。

**Tests**

contract/type tests 可选，主要文档审查。

**Acceptance criteria**

后续 exporter 可以完全从 snapshot/context 工作，用户能理解导出入口和失败结果。

**Out of scope**

具体格式实现。

### P9-01 — Built-in Markdown / PDF / DOCX Export

**Goal**

一次完成三种内建 exporter 及代表性格式测试。

**Allowed scope**

platform/export、application export orchestration、必要 UI、tests。

**Read first**

P9-00、P3 image/reference path rules、P8 templates。

**Implementation requirements**

明确图片/reference/template 如何处理；单个 exporter 失败不污染 Document；输入来自 snapshot；输出文件名/路径规则稳定。

**Tests**

golden/structural tests、图片/表格/reference/Unicode 代表性文档。

**Acceptance criteria**

同一文档可稳定导出 Markdown/PDF/DOCX，并有可读错误；导出不修改 source。

**Out of scope**

custom provider、batch mixed-format。

### P9-02 — Custom Template Export + Batch Export

**Goal**

接 P8 `export.ts` provider，支持多文件各自选择格式和逐项结果。

**Allowed scope**

custom exporter provider runner、batch orchestration/UI、tests。

**Read first**

P9-00、P9-01、P8-06。

**Implementation requirements**

batch 中一项失败不隐瞒其他项结果；filename conflict 策略明确；custom provider 有权限/错误边界；每个文件可以不同格式。

**Tests**

mixed-format batch、partial failure、name collision、custom exporter failure。

**Acceptance criteria**

用户能明确知道每个文件的输出位置/格式/成功失败，部分失败不让整个 batch 结果模糊。

**Out of scope**

新的外部云导出服务。

### P9-AR1 — Export Phase Gate

**Goal**

确认 Export 的 source correctness、格式覆盖和批量失败语义。

**Allowed scope**

review、tests、remediation、docs sync。

**Read first**

P9 全部 tasks、`PHASE_GATE_CHECKLIST.md`。

**Implementation requirements**

检查 Markdown/PDF/DOCX/custom/batch、snapshot source、图片/引用策略、partial failure、export 不修改 Document。

**Tests**

运行 exporter tests + 代表性 end-to-end export journey。

**Acceptance criteria**

错误输出、source mutation、batch silent failure 均不能 PASS。

**Out of scope**

不开始 P10。

## 16. Phase 10 — Observability / Diagnostics

简单解释：Diagnostics（诊断）是“应用出问题时能直接看到发生了什么”，不只是开发者 Debug Panel。

### P10-00 — Diagnostics & Privacy Contract

**Goal**

确定哪些诊断数据默认保留、哪些只能用户主动勾选进入报告，例如 screenshot、DOM、document content、full path。

**Allowed scope**

Diagnostics contract/UX/privacy docs、必要 ADR/Feature Map。

**Read first**

legacy diagnostics/debug、现有 Event Timeline、UX_SPEC Error/Diagnostics。

**Implementation requirements**

隐私选项显式；报告能说明包含哪些敏感内容；默认不悄悄收集完整文档/绝对路径/截图。

**Tests**

文档/contract review。

**Acceptance criteria**

开发者和用户都能理解“报告里会带什么、不带什么”。

**Out of scope**

诊断 UI 和 agent transport 实现。

### P10-01 — Runtime Diagnostics

**Goal**

统一 Document/Projection、timeline、error ring、performance samples、Diff coverage、Reference health 等运行状态。

**Allowed scope**

observability core/application、bounded buffers/cache、tests。

**Read first**

P10-00、P1 Event Timeline、P2 Projection diagnostics、P7 diff health、P4 refs health。

**Implementation requirements**

能回答 revision、persistedRevision、projection list、stale/degraded/source-fresh、最近修改/保存事实；诊断本身失败不能破坏编辑；内存有界。

**Tests**

failure isolation、bounded memory、representative facts、malformed error object。

**Acceptance criteria**

诊断信息可靠且不会成为业务依赖或第二 truth。

**Out of scope**

最终报告 UI、LAN debug。

### P10-02 — Diagnostics UI & Report Package

**Goal**

提供异常 badge、timeline/debug view 和用户可生成的诊断包。

**Allowed scope**

Diagnostics UI、report builder/storage port、privacy UI、browser/integration tests。

**Read first**

P10-00、P10-01、UX_SPEC Errors/Context Panel。

**Implementation requirements**

privacy selections 清楚；生成报告失败不影响文档；可选 screenshot/DOM/content/path；report 对缺失诊断项容错。

**Tests**

browser UI、package content assertions、privacy exclusions、report failure。

**Acceptance criteria**

用户能生成可用于排障的报告，并能明确控制敏感内容。

**Out of scope**

Agent debug transport。

### P10-03 — Agent Debug API & Transport

**Goal**

等 v2 Diagnostics 稳定后，再建立 `writeit-v2` agent/debug API，并决定 off/local/lan 与 LAN 高风险 exec 限制。

**Allowed scope**

agent/debug API、transport、permission policy、tests；必要的 `.pi` v2 resource 更新。

**Read first**

P10-00~02、legacy debug protocol、desktop security requirements。

**Implementation requirements**

不得直接搬 legacy 私有状态协议；API 用 documents/projections/timeline/diff.health/refs.health/performance 等语义数据；LAN 权限单独安全设计；默认拒绝未授权高风险动作。

**Tests**

permission/transport/API contract、unauthorized attempts、disconnect/reconnect。

**Acceptance criteria**

Agent 能诊断但不能绕过正常数据/权限边界，LAN 模式安全规则明确。

**Out of scope**

Tauri-specific transport implementation可留 P11。

### P10-AR1 — Diagnostics Phase Gate

**Goal**

确认诊断是可靠旁路能力，不会反向影响文档业务和隐私。

**Allowed scope**

review、tests、remediation、docs sync。

**Read first**

P10 全部 tasks、`PHASE_GATE_CHECKLIST.md`。

**Implementation requirements**

重点检查诊断 failure isolation、privacy defaults、report correctness、agent permission。

**Tests**

运行 P10 suite + privacy/security regression。

**Acceptance criteria**

敏感数据默认泄漏、诊断导致编辑失败、Agent 越权均必须 HOLD。

**Out of scope**

不开始 P11。

## 17. Phase 11 — Tauri + Desktop Platform

Phase 11 才把稳定的 browser 架构接到真正桌面能力。Tauri command 只是平台实现，不得直接进入 Document Core。

### P11-00 — Desktop Capability Contract

**Goal**

列出 browser mock 到 desktop adapter 的映射：FileSystem、Binary/Attachment、Git、Window、Dialogs、Export、Diagnostics storage、reveal in explorer、workspace restore。

**Allowed scope**

platform contract/docs、UX desktop behavior、Feature Map、必要 ADR clarification。

**Read first**

P3/P7/P9/P10 ports、legacy Tauri integration、UX_SPEC。

**Implementation requirements**

每项都有明确 Port/Adapter owner；平台调用不散落进 UI/Core；Windows/macOS 差异记录。

**Tests**

contract review。

**Acceptance criteria**

所有 desktop 能力都有 owner 和 adapter contract，Pi 不需要临时从 Vue 组件直接 call Tauri。

**Out of scope**

实际 adapter implementation。

### P11-01 — Desktop FS / Window / Dialog / Recovery

**Goal**

完成文件系统、打开/恢复 workspace、reveal file/dir/image、窗口/titlebar、dialogs 等基本桌面旅程。

**Allowed scope**

Tauri FS/Binary/Window/Dialog adapters、workspace recovery integration、platform tests。

**Read first**

P11-00、P3 persistence/workspace、P3 image、UX desktop journey。

**Implementation requirements**

不绕过 application save/conflict/delete policy；last workspace restore 有失败/不存在路径处理；reveal failure 不修改文档。

**Tests**

adapter contract + 少量真实 desktop E2E。

**Acceptance criteria**

open → edit → save → close → reopen 在 desktop 真实文件系统成立；平台错误不造成 ghost state。

**Out of scope**

Git/export/diagnostics adapters。

### P11-02 — Desktop Git / Export / Diagnostics Adapters

**Goal**

把 P7/P9/P10 的 browser/mock ports 接到 Tauri/desktop 实现。

**Allowed scope**

Tauri Git/Export/Diagnostics storage adapters、integration tests。

**Read first**

P11-00、P7 ports、P9 export contracts、P10 diagnostics contracts。

**Implementation requirements**

不绕过 application policy；Git command/result 解析留在 adapter；export/diagnostics storage failure 有明确错误；browser mock contract 与 desktop behavior 对齐。

**Tests**

contract parity、Git command failure、export failure、storage failure。

**Acceptance criteria**

同一 application code 可在 browser mock 与 desktop adapter 上工作，不需要 desktop-only 业务分支散落各处。

**Out of scope**

packaging/performance profile。

### P11-03 — Packaging & Performance Profile

**Goal**

完成 Windows/macOS packaging，并重新评估 legacy lite mode / WebView2 GPU blacklist / occlusion options。

**Allowed scope**

Tauri/build config、platform settings/performance profile、packaging smoke tests。

**Read first**

P11-01/02、legacy performance options、实际目标部署环境。

**Implementation requirements**

只有真实性能证据需要时才保留 lite/performance settings；建模为 platform performance profile，不进入 editor/core；Windows/macOS config 明确。

**Tests**

build/package smoke、代表性低性能/无 GPU 环境检查（能力允许时）。

**Acceptance criteria**

两个目标平台可生成可启动产物；性能兼容选项有证据而不是历史包袱。

**Out of scope**

Linux packaging，除非后续明确加入目标。

### P11-04 — Desktop Debug Transport Security

**Goal**

实现已在 P10 决定的 local/lan debug transport 与权限限制。

**Allowed scope**

Tauri/local LAN transport、安全/权限 UI、tests。

**Read first**

P10-03、P11-00、legacy LAN debug restrictions。

**Implementation requirements**

LAN 默认不开放高风险 exec；授权/绑定/错误状态明确；不能因为 debug channel 影响普通编辑；关闭 debug 后端口/资源正确释放。

**Tests**

local/lan permissions、unauthorized attempts、shutdown/restart lifecycle、network failure。

**Acceptance criteria**

debug transport 可用且默认安全，不产生后台残留或越权入口。

**Out of scope**

新的远程云控制平台。

### P11-AR1 — Desktop Phase Gate

**Goal**

确认 v2 browser 架构在桌面环境仍保持数据和边界正确。

**Allowed scope**

review、desktop regression tests、remediation、docs sync。

**Read first**

P11 全部 tasks、`PHASE_GATE_CHECKLIST.md`、P3/P7/P9/P10 gates。

**Implementation requirements**

重点检查真实文件数据安全、platform adapter 边界、Windows/macOS 基本可用、Git/Export/Diagnostics parity、debug transport 安全。

**Tests**

desktop smoke/E2E + adapter suites + package verification。

**Acceptance criteria**

真实文件覆盖/丢失、平台调用越界、debug 越权、无法启动/保存的目标平台均必须 HOLD。

**Out of scope**

Phase 12 parity review 本身。


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

对布局和 Live Preview 这种纯文字断言很难发现的问题，允许维护**少量关键 screenshot baseline（截图基线）**，例如 workspace shell、Markdown Live Preview、reference popup、embed、table、annotation、Git diff。不要对每个小组件做像素级截图测试；只锁用户真正关心的关键状态。

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

## 23. Agent Task / Codex Goal Contract

每个任务继续包含：

```text
Goal                 这次要解决什么
Allowed scope        允许修改哪些区域
Read first           开始前必须读什么
Implementation requirements  必须做到什么
Tests                怎么证明
Acceptance criteria  什么叫真正完成
Out of scope         这次明确不做什么
```

### Task 粒度规则

前面的 P0~P2 拆得细是必要的，因为当时在建立 DocumentStore、Projection、持久化等地基。后续不需要机械保持相同粒度。

从 P5 起优先按 **vertical slice（完整操作流程）** 合并任务。简单说：一个 Task 最好让用户或测试能够完成一段完整行为，而不是只创建一个 class/file。

例如 Table 推荐：

```text
不推荐：parser 一个 task、serializer 一个 task、addRow 一个 task、deleteRow 一个 task
也不推荐：一个 task 实现整个 Table
推荐：Table Core / Editing Operations / CM6 Editing / Selection+Clipboard / Commands
```

只有遇到以下高风险边界时才继续拆小：

- 谁拥有 Markdown 数据发生变化。
- 一次操作会同时修改多个 Document 或多个文件。
- 保存/rename/delete/external file conflict。
- async lifecycle（异步加载、关闭、重试）容易造成旧状态覆盖新状态。
- Git discard 等破坏性操作。
- 需要修改 Accepted ADR。

普通 UI 菜单、一组相邻命令、同一用户旅程中的几个小组件可以放在同一个 Task。

默认执行模式仍然是一次一个 Task ID。用户启动并明确引用 [`GOAL.md`](./GOAL.md) 的 Codex Goal 时，Goal checkpoint 可以按已声明顺序包含多个 Task ID；这不改变每个 Task 的 scope、tests 和 acceptance criteria，只改变 checkpoint 通过后是否自动继续。

Goal 的 objective、允许范围、checkpoint、统一验证、暂停条件和完成条件以 `GOAL.md` 为准；已预先冻结或允许自适应的产品选择以 [`DECISIONS.md`](./DECISIONS.md) 为准。Goal 不得把 open backlog 当成完成标准，也不得在执行中静默扩大范围。

### Task 开始前的 UX 规则

只要 Task 会改变用户看到/点击/输入的东西，`Read first` 必须包含 `docs/UX_SPEC.md` 对应章节。若该章节还没有决定核心交互，先完成 UX 文档小任务，不允许 Agent 自己冻结产品行为。

## 24. Codex 执行纪律

```text
Read → Inspect → Implement → Test → Update STATUS → Report
```

补充规则：

1. 有 UI/交互时先读 `UX_SPEC.md`。
2. 每个 Phase 完成前运行 `PHASE_GATE_CHECKLIST.md`，不是只看 tests green。
3. 小型实现选择可以自行选择并记录；普通 Task 中会改变 ADR 或主要用户操作方式的选择必须停止并提出决策。Codex Goal 中按 `DECISIONS.md` 的 `FROZEN` / `MAY ADAPT` / `MUST ASK` 分类处理。
4. Legacy 行为不清晰时查 `LEGACY_FEATURE_MAP.md` 和旧测试，不要无目的扫描整个旧项目。
5. 普通任务不自动开始下一个 Task；Codex Goal 的 checkpoint PASS 后自动继续。Gate 为 HOLD 时先建立 remediation、修复并复审，不因 HOLD 本身等待用户。
6. 测试通过不是数据安全证明；涉及 rename/delete/save/clipboard/async lifecycle 时必须补失败/恢复路径。
7. Goal checkpoint 使用 `npm run verify:fast`；Phase Gate、跨浏览器交互或 checkpoint 收尾使用 `npm run verify`。平台阶段另加对应 desktop/package 验证。
8. Goal checkpoint 验证通过并同步 STATUS/GOAL 后可自动创建本地 commit；禁止自动 push、tag、签名、发布或创建 release。

## 25. 推荐执行节奏

### 已完成的前半程

P0~P4 按既有历史和 remediation/gate 记录继续维护，不因为本次 SPEC 调整重写历史任务。

### 当前建议

P4-AR2 已 PASS。开始 P5 前先在 Codex Goal 的 G0 checkpoint 对 P4-UX01、P4-UX02 以及 production Embed loader failure/retry 证据做一次显式 reconciliation：已满足的条目补证据，未满足的条目实现并验证。随后按 `GOAL.md` 的 G1～G8 连续推进 P5～P12。

每个 Phase 原则上只做一次正式 Phase Gate。只有中途出现新的数据 authority、持久化模型、跨 Document transaction、平台边界或 ADR 修改时，才额外做中途 Architecture Review。


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
