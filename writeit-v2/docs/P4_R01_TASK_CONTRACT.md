# P4-R01 — Directory rename/move safety for open Documents

## Goal

在不改变 Markdown authority 或 Projection 模型的前提下，为 workspace directory rename/move 增加 fail-closed 的路径安全门：如果操作会包含任何仍由运行时绑定的已打开 Document（包括嵌套 descendant），则在 filesystem mutation 之前暂时阻止操作，并返回可诊断、可展示的原因。没有受影响的目录操作继续使用既有 filesystem/tree 行为。

本任务的安全目标是：一次被阻止的操作不能让 `DocumentStore`、tabs、persistence、recovery 或 workspace tree 对同一 Document 看到不同路径。

## Allowed scope

- `writeit-v2/src/application/workspace/` 中 directory rename/move 的纯逻辑 preflight、typed diagnostic error 和 `WorkspaceTreeService` 接入。
- App shell 中为 directory safety 提供当前 runtime path bindings（包括 `DocumentStore` 中仍被保留的 loaded Documents，以及 recovery path bindings）；被阻止时不得写入这些状态。
- 相关 v2 unit、integration、browser 测试。
- 本 Task Contract 和 `writeit-v2/docs/STATUS.md` 的简洁状态更新。

允许读取 tabs、persistence、recovery 和 DocumentStore 来建立安全检查所需的 path snapshot；不在本任务中实现 directory reference rewrite、批量 path rebinding 或其他新的 authority。

## Read first

- `AGENTS.md`
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`（尤其是 §3、§4、§10、§20、§23）
- `writeit-v2/docs/STATUS.md`
- `writeit-v2/docs/P2_ARCHITECTURE_REVIEW.md` 的 P2-AR2 结论及 P2-AR-06 contract/out-of-scope
- `writeit-v2/src/application/reference/rename.ts`（P4-06 file-only linkage）
- `writeit-v2/src/application/workspace/tree.ts`
- `writeit-v2/src/application/workspace/tabs.ts`
- `writeit-v2/src/application/persistence/index.ts`
- `writeit-v2/src/application/workspace/recovery.ts`
- `writeit-v2/src/editor/cm6/extensions/embed-projection.ts`（P4-09 child projection/path loading）
- 相关 workspace、rename、persistence、recovery 和 embed 测试

## Implementation requirements

1. 对 `rename` 与 `move` 分别计算 canonical source/target path；只有 source entry 是 directory 且 target 不同于 source 时执行 safety preflight。descendant 判断必须按 workspace path segment 判断，不能用会把 `notes-archive` 误判为 `notes` 子目录的简单前缀。
2. Safety preflight 必须覆盖任意深度的 nested descendant，并将 clean/dirty Document 的 `documentId`、path、dirty 状态纳入 typed diagnostic。路径 binding snapshot 获取失败或形状非法时必须 fail closed，且 filesystem mutation 不能开始。
3. 被阻止的操作必须在任何 filesystem write/rename/move、DocumentStore path/revision/Markdown change、tab change、persistence change、recovery write 或 tree refresh 之前抛出；error 必须包含稳定 code/reason、operation、source/target、受影响路径和可直接展示的 message。
4. App 集成应保护当前仍有 runtime path binding 的 loaded Document；由于 tabs 只保存 DocumentId、persistence 可能仍追踪已关闭 tab、P4-09 embed 可能加载 child Document，不能只检查 active tab 而留下隐藏 path binding。recovery 中尚未加载但仍可恢复的 open path 也不得被目录移动后静默失联。
5. 没有受影响 Document/path binding 的目录 rename/move、file 操作、同路径 no-op 和已有错误/边界行为继续走既有流程；成功后仍由 filesystem refresh 发布 tree projection。
6. 不改变 Markdown authority、DocumentStore revision 语义、Projection 不变量、P4-06 file linkage 或 P4-09 embed lifecycle；不引入 timeout/sleep 或 `editor-app` runtime import。

## Tests

- Pure unit：nested descendant、任意深度、同级/相似前缀边界、clean/dirty diagnostics、重复/非法 binding、rename/move target 计算和 fail-closed safety result。
- Integration：directory rename 与 directory move 都在 filesystem mutation 前阻止；dirty 文档也阻止；阻止后 filesystem、DocumentStore path/Markdown/revision/persisted state、tabs snapshot、persistence state、recovery snapshot/storage 和 tree snapshot 均不变；provider failure 不会部分执行；无影响目录保留 rename/move 行为。
- Browser：通过真实 workspace tree 打开 nested Document，分别尝试 directory rename/move，验证可展示错误、tree/path/tab/dirty 状态不变，并覆盖失败后可继续使用 workspace。
- 执行相关 unit/integration/browser、`npm run typecheck`、`npm run build`、`npm run check:boundaries` 和 `git diff --check`。

## Acceptance criteria

- 对包含 open Document 的 directory rename/move，调用方得到可诊断、可展示的阻止原因，且 nested descendant 和 dirty case 均覆盖。
- 被阻止时没有 filesystem、DocumentStore、tabs、persistence、recovery 或 workspace tree 状态变化，也没有半完成的 refresh/path update。
- 不包含 open Document/path binding 的 directory 操作与现有行为一致；file rename/move 和既有 P4-06 行为不回归。
- 相关 v2 测试、boundary check、typecheck、build 和 whitespace check 通过；不违反 Markdown authority、Projection、no-timeout、no-legacy-runtime-import 不变量。

## Out of scope

- ReferenceGraph rollback、directory incoming-reference rewrite 或新的 directory linkage strategy。
- 图片路径/attachment、entity completion、P2A evidence/remediation、P3/P4 其他合同、P5/table、P6/P7/P8/P9/P10/P11/P12 功能。
- 改变 accepted ADR、DocumentStore authority、tabs/persistence/recovery 的长期生命周期模型，或为本任务引入新的批量 directory path rebind/rollback transaction。
- 任何 `editor-app/` 修改或 runtime import。
