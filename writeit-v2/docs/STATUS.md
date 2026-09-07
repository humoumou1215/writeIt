# WriteIt v2 Status

Current phase: Phase 2A user acceptance remediation
Current task: P2A-R01 — Ready for implementation

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
- [x] Initial P1 Architecture Review — gate result: CHANGES REQUIRED / HOLD ([report](./P1_ARCHITECTURE_REVIEW.md))
- [x] P1-R01 Identity-safe Document Addressing
- [x] P1-R02 Failure-isolated, ordered DocumentStore dispatch
- [x] P1-R03 Explicit projection acknowledgement and stale protocol
- [x] P1-R04 Timeline/history memory and source-fidelity guardrails
- [x] P1-AR2 Re-run P1 architecture gate — PASS for P2-01 entry
- [x] P2-01 Single Document / Single View
- [x] Automated v2 architecture boundary checks and v2 CI
- [x] P2-02 User transaction → DocumentStore
- [x] P2-03 DocumentStore update → Projection
- [x] P2-04 Multi-view same Document
- [x] P2-05 Projection revision / stale detection
- [x] P2-06 Basic Live Preview
- [x] P2-AR1 P1/P2 Boundary Check & Architecture Review — gate result: CHANGES REQUIRED / HOLD ([report](./P2_ARCHITECTURE_REVIEW.md))
- [x] P2-R01 Total observer failure isolation
- [x] P2-R02 CM6 Store-sync authority boundary
- [x] P2-R03 Atomic Projection attach, replay, and catch-up
- [x] P2-R04 Separate source freshness from degraded rendering
- [x] P2-R05 AST-backed architecture gate and fixture coverage
- [x] P2-R06 Real-browser and CM6 source-fidelity gates
- [x] P2-AR2 P1/P2 → post-P2 architecture gate re-review — PASS; architecture HOLD lifted ([report](./P2_ARCHITECTURE_REVIEW.md))
- [x] Legacy user-visible feature omission audit — IMPLEMENTATION_SPEC expanded with explicit coverage/tasks; no product code changed
- [x] P2A-00 Feature map sync — granular legacy workflow coverage added; root `LEGACY_FEATURE_MAP.md` remains canonical
- [x] P2A-01 Command Registry — application command contract with availability/execute lifecycle; keybindings remain separate
- [x] P2A-02 Slash Quick Insert Surface — CM6 slash trigger, filtering, keyboard/mouse selection, Escape dismissal, and basic Markdown provider
- [x] P2A-03 Completion Engine — provider registry, ASCII `@`/`[[`/`![[` trigger detection, anchored CM6 menu, filtering, keyboard/mouse selection, Store-backed apply, and IME composition guard
- [x] P2A-04 IME / full-width trigger normalization — exact 1:1 detection normalization for `＠`, `！`, `【`/`［` and closing variants; source-preserving CM6 apply and composition-boundary coverage
- [x] P2A-05 Raw Source / Live Preview Toggle — one CM6 document switches between source and source-backed decorations/widgets; `Ctrl/Cmd+E`, selection, source revision and Store history remain continuous
- [x] P2A-06 Keybinding Foundation — DOM-independent command-id mapping, canonical key-stroke normalization, atomic configurable overrides, reset semantics, and pure conflict detection
- [x] Initial P2A user acceptance review — CHANGES REQUIRED / HOLD P3 ([report and remediation contracts](./P2A_ACCEPTANCE_REVIEW.md))

## Active
- [ ] P2A-R01 Caret popup positioning and visible selection — ready
- [ ] P2A-R02 Slash command group navigation
- [ ] P2A-R03 Reference completion mode switching
- [ ] P2A-R04 Popup IME, editability, and lifecycle safety
- [ ] P2A-R05 Line-ending source fidelity
- [ ] P2A-R06 Keybinding recorder round-trip edge cases
- [ ] P2A-AR1 Re-run Phase 2A acceptance gate

