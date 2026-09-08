# WriteIt v2 — P1 + P2 Boundary Check & Architecture Review

- **Initial review date:** 2026-09-07
- **Re-review date (P2-AR2):** 2026-09-07
- **Scope:** P1 foundation/remediations, P2-01 through P2-06, P2-R01 through P2-R06, accepted ADR-0001 through ADR-0006, architecture enforcement, and readiness for the post-P2 sequence
- **Initial P2 → P3 architecture gate:** **CHANGES REQUIRED / HOLD**
- **Current gate (P2-AR2):** **PASS** — architecture HOLD lifted; enter P2A-00 next before P3
- **CM6 architecture decision:** remains **GO**; no finding requires superseding ADR-0004

## Executive conclusion

The initial review established that the P1/P2 happy path worked, but found five protocol/enforcement blockers plus a missing permanent real-browser gate. Those findings held P3 even though no issue reopened the CM6 architecture decision.

P2-R01 through P2-R06 now resolve the blocker scenarios: observer failures cannot interrupt committed fan-out; Store replay authorization is adapter-private and checked; CM6 and Preview mount paths buffer/reconcile initialization changes; source freshness is independent from enhancement degradation; the boundary checker uses TypeScript AST inspection and explicit resolved layer rules; and Playwright Chromium exercises the critical editor/projection/fallback/source-fidelity lifecycle. All unit/integration, browser, typecheck, build, dependency, and whitespace checks pass.

**P2-AR2 therefore lifts the architecture HOLD.** Under the current implementation sequence, the next task is P2A-00 and Phase 2A must complete before P3 starts; this sequencing requirement is not a failed architecture gate. The full-source fan-out/selection and byte-budget concern was tracked as P2-AR-06 and is now addressed by the remediation contract below before further editable-projection work.

## Evidence reviewed

- `docs/IMPLEMENTATION_SPEC.md`, `docs/STATUS.md`, `docs/P1_ARCHITECTURE_REVIEW.md`
- ADR-0001 through ADR-0006
- `src/core/document/`, `src/platform/filesystem/`
- `src/editor/cm6/projection/single-document-view.ts`
- `src/editor/preview/basic-live-preview.ts`
- all current v2 unit/integration tests
- `scripts/check-boundaries.mjs` and `.github/workflows/v2.yml`
- current working-tree diff and import/timer scans

Initial review baseline validation:

```text
npm run check:boundaries  PASS — 16 source files
npm run test              PASS — 11 files, 43 tests
npm run typecheck         PASS
npm run build             PASS — 554.59 kB main chunk warning
npm ls --depth=0          PASS
real Chromium smoke       PASS — edit updated revision, dirty state and preview
git diff --check          PASS
```

The review used temporary, removed-after-run probes for adversarial protocol cases. No probe file remains in the repository.

## Initial boundary check result

| Boundary | Initial source tree | Initial automated enforcement |
|---|---:|---:|
| No v2 runtime import from `editor-app/` | PASS | **FAIL — incomplete parser** |
| Core has no Vue/DOM/CM6/Tauri dependency | PASS | **FAIL — direct-pattern only** |
| Core does not depend on Editor/UI/Platform | PASS by manual inspection | **FAIL — not checked** |
| No timeout/sleep synchronization in current source | PASS | PARTIAL — regex scans text, not protocol semantics |
| Markdown/Revision authority remains in Store on normal path | PASS | PARTIAL — CM6 sync marker bypass is not guarded |
| Projection revision truthfulness | **FAIL on mount/fallback edges** | FAIL — missing regression cases |
| Observer failure isolation | **FAIL on hostile thrown value** | FAIL — missing regression case |

A synthetic source tree containing all of the following still produced `architecture boundary check passed`:

```ts
// Core side-effect framework import
import 'vue'

// Legacy side-effect runtime import
import '../../editor-app/src/runtime'

// Core reverse dependency on Editor
import { adapter } from '../editor/adapter'
```

This means the current tree is clean, but the claimed permanent guard is not yet trustworthy.

## Initial findings

### P12-AR-01 — BLOCKER — observer error formatting can break committed-change isolation

**Evidence:** `src/core/document/store.ts:1004-1024`, especially `String(error)` at line 1013.

`dispatchEvent` catches a Projection listener failure, but stringifies the arbitrary thrown value before continuing fan-out. JavaScript permits throwing any value, including an object whose `toString` also throws. The focused probe observed:

```text
authoritative Markdown: "committed"
applyChange outcome: throws "cannot format thrown value"
healthy projection deliveries: []
broken projection: stale by lag, degraded=false
```

