# P7 Git + Diff + Provenance Architecture & Product Gate

**Result: PASS**

- **Date:** 2026-09-09
- **Checkpoint:** G3
- **Tasks:** P7-00, P7-01, P7-02, P7-03, P7-04, P7-05, P7-06, P7-AR1
- **Contract:** [P7-00 Git / Diff / Blame UX Contract](./P7_00_GIT_DIFF_UX_CONTRACT.md)
- **ADR:** [ADR-0006](./adr/ADR-0006-diff-guarantee-on-markdown-source.md)

## Evidence

| Area | Evidence | Result |
|---|---|---|
| Git port / mock | `tests/unit/platform/git/memory.test.ts` (2), `tests/unit/application/git/service.test.ts` (1): structured repo/status/history, non-Git and command failure, cache invalidation and discard calls | PASS |
| Workbench navigation | `src/ui/review/GitWorkbenchPanel.vue`, `tests/browser/git-workbench.spec.ts` (1): branch selector, changed-file target, history, unified/split toggle, discard action and visible failure | PASS |
| Raw diff guarantee | `tests/unit/core/diff/raw.test.ts` (2): line/hunk diff, context, empty/equal source and complete raw-change representation | PASS |
| Semantic enhancement | `tests/unit/core/diff/semantic.test.ts` (2): Mermaid flowchart added/removed nodes/edges and raw fallback on parser failure | PASS |
| Blame provenance | `tests/integration/editor/cm6/blame-projection.test.ts` (1), `tests/browser/blame.spec.ts` (1): committed/local markers, activation, zero DocumentStore revision | PASS |
| Full regression | `npm run verify`: 81 Vitest files / 461 tests, 78 Chromium tests, typecheck and build green | PASS |

## Gate audit

- Git UI depends on structured `GitRepositoryPort`/`GitBlamePort` values; no core or UI path parses human-readable CLI output. Non-Git and command-failure states remain explicit.
- Raw Markdown diff is the guarantee layer. Every added/removed line is represented by a raw hunk; semantic Mermaid enhancement reports stable node/edge identity only for supported flowcharts and degrades to raw on failure.
- Workbench layout, target selection, history and blame are projections. Toggling them does not mutate `DocumentStore` Markdown or revision.
- Discard entry points are explicit and confirmation-gated in the application; adapter failures surface without a false success state. The platform contract leaves filesystem synchronization to the P11 adapter boundary.
- Blame markers attach to source lines. `uncommitted` and `unknown` are never inferred from neighboring commits; commit metadata remains machine-readable for drill-down.
- Existing editor, Table, Mermaid, Embed and annotation projections remain source-backed and share the same authority invariants.

## Remaining risks

- The current browser adapter is an in-memory/non-Git implementation; native Git process and filesystem synchronization are intentionally a P11 platform task.
- Advanced Git movement/copy detection and large-repository performance are approved quality follow-ups; baseline provenance and raw diff guarantees are complete.

## Next

P8-00 — Search / Panel / Template UX Contract
