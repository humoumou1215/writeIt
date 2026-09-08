# P4-R05 — Embed failure/recovery lifecycle coverage

## Goal

补齐 P4-09 Embed Projection 的 failure/recovery acceptance evidence，证明 Embed target 在 missing、暂时加载失败、后来可用、嵌套目标重建、父 Projection detach、close/reopen 等生命周期变化中能够重新解析并恢复显示；全过程保持 Markdown source-safe、可诊断且不依赖固定 timeout/sleep。

## Allowed scope

- `writeit-v2/src/editor/cm6/extensions/embed-projection.ts` 及为 Embed 生命周期协议所必需的最小适配改动。
- Embed Projection 相关的 unit、integration、browser 测试和测试 fixture/harness。
- 本任务合同、`writeit-v2/docs/STATUS.md` 及与本任务证据直接相关的说明更新。
- 检查现有 `DocumentStore` projection attach/acknowledge/detach、`SingleDocumentView` 生命周期和 P4-09 接线；若发现真实的本范围协议缺陷，只修复 Embed lifecycle，不改变其架构边界。

## Read first

- `AGENTS.md`
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`
- `writeit-v2/docs/STATUS.md`
- `writeit-v2/src/editor/cm6/extensions/embed-projection.ts`
- `writeit-v2/src/editor/cm6/projection/single-document-view.ts`
- `writeit-v2/src/core/document/store.ts`
- P4-09 现有 integration/browser/unit 测试及相关评审结论
- `writeit-v2/docs/adr/ADR-0002-document-store-runtime-content-authority.md`
- `writeit-v2/docs/adr/ADR-0003-editor-views-are-projections.md`

## Implementation requirements

- 明确并验证 Embed target 的 missing/load-failure/retry/success 状态转换；target 后来出现或 transient loader failure 后，必须通过显式事件/Promise 完成或等价的调用者触发重新解析，不得使用固定 timeout/sleep。
- pending、in-flight、missing bookkeeping 必须允许后续 retry；同一请求去重不能永久阻塞新的 generation 或新的失败恢复尝试。
- 异步 request 必须绑定当前 Embed Projection 与 host Document generation；late resolve/reject 不得更新 detached/destroyed Projection，也不得向 readonly Projection 提交 source mutation。
- nested target removed/recreated、父 Projection 在 target load 中 detach、close/reopen 后，child projection registration、source revision、stale/degraded 状态和恢复结果必须保持一致；旧 child 不得泄漏或接收晚到结果。
- editable、read-only、circular/nesting guard、DocumentStore authority、Projection attach/acknowledge/detach、Markdown source fidelity 和 failure diagnostics 不得回归。
- failure 必须降级到可见/可诊断状态并保留原始 Markdown；不得改变 ADR、DocumentStore authority、Projection 边界，不得 runtime import `editor-app/`，不得引入 timeout/sleep。

## Tests

- unit：如有可独立验证的 retry/generation/bookkeeping 协议，覆盖其纯逻辑；若不存在代码缺陷，明确以 integration/browser evidence 证明现有实现无需修改。
- integration：覆盖 missing → appears、transient load failure → retry → success、nested target removed/recreated、parent detached during target load、close/reopen，以及 editable/read-only/circular 既有不变量和 no-leak/no-late-write。
- browser：用真实 Chromium 验证至少一条 missing/recovery、transient retry、detach/close-reopen 的用户可见状态路径；不得用固定等待掩盖同步问题，使用受控 Promise/事件驱动断言。
- 运行 `cd writeit-v2 && npm run test`、相关 integration/browser 测试、`npm run typecheck`、`npm run build` 和 boundary check；记录命令与结果。

## Acceptance criteria

- 有测试证据证明 missing target 后在 target 出现时无需重新编辑 host Markdown 即可 mounted/recovered。
- 有测试证据证明一次 transient load failure 不会永久占用 request；显式 retry 后可成功 mounted，失败期间 host source 不变且状态可诊断。
- nested target 被移除再重建、父 Projection 在加载中 detach、close/reopen 后均无 stale child registration、ghost projection 或 late-result source mutation。
- editable/read-only/circular/深度限制和 existing P4-09 revision/undo/lifecycle invariants 全部通过；readonly/circular 失败不会修改 source。
- 所有异步结果均受当前 projection/document generation 约束；destroyed/detached projection 不再刷新或写入，失败可降级且 Markdown 保留。
- 相关 unit/integration/browser、typecheck、build、boundary 检查通过；STATUS 只记录 P4-R05 的完成与剩余风险。
- 仅为 P4-R05 暂存并创建一个 commit，默认不 push；不 reset/checkout/clean/force push/amend/rebase。

## Out of scope

- P5/table、dirty delete、conditional writes、clipboard、目录 migration、图片、ReferenceGraph 及其他 reference 功能。
- 改变 ADR、DocumentStore authority、Markdown source contract、Projection 边界或引入第二份内容 authority。
- 新增通用 persistence/recovery 架构、重写 App workspace 生命周期，或修改 `editor-app/`、`raw/`。
- 通过 timeout/sleep、固定延时或扩大任务范围来稳定测试。