The source commit succeeds before the caller sees an exception, and a healthy Projection receives nothing. This is the exact ambiguity and partial fan-out that P1-R02 was intended to remove.

**Required resolution:**

- introduce a total, non-throwing error formatter or retain the raw `unknown` until a diagnostics boundary;
- isolate stale bookkeeping, error reporting, and each remaining listener independently so none can abort fan-out;
- add regression tests for hostile thrown values, failed error sinks, and healthy listeners after the failed listener.

### P12-AR-02 — BLOCKER — exported `storeSync` permits an untracked CM6 source mutation

**Evidence:** `src/editor/cm6/projection/single-document-view.ts:26`, `:59-61`, `:94`, and `:126-133`; the marker is re-exported through the editor barrel files.

`storeSync` is the capability that tells the update listener “this document change already came from Store.” It is exported, and the mutable raw `EditorView` is public. A caller or future extension can dispatch a document change annotated with that marker. The focused probe produced:

```text
CM6 local Markdown: "local-source"
DocumentStore Markdown: "source"
ProjectionState: revision=0, stale=false, degraded=false
```

A later ordinary user transaction can then submit the already-diverged full CM6 text to Store, disguising the bypass as a normal edit. This violates the rule that every source mutation passes through `DocumentStore` and also defeats P2-05 stale detection.

**Required resolution:**

- make the Store-sync capability private to the adapter and impossible to import through public barrels;
- reduce or explicitly constrain the public mutable `EditorView` surface;
- ensure every ignored CM6 document change is adapter-authenticated and/or followed by an authority invariant check;
- add a regression test proving external extensions cannot create a healthy, divergent local document.

### P12-AR-03 — BLOCKER — Projection attach is not atomic with subscription/catch-up

**Evidence:** `src/editor/cm6/projection/single-document-view.ts:258-318` and `src/editor/preview/basic-live-preview.ts:251-302`.

Both mount paths take a Store snapshot, attach metadata, construct/render the view, subscribe later, and finally acknowledge the old snapshot. A synchronous Store mutation during CM6 extension initialization occurs after the snapshot but before the subscription. The probe using a legitimate `ViewPlugin` initialization hook observed:

```text
CM6 local Markdown: "revision-zero"
DocumentStore Markdown: "revision-one"
displayedRevision: 0
ProjectionState: revision=0, stale=true, degraded=false
```

Stale derivation avoids a false healthy state here, but P2-03 does not deliver the committed Store update, and there is no catch-up until another source revision happens.

**Required resolution:**

- provide an atomic attach/subscribe/replay contract, or buffer events before view construction and reconcile against a fresh Store snapshot before initial acknowledgement;
- apply the same lifecycle rule to CM6 and non-CM6 projections;
- test Store mutations during extension/renderer initialization and teardown.

### P12-AR-04 — BLOCKER — fallback display and Projection revision/degraded state disagree

**Evidence:** `src/editor/preview/basic-live-preview.ts:215-225`; `src/core/document/store.ts:441-470`.

When rich preview rendering fails, the implementation successfully replaces the DOM with source fallback, but it neither advances `displayedRevisionValue` nor acknowledges that revision. The focused probe observed:

```text
rendered fallback text: source from revision 1
authoritative revision: 1
preview displayedRevision: 0
ProjectionState: revision=0, stale=true, degraded=true
```

The Core protocol cannot cleanly report `displayedRevision=current`, `stale=false`, `degraded=true`: acknowledging the current revision automatically clears `degradedReason`, while marking degradation also marks the Projection explicitly stale. This conflates source freshness with enhancement health and makes diagnostics untruthful.

The current UI also exposes neither editor nor preview stale/degraded status; the fallback is styled as a generic code block rather than visibly identified as degraded, contrary to ADR-0003's visible-degradation requirement.

**Required resolution:**

- model displayed source revision independently from render/enhancement health;
- let a Projection acknowledge a current source fallback while retaining a degraded reason;
- make fallback/degraded state visible to the user;
- test initial render failure, update render failure, fallback failure, retry, and recovery without requiring a new document revision.

### P12-AR-05 — BLOCKER — architecture boundary checker has material false negatives

**Evidence:** `scripts/check-boundaries.mjs:18-47`.

The import regex only recognizes `from '…'` and `import('…')`; it misses side-effect imports such as `import 'vue'` and `import '../../../editor-app/…'`. Core checks only match selected package names and globals; they do not resolve relative imports or enforce the intended layer direction, so `src/core` can import `src/editor`, `src/ui`, or `src/platform` without failing. Timer matching scans raw source text, which can both miss alternate calls and reject harmless comments or legitimate non-synchronization timers.

