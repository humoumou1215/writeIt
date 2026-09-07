# WriteIt Legacy Feature Map

> P0-04 产物。本文把 `editor-app/` 中已存在的能力映射到 v2 的目标边界。
> `editor-app/` 仅是行为、fixture、测试和纯算法的参考实现；`writeit-v2/` 禁止对其建立 runtime import。
>
> `Strategy` 使用本任务允许的五种分类：`KEEP BEHAVIOR`、`COPY PURE CODE`、`REWRITE`、`DROP`、`DEFER`。这是迁移策略，不是 Phase 12 的最终 parity 状态。当前没有足够证据主动将任何能力归为 `DROP`。

## Strategy meanings

- **KEEP BEHAVIOR**：保留已验证的用户可见语义和边界，但在 v2 的新依赖方向中重新实现适配器或 projection。
- **COPY PURE CODE**：只可提取与 UI、DOM、CodeMirror、Vue、Tauri 无关的纯算法；必须在 v2 中重新归属并补充测试，不能跨目录 import。
- **REWRITE**：旧版状态模型、所有权或 UI 耦合不符合 v2 不变量，按 v2 owner 重新设计。
- **DROP**：明确不再提供的能力。当前没有项目级确认项。
- **DEFER**：保留为候选能力，等对应 Phase / Feature Parity Review 再决定；不表示已经删除。

## Capability map

