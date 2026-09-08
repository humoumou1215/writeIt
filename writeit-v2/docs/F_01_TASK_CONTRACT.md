# F-01 — Dirty delete CAS integration

## Goal

将 P3-R02 的 dirty-aware recursive deletion 与 P3-R03 的 conditional filesystem write contract 接通。删除流程中所有 dirty Document 的 Save preparation 和失败后的 rollback 都必须使用读取时获得的 `FileVersionToken` 与 `writeTextIfUnchanged`，从而在外部内容变化时 fail closed，不覆盖外部 bytes，也不在保存冲突/失败后继续 filesystem delete。

## Allowed scope

- `writeit-v2/src/application/persistence/index.ts`：dirty deletion Save preparation、CAS conflict diagnosis、条件 rollback 和 autosave safety 所需的最小调整。
- `writeit-v2/src/application/workspace/deletion.ts` 及其直接测试接线：只在确认 F-01 需要时调整删除结果/诊断，不改变既有 recursive plan、cleanup 或 directory rename policy。
- 与上述集成直接相关的 filesystem contract 使用、unit/integration/browser 测试。
- 本合同、`writeit-v2/docs/STATUS.md` 和 `writeit-v2/docs/P4_ARCHITECTURE_REVIEW.md` 中 F-01 的状态证据更新。

不修改 accepted ADR，不改变 Markdown/DocumentStore/Projection authority，不建立跨目录 runtime import。

## Read first

- `AGENTS.md`
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`
- `writeit-v2/docs/STATUS.md`
- `writeit-v2/docs/P3_R02_TASK_CONTRACT.md`
- `writeit-v2/docs/P3_R03_TASK_CONTRACT.md`
- `writeit-v2/docs/P4_AR2_TASK_CONTRACT.md`
- `writeit-v2/docs/P4_ARCHITECTURE_REVIEW.md` 中 F-01 证据
- `writeit-v2/src/application/persistence/index.ts`
- `writeit-v2/src/application/workspace/deletion.ts`
- `writeit-v2/src/platform/filesystem/port.ts`、`memory.ts`
- 相关 deletion、persistence、filesystem、tree integration 和 browser tests

## Implementation requirements

1. 删除前继续递归收集目标文件/目录下所有已加载 Document、dirty 状态、tabs、projections、persistence registrations、recovery bindings 和 ReferenceIndex/Graph source facts；Cancel、Discard、Save 的既有用户语义不得被局部绕过。
2. 每个 dirty Document 的 Save preparation 必须先读取 coherent text snapshot，并保存该 snapshot 的 content/version。写入必须调用 `writeTextIfUnchanged(path, snapshot.version, document.markdown)`；不得以 `writeFile` 或 read-check-write fallback 代替。已知 persistence baseline version 发生变化（包括相同 bytes 的重写）时也必须报告 conflict。
3. 任一 CAS `changed`/`deleted` conflict、degraded outcome、adapter failure 或 Store snapshot race 都必须在 filesystem delete 前中止。冲突需保留本地 Document Markdown/revision/dirty 状态，并提供 path、expected/actual version、actual content（可得时）和明确的 persistence/deletion diagnosis。
4. 删除失败或后续多文档 Save 失败时，只能用成功 CAS 返回的 new version 作为 rollback 的 expected token，调用同一 `writeTextIfUnchanged` 恢复原 bytes。rollback CAS conflict/degraded/failure 不得改用新读到的 token强行覆盖外部内容；必须继续阻止删除/返回明确的 rollback diagnostics。无需实现分布式跨文件事务，但不得静默隐藏部分写入。
5. Save preparation 不得 `markPersisted` 或改变 Store Markdown/revision；只有 filesystem delete 成功后才 commit transaction，随后清理 projections、tabs、persistence、recovery、Store 和 ReferenceIndex/Graph。若 conditional rollback 成功，已知 persistence version 可更新为 rollback 返回的新 token，使 baseline 与 adapter 的逻辑版本一致；取消、冲突、保存失败、delete 失败时不能产生 ghost 或让 autosave 复活 deleted file。
6. 保持现有 CAS adapter contract、source fidelity、Projection lifecycle、no-timeout/no-sleep 和 boundary 规则。图片 attachment compensation、目录 descendant migration、clipboard、embed、P5 及其他 P4-AR2 findings 不在本任务实现。

## Tests

- Unit：dirty file/directory 的 coherent snapshot + expected token；Save CAS success；内容变化、删除和相同 bytes/version rewrite 的 conflict；degraded/adapter failure；多文档先写后失败时 conditional rollback；delete failure 后 rollback conflict 不覆盖外部 bytes，并保留明确 diagnosis。
- Integration：递归 nested descendant 的 Save/Discard/Cancel；任一 Save conflict/failure 不执行 filesystem delete；成功路径清理 Store、tabs、projections、persistence、recovery、ReferenceIndex/Graph，后续 autosave 不复活；未打开 clean file/directory 删除行为不回归。
- Browser：既有单文件/递归目录 dirty Cancel、Save、Discard 和 cleanup journey 继续通过；如现有 browser harness 能注入外部 mutation，补充 Save CAS conflict 的可见失败旅程，不使用固定等待。
- Verification：
  - `cd writeit-v2 && npm run test`
  - `cd writeit-v2 && npm run test:browser`
  - `cd writeit-v2 && npm run typecheck`
  - `cd writeit-v2 && npm run build`
  - `cd writeit-v2 && npm run check:boundaries`
  - `git diff --check`

## Acceptance criteria

1. 单个 dirty 文件：Cancel 保持 filesystem、DocumentStore、tabs、persistence/recovery 和 projections 不变；Save 在无外部变化时成功删除；Discard 成功删除。
2. dirty descendant + 嵌套目录：递归收集全部 runtime bindings；任一 Cancel、CAS 冲突或保存失败都不继续删除；成功路径无 ghost tab/persistence registration，autosave 不复活文件。
3. Save snapshot 后外部文件改变：CAS conflict；外部 bytes 不被覆盖，文件不被删除；本地 Document 保留，dirty/conflict diagnosis 可查询。
4. 多文档部分失败：已发生的 preparation writes 只做 conditional rollback；不能静默部分删除或伪装成功；结果包含失败 phase、affected paths/DocumentIds 和 rollback cause。
5. clean 且未打开的文件/目录继续使用既有 filesystem delete 行为，不因 F-01 回归。
6. Delete 成功后 Store、tabs、projections、persistence、recovery 和 ReferenceIndex/Graph 不含受影响 ghost facts。
7. 相关 unit/integration/browser、boundary、typecheck、build 和 whitespace 检查通过；本任务完成后仍不授权图片任务或 P5。

## Out of scope

- 图片 attachment ownership/compensation、orphan/collision、clipboard、embed retry、P5/Table、P7/P8 或其他 P4-AR2 findings。
- 目录 descendant migration、directory path rebind、incoming-reference rewrite、transactional filesystem delete 或新的跨文件分布式事务协议。
- 修改 accepted ADR、重做 DocumentStore/revision/Projection 长期模型、修改 `editor-app/`、real Tauri/native adapter。
- `reset`、`checkout`、`clean`、force push、amend、rebase，以及自动开始下一个 Task。