**Required resolution:**

- parse TypeScript/Vue imports with an AST-capable implementation and resolve relative paths;
- define and enforce an explicit layer dependency matrix, including side-effect, re-export, dynamic, and CommonJS forms as applicable;
- add fixture tests containing known-good and known-bad source trees;
- keep the timer rule narrow and explicit rather than claiming semantic synchronization detection from a text regex.

### P12-AR-06 — HIGH — full-source synchronization resets view-local selection and scales with document size

**Evidence:** `single-document-view.ts:137` converts every local edit to a full string; `:161-169` and `:214-222` replace the complete CM6 document for Store/recovery updates. `store.ts:68-72`, `:225`, and `:683-691` retain full before/after source history with a default 1,000-entry count cap.

A two-view probe placed View B's caret at offset 3, then inserted one character at the start through View A. View B received correct source but its selection moved `3 → 0`. The current path also performs full-document string materialization and whole-document replacement per edit/view. An entry-count cap is deterministic, but it is not a byte budget; large Markdown files can retain hundreds of full source versions.

Selection mapping and the exact source-change API were deferred by ADR-0002/0003, so this is not by itself a reason to supersede an ADR. It is, however, a high-risk limit on the claim that interactive multi-view is production-ready.

**Required follow-up before editable embeds/P4, and preferably before workspace multi-view is exposed:** define a CM6-independent source-change representation or another minimal-diff application strategy, preserve/map view-local selection, group typing history, and add a byte-aware history/performance budget.

### P12-AR-07 — HIGH — P2's permanent test gate does not exercise a real browser or CM6 source fidelity

**Evidence:** all editor integration tests use `@vitest-environment jsdom`; `package.json` has no browser-test script/dependency; the source-fidelity corpus test edits `DocumentStore` directly rather than traversing the CM6 adapter.

A manual real-Chromium smoke passed, which is positive evidence, but CI currently cannot detect browser-only transaction, focus, selection, or lifecycle regressions. Existing tests also omit actual renderer failure/fallback, mount-window mutation, sync-marker misuse, and hostile observer failures—the exact cases that exposed this review's blockers.

**Required resolution before P2-AR2:**

- add a small real-browser integration suite for mount → type → Store revision → second Projection/Preview → destroy;
- run the unknown-Markdown corpus through a targeted CM6 edit and prove unrelated source remains byte-for-byte identical;
- add deterministic unit/integration tests for each blocker; do not mask lifecycle failures with fixed waits.

### P12-AR-08 — MEDIUM — architecture-document location is internally inconsistent

`AGENTS.md` and the Phase 0 exit criteria point to `writeit-v2/docs/LEGACY_FEATURE_MAP.md`, while P0-04 and the actual repository use root `LEGACY_FEATURE_MAP.md`. The required read-first path currently returns `ENOENT`.

**Required resolution:** choose one canonical location, update all agent/spec/status references, and use a link only if backward compatibility is necessary. Do not maintain two divergent copies.

## Accepted strengths

- Current production source has no runtime import from `editor-app/`.
- Current Core source has no direct Vue, DOM, CodeMirror, Tauri, or filesystem implementation dependency.
- The normal CM6 user path commits through Store with an explicit origin; Store-sync annotation prevents ordinary feedback loops.
- Store state and public document snapshots are immutable; identity addressing remains runtime-discriminated.
- Per-document FIFO delivery, explicit Projection acknowledgement, revision conflict checks, bounded compact timeline facts, and per-document history all work for covered normal cases.
- Basic Preview builds DOM with text nodes rather than `innerHTML`; unsafe link schemes remain source text, and renderer behavior never mutates authoritative Markdown.
- Memory filesystem preserves supplied strings and remains a replaceable adapter.
- No timeout/sleep synchronization appears in current v2 source.
- ADR-0001 through ADR-0006 remain mutually coherent; none of the required remediations introduces a second Markdown authority.

## Deferred Phase 3 conditions (not new P2 findings)

The following remain valid planned Phase 3 work rather than reasons to reject CM6 or P1/P2:

- serialized/superseded saves and stale-write protection;
- external-file reconciliation and save-conflict policy;
- rename/delete/unload and path canonicalization policy;
- encoding/BOM/line-ending policy at the real filesystem boundary;
- an Application layer that owns workspace/save orchestration instead of placing those policies in `App.vue`, CM6 extensions, or filesystem adapters.

## Initial gate decision and remediation order

**Initial decision (superseded by P2-AR2): HOLD P3.** Recommended one-task sequence:

