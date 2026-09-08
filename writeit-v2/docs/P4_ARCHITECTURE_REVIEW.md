# P4-AR2 — P0–P4 Architecture & Product Boundary Re-review

- **初始评审日期：** 2026-09-08
- **初始 Baseline：** `65103f3` (`fix(v2): complete P4-R05 embed lifecycle recovery`)
- **本次 re-review：** 2026-09-08，`HEAD b96d116` 加当前未提交 F-03 follow-up 工作树
- **评审范围：** P0–P4 architecture invariants、P2-AR-06、P4-R01、P4-R02、P3-R01、P4-R03、P3-R02、P3-R03、P4-R04、P4-R05、F-01/F-02、F-03 follow-up、P2A 用户验收证据、Task Contract/STATUS/README/Feature Map 一致性
- **最终 Gate：** **CHANGES REQUIRED / HOLD**
- **P5 状态：** 未开始；`P5-01` 未获授权
- **ADR 状态：** ADR-0001 至 ADR-0006 仍 Accepted；本次没有提出修改 ADR 或改变已批准目录策略

## 1. 结论摘要

P0–P4 的核心 authority、Projection、source-fidelity、依赖边界和 P2-AR-06 的正常 fan-out/history 路径有充分自动化证据；本次完整 gate 全部通过，不能据此伪称 P0–P4 产品边界已经无风险。

本次 Gate 保持 HOLD，原因是仍有会影响生产验收的未关闭事项；F-01 与 F-02 的独立 remediation 已在后续 follow-up 中关闭：

1. **F-01：已由本任务关闭。** dirty recursive delete 的 Save preparation/rollback 现使用 P3-R03 CAS；race、same-content rewrite、delete-failure rollback conflict 和多文档部分失败均有证据。
2. **F-02：已关闭。** image attachment 现在使用 timestamp-first + exclusive create，返回 ownership receipt；Store/projection mutation 失败时只做 receipt-scoped conditional cleanup，失败会产生明确 orphan diagnostic，不覆盖或删除既有/外部 bytes。
3. **HIGH / production acceptance gap：** Embed controller 的 generation/retry/late-result 协议已有证据，但 production App wiring 只间接依赖 workspace/reference refresh 触发 retry；没有针对真实 persistence loader failure 的 production Chromium 用户旅程证据，也没有明确的 embed retry surface。

目录操作的当前批准策略仍然是“影响已打开 descendant Document/path binding 时阻止”，本次不把它改成 transactional path migration。该策略足以保护当前运行时 path binding 的一致性，但不等于完整 directory reference migration；未打开 descendant 的 incoming-reference rewrite、path rebind、rollback 仍是明确 deferred risk。

## 2. 工作流与验证基线

### 本次 re-review（2026-09-08）

本次复核以 `HEAD b96d116`（`docs(v2): merge UX and phase gate specifications`）为提交基线，并在当前工作树上执行；工作树开始时并非 clean，已有的 F-03 follow-up 修改和测试不属于本次评审产生的变更。本次评审只读取并验证这些变更，不修改产品源代码、测试代码、`editor-app/` 或 `raw/`。

开始复核时 `git status --short --branch` 为：`master...origin/master`，已有变更涉及 `STATUS.md`、`App.vue`、workspace open seam、CM6 popup/completion/embed/style、F-03 browser/integration tests，以及 F-03-R1/R2/R3 contracts、workspace-open unit test 和 image-paste unit test。评审结论必须区分这些未提交变更与本次 review 文档，不能把它们一起暂存。

本次 gate 命令结果：

| 命令 | 结果 | 证据摘要 |
|---|---|---|
| `cd writeit-v2 && npm run test` | **PASS** | boundary check 通过（87 source files）；Vitest 63 files / 396 tests passed |
| `cd writeit-v2 && npm run test:browser` | **PASS** | Chromium 63 tests passed |
| `cd writeit-v2 && npm run typecheck` | **PASS** | `vue-tsc --noEmit` 通过 |
| `cd writeit-v2 && npm run build` | **PASS** | Vite production build 通过；899.86 kB main chunk 的既有 >500 kB warning 非本次 gate blocker |
| `cd writeit-v2 && npm run check:boundaries` | **PASS** | AST/layer boundary check 通过（87 source files） |
| `git diff --check` | **PASS** | 无 whitespace error |

