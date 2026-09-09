# WriteIt v2 Status

- **Current phase:** G8 — Phase 12 Parity + RC Audit
- **Current task:** Full RC review and built-in browser validation complete
- **Branch:** `codex/goal-writeit-v2`
- **Verified baseline:** Full RC review (`RC_REVIEW_REPORT.md`); Node 22/23 verification and 80 Chromium tests PASS
- **Goal contract:** [GOAL.md](./GOAL.md)
- **Decision ledger:** [DECISIONS.md](./DECISIONS.md)
- **Milestone history:** [MILESTONES.md](./MILESTONES.md)

## Completed baseline

- [x] P0 repository reset, v2/legacy boundary, feature map, initial ADRs and scaffold
- [x] P1 DocumentStore/revision/history/timeline/filesystem foundation — gate PASS
- [x] P2 CM6 projection/source-fidelity architecture — gate PASS after remediation
- [x] P2A command/completion/IME/source-mode/keybinding foundation — acceptance PASS after remediation
- [x] P3 workspace, tabs, persistence, recovery/settings, attachment/image and template hook
- [x] P4 references, graph, completion, navigation, rename, clipboard, context actions and Embed
- [x] F-01/F-02/F-03 integration and follow-up fixes
- [x] P4-AR2 — PASS after user decision B ([review](./P4_ARCHITECTURE_REVIEW.md))
- [x] Goal preparation — contracts, decisions, ADR-0007/0008, task-ID normalization and unified verification commands; 396 Vitest + 63 Chromium + typecheck/build PASS
- [x] P6 Annotation + Mermaid — gate PASS ([review](./P6_ARCHITECTURE_REVIEW.md)); sidecar anchors/threads/drawer and source-backed Mermaid preview/commands/reference fallback complete
- [x] P7 Git + Diff + Provenance — gate PASS ([review](./P7_ARCHITECTURE_REVIEW.md)); structured Git ports/workbench, raw diff guarantee, semantic fallback, discard guard and blame projection complete
- [x] Full RC review — PASS WITH FOLLOW-UP ([report](./RC_REVIEW_REPORT.md)); static boundary review, full verification and built-in browser journeys complete

## Goal progress

| Checkpoint | State | Scope |
|---|---|---|
| G0 | PASS | P4-UX01/P4-UX02 and production Embed retry reconciliation |
| G1 | PASS | P5 Table |
| G2 | PASS | P6 Annotation + Mermaid |
| G3 | PASS | P7 Git + Diff + Provenance |
| G4 | PASS | P8 Derived Services + Template Intelligence |
| G5 | PASS | P9 Export |
| G6 | PASS | P10 Diagnostics |
| G7 | PASS | P11 Tauri/Desktop |
| G8 | PASS | P12 parity + RC audit |

## Gate state

- P4-AR2: **PASS**. The earlier architecture blocker is cleared.
- P4-UX01/P4-UX02: **PASS** in [G0 reconciliation](./G0_P4_UX_RECONCILIATION.md).
- production Embed loader failure/retry: closed in G0 with real App browser evidence.
- P5: **PASS** in [P5 Table Architecture Review](./P5_TABLE_ARCHITECTURE_REVIEW.md); core, projection, clipboard/IME, commands, resize and reorder are complete.
- P6: **PASS** in [P6 Annotation + Mermaid Architecture Review](./P6_ARCHITECTURE_REVIEW.md); annotation sidecar/anchors/drawer and source-backed Mermaid preview/commands/reference fallback are complete.
- P7: **PASS** in [P7 Git + Diff + Provenance Architecture Review](./P7_ARCHITECTURE_REVIEW.md); structured ports/workbench, raw diff guarantee, semantic fallback and blame projection are complete.
- P10: **PASS** in [P10 Architecture Review](./P10_ARCHITECTURE_REVIEW.md); bounded diagnostics, explicit privacy report and permissioned debug API are complete.

- P8: **PASS** in [P8 Architecture Review](./P8_ARCHITECTURE_REVIEW.md); search/replace, derived outline/backlinks/stats, validation gate and template catalog/provider contracts are complete.
- P9: **PASS** in [P9 Architecture Review](./P9_ARCHITECTURE_REVIEW.md); snapshot-based Markdown/PDF/DOCX/custom export and itemized batch failures are complete.
- P11: **PASS** in [P11 Architecture Review](./P11_ARCHITECTURE_REVIEW.md); desktop adapters, debug policy, package smoke and Windows CI artifact workflow are complete.
- P12: **PASS** in [P12 RC Audit](./P12_RC_AUDIT.md); feature-map parity classifications and approved deferrals are explicit.
- Full RC review: **PASS WITH FOLLOW-UP** in [RC review report](./RC_REVIEW_REPORT.md); no new P0/P1 blocker or `MUST ASK` decision was found.

## Active decisions

- Product defaults and allowed adaptation are frozen in [DECISIONS.md](./DECISIONS.md).
- Annotation persistence follows [ADR-0007](./adr/ADR-0007-annotation-workspace-sidecar-persistence.md).
- Executable template providers follow [ADR-0008](./adr/ADR-0008-template-provider-runtime-boundary.md).
- Existing directory operations remain fail-closed for Store-loaded/recovery-bound descendants; full directory migration stays an approved parity deferral.
- Goal checkpoints may auto-commit locally after green validation; push/tag/sign/release remain prohibited.

## Known risks / prerequisites

- Local machine currently lacks Rust/Cargo/rustup and full Xcode, so P11 implementation/package smoke needs an explicit toolchain preflight. Installing full Xcode, accepting licenses or obtaining signing credentials requires user action; unsigned development packaging does not require release signing.
- Windows package evidence must come from CI or a Windows host; this macOS checkout cannot provide a native Windows launch smoke.
- Node 22 is the CI/release baseline; current local Node 23 is inside the supported `>=22 <24` development range.
- Browser/mock filesystem coverage is strong, but native CAS/binary/exclusive-create semantics still need P11 adapter evidence.
- Office clipboard evidence does not cover every target application; the bounded deferral policy is in `GOAL.md`.
- P5 follow-up is bounded to approved `PD-004` Office matrix expansion and larger-table performance samples; neither blocks P6.
- Production build passes but the main JS chunk is about `990.43 kB` (`310.70 kB` gzip), above Vite's warning threshold; address from measured startup/runtime evidence rather than hiding the warning.

## Next

No further Goal checkpoint is pending. If continuing post-RC hardening, measure startup/runtime performance before deciding whether to split the main chunk; native Tauri launch and Windows artifact execution still require the corresponding target toolchains/hosts.
