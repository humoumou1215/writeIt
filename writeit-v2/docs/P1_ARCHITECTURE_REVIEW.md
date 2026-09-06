# WriteIt v2 — P1 Foundation Architecture Review

- **Initial review date:** 2026-09-06
- **Re-review date (P1-AR2):** 2026-09-07
- **Scope:** P1-01 through P1-05, P1-R01 through P1-R04, accepted ADR-0001 through ADR-0006, and readiness for Phase 2
- **Initial P1 → P2 gate:** **CHANGES REQUIRED / HOLD**
- **Current P1 → P2 gate (P1-AR2):** **PASS for P2-01 entry**
- **CM6 architecture decision:** remains **GO**; this review does not reopen ADR-0004

## Executive conclusion

P1 has implemented its functional checklist: document types, one in-memory Markdown authority, revision/dirty state, per-document history, timeline events, and a filesystem port with a memory adapter. Core also remains free of Vue, DOM, CM6, Tauri, and legacy runtime imports.

The initial review found that the foundation was not ready to be used as the synchronization boundary for P2. P1-R01 has since resolved runtime-ambiguous document lookup. Failure-leaking observers, re-entrant out-of-order delivery, and inferred projection acknowledgements can still make a committed change look failed or leave healthy projections behind while diagnostics claim otherwise. These are foundation protocol issues, not CM6 issues, and should be corrected before P2 starts.

## Evidence reviewed

- `docs/IMPLEMENTATION_SPEC.md`, `docs/STATUS.md`, ADR-0001 through ADR-0006
- `src/core/document/{types,store,timeline}.ts`
- `src/platform/filesystem/{port,memory}.ts`
- all P1 unit and integration tests
- CM6 Spike report and its store/projection protocol as reference evidence
- dependency/import and timer scans
- focused runtime probes for locator collision, observer failure, projection fan-out failure, and re-entrant mutation

Validation baseline:

```text
npm run test       PASS — 6 files, 25 tests
npm run typecheck  PASS
npm run build      PASS
```

Static boundary checks found no `editor-app` runtime import, no forbidden Vue/DOM/CM6/Tauri import in `src/core`, and no timeout/sleep synchronization.

## Findings

### P1-AR-01 — RESOLVED by P1-R01 — `DocumentKey` was ambiguous after TypeScript erasure

The original implementation accepted `DocumentId | DocumentPath`; both brands erase to strings. An id-first lookup could therefore resolve a valid path to another document whose id used the same string.

P1-R01 replaced that union with immutable, runtime-discriminated `DocumentLocator` values constructed by `documentById` and `documentByPath`. Every public lookup, mutation, history, persistence, timeline, subscription, and projection-lifecycle operation now requires a locator, and raw strings are rejected at runtime. A collision regression loads one document with `id="shared"` and another with `path="shared"`, then exercises all store operation families through the path locator while proving the id-addressed document remains unchanged.

### P1-AR-02 — BLOCKER — timeline observers can interrupt already-committed state transitions

**Evidence:** `src/core/document/timeline.ts:100-109`; store mutations call `timeline.record` after mutating registries/state, for example `src/core/document/store.ts:250` and `src/core/document/store.ts:525-536`.

`EventTimeline.record` invokes listeners without failure isolation. A throwing diagnostics listener makes `load` or `applyChange` throw after state has already changed. The focused probe observed `load` throw while the document remained loaded.

**Impact:** callers cannot tell whether a command committed, retry is unsafe, and an observability consumer can control domain behavior. This contradicts the intended role of the timeline as passive facts.

**Required resolution:** make timeline delivery failure-isolated. Recording the fact and completing the authoritative operation must not depend on observer code. Route observer failures to an explicit diagnostics/error sink and test multiple listeners, including a failing first listener.

### P1-AR-03 — BLOCKER — one failed projection aborts healthy projection fan-out

**Evidence:** `src/core/document/store.ts:785-798`; the current behavior is codified by `tests/unit/core/document/timeline.test.ts:74-85`.