额外只读扫描未发现 v2 source 的 `editor-app` runtime import、Core 到 UI/platform/editor 的越层 import 或以 `setTimeout`/`setInterval`/`sleep`/固定 delay 作为状态协议的命中。测试通过证明当前 fixture/路径满足合同，不表示真实 native adapter、directory migration 或生产 Embed loader failure/retry 用户旅程已经闭合。

### 初始 gate 记录（历史证据）

开始评审时 `git status --short --branch` 为 clean（`master...origin/master [ahead 9]`）。本次没有修改产品源代码、测试代码、`editor-app/` 或 `raw/`；只产生评审合同、评审报告及必要的状态/README 文档。

已执行完整 gate：

| 命令 | 结果 | 证据摘要 |
|---|---|---|
| `cd writeit-v2 && npm run test` | **PASS** | boundary check 通过（86 source files）；Vitest 61 files / 358 tests passed |
| `cd writeit-v2 && npm run test:browser` | **PASS** | Chromium 51 tests passed |
| `cd writeit-v2 && npm run typecheck` | **PASS** | `vue-tsc --noEmit` 通过 |
| `cd writeit-v2 && npm run build` | **PASS** | Vite production build 通过；889.28 kB main chunk 的既有 >500 kB warning 非本次 gate blocker |
| `cd writeit-v2 && npm run check:boundaries` | **PASS** | AST/layer boundary check 通过（86 source files） |
| `git diff --check` | **PASS** | 无 whitespace error |

测试通过说明已有路径满足当前 fixture/测试合同，不表示未覆盖的 race、真实平台 adapter 或人工用户验收已经通过。

## 3. 核心架构不变量复核

| 领域 | 结论 | 证据/限定 |
|---|---|---|
| Markdown persistent contract | **PASS** | Store、persistence、reference、image projection 均保留 source；未知 Markdown 和混合换行的 browser fidelity 通过。 |
| DocumentStore runtime authority | **PASS** | source mutation 仍经过 Store；history retained payload 是 delta；persistence baseline/clipboard/reference facts 是派生或外部对账数据，不是第二 live authority。 |
| Projection boundary | **PASS** | CM6、preview、embed、image、clipboard/context surface 均通过 Store/capability；P4-09 child projection 有 attach/ack/detach/lifecycle 证据。 |
| Core/layer boundary | **PASS** | AST checker 覆盖 side-effect、re-export、dynamic、CommonJS、Vue script 和 resolved layer matrix；当前 v2 无 legacy runtime import。 |
| Source fidelity | **PASS（已覆盖范围）** | LF/CRLF/CR/mixed、unknown Markdown、targeted edit、no-edit mount 和 Chromium fan-out 通过；没有发现打开或保存自动 rewrite 的证据。 |
| No timeout/sleep protocol | **PASS** | auto-save timer 仅调度 guarded save；embed/popup 使用事件或 microtask，不以固定延时作为 authority 协议。 |
| Git/diff guarantee | **未进入 P5 blocker 判断** | ADR-0006 仍要求 source diff guarantee；P7 实现尚未开始，不能把 future semantic diff 说成已完成。 |

### P2-AR-06 fan-out/history 复核

**主要风险已解除：** `DocumentStore` event 携带 CM6-independent `SourceChangeSet`；CM6 fan-out 优先映射最小 projected ranges，Chromium 已证明 secondary caret 通过 source-start insertion 保持在正确位置；typing grouping 需要显式 group/continuation；history retained entry 只保留 source delta，并受 `maxEntries` 与 UTF-8 `maxBytes` 双重预算约束。大文档 browser smoke、Unicode/UTF-16、line-ending-only change、undo/redo 和 byte-budget unit/integration coverage 均通过。

**残余风险没有被抹掉：** `SingleDocumentView.applyAuthoritativeDocument()` 在 source/projection mapping 无法表示时仍使用 contiguous whole-projection fallback，而不是把该情况显式标为 stale/recovery；`getHistory()` 调用时仍会按兼容 API materialize before/after。当前 STATUS 已记录这两个限制。它们不重新打开 ADR-0002/0003，也不是本次最高 blocker，但仍是 selection/performance 的 deferred quality risk，后续需要 failure-path coverage，而不是只验证正常 caret insertion。

## 4. 已批准 remediation 逐项结论

### P4-R01 — directory rename/move safety

**结论：当前策略 PASS；完整能力 DEFERRED。**

