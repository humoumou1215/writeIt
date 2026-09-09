# WriteIt v2 Codex Goal Contract

- **Status:** COMPLETE — RC review and validation complete; follow-up prerequisites are recorded in the RC report
- **Prepared on:** 2026-09-08
- **Baseline commit:** `03975a7` (`fix(v2): complete F-03 follow-up integration`)
- **Goal branch:** `codex/goal-writeit-v2`
- **Execution spec:** [IMPLEMENTATION_SPEC.md](./IMPLEMENTATION_SPEC.md)
- **Decision ledger:** [DECISIONS.md](./DECISIONS.md)
- **Current state:** [STATUS.md](./STATUS.md)

## Objective

从已验证的 P0～P4 基线出发，在一个 Codex Goal 中完成 P4 UX 遗漏核对以及 P5～P12，交付一个可验收的 WriteIt v2 release candidate：Markdown/DocumentStore/Projection/Diff 不变量保持成立，legacy capability map 逐项有结论，浏览器主流程通过，macOS 可生成并启动 unsigned development package，Windows 可由 CI 生成 package artifact。

这个 Goal 比单个 Task 大，但不是开放式 backlog。仅执行下述 checkpoint；不得顺手扩展产品范围。

## In scope

- P4-UX01、P4-UX02 与 production Embed loader failure/retry acceptance gap 的显式 reconciliation。
- `IMPLEMENTATION_SPEC.md` 中 P5-00～P12 的任务、Phase Gate 与必要 remediation。
- 为上述任务所需的 v2 产品代码、测试、文档、browser mock、Tauri/desktop adapter、CI/package 配置。
- `LEGACY_FEATURE_MAP.md` 中每个 granular workflow 的最终 parity classification。
- 每个 checkpoint 的本地 commit、验证证据与状态同步。

## Explicitly out of scope

- 修改 `editor-app/`、`raw/` 或将 legacy runtime import 到 v2。
- 实际 push、merge、tag、签名、notarization、公证、商店发布、GitHub Release 或面向用户的生产发布。
- Linux packaging。
- 自动安装完整 Xcode、付费证书、外部账号凭据或修改用户机器的全局安全策略。
- 物理删除/重命名 `editor-app/`，或将目录结构切换为最终发布布局。
- 未列入 P5～P12/本文件的全新产品功能。

## Non-negotiable invariants

根 `AGENTS.md` 的十项架构不变量全部适用，尤其是：Markdown 是持久数据合同；`DocumentStore` 是运行时内容权威；所有编辑器、Embed、Table、Mermaid、Diff 和预览都是 Projection；unknown/failed rendering 不得损坏 source；Raw Markdown Diff 是保证层。

任何 checkpoint 只有在这些不变量仍有测试/审查证据时才可标为 PASS。

## Execution policy

1. 按 G0 → G8 顺序执行，不并行打开互相依赖的 Phase。
2. 每个 SPEC Task 仍遵守自己的 Allowed scope、Read first、Tests、Acceptance criteria 和 Out of scope。
3. checkpoint 内可以连续执行多个 Task ID；每个 Task 完成即更新测试和局部记录，不等到 Phase 末尾补账。
4. Phase Gate 为 HOLD 时，新增范围最小的 `Px-Rnn` remediation，完成修复并复审；HOLD 本身不是向用户暂停的理由。
5. 只有 `DECISIONS.md` 标记为 `MUST ASK` 的事项、Accepted ADR/核心不变量变更、凭据/许可、不可逆外部动作或 Goal 范围变更才暂停。
6. 每个 checkpoint 结束时更新本文件 progress log 与 `STATUS.md`，运行验证，创建本地 checkpoint commit；不得自动 push/tag/release。
7. 当实现证据与 `MAY ADAPT` 决策冲突时，选择最小且符合不变量的方案，更新 `DECISIONS.md`、测试和相应 Task/Review 后继续。

## Checkpoints

| ID | Scope | Required outcome | Gate / verification |
|---|---|---|---|
| **G0** | P4-UX01、P4-UX02、production Embed retry gap | 对每条 acceptance requirement 建立“已有证据/本次实现/明确失败”矩阵；补齐未满足项；真实 App loader failure → visible retry → recovery 有 browser evidence | P4 UX reconciliation review PASS；`npm run verify` |
| **G1** | P5-00～P5-05、P5-AR1 | Table core、编辑、CM6 projection、selection/clipboard/IME、resize/reorder 全部达到 UX contract；cell 换行验证 `<br>` | P5-AR1 PASS；`npm run verify` |
| **G2** | P6-00、P6-A01～A03、P6-M01～M02、P6-AR1 | Annotation sidecar/anchor/thread/drawer 与 Mermaid source-backed preview/command/reference/fallback 完成 | P6-AR1 PASS；`npm run verify` |
| **G3** | P7-00～P7-06、P7-AR1 | Git ports/workbench、raw guarantee diff、discard safety、semantic diff、blame/history 完成 | P7-AR1 PASS；`npm run verify` |
| **G4** | P8-00～P8-06、P8-AR1 | Search/replace、Outline/Backlinks/stats、Validation、Template catalog/providers 完成；provider runtime 遵守 ADR-0008 | P8-AR1 PASS；`npm run verify` |
| **G5** | P9-00～P9-02、P9-AR1 | Markdown/PDF/DOCX/custom/batch export consume authoritative snapshots；逐文件失败可见 | P9-AR1 PASS；`npm run verify` + export fixtures |
| **G6** | P10-00～P10-03、P10-AR1 | Runtime diagnostics、隐私控制、report package、agent debug API/transport contract 完成 | P10-AR1 PASS；`npm run verify` + privacy/security tests |
| **G7** | P11-00～P11-04、P11-AR1 | Browser ports 接入 Tauri；macOS unsigned dev package 可启动；Windows CI package artifact；debug transport default-safe | P11-AR1 PASS；`npm run verify` + adapter/desktop/package smoke |
| **G8** | P12 parity review + RC audit | feature map 每行有最终状态；只保留预授权 deferral；所有 gate/文档/构建证据一致；无 P0/P1 release blocker | Full verification PASS；干净 worktree；RC readiness report |