The store commits the source and revision, invokes subscribers in sequence, marks the first throwing subscriber stale, then rethrows immediately. Remaining subscribers receive nothing. The focused probe produced:

```text
authoritative Markdown: "1"
applyChange result: throws
healthy projection events: []
```

**Impact:** a rich preview failure can prevent unrelated editors/embeds from receiving a committed revision, while the mutation caller sees a misleading failure. This violates failure-degradation and multi-projection synchronization requirements.

**Required resolution:** continue deterministic fan-out after an individual projection failure, mark only the failed projection stale/degraded, and do not turn a committed source mutation into a thrown observer error. Replace the existing test expectation with failure-isolation and healthy-fan-out assertions.

### P1-AR-04 — BLOCKER — synchronous re-entrant mutations regress delivery order

**Evidence:** subscriber callbacks run inline and projection revision is updated only after each callback returns (`src/core/document/store.ts:785-806`).

If subscriber A handles revision 1 and synchronously submits revision 2, subscriber B receives revision 2 and then revision 1. The focused probe reproduced:

```text
store Markdown: "2"
B delivery order: 2, 1
ProjectionUpdated facts: first:2, second:2, first:1, second:1
```

**Impact:** a projection can end at old content while being recorded as non-stale, and a later edit can overwrite newer source unless every caller perfectly supplies a revision guard.

**Required resolution:** define and enforce one dispatch rule before P2: queue nested notifications until the current revision finishes fan-out, or reject re-entrant source mutations before they commit. Assert strictly increasing revision delivery per subscriber.

### P1-AR-05 — BLOCKER — projection timeline facts are inferred rather than acknowledged

**Evidence:** generic `subscribe` automatically attaches a projection (`src/core/document/store.ts:606-644`), and a callback returning without error is recorded as `ProjectionUpdated` (`src/core/document/store.ts:719-734`, `src/core/document/store.ts:802-806`). `attachProjection` and `updateProjection` also allow an older displayed revision to be marked non-stale (`src/core/document/store.ts:293-340`).

A callback may be an application observer, may schedule asynchronous rendering, or may simply ignore an event; none of those cases proves that a view displays the revision. Projection revisions can also move backwards while stale is cleared.

**Impact:** the event timeline cannot reliably answer which projection displays which revision, undermining P2-05 and future diagnostics.

**Required resolution:** separate generic document subscriptions from projection lifecycle, and require an explicit projection apply acknowledgement (or an equivalent protocol with truthful completion semantics). Prevent accidental revision regression; derive revision lag as stale while retaining a separate degraded/apply-failed reason where needed.

### P1-AR-06 — HIGH — high-frequency editing retains unbounded full-source states

**Evidence:** every timeline `DocumentChanged` retains both previous and current `DocumentState` (`src/core/document/timeline.ts:14-20`), `EventTimeline` has an unbounded array (`src/core/document/timeline.ts:94-106`), and every history entry retains full before/after strings (`src/core/document/store.ts:50-53`, `src/core/document/store.ts:525-532`).

**Impact:** P2 will turn editor transactions into frequent store changes. Large documents and long sessions can retain every full source revision in both diagnostics and history. The current design has no retention budget, grouping, or compact change representation.

**Required resolution before high-frequency P2 integration:** keep timeline facts compact (revision/path/origin/status rather than full Markdown), define diagnostic retention or a pluggable sink, and set an explicit history strategy/budget. A pure source-change representation may be introduced without coupling Core to CM6.

### P1-AR-07 — HIGH — permanent source-fidelity and boundary gates are not automated in v2

The current tests preserve several exact strings, but v2 has no permanent golden corpus for `open → no edit → save`, no targeted-edit/no-unrelated-rewrite corpus, and no automated dependency-boundary check. Existing repository CI only targets `editor-app`.

**Impact:** P2 is the first phase that can accidentally normalize source or introduce forbidden dependencies, but the required architecture gates would rely on manual review.

