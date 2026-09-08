# P3-R02 — Dirty-aware recursive workspace deletion

## Goal

统一 File Tree/应用入口的文件与目录删除流程：删除前递归收集所有受影响的已加载 Document、tabs、projections、persistence registrations 和 recovery bindings，对 dirty Markdown 提供明确的 Save / Discard / Cancel 决策；只有保护检查和所需保存成功后才删除 filesystem，避免未保存内容被删除或后续 autosave 复活，并在成功后清理全部运行时引用，避免 ghost document。

## Allowed scope

- `writeit-v2` 中应用级 workspace deletion command/service，以及 File Tree 和应用入口到该统一入口的接线。
- 递归收集 descendant runtime bindings（DocumentStore、tabs、projections、persistence、recovery）所需的最小 application/core/platform 接口。
- dirty Document 的 Save / Discard / Cancel 决策、保存失败/取消的 fail-closed 结果和可诊断的多文件/目录删除结果。
- 删除成功后的 Document、projection、tab、persistence、recovery、ReferenceIndex/ReferenceGraph 清理，以及未打开文件的既有删除行为保持不变所需的接线。
- 相关 unit、integration、browser 测试、boundary/typecheck/build 验证，以及本 Task Contract 和 `writeit-v2/docs/STATUS.md` 的简洁状态更新。

不得改变已批准的目录 rename/move 策略：影响已打开 descendant Document 的目录 rename/move 仍暂时阻止；不得实现 transactional path migration。不得修改 accepted ADR。

## Read first

- `AGENTS.md`
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`
- `writeit-v2/docs/STATUS.md`
- `LEGACY_FEATURE_MAP.md` 中 File CRUD、tabs/dirty/close confirm、manual save/autosave 和 ReferenceIndex/Graph 相关条目
- `writeit-v2/docs/P3_R01_TASK_CONTRACT.md`
- `writeit-v2/docs/P4_R01_TASK_CONTRACT.md`
- `writeit-v2/src/application/workspace/tree.ts`
- `writeit-v2/src/application/workspace/tabs.ts`
- `writeit-v2/src/application/persistence/index.ts`
- `writeit-v2/src/application/workspace/recovery.ts`
- `writeit-v2/src/core/document/store.ts`
- `writeit-v2/src/core/reference/reference-index.ts`、`graph.ts`
- `writeit-v2/src/App.vue`、`WorkspaceTree.vue`、`WorkspaceTabs.vue` 及相关 P3-01/P3-02/P3-03/P4-R01 测试
- 与 dirty-aware recursive deletion、opened descendant cleanup、autosave resurrection 和 ghost document 相关的外部评审结论

## Implementation requirements

1. 文件删除和目录递归删除必须经过同一个 application command/service；目录 descendant 判断按 workspace path segment 进行，收集任意深度的已加载 Document、tabs、projections、persistence registrations 和 recovery bindings，不能只检查 active tab 或 UI 组件局部状态。删除计划必须可诊断并稳定列出受影响路径/DocumentId/dirty 状态。
2. 对受影响的 dirty Document 提供明确的 Save / Discard / Cancel 流程。Save 必须沿用现有 guarded persistence path，Discard 必须是显式的 Store/application 操作；Cancel、用户拒绝或任一保存失败都必须在 filesystem 删除前结束，且 filesystem、DocumentStore（含 Markdown/revision/persisted state）、tabs、persistence、recovery 和 tree 状态保持不变。不得用 timeout/sleep 协调状态。
3. 只有所有保护决策和保存步骤成功后才执行 filesystem 删除。多文件/目录删除的执行顺序、失败步骤和 compensation/cleanup 结果必须可诊断；不能为目录删除在 UI 组件中复制一套文件逻辑，也不能让 autosave 或遗留 persistence registration 在删除后重新创建文件。
4. 删除成功后，统一清理受影响 Document 的 projections（包括嵌套/多 projection）、tabs、persistence registrations、recovery entries，以及 ReferenceIndex/ReferenceGraph 的 source/node/edge/backlink 派生事实，避免 ghost document。DocumentStore 的 Markdown authority、revision 语义和 Projection 生命周期必须保持一致；未打开文档的既有 filesystem 删除行为不得回归。
5. 删除取消、保存失败、filesystem 删除失败或清理失败均须返回稳定 code/phase/affected entries/cause 等可展示诊断；不得静默吞错、部分清理后伪装成功或在取消路径修改 source。若现有删除/生命周期合同不足以安全保证原子性，停止并报告决策点，不引入未经批准的 transactional path migration。
6. 不处理 conditional filesystem writes、clipboard fallback、embed retry、ReferenceGraph 其他功能、图片 compensation、P5 或其他审计项；不改变目录 rename/move 安全策略，不改变 accepted ADR，不 runtime import `editor-app`。

## Tests

- Pure unit：文件/目录统一删除计划；任意深度 descendant、相似前缀边界、重复/非法 runtime binding；clean/dirty 收集；Save / Discard / Cancel、用户取消、保存失败和可诊断结果；未打开文件保持既有行为。
- Integration：Store、tabs、active/非 active projections、persistence registrations、recovery 和 ReferenceIndex/Graph 的递归收集与成功清理；Cancel/Discard/Save/保存失败及 filesystem/cleanup failure 的状态不变量；删除后后续 autosave、Store notification、reference query 不复活/不返回 ghost document；文件与目录入口使用同一 application service。
- Browser：从 File Tree/应用入口删除已打开 clean/dirty 文件及含嵌套 descendant 的目录，验证 Save / Discard / Cancel、错误展示、tabs/projection/dirty 状态、tree 和 persistence/recovery 行为；取消或保存失败后可继续编辑/保存，成功后不会复活文件。
- 执行相关 unit/integration/browser、`npm run typecheck`、`npm run build`、`npm run check:boundaries`、边界检查和 `git diff --check`；不得增加固定等待掩盖失败。

## Acceptance criteria

- 文件与目录递归删除统一经过 application command/service，并覆盖任意深度 descendant 的所有 runtime bindings；删除计划和失败路径可诊断。
- dirty 文档有明确 Save / Discard / Cancel；取消、拒绝或保存失败时 filesystem、Store、tabs、projections、persistence、recovery 和 tree 不变，dirty Markdown 不会被删除或被 autosave 复活。
- 删除成功后 projections、tabs、persistence、recovery、ReferenceIndex/ReferenceGraph 均无受影响 ghost facts；未打开文档的既有删除行为保持不变。
- 目录 rename/move 对打开 descendant 的既有阻止策略和其他既有语义不变；Markdown authority、source fidelity、Projection lifecycle、no-timeout/no-sleep、boundary 和 no-legacy-runtime-import 不变量保持通过。
- 相关 unit/integration/browser、boundary、typecheck、build 和 whitespace 检查通过，并只为 P3-R02 创建一个 commit。

## Out of scope

- conditional filesystem writes、clipboard fallback、embed retry、ReferenceGraph 非删除相关改造、图片 compensation、P5/table 及其他外部审计项。
- 目录 rename/move 策略变化、directory path migration、transactional path migration、incoming reference rewrite 或新的 rename compensation protocol。
- 修改 accepted ADR、Markdown/DocumentStore/revision authority、Projection 长期生命周期模型，或将 CM6/Vue/DOM 逻辑下沉到 Core。
- `editor-app/` 的修改、任何 runtime import、真实 Tauri/native adapter、无关 Phase/Task 和自动开始下一任务。
