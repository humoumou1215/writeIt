# P4-R02 — ReferenceGraph rollback safety

## Goal

修复 P4-06 rename/move 在 Store/filesystem compensation 后可能把 ReferenceGraph 恢复到 rollback 前旧 revision 的问题。rollback/compensation 完成后，graph 的 source content facts、edge/backlink health 和 `sourceRevision` 必须与当前 `DocumentStore` snapshot/revision 一致；任何失败都必须保留可诊断结果，不能静默吞错或损坏 Markdown。

## Allowed scope

- `writeit-v2/src/application/reference/rename.ts` 中 P4-06 compensation 后的 graph 重同步、失败诊断和必要的 rollback orchestration。
- `writeit-v2/src/core/reference/graph.ts`、`reference-index.ts` 及其相关纯逻辑测试，仅限支持从当前 Store authority 重建/同步 graph 所需的最小接口或不变量检查。
- 与 P4-06 rollback、target conflict、dirty/external conflict、filesystem compensation failure、后续 Store update 相关的 v2 unit/integration tests。
- 本 Task Contract 与 `writeit-v2/docs/STATUS.md` 的简洁状态更新。

不得修改图片路径、entity completion、P2A evidence/remediation、目录 rename/move、P3/P4 其他合同或 P5；不得改变既有 ADR、Markdown/DocumentStore/Projection authority 不变量。

## Read first

- `AGENTS.md`
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`
- `writeit-v2/docs/STATUS.md`
- `writeit-v2/docs/P2_ARCHITECTURE_REVIEW.md` 的结论及 P2-AR-06 contract/out-of-scope
- `writeit-v2/docs/P4_R01_TASK_CONTRACT.md`（仅确认目录安全任务边界，不修改其实现）
- `writeit-v2/src/application/reference/rename.ts`
- `writeit-v2/src/core/reference/graph.ts`
- `writeit-v2/src/core/reference/reference-index.ts`
- `writeit-v2/src/core/document/store.ts`
- `writeit-v2/tests/unit/application/reference-rename.test.ts`
- `writeit-v2/tests/integration/core/reference-graph.test.ts`
- 相关独立评审结论：P4-06 compensation 后 graph 可能继续使用 rollback 前的 Store snapshot/revision

## Implementation requirements

1. P4-06 正常成功路径保持现有行为；target conflict、dirty/external conflict 必须在 mutation 前失败且保持可诊断、source-safe。
2. Store/filesystem rollback 或其他 compensation 完成后，禁止使用 rollback 前保存的 `DocumentState` 作为 graph 的最终 revision authority。优先从 rollback 完成时 `DocumentStore.getAll()` 的当前 snapshot 重新 index/rebuild；所有已加载相关 Document 的 graph index entries、edges、backlinks 和 `sourceRevision` 必须反映该 snapshot。
3. Graph 内容和 workspace resolution health 必须与 compensation 完成后的 filesystem/catalog 状态一致：旧 target phantom node/edge 不得残留，恢复后的 target/link 状态必须可诊断。重同步失败必须显式记录在 `ReferenceRenameTransactionError` 的诊断结果中，不能静默降级为成功。
4. rollback/re-sync 过程不得绕过 DocumentStore、回写旧 revision、吞掉 Markdown 或建立第二份 source authority；Store 的 monotonic revision 语义保持不变。不要复用过期 snapshot/revision，也不引入 timeout/sleep 或 `editor-app` runtime import。
5. filesystem compensation failure、Store compensation failure、graph re-sync failure 和原始 rename/write failure 均须保留 cause/rollback 状态，使调用方能区分 rollback 是否完整；现有错误类型若需扩展，只增加与本任务直接相关的稳定诊断字段。
6. 补充专门 regression assertions：rollback 后每个相关 graph edge/node/index entry 的 revision 与对应当前 Store revision 一致；rollback 后的 subsequent Store update 继续更新 graph revision/content/backlinks，不被旧 graph snapshot 卡住。不得改变 P4-R01 目录 safety 行为。

## Tests

- Unit：成功 rename、target conflict、dirty/external conflict、filesystem compensation failure 的可诊断错误与 Markdown safety；rollback 后 graph content/edge/backlink health 与当前 Store revision 一致；随后 Store update 后 graph revision 继续前进并反映新链接。
- Integration：DocumentStore + ReferenceGraph + P4-06 compensation，覆盖 Store rollback 产生新 revision、filesystem rollback 成功/失败，以及 graph re-sync failure 的明确错误状态；断言不使用 rollback 前 snapshot/revision。
- 执行相关 unit/integration/browser 检查、`npm run typecheck`、`npm run build`、`npm run check:boundaries` 和 `git diff --check`；不增加固定等待来掩盖失败。

## Acceptance criteria

- P4-06 compensation 完成后，ReferenceGraph 的 source content facts、edge/backlink health、node/index `sourceRevision` 与当前 `DocumentStore` snapshot/revision 一致。
- rollback 后 subsequent Store update 能正常产生最新 graph revision/content，且不会回退或停留在 rollback 前 revision。
- 正常成功、target conflict、dirty/external conflict、filesystem compensation failure 和 graph re-sync failure 均可诊断；失败不静默吞错、不损坏 Markdown、不留下未说明的 phantom graph facts。
- 相关 unit/integration/browser、typecheck、build、boundary 和 whitespace 检查通过；不违反既有 ADR、Markdown/DocumentStore/Projection/no-timeout/no-legacy-runtime-import 不变量。

## Out of scope

- 图片路径、attachment、entity completion、P2A evidence/remediation。
- 目录 rename/move、directory incoming-reference rewrite 或新的 directory path-rebind/rollback strategy。
- P3/P4 其他合同、P5/table、P6 及后续 Phase 功能。
- 改变 accepted ADR、DocumentStore authority/revision 模型、ReferenceGraph 长期数据所有权或引入新的持久化事务协议。
- 任何 `editor-app/` 修改或 runtime import。