| Capability | Legacy Location | v2 Owner | Strategy | Migration notes / evidence |
|---|---|---|---|---|
| FileSystem | `editor-app/src/fs/{types,index,dev,mock,web,tauri}.ts`；`src/state/treeOps.ts` | `platform/filesystem` | `KEEP BEHAVIOR` | 保留 mock/web/Tauri adapter 的可替换边界和文件树语义；v2 先定义 `FileSystemPort`，Core 不依赖具体平台。可参考旧版 `fs` 接口，但不复制 Tauri/DOM 实现。 |
| Document state | `editor-app/src/editor/docstore/{model,serialize,posmap,store,bridge}.ts`；`src/editor/manager.ts` | `core/document` | `REWRITE` | 旧版 docstore 和 manager 是重要行为证据，但 v2 必须以单一 `DocumentStore`、Markdown authority、revision 和 persisted revision 为准。相关 runtime-layer 规格与测试仅作迁移输入。 |
| Multi tabs | `editor-app/src/state/store.ts`；`src/editor/manager.ts`；`src/components/{TabBar,TabContextMenu,EditorPane}.vue` | `application` + `ui/workspace` | `REWRITE` | 旧版每标签 Crepe 实例和可见性切换可作为 UX 参考；v2 tab 是 Document/Projection 的工作区编排，不得产生第二份 Document 内容 authority。 |
| References | `editor-app/src/editor/ref/`；`src/editor/manager.ts`；`src/components/RefEditorMenu.vue` | `core/reference` | `REWRITE` | 参考 `remark-ref.ts`、`resolve.ts`、`stringify.ts`、`nodes.ts` 和相关嵌套/循环 fixture；v2 重新实现 `ReferenceParser`、`ReferenceIndex`、`ReferenceGraph`。 |
| Editable Embed | `editor-app/src/editor/ref/{file-block-view,embed-chain,writeback,app-plugin}.ts`；`src/editor/docstore/` | `editor/cm6/projection` + `application` | `REWRITE` | 旧版可编辑嵌入、嵌套、写回和同步测试是行为参考；v2 Embed 是 source Document 的 projection，编辑必须通过 DocumentStore，不得持有副本。 |
| Table | `editor-app/src/editor/table/{schema,command,keymap,clipboard,column-width,config,index}.ts`；`tests/e2e/table-*.js` | `core/table` + `editor/cm6/widgets/table` | `COPY PURE CODE` | 仅提取 parser/serializer、selection 和局部操作等纯算法思路；CM6 widget、clipboard 和生命周期全部在 v2 重新实现。编辑限制在当前 table region，不能重写整个文件。 |
| Annotation | `editor-app/src/annotations/`；`src/components/AnnotationDrawer.vue`；`src/editor/ref/` 中的嵌入定位逻辑 | `core/annotation` + `ui/review` | `REWRITE` | 旧版 annotation mark、thread/card、嵌入定位和 diff/validation 卡片可作为 fixture；v2 以 `Annotation`、`Thread`、`RangeAnchor`、`ResolvedState` 为 domain，Decoration 只是 projection。 |
| Mermaid | `editor-app/src/editor/{mermaid,mermaid-diagrams,mermaid-diff,mermaid-ref,mermaid-zoom}.ts`；`src/components/RenderDiff.vue` | `editor/cm6/widgets/mermaid` | `KEEP BEHAVIOR` | 保留 Markdown fence、预览、缩放、引用/差异场景和 renderer failure fallback 的产品语义；渲染 widget 与 DOM 生命周期在 v2 重写，源码始终是 authority。 |
| Diff | `editor-app/src/editor/diff/`；`src/editor/{diff-deco,render-diff}.ts`；`src/components/{DiffView,RenderDiff}.vue` | `core/diff` + `ui/review` | `REWRITE` | 旧版 anchor/fence/semantic renderer 和 fixtures 只提供场景证据；v2 强制 `Raw Diff → Semantic Enhancement → Renderer`，semantic 失败不能吞掉 Markdown raw change。 |
| Git | `editor-app/src/git/`；`src/components/{GitPanel,GitChangeTree,GitFileContextMenu,BranchPicker,ScmFileRow}.vue`；`src/vite-plugins/dev-repo.ts` | `platform/git` | `KEEP BEHAVIOR` | 保留 status、branch、history、range diff 和 mock repository 的用户语义；v2 重新定义 Git port/adapter，raw source diff 是保证层，不能让 UI renderer 成为数据来源。 |
| Validation | `editor-app/src/validate/`；`src/annotations/service.ts`；`tests/e2e/m5-*.js` | `core/validation` | `COPY PURE CODE` | 可提取规则匹配、报告模型等纯逻辑；插件、DOM 标记、annotation drawer 和落盘适配在 v2 重写，并作为 Document 的派生结果。 |
| Template | `editor-app/src/template/`；`src/components/TemplatePicker.vue`；`src/state/settings.ts` | `application` + `ui/components` | `DEFER` | 旧版目录约定和 `TemplatePicker` 保留为需求/fixture 参考；等待模板规则进入 Phase 8 后再决定保留范围和 API。 |
| Search | `editor-app/src/search/index.ts`；`src/components/SearchPanel.vue` | `index/search` | `DEFER` | 旧版搜索 UI 和索引行为先保留为参考；v2 需在派生服务设计时决定索引生命周期，不能建立第二份 Document authority。 |
| Outline | `editor-app/src/editor/outline.ts`；`src/components/OutlinePanel.vue` | `index` | `REWRITE` | 旧版从编辑器结构生成 outline 的行为可参考；v2 由 Markdown/Document 派生索引生成，不依赖 CM6 实例作为唯一来源。 |
| Export | `editor-app/src/export/`；`src/components/ExportModal.vue` | `platform/export` | `DEFER` | 旧版 Markdown/MD AST、PDF、DOCX exporter 和导出 E2E 作为兼容性证据；按 Phase 9 重新定义 `DocumentSnapshot` + `ExportContext` 输入。 |
| Diagnostics | `editor-app/src/diagnostics/`；`src/debug/`；`.pi/skills/writeit-debug/`；`.workbuddy/` legacy wrapper | `observability` | `REWRITE` | 旧版 logger、probe、debug relay、CLI 和诊断包仅作问题场景参考；不得直接把 legacy 协议当成 v2 API。Phase 10 重新建立 document/projection/timeline/diff/reference diagnostics。 |
| Themes | `editor-app/src/style.css`；`src/state/settings.ts`；`src/components/SettingsModal.vue` | `ui` | `DEFER` | 保留视觉和设置需求作为 UI 参考；等 v2 UI 稳定后再决定 port 范围，不让主题实现影响 Core/domain 边界。 |