- `WorkspaceTreeService` 对 directory rename/move 按 path segment 做 descendant preflight。
- Store 中所有 loaded Document（不只 active tab）和 recovery path 都进入 typed diagnostic；nested、dirty、sibling-prefix、provider failure 和 filesystem mutation 前阻止均有 unit/integration/Chromium evidence。
- 阻止路径不修改 filesystem、Store path/revision/Markdown、tabs、persistence、recovery 或 tree snapshot。
- 当前策略明确是 fail-closed block，不是 transactional path migration。未打开 descendant 的 incoming references 仍可能因 directory move 失去解析；directory-wide reference rewrite/path rebind/rollback 尚未实现。
- 另有一个未自动化的 TOCTOU 风险：preflight 与 filesystem call 之间没有跨 workspace open/embed loader 的统一 operation lock；普通 App UI 用 `workspaceBusy` 降低该风险，但 in-flight embed loading/外部 application caller 仍需要专门 coverage。

本次不改变该批准策略；若未来要实现完整 migration，必须另行提出架构/用户决策，不在本 Task 局部绕过。

### P4-R02 — ReferenceGraph rollback revision

**结论：PASS。**

compensation 后 graph 从当前 Store snapshot 和当前 filesystem catalog 重建，不复用 rollback 前 snapshot 作为 revision authority；Store rollback 产生的新 revision、edge/backlink revision、后续 Store update、filesystem/graph compensation failure 都有 integration/unit evidence。当前没有发现 graph phantom revision 被静默伪装成功的证据。

### P3-R01 — document-relative image paths

**结论：PASS（路径语义 + F-02 attachment transaction follow-up）。**

root-images、same-dir、file-images、inline 在 nested document 下的 canonical source path、resolver、preview、copy、tree locate 使用同一 document-relative helper；读取/decode/clipboard failure 不改 source。F-02 follow-up 已补齐 binary exclusive create、timestamp collision handling、ownership-scoped compensation 和 orphan diagnostics；生产/native binary adapter 仍必须实现同一 port contract。

### P4-R03 — entity completion modes

**结论：PASS。**

file-self/object/heading child session 在 link、editable embed、readonly embed 三种 mode 共享 provider/application contract；ASCII/full-width trigger、mode switch、二级 navigation/back/filter、source/revision/history/caret preservation、heading fallback、IME/lifecycle race 和 exact Markdown apply 的 unit/integration/Chromium evidence 通过。P8 template catalog/doctype 仍是 deferred，不被 P4-R03 的 PASS 覆盖。

### P3-R02 — dirty-aware recursive delete

**结论：生命周期 cleanup PASS；F-01 CAS remediation PASS。**

recursive plan、任意深度 runtime bindings、Save/Discard/Cancel、autosave lock、projection/tab/persistence/recovery/ReferenceGraph cleanup 和 no-ghost tests 通过。F-01 进一步让 dirty Save preparation 使用 coherent snapshot token + `writeTextIfUnchanged`，并让 delete-failure/multi-document rollback 使用成功 CAS 返回的 token；冲突会在 filesystem delete 前中止并保留 local conflict diagnosis。证据见 [F-01 contract](./F_01_TASK_CONTRACT.md) 与 follow-up 小节。

### P3-R03 — conditional filesystem writes/CAS

**结论：normal persistence/rename PASS；dirty delete integration 已接入 CAS。**

manual/auto save、P4-06 incoming-reference rewrite 和 F-01 dirty-delete Save/rollback 均使用 coherent snapshot + `writeTextIfUnchanged`；changed/deleted、same-content version change、degraded adapter、conditional rollback 和 graph compensation evidence 通过。P3-R03 原合同不负责重新设计 dirty delete；F-01 只复用既有 adapter contract，将 deletion preparation/rollback 接入同一条件写语义。

### P4-R04 — clipboard fallback freshness

**结论：PASS（当前 plain-text evidence contract）。**

custom MIME/file URI 优先；changed/empty/ambiguous/permission failure fall through normal paste；plain-text-only fallback 要求 exact normalized text + fingerprint + current binding；late async read 不会清掉 newer binding；browser regression 通过。不可区分的“外部程序复制了完全相同 plain text”仍是 text-only platform 的信息论限制，必须保留为 adapter/deferred risk，不能宣称可以证明来源。

### P4-R05 — embed failure/recovery lifecycle