1. **P2-R01 — Restore total observer failure isolation**
2. **P2-R02 — Seal the CM6 Store-sync authority boundary**
3. **P2-R03 — Atomic Projection attach, replay, and catch-up**
4. **P2-R04 — Separate source freshness from degraded rendering**
5. **P2-R05 — Replace the regex-only architecture gate and add fixtures**
6. **P2-R06 — Add real-browser and CM6 source-fidelity gates**
7. **P2-AR2 — Re-run the P1/P2 → P3 architecture gate**

`P12-AR-06` should be turned into an explicit source-change/selection/performance task before P4 editable embeds; it need not supersede any accepted ADR. The initial review required **P2-R01** to start the remediation sequence.

## P2-AR2 — P1/P2 → Post-P2 Architecture Gate Re-review

- **Re-review date:** 2026-09-07
- **Gate result:** **PASS** — P2 architecture remediation accepted
- **Next permitted task:** **P2A-00**; P3 follows the mandatory Phase 2A sequence

### Remediation evidence accepted

- **P2-R01 / P12-AR-01:** arbitrary thrown values are formatted through a total fallback; stale bookkeeping and diagnostics are independently isolated; hostile observers and failed error sinks no longer interrupt later healthy listeners.
- **P2-R02 / P12-AR-02:** `storeSync` and its per-projection token are private to the adapter, replay transactions require controller authorization plus transaction identity, the public surface exposes only source edit intents, and captured/forged replay annotations cannot produce a healthy divergent Projection.
- **P2-R03 / P12-AR-03:** CM6 and Preview subscribe before construction/rendering, buffer initialization events, replay them in order, and reconcile a fresh Store snapshot before final acknowledgement. Teardown unsubscribes before projection-owned cleanup.
- **P2-R04 / P12-AR-04:** Projection source revision and enhancement health are separate. Initial/update render failures visibly show exact source fallback at the current revision with `stale=false, degraded=true`; fallback failure remains stale; retry can recover without a new Document revision.
- **P2-R05 / P12-AR-05:** the permanent checker parses TypeScript/JavaScript and Vue script blocks with TypeScript ASTs, covers static side-effect/re-export/dynamic/CommonJS forms, resolves relative layer dependencies against an explicit matrix, and is exercised against known-good and known-bad fixture projects.
- **P2-R06 / P12-AR-07:** Playwright Chromium covers real CM6 typing, Store revision/fan-out to a second editor and Preview, deterministic destruction, a targeted edit over the unknown-Markdown corpus, and degraded Preview recovery without a source revision.

### Verification run

```text
npm run test          PASS — 12 files, 60 tests; boundary check passed for 16 source files
npm run test:browser  PASS — 3 Chromium tests
npm run typecheck     PASS
npm run build         PASS — production bundle built; non-blocking 500 kB chunk warning
npm ls --depth=0      PASS
npm run check:boundaries PASS — included directly and via npm run test
git diff --check      PASS
```

The first browser-test attempt could not launch because the matching local Playwright browser binary was absent. After `npx playwright install chromium`, the unchanged three-test suite passed; this was an environment prerequisite rather than a product failure.

### Decision and remaining conditions

P12-AR-01 through P12-AR-05 are resolved by implementation plus permanent regression coverage, and the P12-AR-07 real-browser/source-fidelity gate is active. Current source passes the accepted dependency direction, has no v2 runtime import from `editor-app/`, keeps Core independent from Vue/DOM/CM6/Tauri, and contains no timeout/sleep synchronization protocol. ADR-0001 through ADR-0006 remain coherent and ADR-0004 remains GO.

The architecture HOLD is lifted. The current SPEC inserts Phase 2A before P3, so this review authorizes **P2A-00** as the next task rather than starting P3 directly.

Remaining non-blocking conditions:

- **P2-AR-06 remediation complete:** Store change events now carry CM6-independent source deltas; CM6 fan-out applies minimal projected changes and lets CM6 map selection; typing grouping is explicit; and history retains source deltas under both `maxEntries` and UTF-8 `maxBytes` budgets. Boundary, large-document, unit, integration, and Chromium coverage passed.
- **P12-AR-08 remains MEDIUM:** `LEGACY_FEATURE_MAP.md` references are inconsistent. P2A-00 owns canonical path synchronization; two divergent copies must not be created.
- The AST gate intentionally checks statically discoverable module references and the current explicit source layout. If path aliases or a new top-level layer are introduced, the resolver/matrix fixtures must evolve with them.
- P2-06 remains deliberately basic, and the production bundle currently emits a non-blocking chunk-size warning; neither changes source authority or blocks P2A-00.

## P2-AR-06 Remediation Task Contract