## P2A-00 granular feature coverage baseline

The following rows are the authoritative decomposition of the legacy user-visible baseline introduced in `writeit-v2/docs/IMPLEMENTATION_SPEC.md` §5A and its Phase 12 checklist. The older capability map above is retained as the historical P0-04 mapping; these rows prevent a broad label from silently closing multiple workflows. `Strategy` remains a migration strategy, not a Phase 12 parity result. Each row must later be closed independently as `MIGRATED`, `REDESIGNED`, `INTENTIONALLY DROPPED`, or `DEFERRED`.

| Capability / user workflow | Legacy evidence | v2 owner / phase | Strategy | Coverage obligation |
|---|---|---|---|---|
| Raw source ↔ Live Preview toggle (`Ctrl+E`) | `editor-app/src/editor/manager.ts`, `src/components/RefEditorMenu.vue` | CM6 presentation / P2A-05 | `REWRITE` | One CM6 state and one DocumentStore authority; preserve selection, history, and source without parse→serialize mode switching. |
| `/` Quick Insert / command menu | Crepe block-edit, `editor-app/src/editor/features.ts` | CommandRegistry + CM6 adapter / P2A-01–02 | `REWRITE` | Independent command registry; filtering, keyboard navigation, Enter, Escape, and mouse selection; Template/Mermaid are later providers. |
| `@` / `[[` / `![[` completion triggers | `editor-app/src/editor/ref/menu/` | Completion engine / P2A-03 | `REWRITE` | Shared trigger, anchored popup, provider, filtering, selection, and apply lifecycle for all three forms. |
| Full-width / IME trigger normalization | `editor-app/src/editor/ref/menu/core.ts` | Trigger core / P2A-04 | `COPY PURE CODE` | Cover `＠`, `！`, `【`/`［` and composition boundaries without rewriting unrelated Markdown source. |
| File → object / heading entity completion | `editor-app/src/editor/ref/menu/`, `src/editor/template/suggest-context.ts` | Reference/template providers / P4-04, P8-T05–06 | `REWRITE` | File-self, object, and heading are explicit candidate types; dynamic suggestions use a defined context. |
| Mermaid `@` reference completion | `editor-app/src/editor/mermaid-ref.ts` | Shared completion provider / P6-M04 | `REWRITE` | Reuse P2A/P4 completion business logic; do not create a Mermaid-only provider path. |
| Reference click navigation, hover, broken marking, and recovery | `editor-app/src/editor/ref/app-plugin.ts`, `ref-tooltip.ts` | Reference navigation and health / P4-05 | `REWRITE` | Open target, jump to fragment, diagnose broken references, and offer re-selection without losing the original token. |
| Reference rename linkage | `editor-app/src/editor/ref/`, tree operations | Application/reference rename policy / P3-01, P4-06 | `REWRITE` | Incoming references update, conflict, or failure behavior is explicit and tested; rename must not silently create broken links. |
| Tree/system file-manager copy → reference paste | `editor-app/src/editor/ref/clipboard-core.ts`, `src/components/ContextMenu.vue` | Reference clipboard adapter / P4-07 | `REWRITE` | Link, editable embed, readonly embed, directory path, and multi-file behavior are explicit. |
| Reference link / editable embed / readonly embed actions | `src/components/RefEditorMenu.vue` | Application command + editor adapter / P4-08 | `REWRITE` | Change the Markdown reference token/mode, never create a copied Document authority. |
| Editable, readonly, nested, and circular embeds | `editor-app/src/editor/ref/`, manager | Embed projection / P4-09 | `REWRITE` | Cover multi-projection revision, undo, close/reopen, stale state, lifecycle, nesting, and cycle handling. |
| Template scan, doctype, workspace/global domains | `editor-app/src/editor/template/service.ts` | Template catalog / P8-T01 | `REWRITE` | Define domain precedence, rescan behavior, and scan-failure degradation. |
| Create a file from a template | `src/components/TemplatePicker.vue`, tree operations | Workspace application seam + template provider / P3-08, P8-T02 | `REWRITE` | New-from-template is distinct from slash insertion and remains outside the tree component's hard-coded logic. |
| Template `rules.ts` validation provider | `editor-app/src/editor/template/`, validation | Validation provider / P8-T04 | `REWRITE` | Rule execution produces derived issues and never becomes Document authority. |
| Template `suggest.ts` static/dynamic `objectsFor(ctx)` | `editor-app/src/editor/template/service.ts`, `suggest-context.ts` | Suggestion provider / P8-T05–06 | `REWRITE` | Context covers paragraph, heading, task, table, and file/object reference structures; fallback heading entities remain defined. |
| Template `export.ts` provider | `editor-app/src/editor/template/export.ts` | Export metadata/provider contract / P8-T07, P9-04 | `DEFER` | Establish provider metadata without coupling template scanning directly to export execution. |
| `{{placeholder}}` whole-placeholder editing | `editor-app/src/editor/ref/placeholder.ts` | Source-backed CM6 assistance / P8-T03 | `REWRITE` | Click/keyboard can select and replace the whole placeholder; fence and other exception behavior is explicit. |
| Image paste persistence and inline fallback | `editor-app/src/editor/image-paste.ts` | Binary attachment pipeline / P3-06 | `REWRITE` | Decide and test root-images, same-dir, file-images, and inline strategies; write failure must preserve a safe Markdown fallback. |
| Relative image display, preview, copy, tree/system reveal | `editor-app/src/editor/image-paste.ts`, `src/components/{RefEditorMenu,ImagePreviewModal}.vue` | Image projection + platform adapter / P3-07, P11 | `REWRITE` | Renderer/read failure never changes the stored relative path; system reveal stays behind a platform port. |
| Markdown table 2D editing, clipboard, and IME | `editor-app/src/editor/table/`, CM6 spike | Table core + CM6 widget / P5 | `COPY PURE CODE` | Keep table-region edits, clipboard/selection/undo behavior, and IME coverage; do not introduce a nested PM or rewrite the whole file. |
| Annotation creation, threads, replies, resolve, code-block anchors | `editor-app/src/annotations/`, `src/components/AnnotationDrawer.vue` | Annotation domain + review UI / P6-A01–03 | `REWRITE` | Decoration is only a projection; anchor and persistence semantics are independently specified. |
| Annotation drawer width, open policy, and anchor feedback | `src/components/AnnotationDrawer.vue`, settings | Review UI/settings / P6-A04 | `REWRITE` | Drawer expansion, active card, location feedback, and diff-view policy have independent UX acceptance. |
| Mermaid preview, error fallback, and source editing | `editor-app/src/editor/mermaid.ts`, `mermaid-diagrams.ts` | Source-backed Mermaid widget / P6-M01–02 | `REWRITE` | Preserve fence source on loading/render errors and on preview/source toggles. |
| Mermaid slash templates | `editor-app/src/editor/mermaid-diagrams.ts` | CommandRegistry provider / P2A-01, P6-M03 | `REWRITE` | Templates execute through the shared command contract and produce correct Markdown source. |
| Workspace full-text search | `editor-app/src/search/`, `src/components/SearchPanel.vue` | Derived search index / P8-S01 | `DEFER` | Group results by file, support case option, and define cache refresh/invalidation. |
| Precise search occurrence jump and editor highlight | `src/components/SearchPanel.vue`, manager search hooks | Search application + CM6 adapter / P8-S02 | `REWRITE` | Open, locate, and highlight the exact occurrence; Widget/atomic matches have an explicit fallback. |
| Replace current / replace all | `src/components/SearchPanel.vue` | Application command / P8-S03 | `REWRITE` | Dirty/open-document conflict policy and DocumentStore/FS write order are explicit; no implicit skip. |
| Outline navigation, active tracking, resize/autofit | `src/components/OutlinePanel.vue`, `editor-app/src/editor/outline.ts` | Derived outline index + UI / P8-I01 | `REWRITE` | Index comes from Markdown; click jump and active heading tracking are projection behavior. |
| Backlinks and reference health | Reference index, `editor-app/src/editor/ref/` | ReferenceGraph-derived service / P8-I02, P10 | `REWRITE` | Backlinks and health facts come from the graph and link back to source references. |
| Automatic validation, issue surface, strict save gate | `editor-app/src/validate/`, `src/annotations/service.ts` | Validation + application save policy / P8-V01–03 | `REWRITE` | Validation is derived; only application policy decides whether save is blocked. |
| Git repository, branch, worktree, history, range comparison | `editor-app/src/git/`, `src/components/{GitPanel,BranchPicker,DiffView}.vue` | Git port + review application / P7-01–03 | `KEEP BEHAVIOR` | Preserve user workflow while isolating browser mock/Tauri adapters and machine-readable Git data. |
| Raw source diff with split/unified navigation and discard | `editor-app/src/editor/diff/`, `src/components/DiffView.vue` | Core diff + review UI / P7-04–06 | `REWRITE` | Every raw change remains represented; hunk fold/navigation and discard have confirmation/failure handling. |
| Semantic Mermaid/Table/Embed diff and change explanation | `editor-app/src/editor/{diff,mermaid-diff}.ts`, `src/components/RenderDiff.vue` | Semantic diff enhancement + annotations / P6, P7-07–08 | `REWRITE` | Enhancement failure degrades to source diff and never removes a raw change. |
| Search/Git/tree status integration and entry points | `src/App.vue`, `src/components/FileTree.vue` | Workspace/review UI / P3, P7, P8 | `REWRITE` | Cross-surface dirty/Git/search state remains reachable without duplicating Document authority. |
| Markdown, PDF, DOCX, template/custom, and batch export | `editor-app/src/export/`, `src/components/ExportModal.vue` | Export ports / P9-01–05 | `DEFER` | Each format and per-file batch result is independently decided; exporters consume snapshots, not CM6 DOM authority. |
| Settings: theme, icons, autosave, shell, outline, annotation, image, shortcuts | `editor-app/src/state/settings.ts`, `src/components/SettingsModal.vue` | UI/application/platform settings / P3, P10, P11 | `DEFER` | Settings may be redesigned but each legacy workflow needs an explicit outcome. |
| Configurable shortcuts, conflict detection, reset defaults | `editor-app/src/state/settings.ts`, App key handling | Command/keybinding foundation + settings UI / P2A-06, P3-05 | `REWRITE` | Command IDs are stable and independent from configurable keybindings, including editor-specific commands. |
| Sidebar collapse/pin/resize, reveal current, previous/next file | `src/App.vue`, `src/components/FileTree.vue` | Workspace shell/navigation / P3-02, P3-04 | `REWRITE` | Navigation and shell state are UI/application state, not editor source state. |
| File CRUD, drag move, system explorer reveal | `src/components/FileTree.vue`, tree operations/context menu | Workspace tree + platform adapter / P3-01, P11 | `REWRITE` | Create/rename/delete/move and reveal failure behavior are explicit and testable. |
| Last workspace restore | `src/App.vue`, settings | Workspace recovery + platform adapter / P3-04, P11 | `DEFER` | Restore policy is explicit and must not be implemented through hidden DocumentStore state. |
| Diagnostics report, error badge, timeline, privacy selections | `editor-app/src/diagnostics/`, settings | Observability / P10 | `REWRITE` | Document/projection/timeline facts and optional DOM/document/path/screenshot data have explicit redaction choices. |
| Agent debug channel and LAN execution restrictions | `editor-app/src/debug/`, `.pi/skills/writeit-debug/`, `.workbuddy/` | New observability/debug protocol / P10–11 | `REWRITE` | Do not inherit the legacy private protocol; off/local/lan and high-risk command policy require new decisions. |
| Lite mode and WebView GPU/occlusion controls | legacy settings/Tauri performance hooks | Platform performance profile / P11 | `DEFER` | Reassess necessity; if retained, keep controls out of Core/editor authority. |
| Git blame source-line provenance | legacy Git history/blame capability | Git provenance data model / P7-10 | `REWRITE` | Return commit, author, time, subject, original path/line where available, and final source line ranges without mutating the Document. |
| IDEA-style blame gutter and commit drill-down | Git history/blame UI patterns | CM6 provenance projection + Git review / P7-11 | `REWRITE` | Gutter is projection-only; hover/click uses commit IDs for details/diff and shows at least author + date. |
| Dirty/local line attribution and blame safety | Git worktree status + document state | Git provenance mapping / P7-12 | `REWRITE` | Modified/new/unsaved lines are local or unknown; unchanged reliably mapped lines retain history; no false neighboring attribution. |
| File history / document provenance | `editor-app/src/git/`, GitPanel history flows | Git history application / P7-13 | `KEEP BEHAVIOR` | Show author, date/time, commit ID, summary, selected version/diff, and explicit rename-history cutoff if needed. |
| Blame options and provenance quality | Git blame capabilities | Git blame port options / P7-14 | `DEFER` | Port must leave room for whitespace, movement/copy detection, and author-vs-committer time options. |
| Table row/column reorder and column resize | `editor-app/src/editor/table/` | Table widget / P5 follow-up | `DEFER` | If absent from the first table release, remain an explicit deferred parity item rather than an implicit omission. |

