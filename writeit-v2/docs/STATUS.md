# WriteIt v2 Status

- **Current phase:** Codex Goal preparation complete; P5 not started
- **Current task:** None — Goal contract is READY, not ACTIVE
- **Branch:** `codex/goal-writeit-v2`
- **Verified baseline:** `03975a7` (`fix(v2): complete F-03 follow-up integration`)
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

## Goal progress

| Checkpoint | State | Scope |
|---|---|---|
| G0 | PENDING | P4-UX01/P4-UX02 and production Embed retry reconciliation |
| G1 | PENDING | P5 Table |
| G2 | PENDING | P6 Annotation + Mermaid |
| G3 | PENDING | P7 Git + Diff + Provenance |
| G4 | PENDING | P8 Derived Services + Template Intelligence |
| G5 | PENDING | P9 Export |
| G6 | PENDING | P10 Diagnostics |
| G7 | PENDING | P11 Tauri/Desktop |
| G8 | PENDING | P12 parity + RC audit |

## Gate state

- P4-AR2: **PASS**. The earlier architecture blocker is cleared.
- P4-UX01/P4-UX02: present in SPEC but not previously closed as independent tasks; G0 must reconcile every acceptance item.
- production Embed loader failure/retry: former non-blocking deferred test gap; D-013 promotes it to a required G0 outcome.
- P5～P12: not started.

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
- production Embed failure/retry must be closed in G0 before Table work.
- Production build passes but the main JS chunk is about `899.86 kB` (`283.16 kB` gzip), above Vite's warning threshold; address from measured startup/runtime evidence rather than hiding the warning.

## Next

Open a fresh Codex task, activate the single Goal defined by [GOAL.md](./GOAL.md), change its status to `ACTIVE`, and start G0. Do not start P5 until G0 is PASS.
