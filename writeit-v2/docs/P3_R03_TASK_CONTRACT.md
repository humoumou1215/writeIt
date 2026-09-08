# P3-R03 — Conditional filesystem writes / conflict-safe mutation

## Goal

消除文本文件持久化与 P4-06 incoming-reference rewrite 中的 read-check-write TOCTOU 覆盖风险。FileSystemPort 必须提供可比较的文件版本快照和条件写入语义；应用层在检测到计划后的外部变化时必须 fail closed、返回可诊断冲突，并保持 DocumentStore 的 Markdown/revision authority 不变。

## Allowed scope

- `writeit-v2/src/platform/filesystem/port.ts`、`memory.ts` 以及相关 filesystem barrel/contract 文档：文本文件 snapshot、不可变 version token、conditional write result 和 deterministic MemoryFileSystem 实现。
- `writeit-v2/src/application/persistence/index.ts` 的 manual/auto save、external-change 检查及其直接需要的 persistence version/error 状态。
- `writeit-v2/src/application/reference/rename.ts` 的 incoming-reference rewrite、计划快照、条件写入和现有 compensation/rollback 所需的最小调整。
- 上述 contract 变化直接涉及的 unit、integration、browser 测试、boundary/typecheck/build 验证，以及本 Task Contract 和 `writeit-v2/docs/STATUS.md` 的简洁更新。

不改变 accepted ADR，不建立第二份 Markdown authority，不改变现有 P3-R02 dirty-delete 决策/生命周期流程；如需为同一条件写 contract 更新既有 rollback 写入，只保留其原有 compensation 目的和结果语义。

## Read first

- `AGENTS.md`
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`（P3-03 Persistence policy、P4-06 Rename linkage、核心 authority/invariant 和测试边界）
- `writeit-v2/docs/STATUS.md`
- `writeit-v2/docs/P3_R02_TASK_CONTRACT.md`、`writeit-v2/docs/P4_R02_TASK_CONTRACT.md`
- 本次综合评审结论：当前 read-check-write 在检查与写入之间可能覆盖外部修改；平台无法提供强原子能力时必须显式 degraded/conflict，不能伪装成安全写入
- `writeit-v2/src/platform/filesystem/port.ts`、`memory.ts`、`workspace-port.ts`
- `writeit-v2/src/application/persistence/index.ts`
- `writeit-v2/src/application/reference/rename.ts`
- 相关 persistence、filesystem、rename 的 unit/integration/browser 测试

## Implementation requirements

1. 为文本文件定义同一套 snapshot/conditional-write contract：读取必须返回与内容对应的 `FileVersionToken`；token 是 adapter 生成的 opaque、不可变、可用精确相等比较的值，不能由调用方修改或重新解释。`writeTextIfUnchanged(path, expectedVersion, content)` 必须在同一 adapter 原子边界比较 expected token 并写入；成功只返回明确的 atomic write 结果和新 token，token 必须在每次内容写入（包括相同字节的写入）后可区分。Workspace path relocation 若保留文件内容，必须保留该逻辑文件版本 token。
2. 条件写冲突必须是稳定、可诊断的 discriminated result，至少区分 changed/deleted；无法提供强原子 compare-and-write 的未来 adapter 必须返回明确 degraded/unsupported 结果且不得报告为成功安全写入（contract 文档不得把 best-effort read-then-write 当作 CAS）。MemoryFileSystem 实现同一语义，所有返回 snapshot/result 对外暴露的对象和 token 不得让调用方改变 adapter 状态。
3. DocumentPersistenceService 的 manual save、auto-save 和 external-change 对账必须以 snapshot 的内容/version 为 baseline，并以 `writeTextIfUnchanged` 完成实际 save。条件冲突或 degraded 不得写入外部文件、不得调用 `markPersisted`、不得错误清除 dirty 或改变 Markdown/revision；错误需保留 path、expected/actual version、内容（若可得）和原因等诊断。计时器只能调度同一 guarded save path，不能作为同步协议。
4. ReferenceRenameService 的 plan 必须保存所有将被 rewrite 的文本文件 snapshot/version；incoming rewrite 必须使用同一 conditional-write contract，计划后外部修改只能 abort/报告，不能用普通 `writeFile` 覆盖。现有 filesystem/Store/graph compensation/rollback 必须保留；rollback 若恢复写入也必须以已知的当前 version 条件写，外部变化导致无法恢复时保留失败诊断而不覆盖该变化。rename/move 后的 path rebind 只能采用实际成功写入/搬移得到的 token。
5. 只在本任务直接涉及的 application/filesystem 边界补充 capability/result/error 类型；不通过重新读取后无条件写入、静默 fallback 或第二份 Markdown 缓存绕过条件语义。所有 source mutation 仍经过 DocumentStore，Graph/Projection 仍为派生/投影；不得引入 timeout/sleep、`editor-app` runtime import 或 accepted ADR 变化。

## Tests

- Pure unit：FileVersionToken 的不可变/可比较语义；MemoryFileSystem snapshot、成功 conditional write、changed/deleted conflict、相同内容外部写入、移动后 token 语义和 degraded adapter contract。
- Persistence unit/integration：manual/auto save 的 CAS success；snapshot 后外部修改（含相同内容重写、删除）不能被覆盖；冲突/degraded 的稳定诊断；Store Markdown/revision/persistedRevision/dirty 和 persistence baseline 不被错误确认；reload/discard 的既有语义不回归。
- Rename unit/integration/browser：incoming source 的 planned-version race、多个 source 的部分写入后 compensation、target path/file move、filesystem/Store/graph rollback 和 rollback conflict 均不覆盖外部内容，错误保留原因/路径/version，正常 rename/linkage 行为不回归。
- 执行相关 unit/integration/browser、`npm run check:boundaries`、`npm run typecheck`、`npm run build`、`git diff --check` 和必要的 boundary/legacy-import 检查；不得用固定等待掩盖失败。

## Acceptance criteria

- FileSystemPort 明确定义 coherent text snapshot、不可变可比较 version token、atomic conditional write、conflict/degraded 结果；MemoryFileSystem 可 deterministic 地证明这些语义，且没有把非原子 adapter 伪装成安全写入。
- Persistence manual/auto save 使用条件写；检查与写入之间的外部修改永远不会被覆盖，冲突/degraded 可诊断，DocumentStore Markdown/revision/persisted state 和 dirty 语义不被错误确认或悄悄改变。
- P4-06 incoming-reference rewrite 使用同一条件写；计划后的外部修改 abort/报告，既有 compensation/rollback 保留且自身不以无条件写覆盖外部变化；正常 rename、path rebind、graph/linkage 行为通过。
- 相关 unit/integration/browser、boundary、typecheck、build 和 whitespace 检查通过；不违反 Markdown/DocumentStore/Projection authority、no-timeout/no-sleep、no-legacy-runtime-import 不变量。

## Out of scope

- 重新设计 dirty delete、目录 descendant migration/path rebind、clipboard fallback、embed retry、图片 compensation、P5/table 和其他未列出的 remediation。
- 新的 directory rename/incoming-reference transaction policy、平台 watcher、真实 Tauri/native adapter 实现；本任务只规定未来 adapter 的 conditional capability/degraded contract。
- 改变 accepted ADR、DocumentStore/revision/Projection 长期模型、Markdown 持久化格式或引入第二份 Markdown authority。
- `editor-app/` 的修改、任何 runtime import、reset/checkout/clean、amend/rebase/force push，以及自动开始下一任务。