### Granular coverage governance

- A broad label such as `References`, `Templates`, `Search`, or `Git/Diff` never closes the rows above.
- A later implementation must identify the specific row(s) it closes and retain source-fidelity, projection-only, and degraded-fallback invariants.
- `DEFER` here is a migration strategy or explicit follow-up, not permission to silently drop a workflow. Final parity state is decided only during Phase 12.

## Boundary and provenance rules

1. v2 代码只能把本表列出的 legacy 内容当作参考输入；禁止 `writeit-v2/` runtime import `editor-app/`。
2. 复制纯逻辑时，必须在 v2 中说明新的 owner，并用 v2 的 unit/integration tests 证明行为；不得携带旧 manager、Crepe、Vue、DOM 或 Tauri 的隐式状态。
3. Markdown source、Document revision、persisted revision 和 dirty state 的最终所有权属于 v2 `DocumentStore`；任何 editor view、embed、table widget、preview 或 diff view 都只是 projection。
4. 未知 Markdown、preview/semantic diff/导出失败都不能修改或吞掉原始 Markdown。迁移 fixture 应优先覆盖 source fidelity、嵌套引用、表格局部编辑和 raw diff 保证。
5. `DEFER` 项在进入对应 Phase 前不提前实现，也不应被解释为 `DROP`。后续 Feature Parity Review 再将每项标记为 `MIGRATED`、`REDESIGNED`、`INTENTIONALLY DROPPED` 或 `DEFERRED`。

## Reference material

- Target boundary and phase ownership: `writeit-v2/docs/IMPLEMENTATION_SPEC.md`
- Current execution state: `writeit-v2/docs/STATUS.md`
- Repository classification: `writeit-v2/docs/REPOSITORY_INVENTORY.md`
- Legacy-only rules: `editor-app/AGENTS.md`
- Document synchronization behavior notes: `editor-app/specs/runtime-doc-layer.spec.md`
