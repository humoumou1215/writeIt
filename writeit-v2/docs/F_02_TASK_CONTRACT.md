# F-02 — Collision-safe timestamp image attachment compensation

## Goal

只修复 P3-06 image attachment transaction：新附件使用时间戳优先且不可覆盖的命名/落盘语义；Markdown mutation 失败时只补偿本次成功创建的文件，并对无法清理的附件产生明确 orphan diagnostic。保持 P3-R01 的 document-relative Markdown path、四种粘贴策略和 inline data URL 合同。

用户已确认的策略是：**时间戳优先的唯一命名 + 尽力清理 + orphan 诊断**。本任务不把 best-effort cleanup 伪装成跨系统完整 rollback。

## Allowed scope

- `writeit-v2/src/core/workspace/attachments.ts`：附件 transaction result、短生命周期 ownership receipt 和 orphan diagnostic contract。
- `writeit-v2/src/platform/filesystem/binary-port.ts`、`memory.ts` 及直接 binary tests：exclusive binary create 与 ownership-checked conditional cleanup。
- `writeit-v2/src/application/attachments/image-paste.ts`：时间戳命名、collision retry、attachment receipt、compensation 和 inline fallback。
- `writeit-v2/src/editor/cm6/extensions/image-paste.ts`、`src/App.vue`：当前 projection mutation capability/revision gate、失败补偿和可见 diagnostic 接线。
- P3-06/P3-07 相关 unit、integration、browser tests。
- 本合同、`writeit-v2/docs/STATUS.md` 和 `writeit-v2/docs/P4_ARCHITECTURE_REVIEW.md` 中 F-02 的状态/证据更新。

不得修改 accepted ADR，不得改变 DocumentStore/Markdown/Projection 核心不变量，不得 runtime import `editor-app/`。

## Read first

- `AGENTS.md`
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`
- `writeit-v2/docs/STATUS.md`
- `writeit-v2/docs/P3_R01_TASK_CONTRACT.md`
- `writeit-v2/docs/P4_AR2_TASK_CONTRACT.md`
- `writeit-v2/docs/P4_ARCHITECTURE_REVIEW.md` 中 F-02 结论
- `LEGACY_FEATURE_MAP.md` 中 image paste / relative image projection 条目
- `writeit-v2/src/core/workspace/attachments.ts`
- `writeit-v2/src/application/attachments/image-paste.ts`
- `writeit-v2/src/platform/filesystem/binary-port.ts`、`memory.ts`
- `writeit-v2/src/editor/cm6/extensions/image-paste.ts`、projection mutation capability
- P3-06/P3-07 现有 unit、integration、browser tests

## Implementation requirements

1. 默认新生成附件名以明确时间戳开头；同一时间戳、相同 entropy 或重复粘贴遇到候选冲突时，用序号/entropy 后缀重试。binary adapter 必须提供 exclusive create 语义：候选已存在只报告 collision，不覆盖 text/binary/directory entry。
2. 成功 create 返回短生命周期 ownership receipt/version。Markdown 仍只写标准 document-relative source path；解析、preview、copy、tree locate 不改用 workspace-root-first 私有语义。inline mode 不落 binary，继续使用现有 data URI/base64 合同。
3. binary create 成功后，CM6 adapter 只能通过当前 projection mutation capability 的 live/editable/current-projection/revision 检查提交 Markdown。readonly、destroyed、stale/revision race、reference/result validation、mutation failure 或提交前后续流程失败都必须对本次 receipts 做 best-effort compensation。
4. compensation 使用 ownership-checked conditional delete；不得根据任意 path 或 pre-existing path 进行无条件删除。cleanup success 只删除本次 receipt 所拥有、版本仍匹配的 bytes；ownership 丢失或 cleanup capability/error 时保留外部 bytes。
5. cleanup 失败、ownership 无法确认、缺少 receipt/capability 等情况必须产生 `orphan-attachment` diagnostic，至少包含 path、reason、operation 和关联 document path；诊断应明确表示可能遗留 orphan，不得报告为完整 rollback。成功 Markdown mutation 后不做补偿，附件保留并维持 Store revision/history/dirty 语义。
6. 不引入 timeout/sleep，不修改 F-01、Embed/clipboard、目录 migration、P5/Table 或 accepted ADR；不通过局部实现建立第二份 Markdown authority。

## Tests

- Unit：默认 timestamp-first 命名；同一时间连续粘贴/重复粘贴；候选文件已存在；exclusive create 不覆盖已有 text/binary；四种策略、嵌套 document-relative path、inline data URI、binary write failure；ownership-checked cleanup success、cleanup failure、ownership loss、orphan diagnostic。
- Integration：成功 mutation 的 source/revision/history/dirty 与 attachment 保留；readonly/destroyed projection、revision race、result/reference validation 和 mutation failure 后的 compensation；已有文件和外部替换 bytes 绝不被删除；cleanup diagnostic 包含路径/原因/文档/操作。
- Browser：既有四种策略/inline 和 nested document-relative preview/tree locate 旅程继续通过；成功后 preview/copy/locate 与 source fidelity、重挂载/重新解析行为继续通过。
- Verification：
  - `cd writeit-v2 && npm run test`
  - `cd writeit-v2 && npm run test:browser`
  - `cd writeit-v2 && npm run typecheck`
  - `cd writeit-v2 && npm run build`
  - `cd writeit-v2 && npm run check:boundaries`
  - `git diff --check`

不使用固定等待掩盖失败；测试中的 Promise completion 只等待明确的事件/回调。

## Acceptance criteria

1. 新附件文件名时间戳优先，重复/并发候选不会覆盖已有 entry；exclusive create 和 ownership receipt 有可重放证据。
2. 四种粘贴策略和 inline data URL 合同不回归；嵌套文档 Markdown source 仍是标准 document-relative path，preview/解析/tree 定位指向同一实际 workspace path。
3. attachment write 后所有 Markdown mutation 都经过当前 projection capability/revision gate；readonly、destroyed、revision race、mutation/后续提交前流程失败不改写原 source，并只补偿本次新建文件。
4. cleanup 成功删除本次 receipt；cleanup 失败/ownership 丢失保留已有或外部 bytes，并产生明确 orphan diagnostic，不伪装为完整 rollback。
5. 成功 mutation 保留附件，DocumentStore source/revision/history/dirty 正确；成功后 reopen/preview/copy/locate 不改 source。
6. 相关 unit/integration/browser、boundary、typecheck、build 和 whitespace checks 通过；P4-AR2 仍可因 F-03 Embed production acceptance 保持 HOLD，P5 不因本任务自动开始。

## Out of scope

- F-01、F-03/Embed production acceptance、Reference clipboard、directory rename/migration、P5 Table、P6–P12 功能。
- 修改 accepted ADR、重新设计 DocumentStore/revision/Projection 长期模型、批量迁移已有 Markdown image source。
- 真实 Tauri/native binary adapter、系统文件管理器 reveal、分布式跨文件事务；adapter 若不能提供 exclusive/ownership contract 必须显式 degraded，而不能声称安全。
- `editor-app/`、`raw/` 的修改，以及 reset/checkout/clean/force push/amend/rebase 或自动开始下一 Task。