**Required resolution:** establish the v2 golden corpus and automated boundary checks before accepting the first source-changing CM6 task; add v2 test/typecheck/build to CI before substantial P2 work lands.

## Accepted strengths

- `DocumentStore` is the only current live Markdown/revision authority.
- State and snapshots are immutable at the public boundary.
- Revision conflicts can be detected, and persistence acknowledges a specific written revision.
- History is per document; tests cover edits from A Tab, B→A, and C→A against one history.
- `FileSystemPort` points inward to domain types while Core has no platform dependency.
- `MemoryFileSystem` preserves supplied strings and is isolated/deterministic.
- No legacy runtime dependency, forbidden Core framework dependency, or timeout-based synchronization was found.

## Deferred risks (not reasons to reopen the CM6 decision)

- Phase 3 must serialize or supersede concurrent saves. `markPersisted` rejecting an old acknowledgement cannot prevent an already-completed stale write from overwriting newer disk content.
- `DocumentPath` canonicalization, case sensitivity, aliases, rename, delete, external changes, and save-conflict policy remain intentionally deferred.
- Encoding/BOM and byte-level filesystem policy still need an explicit source-fidelity decision.
- `writeit-v2/README.md` and the scaffold UI still report P0; this is documentation/UI drift, not a domain blocker.

## Initial gate decision and remediation order

**Initial decision (superseded by P1-AR2): do not start P2-01 yet.** The Phase 1 functional scope was present, but the initial P1 → P2 architecture gate remained on hold until the blocker scenarios had regression tests and passed.

Recommended one-task sequence:

1. **P1-R01 — Identity-safe Document Addressing** — completed 2026-09-06
2. **P1-R02 — Failure-isolated, ordered DocumentStore dispatch**
3. **P1-R03 — Explicit projection acknowledgement and stale protocol**
4. **P1-R04 — Timeline/history memory and source-fidelity guardrails**
5. **P1-AR2 — Re-run the P1 architecture gate**

These remediations refine decisions explicitly deferred by ADR-0002/ADR-0003; they do not require a superseding ADR unless implementation proposes a second Markdown authority or changes the accepted projection model.

## P1-AR2 — P1 → P2 Architecture Gate Re-review

- **Re-review date:** 2026-09-07
- **Gate result:** **PASS for P2-01 entry**

### Remediation evidence accepted

- **P1-R01:** runtime-discriminated id/path locators prevent cross-namespace collisions across lookup, mutation, history, persistence, timeline, subscription, and projection operations.
- **P1-R02:** timeline and document observer failures are routed to an isolated error sink; document fan-out continues after a failing projection, and re-entrant source notifications are queued FIFO per document.
- **P1-R03:** generic subscriptions no longer create projection lifecycle state; projection progress requires explicit acknowledgement, rejects revision regression, derives lag as stale, and records apply failure separately as degraded.
- **P1-R04:** timeline facts omit Markdown and use bounded retention; per-document history has an explicit entry budget; the source-fidelity corpus covers no-edit saves and targeted edits without unrelated rewriting.

### Verification run

```text
npm run test       PASS — 8 files, 34 tests
npm run typecheck  PASS
npm run build      PASS
```

Additional gate checks passed: no `editor-app` runtime import in `writeit-v2/src`, no Vue/DOM/CM6/Tauri dependency in `src/core`, no timeout/sleep synchronization, and `git diff --check` reported no whitespace errors.

### Decision and remaining conditions

The initial blocker findings P1-AR-02 through P1-AR-05 are covered by regression tests and passed verification. The P1 foundation is accepted as the synchronization boundary for **P2-01**; ADR-0004 remains GO and no superseding ADR is required.

P1-AR-07 remains an explicit follow-up condition before the first source-changing CM6 task: the corpus exists, but automated architecture-boundary checks and the v2 CI path are not established yet. P2-02 must add or be gated by those checks; this residual risk does not block the narrow P2-01 entry.