## Blocked
- P3 is on HOLD until P2A-R01 through P2A-R06 complete and P2A-AR1 records PASS.

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
- The initial P1 Architecture Review kept ADR-0004/CM6 at GO but placed the implementation gate before P2 on HOLD; the P1-AR2 re-review and remediation evidence are recorded in `P1_ARCHITECTURE_REVIEW.md`.
- P1-R01 replaces the erased `DocumentId | DocumentPath` union key with immutable runtime-discriminated `DocumentLocator` values; all store operations now require explicit id/path addressing and cross-namespace collisions are covered by regression tests.
- P1-R02 isolates timeline and projection observer failures through an injected error sink, continues deterministic fan-out, and queues re-entrant document notifications per document.
- P1-R03 separates generic subscriptions from projection lifecycle, requires explicit projection acknowledgement, rejects revision regression, derives lagging state as stale, and tracks apply failure as degraded.
- P1-R04 makes timeline facts compact and bounded, caps per-document undo/redo retention, and adds an unknown-Markdown source-fidelity corpus.
- P1-AR2 re-runs the P1 → P2 gate: blocker remediations are accepted for P2-01; ADR-0004 remains GO.
- P2-01 established the read-only CM6 Markdown projection boundary; later P2 tasks add Store-backed source changes without changing the authority model.
- P2-02 through P2-05 connect CM6 user changes and Store updates with explicit origins, `storeSync`, per-projection acknowledgement, multi-view fan-out, and stale/degraded recovery; P2-06 adds a source-backed basic preview.
- The v2 CI workflow installs Playwright Chromium and runs boundary/unit tests, real-browser integration tests, typecheck, and build for `writeit-v2` changes.
- P2-AR1 keeps ADR-0004 at GO but holds P3: mount catch-up, fallback revision truth, and boundary enforcement still require remediation.
- P2-R01 makes observer error formatting total, isolates stale bookkeeping and diagnostics failures, and preserves deterministic fan-out after hostile observer failures.
- P2-R02 keeps Store-sync annotation capability private, authenticates replay transactions per adapter, constrains the public editor surface, and checks source authority after ignored changes.
- P2-R03 subscribes before CM6/preview construction, buffers initialization events, and reconciles a fresh Store snapshot before the first projection acknowledgement; teardown unsubscribes before cleanup.
- P2-R04 separates source freshness from enhancement health: a preview can acknowledge current source fallback while remaining degraded, and retry can clear degradation without a source revision.
- P2-R05 replaces regex import scanning with TypeScript AST inspection, resolves local dependencies against an explicit layer matrix, and runs the same CLI against known-good/known-bad fixtures.
- P2-R06 adds a Playwright Chromium gate for real CM6 typing, multi-projection/preview fan-out, clean destruction, unknown-Markdown targeted-edit fidelity, and degraded-preview recovery.
- P2-AR2 accepts P2-R01 through P2-R06: all blocker regressions and the permanent Chromium/source-fidelity gate pass, the architecture HOLD is lifted, and ADR-0004 remains GO. The current SPEC requires Phase 2A before P3, so P2A-00 is the next permitted task.
- The 2026-09-07 feature omission audit adds a legacy UX coverage baseline. Broad labels such as References/Templates/Search/Git no longer count as parity by themselves; completion, quick insert, reference clipboard/recovery, template intelligence, image workflows, precise search/replace, and detailed Git/Diff journeys are explicit deliverables.
- Git provenance is now an explicit Phase 7 deliverable: IDEA-style editor/gutter Git blame must show line-level author/time with commit drill-down, local/uncommitted lines must not be falsely attributed, and file history must answer who changed a document and when. This is a product requirement, not a current P2 gate item.
- Phase 2A (after P2-AR2, before P3) is reserved for Editing Assistance & Source UX foundations: CommandRegistry, `/` quick insert surface, `@`/`[[`/`![[` completion engine, full-width/IME trigger normalization, same-CM6 raw/Live Preview toggle, and keybinding foundation. It does not alter the current P2 remediation gate.
- P2A-00 keeps the root `LEGACY_FEATURE_MAP.md` as the canonical map and adds one row per audited user workflow; broad capability rows remain historical context only.
- P2A-01 establishes a DOM/CM6-independent CommandRegistry with stable ids, metadata, availability checks, execution, duplicate protection, and unregister handles; keybindings are deliberately outside the command contract.
- P2A-02 adds a CM6 slash surface with pure query filtering and basic Markdown commands; command replacements use the DocumentStore mutation bridge, while Template/Mermaid providers remain future work.
- P2A-03 adds a DOM/CM6-independent completion provider registry and edit contract; the CM6 adapter owns only trigger/location/UI/apply bridging, and P4 remains responsible for the real workspace reference provider.
- P2A-04 normalizes supported full-width trigger punctuation only in a same-length detection copy; raw Markdown remains unchanged while the menu is open, and composition guards prevent premature trigger execution.
- P2A-05 keeps raw source and Live Preview in one CM6 EditorView; mode changes are no-document-change state effects, and Markdown syntax is hidden/enhanced only through source-positioned decorations/widgets.
- P2A-06 keeps command metadata independent from keybindings; the pure registry accepts defaults and user overrides, rejects conflicting active assignments atomically, and leaves Settings UI/event wiring to P3.
- Initial user acceptance on baseline `30d56e3` found that implementation completion did not equal UX acceptance: P2A is reopened for the remediation sequence defined in `P2A_ACCEPTANCE_REVIEW.md`, and P3 remains on HOLD.
- Popup geometry/scrolling is a shared slash/completion concern; reference insertion mode is provider-defined state and must remain separate from trigger detection and Markdown authority.