## Approved deferrals

以下项目可在 G8 标记 `DEFERRED`，但必须保留原因、风险、恢复条件和建议 owner；列表外的新 deferral 不能让 Goal 达成完成状态。

- 全目录 path migration 与 closed-document incoming reference rewrite；现行 fail-closed directory policy 保持有效。
- 高级 Git blame heuristics：copy/move detection、复杂 whitespace/author-vs-committer 选项；基础准确 provenance 仍必须完成。
- legacy lite mode、GPU blacklist、occlusion controls：仅在真实性能证据证明需要时保留，否则可 `INTENTIONALLY DROPPED`。
- 超出 WPS 与可获得测试环境的 office clipboard 扩展矩阵；核心 TSV/HTML/浏览器剪贴板行为仍必须完成。
- code signing、notarization、store distribution、生产发布、Linux packaging。
- 最终目录 cutover 与删除 legacy tree。

production Embed loader failure/retry 不在 deferral 列表中，必须在 G0 关闭。

## Verification contract

Repository baseline uses Node 22 in CI; `.nvmrc` is authoritative for local setup. Node 23 remains accepted for development while the package engine range is `>=22 <24`, but checkpoint evidence must include Node 22 CI or equivalent Node 22 run before G8 completion.

```bash
cd writeit-v2

# Per-task / fast checkpoint feedback
npm run verify:fast

# Phase gate and checkpoint completion
npm run verify
```

`verify:fast` includes architecture boundary checks, all Vitest tests, typecheck and production build. `verify` additionally includes Playwright browser tests. G7/G8 must also run the desktop/package commands established by P11.

Fixed sleeps/timeouts may not be added to hide lifecycle failures.

## Completion conditions

The Goal is complete only when all of the following are true:

- G0～G8 are PASS with linked evidence and local checkpoint commits.
- Every applicable SPEC Task and Phase Gate in scope is complete; remediation is closed rather than merely listed.
- `LEGACY_FEATURE_MAP.md` has no undecided granular row; any `DEFERRED` row is in the approved list above and documents recovery criteria.
- `npm run verify` passes at HEAD; Node 22 CI passes.
- macOS unsigned development package is generated and launch-smoked; Windows CI generates its package artifact.
- Source-fidelity, diff completeness, failure recovery, permission/privacy and destructive-operation tests have no P0/P1 failures.
- `STATUS.md`, ADR index, decisions and milestone records agree with implementation.
- Worktree is clean and all Goal changes are committed locally on the Goal branch.
- No push, tag, signature, release or production publication has been performed.

## Progress log

| Checkpoint | State | Commit / evidence | Notes |
|---|---|---|---|
| Goal preparation | COMPLETE | `docs(v2): prepare Codex goal workflow` | Baseline `03975a7`; contract check, 396 Vitest, 63 Chromium tests, typecheck and build PASS |
| G0 | PASS | `feat(v2): close G0 P4 UX reconciliation` | [P4 UX reconciliation](./G0_P4_UX_RECONCILIATION.md) PASS；397 Vitest + 72 Chromium；production retry closed |
| G1 | PASS | `e13e526` | [P5 Table Architecture Review](./P5_TABLE_ARCHITECTURE_REVIEW.md); 434 Vitest + 74 Chromium; typecheck/build PASS |
| G2 | PASS | `be9ba45` | [P6 Architecture Review](./P6_ARCHITECTURE_REVIEW.md); 453 Vitest + 76 Chromium; typecheck/build PASS |
| G3 | PASS | `010c2d6` | [P7 Architecture Review](./P7_ARCHITECTURE_REVIEW.md); 461 Vitest + 78 Chromium; typecheck/build PASS |
| G4 | PASS | `d52183f` | [P8 Architecture Review](./P8_ARCHITECTURE_REVIEW.md); search/replace, derived services, validation and template intelligence implemented |
| G5 | PASS | `f251ed0` | [P9 Architecture Review](./P9_ARCHITECTURE_REVIEW.md); snapshot-based built-in/custom/batch export implemented |
| G6 | PASS | `b5ba4a3` | [P10 Architecture Review](./P10_ARCHITECTURE_REVIEW.md); bounded diagnostics, privacy report and permissioned debug API implemented |
| G7 | PASS | `f710870` | [P11 Architecture Review](./P11_ARCHITECTURE_REVIEW.md); desktop adapters, debug policy and package workflow implemented |
| G8 | PASS | `f710870` | [P12 RC Audit](./P12_RC_AUDIT.md); feature-map parity classifications and approved deferrals are explicit |
| RC review | PASS WITH FOLLOW-UP | local checkpoint | [RC review report](./RC_REVIEW_REPORT.md); 477 Vitest + 80 Chromium, Node 22/23 verification, desktop webview smoke and built-in browser journeys PASS |

## Activation

This contract is ACTIVE in the Codex Goal created from the Objective above. Mark it `COMPLETE` only after every completion condition is met.