**结论：controller protocol PASS；production acceptance **CHANGES REQUIRED / evidence gap**。**

request 绑定 host revision/projection generation；missing → appears、transient failure → explicit retry、nested remove/recreate、parent detach、close/reopen、readonly/circular/depth guard 和 late-result no-leak 的 controlled integration/Chromium evidence 通过。当前 App 的 `ensureEmbeddedDocument()` 失败后依赖 workspace/reference refresh 作为 retry event，没有针对真实 persistence loader rejection 的 production browser journey 或明确的 embed-local retry UI；STATUS 已保留这一风险。该项需要用户确认“受控 harness 证据是否足以进入 P5”，否则应补 production acceptance。

## 5. Gate findings

### F-01 — RESOLVED — dirty delete Save/rollback CAS integration

**Baseline finding：** 原评审在 baseline `65103f3` 发现 `prepareDeletionSave()` 使用无条件 `writeFile`，其 rollback 也可能覆盖外部修改。

**Follow-up result：** F-01 只修改 dirty-delete Save/rollback integration：每个 dirty Document 先读取并保留 coherent content/version；Save 使用 `writeTextIfUnchanged`；成功写入返回的 version 作为 rollback expected token。CAS changed/deleted/degraded、adapter failure、Store race 和 rollback conflict 都阻止 filesystem delete，并返回包含 phase、affected paths/DocumentIds、cause/rollback errors 的诊断。rollback 不会用重新读取的 token 强行覆盖外部 bytes；conflict 会保留 Document dirty/conflict state。相关实现/测试见 [F-01 contract](./F_01_TASK_CONTRACT.md)。

**Follow-up evidence：** deletion/persistence unit suites 覆盖不同内容 race、相同 bytes 的 version race、multi-document partial save failure、delete-failure rollback conflict，以及 rollback 后已知 baseline token 的刷新；完整 Vitest 61 files / 362 tests、Chromium 51 tests、typecheck、build、boundary 和 whitespace checks 均通过。图片 attachment、目录 migration 和 Embed production acceptance 不在本 remediation 内。

### F-02 baseline finding — HIGH / BLOCKER — image attachment compensation/orphan/collision strategy 未闭合

**证据：** `ImageAttachmentService.paste()` 在 `src/application/attachments/image-paste.ts:372-382` 先 `writeBinary()`，再由 CM6 adapter 在 `src/editor/cm6/extensions/image-paste.ts:249-267` 尝试 Store mutation；mutation race/rejection 才调用 cleanup。`BinaryFileSystemPort.deleteBinary` 是 optional best-effort（`src/platform/filesystem/binary-port.ts:10-14`），而 `ImageAttachmentService.cleanup()`（`image-paste.ts:405-436`）返回 `failedPaths`，adapter 没有检查该结果。reference validation failure（`image-paste.ts:228-243`）也没有统一 cleanup。MemoryFileSystem 的 `writeBinary` 会覆盖同路径已有 binary；没有 exclusive-create/ownership token。

**风险：**

- 目标名冲突时可能覆盖已有图片；随后 source mutation 被 revision race 拒绝，cleanup 可能删除原有文件或留下不可解释的 orphan。
- 平台没有 deleteBinary 或 cleanup 失败时，用户只看到 mutation error，无法知道哪些附件已落盘。
- 当前 tests 只验证正常写入和一个显式 cleanup happy path；没有覆盖 name collision、Store rejection、cleanup failure、部分 batch compensation 和 retry/recovery。

**要求：** 后续必须选择并记录 attachment ownership/compensation 策略（exclusive destination、可验证的 created-version/backup、orphan report 或明确保留策略），并以 unit/integration/browser evidence 证明不能删除/覆盖非本次 paste 所拥有的 bytes。此要求已由 F-02 follow-up 独立关闭；以上文字保留为 baseline finding。

### F-02 follow-up — RESOLVED — collision-safe timestamp attachment compensation