## Known risks
- The AST-backed architecture checker now covers side-effect/re-export/dynamic/CommonJS/Vue imports and resolved layer dependencies; the real-browser gate covers the primary CM6 lifecycle path.
- Full-source Store fan-out resets selection in another editable view and the count-bounded history has no byte-aware budget.
- P2-06 preview intentionally covers only headings, emphasis and safe links; richer Markdown rendering remains future work, while source fallback/degraded recovery is covered in unit, jsdom, and real-browser tests.
- Office-app clipboard coverage currently includes WPS but not the broader target matrix; additional compatibility and large-table performance sampling remain post-GO work.
- DocumentStore and the minimal FileSystemPort are implemented; real platform adapters, external-file reconciliation and save-conflict policy remain for later phases.
- `.pi/` and `.workbuddy/` debug resources still target the legacy application; they are intentionally retained and are not v2 diagnostics.
- User-created `fromChatgptWeb.md` is intentionally retained temporarily as reference material and is not a runtime dependency.
- Legacy `npm run test:unit` still has three failures in `tests/unit/diff/zz-seq-research.test.ts` (Mermaid sequence parsing and jsdom `getBBox`); P0-05 did not change that suite.
- The granular feature map records migration strategy and coverage obligations; final parity outcomes remain intentionally open until the corresponding phase and Phase 12 review.
- The audit identifies several legacy UX behaviors whose exact v2 design is intentionally not frozen yet (for example row/column reorder, theme/icon parity, some annotation drawer behavior, and platform GPU/lite-mode controls); they must be explicitly REDESIGNED/DEFERRED/DROPPED rather than silently omitted.
- The completion surface now covers full-width trigger detection and IME composition boundaries, while the App demo provider is not the P4 workspace/reference implementation.
- The P2A-05 live presentation intentionally covers the current basic Markdown subset; richer block widgets and position mapping around hidden syntax remain later work.
- Keybinding Settings UI, persistence policy, and browser/CM6 event dispatch remain P3 work; P2A-06 only establishes the DOM-independent configuration and conflict contract.
- P2A acceptance blockers include off-screen keyboard selection, caret popup boundary failures, missing slash group/reference mode navigation, slash IME submission risk, popup mutation lifetime, CRLF/mixed-line-ending fidelity, and Plus/Space keybinding round trips.
- Git blame on a dirty Live Preview document needs a source-line mapping policy: committed lines should retain provenance while local/unsaved edits are marked local/uncommitted; Widget-collapsed source ranges must not create false line attribution. Phase 7 now carries this as an explicit design/acceptance risk.
- Active instructions and SPEC now consistently point to the root `LEGACY_FEATURE_MAP.md`; historical architecture-review evidence may still mention the former path.

## Next
P2A-R01 — Caret popup positioning and visible selection
