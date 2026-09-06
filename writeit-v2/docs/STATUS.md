# WriteIt v2 Status

Current phase: P1 (foundation remediation required before P2)
Current task: None (P1-R01 complete; next remediation not started)

## Completed
- [x] Initial v2 implementation spec prepared
- [x] Root and legacy agent instructions separated
- [x] P0-01 Repository Inventory
- [x] P0-02 Agent Context Split
- [x] P0-03 Pi Workflow
- [x] P0-04 Legacy Feature Map
- [x] P0-05 Safe Cleanup
- [x] P0-06 Initial ADRs
- [x] P0-07 Scaffold writeit-v2
- [x] P1-01 Document Types
- [x] P1-02 DocumentStore
- [x] P1-03 Document History
- [x] P1-04 Event Timeline
- [x] P1-05 FileSystem Port
- [x] P1 Architecture Review — gate result: CHANGES REQUIRED / HOLD ([report](./P1_ARCHITECTURE_REVIEW.md))
- [x] P1-R01 Identity-safe Document Addressing

## Active
None (next remediation task not started)

## Blocked
- P2-01 remains blocked until the remaining P1 review blockers have regression tests and pass: failure-isolated ordered dispatch and truthful projection acknowledgement/stale semantics.

## Recent decisions
- CM6 Architecture Spike = GO; broader office-app clipboard compatibility and large-table performance sampling are post-GO validation, not architecture blockers.
- `writeit-v2/` is the v2 development mainline.
- `editor-app/` remains in place as legacy reference.
- Root Agent instructions are v2-focused; legacy Crepe, ego-lite, debug hooks and editor rules live under `editor-app/AGENTS.md`.
- `.pi/prompts/v2-task.md` and `.pi/prompts/v2-status.md` define one-task execution and status-maintenance workflows.
- `LEGACY_FEATURE_MAP.md` records legacy locations, v2 owners and one of the five permitted migration strategies for each mapped capability.
- ADR-0001 through ADR-0006 establish the accepted Phase 0 architecture decisions, with evidence links, deferred decisions and an ADR index.
- P1-01 uses validated branded primitives for DocumentId, DocumentPath and Revision; dirty state is derived from revision versus persistedRevision, and snapshots are frozen.
- P1-02 keeps one in-memory authoritative state per document id/path; source changes and persistence acknowledgements require explicit origins and are delivered synchronously to subscribers.
- P1-03 keeps undo/redo as per-document source history owned by DocumentStore; undo and redo create normal revisions/events without creating a second live Markdown authority.
- P1-04 adds a synchronous append-only fact timeline with deterministic sequence numbers; projection lifecycle facts remain metadata and never become Markdown authority.
- P1-05 defines a minimal async FileSystemPort for Markdown read/write; MemoryFileSystem is the test adapter, and persistence acknowledgement remains explicit through DocumentStore.markPersisted.
- The P1 Architecture Review keeps ADR-0004/CM6 at GO but places the implementation gate before P2 on HOLD; remediation details and evidence are recorded in `P1_ARCHITECTURE_REVIEW.md`.
- P1-R01 replaces the erased `DocumentId | DocumentPath` union key with immutable runtime-discriminated `DocumentLocator` values; all store operations now require explicit id/path addressing and cross-namespace collisions are covered by regression tests.

## Known risks
- Observer failures and re-entrant synchronous mutations can produce an exception after commit, partial projection fan-out, or decreasing revision delivery.
- Projection update facts are currently inferred from callback return rather than explicit apply acknowledgement, so stale diagnostics are not yet trustworthy enough for P2.
- Timeline and history retain unbounded full-source states; retention/change representation needs guardrails before high-frequency editor integration.
- The permanent v2 source-fidelity corpus, automated architecture-boundary check, and v2 CI path are not established yet.
- Office-app clipboard coverage currently includes WPS but not the broader target matrix; additional compatibility and large-table performance sampling remain post-GO work.
- DocumentStore and the minimal FileSystemPort are implemented; real platform adapters, external-file reconciliation and save-conflict policy remain for later phases.
- `.pi/` and `.workbuddy/` debug resources still target the legacy application; they are intentionally retained and are not v2 diagnostics.
- User-created `fromChatgptWeb.md` is intentionally retained temporarily as reference material and is not a runtime dependency.
- Legacy `npm run test:unit` still has three failures in `tests/unit/diff/zz-seq-research.test.ts` (Mermaid sequence parsing and jsdom `getBBox`); P0-05 did not change that suite.

## Next
P1-R02 — Failure-isolated, ordered DocumentStore dispatch