- `BinaryFileSystemPort.createBinaryExclusive()` 在 collision 时只返回 `exists`，`MemoryFileSystem` 不覆盖已有 text/binary/directory entry；成功 create 返回 opaque version receipt。
- 默认文件名以 `YYYYMMDD-HHMMSSmmm` timestamp 开头；相同 timestamp/entropy 或重复粘贴通过序号候选重试。Markdown 仍由 P3-R01 helper 产生 document-relative source。
- `ImagePasteResult` 携带 transient ownership receipts。CM6 image adapter 在当前 projection mutation capability/revision 检查和 Markdown/reference validation 失败时只补偿这些 receipts；conditional delete 的 version 不匹配会保留外部 bytes。
- cleanup 返回 path/reason/operation/document 的 `orphan-attachment` diagnostic；App 显示该诊断，不把 best-effort cleanup 伪装成完整 rollback。成功 Store mutation 后附件保留，source/revision/history/dirty 语义保持。
- 证据见 [F-02 contract](./F_02_TASK_CONTRACT.md)、`tests/unit/application/attachments/image-paste.test.ts`、`tests/integration/editor/cm6/image-paste.test.ts`、`tests/unit/platform/filesystem/binary.test.ts` 和 `tests/browser/image-paste.spec.ts`；follow-up gate 为 Vitest 61 files / 372 tests、Chromium 51 tests、typecheck、build、boundary 和 whitespace checks 全部通过。

### F-03 — HIGH / TEST/PRODUCTION ACCEPTANCE GAP — Embed production loader failure evidence 不足

**证据：** P4-R05 controlled harness 已覆盖 retry/generation，但 App 的 `ensureEmbeddedDocument()`（`src/App.vue:480-533`）把 persistence load failure 交给 Embed controller；实际 retry 依赖后续 tree/reference refresh event。当前 browser tests 直接注入 `onTargetMissing`/`subscribeTargets`，未验证真实 App loader failure → 用户可见诊断 → Refresh/retry → child mount 的完整旅程。

**要求：** 在不引入 timer 的前提下补真实 production wiring acceptance，或由用户明确接受“Refresh 是 retry surface、controlled harness 足够”的 deferred decision。该项仍使本次 gate 不能宣称 P5-ready。

### F-04 — MEDIUM / DEFERRED RISK — directory policy 的语义范围与 preflight race

P4-R01 的当前 block policy 可以保护已知 runtime path binding，但不保护完整 closed-document reference semantics；directory move 在没有 open descendant 时仍可能使未打开来源的 reference 断链。另有 preflight 与 move 之间的 in-flight loader/open binding race，当前没有统一 operation lock/recheck 证据。

这是已批准 conservative policy 的边界，不是本次擅自改变策略的理由。应在后续用户决策中选择：继续接受“open descendant block + closed reference migration deferred”，或另立 Task/ADR 做完整 path migration。不能在 STATUS 中写成 directory rename/move 已全面安全。

### F-05 — MEDIUM / TEST GAP — P2-AR-06 fallback path 与人工证据

正常 minimal fan-out/history budget 已通过，但 mapping failure 的 whole-projection fallback、selection/degraded 语义没有同等强度的 browser regression。P2A-AR1 的历史结论为 PASS，当前自动 suite 已覆盖主要 popup/group/mode/IME/lifecycle/line-ending journeys；不过真实中文 IME 的人工验收记录是 review prose，而非仓库内可重放 artifact。本项不重新打开 P2A architecture gate，但若 release policy 要求新一轮用户 sign-off，应由用户提供/确认验收证据。

## 6. 分类与可接受 deferred 风险

### 必须返工后才能关闭的 blocker

- F-03：如果用户验收要求 production Embed loader failure/retry 证据，则必须补 production journey；当前不能把 controlled harness 直接冒充 production acceptance。

### Test/evidence gap（不应伪称 PASS）

- directory preflight/open-loader race；
- P2-AR-06 unrepresentable mapping fallback；
- P2A real-IME/user acceptance artifact；
- App production Embed failure/retry wiring。

### 当前可以保留的 deferred 风险

- directory-wide transactional path migration、closed-document incoming-reference rewrite、path rebind/rollback；本次明确不实现。
- Native/Tauri filesystem 的 strong CAS、watcher、binary adapter 和系统文件管理器 reveal；adapter 在不能提供 CAS 时必须 degraded，不得伪称安全写入。
- P4-R04 text-only clipboard 无法证明“外部复制了完全相同文本”的来源；custom MIME/file URI/platform adapter 仍是增强路径。
- P2-06 richer Markdown、P8 template catalog/doctype、P7 Git provenance、P5 Table Engine、office clipboard matrix/large-table performance；这些不应被本次 P4 gate 的 PASS 混入。

## 7. 文档与状态一致性

本次复核发现并在本评审中处理以下 drift：

