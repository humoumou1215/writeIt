# WriteIt v2 Milestones

长期执行历史保存在 Git 与对应 Task/Review 文档中；本文件只记录不会每天变化的阶段里程碑。实时状态见 [STATUS.md](./STATUS.md)。

| Date | Milestone | Result / evidence |
|---|---|---|
| 2026-09-06 | P0 repository reset and initial architecture | v2/legacy boundary、feature map、scaffold 与 ADR-0001～0006 建立 |
| 2026-09-06 | P1 foundation | P1-AR2 PASS；DocumentStore/revision/history/timeline/filesystem port 基线完成 |
| 2026-09-07 | P2 CM6 projection architecture | [P2 Architecture Review](./P2_ARCHITECTURE_REVIEW.md) remediation 后 PASS |
| 2026-09-07 | P2A editing assistance | [P2A Acceptance Review](./P2A_ACCEPTANCE_REVIEW.md) remediation 后 PASS |
| 2026-09-08 | P3 workspace/persistence baseline | Workspace tree、tabs、persistence、recovery、shortcuts、attachments/images、template hook 完成；后续数据安全 remediation 纳入 P4 re-review |
| 2026-09-08 | P4 reference/embed baseline | Reference graph/completion/navigation/rename/clipboard/context actions/Embed 与 F-01～F-03 follow-ups 完成 |
| 2026-09-08 | P4 architecture/product gate | [P4 Architecture Review](./P4_ARCHITECTURE_REVIEW.md) user decision B 后 PASS；baseline commit `03975a7` |
| 2026-09-08 | Codex Goal preparation | Goal/decision contracts、ADR-0007/0008、统一验证与 Goal 分支建立；396 Vitest、63 Chromium、typecheck/build PASS；尚未激活 Goal |
| 2026-09-08 | G0 P4 UX reconciliation | [G0 review](./G0_P4_UX_RECONCILIATION.md) PASS；production Embed retry gap 关闭；397 Vitest、72 Chromium、typecheck/build PASS |
| 2026-09-09 | G1 Table Engine | [P5 Table Architecture Review](./P5_TABLE_ARCHITECTURE_REVIEW.md) PASS；Table Core、CM6 projection、clipboard/IME、commands、resize/reorder 完成；434 Vitest、74 Chromium、typecheck/build PASS |
| 2026-09-09 | G2 Annotation + Mermaid | [P6 Architecture Review](./P6_ARCHITECTURE_REVIEW.md) PASS；annotation sidecar/anchors/drawer、source-backed Mermaid preview、commands/completion/reference fallback 完成；453 Vitest、76 Chromium、typecheck/build PASS |
| 2026-09-09 | G3 Git + Diff + Provenance | [P7 Architecture Review](./P7_ARCHITECTURE_REVIEW.md) PASS；structured Git ports/workbench、raw diff guarantee、semantic fallback、discard guard、blame projection 完成；461 Vitest、78 Chromium、typecheck/build PASS |

| 2026-09-09 | G4 Derived Services + Template Intelligence | [P8 Architecture Review](./P8_ARCHITECTURE_REVIEW.md) PASS；search/replace、outline/backlinks/stats、validation、template catalog/provider 完成；477 Vitest、80 Chromium、typecheck/build PASS |
| 2026-09-09 | G5 Export | [P9 Architecture Review](./P9_ARCHITECTURE_REVIEW.md) PASS；snapshot-based Markdown/PDF/DOCX/custom/batch export 完成 |
| 2026-09-09 | G6 Diagnostics | [P10 Architecture Review](./P10_ARCHITECTURE_REVIEW.md) PASS；bounded diagnostics、privacy report、permissioned debug API 完成 |
| 2026-09-09 | G7 Desktop adapters | [P11 Architecture Review](./P11_ARCHITECTURE_REVIEW.md) PASS；Tauri command adapters、debug policy、package smoke、Windows workflow 完成 |
| 2026-09-09 | G8 RC audit | [P12 RC Audit](./P12_RC_AUDIT.md) PASS；feature-map parity classifications and approved deferrals recorded |

## Historical detail locations

- Task contracts and remediation records: `docs/*TASK_CONTRACT.md`
- Architecture/product gate reports: `docs/*ARCHITECTURE_REVIEW.md`, `docs/*ACCEPTANCE_REVIEW.md`
- Accepted architecture decisions: [ADR index](./adr/README.md)
- Legacy workflow coverage: [LEGACY_FEATURE_MAP.md](../../LEGACY_FEATURE_MAP.md)
- Exact code and documentation history: Git log on the relevant path