### Goal

Replace full-source Store fan-out and full-source retained history with a source-level, CM6-independent change representation. Applying a committed change to another editable Projection must use a minimal change and preserve/map its local selection where the source mapping is unambiguous. Typing history must have explicit grouping semantics, and per-document history must be bounded by both entry count and retained source-change bytes.

### Allowed scope

- `writeit-v2/src/core/document/` source-change representation, `DocumentStore` change events, history grouping, and history retention.
- `writeit-v2/src/editor/cm6/projection/` and its source-fidelity adapter, only as needed to submit source changes and apply minimal Store fan-out while retaining CM6-local selection.
- Related v2 unit, integration, browser, and boundary/performance-budget tests.
- This contract and the corresponding concise `STATUS.md` update.

Do not modify accepted ADR decisions or add runtime dependencies on CM6 to Core. Do not alter unrelated workspace, reference, attachment, entity, audit-evidence, or Phase 3–5 contracts.

### Read first

- `AGENTS.md`
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`
- `writeit-v2/docs/STATUS.md`
- `writeit-v2/docs/P2_ARCHITECTURE_REVIEW.md`
- ADR-0001 through ADR-0006, especially ADR-0002 and ADR-0003
- Current `src/core/document/store.ts`, `src/editor/cm6/projection/source-fidelity.ts`, `src/editor/cm6/projection/single-document-view.ts`, and their existing tests

### Implementation requirements

1. Keep `DocumentStore` as the sole Markdown/revision authority. Add a frozen, source-offset-based change representation and apply/invert/sequence helpers in Core without CM6, Vue, DOM, Tauri, or `editor-app` imports.
2. Include the committed source change in the Store change event and use it for source-backed history. Retained history must store changed source segments/sequences, not full before/after document snapshots; undo/redo must remain per-document and revisioned.
3. Keep `maxEntries` compatibility and add a validated byte budget (UTF-8 source-change payload bytes). Evict oldest entries deterministically; entries larger than the budget are not retained. Expose enough accounting for tests/diagnostics without retaining Markdown in Core history.
4. Define an explicit typing grouping contract (stable group id plus typing kind/continuation). Consecutive adapter-classified typing transactions in one uninterrupted caret run may merge into one undo entry; selection-only, paste/delete, command, Store replay, and other non-typing boundaries must not merge implicitly or by elapsed time.
5. For Store fan-out, apply only the projected changed ranges (no unconditional whole-document replacement). Let CM6 map the other Projection's local selection through those ranges; line-ending-only source changes must update the source map without changing the CM6 selection. If a mapping/invariant cannot be trusted, use the existing stale/recovery path rather than silently claiming a preserved projection.
6. Preserve all existing authority, revision, lifecycle, source-fidelity, and no-timeout invariants. Do not change an accepted ADR; if one becomes impossible to satisfy, stop and report the decision point.

### Tests

- Core unit tests for source-change validation, minimal targeted/multi-range application, inversion/sequence grouping, Unicode/UTF-16 offsets, byte accounting, max-entry compatibility, zero/oversize budgets, and deterministic eviction.
- CM6 integration tests proving Store fan-out uses minimal changes, maps a secondary caret/selection, preserves untouched mixed line endings, groups explicit typing, and keeps undo/redo correct.
- Real Chromium coverage for two editable projections (including an embed-capable projection path where already present) with a selection-preserving fan-out and a large-document budget/fidelity smoke.
- Run `npm run test`, the relevant integration/browser tests, `npm run typecheck`, `npm run build`, `npm run check:boundaries`, and `git diff --check`.

### Acceptance criteria

- A one-character edit in Projection A updates Projection B to the authoritative source while B's selection is mapped past/around the edit instead of reset to offset 0.
- No normal fan-out path dispatches a full `[0, oldLength]` replacement when a smaller projected change is available; source-only line-ending changes dispatch no document change.
- A grouped typing run is one undo step, while a caret move or non-typing edit starts a separate step without timeout-based synchronization.
- Undo/redo and every source event retain one authoritative Markdown source and correct monotonic revisions.
- `getHistory()` never requires retained full-document snapshots; total retained change bytes and entry count stay within configured budgets, including large-document and oversize-entry boundaries.
- Existing v2 unit/integration/browser, typecheck, build, dependency-boundary, and whitespace checks pass; no runtime import from `editor-app` is introduced.

### Out of scope

Directory rename policy, ReferenceGraph rollback, image paths, entity mode, P2A evidence/remediations, P3/P4 contract changes, table/P5 implementation, richer rendering, and any other architecture-review finding not required by the criteria above.