- `writeit-v2/README.md` 仍写成“下一任务为 P3-08”，与已完成 P4-R05 不一致；已改为当前 P4 gate HOLD，明确 P5 未开始。
- `STATUS.md` 原本 `Blocked: None` 且 `Next: P5-01`，会错误授权 P5；已改为 P4-AR2 review complete / HOLD，并将 P5-01 标为 blocked。
- `STATUS.md` 原本把 P3-R02/P3-R03 的 CAS/guarded-save 描述写得过宽；F-01 follow-up 已将 deletion preparation/rollback 的 CAS 边界补齐，F-02 follow-up 已记录 attachment transaction closure，并保留 F-03 风险。
- `LEGACY_FEATURE_MAP.md` 的 `Strategy` 仍是迁移策略，不是 parity completion；本次不把 broad `File CRUD`/`References` 行误标为已完成，也没有创建第二份 Feature Map。
- P2/P2A 历史 review 中的旧 gate 结论保留为历史证据；P4-AR2 不重写已接受的 PASS，只明确其覆盖边界和本次新增的 evidence gap。

## 8. 用户验收与决策点

1. F-01 dirty-delete external-overwrite/CAS gap 已由 follow-up 关闭；本报告不再把它作为未关闭 blocker。
2. F-02 timestamp-first/exclusive-create/ownership-receipt + best-effort/orphan diagnostic 方案已按用户确认实现并有 unit/integration/browser evidence；本报告不再把 attachment compensation 作为 blocker。
3. 是否接受当前 Embed 的“controller + explicit workspace/reference refresh retry”作为 production acceptance，还是要求真实 App loader failure/retry journey。
4. 是否继续批准当前目录策略：有打开 descendant 时阻止；完整 directory migration 明确 deferred。若要改成 transactional migration，必须另立架构决策，本 Task 不自行改变。
5. 是否需要重新执行并保存 P2A 真实 IME/用户验收记录；历史 P2A-AR1 PASS 不应被自动化 test count 取代。

## 9. Re-review delta after F-03-R3

本次工作树相对初始 P4-AR2 评审新增了 F-03-R1、F-03-R1-FIX、F-03-R2 和 F-03-R3 的实现与证据：

- 真实 App 已覆盖 editable child 的 slash/completion popup、目标 DocumentStore mutation、host source/token 与当前 tab 保持不变、readonly child 不提供可提交 popup，以及 child image paste 的 target-path/一次性边界。
- 已覆盖 loaded dirty target 的显式 Open/激活、稳定 DocumentId、dirty tab indicator、Save 清理 dirty，以及 missing target 出现后加载并继续编辑的 App 旅程。
- 这些 follow-up 没有改变 accepted ADR、DocumentStore authority、Projection 边界、directory fail-closed policy 或 no-timeout 协议；本次 63 条 Chromium 测试和 396 条 Vitest 测试均通过。
- 但仍没有真实 App 的 persistence loader rejection → 用户可见 Embed failure → 明确 Refresh/retry → child mount 的完整 Chromium 旅程。当前 `ensureEmbeddedDocument()` 的失败恢复仍依赖 workspace/reference refresh 事件；F-03-R3 的 popup parity 和 F-03-R1/R2 的成功/dirty/image 路径不能替代该 production acceptance evidence。

P2A 的真实中文 IME 人工验收 artifact、P2-AR-06 unrepresentable mapping fallback 的专门 browser evidence，以及目录 preflight 与 in-flight loader/open 之间的 TOCTOU evidence 仍按原报告分类保留，不重新伪称 PASS。目录操作仍是“有运行时 descendant binding 则阻止”，不是完整 directory path migration。

## 10. 最终 Gate

**CHANGES REQUIRED / HOLD。**

- P0–P4 核心 authority/boundary、source fidelity 和正常 remediation paths 有充分自动化证据；F-01 与 F-02 已关闭，F-03 的交互/图片/dirty Open follow-up 也有当前 App evidence。
- **F-03 production loader failure/retry acceptance evidence 仍未闭合**，因此不能把受控 harness 的 retry 证据或成功加载旅程表述为 P5-ready production acceptance。
- `STATUS.md` 必须保持 `P5-01` blocked，不把 P5 写成 Next；不开始 P5，不改变 accepted ADR，不改变已批准目录策略。
- 后续应由用户批准并定义独立的 F-03 production acceptance remediation Task；本评审不自动开始下一 Task。
