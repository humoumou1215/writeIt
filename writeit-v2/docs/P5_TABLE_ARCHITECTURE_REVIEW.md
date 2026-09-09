# P5 Table Architecture & Product Gate

**Result: PASS**

- **Date:** 2026-09-09
- **Checkpoint:** G1
- **Tasks:** P5-00, P5-01, P5-02, P5-03, P5-04, P5-05, P5-AR1
- **Contract:** [P5-00 Table UX & Behavior Contract](./P5_00_TABLE_UX_CONTRACT.md)
- **ADR:** [ADR-0005](./adr/ADR-0005-markdown-table-core-and-cm6-widget.md)

## Evidence

| Area | Evidence | Result |
|---|---|---|
| Parser / source fidelity | `tests/unit/core/table/parser-serializer.test.ts` (9), CRLF/LF, escaped pipe, code span, emoji/中文, `<br>`, malformed rejection and stale-range protection | PASS |
| Table operations | `tests/unit/core/table/operations.test.ts` (6), `tests/integration/application/table/edit.test.ts` (3), source-range-only mutation, revision, undo/redo, multi-projection fan-out | PASS |
| Projection lifecycle | `tests/integration/editor/cm6/table-projection.test.ts` (12), StateField block decoration, Raw/Live continuity, malformed fallback | PASS |
| Clipboard / IME | `tests/unit/core/table/clipboard.test.ts` (4), integration coverage for quoted TSV, safe HTML, multiline cells, Shift selection, paste, composition guard | PASS |
| Commands / advanced controls | `tests/unit/application/table/commands.test.ts` (3), stable ids, shared pure mapping, protected actions, contextual toolbar/grips, reorder and runtime resize | PASS |
| Real browser journey | `tests/browser/table-engine.spec.ts` (2), Chromium selected replacement, double-click editing, Enter `<br>`, Raw/Live, rectangle selection, command mutation, row drag and column resize | PASS |
| Full regression | `npm run verify`: 69 test files / 434 tests, 74 Chromium tests, typecheck and build green | PASS |

## Gate audit

- Markdown remains the durable contract; Table Core is pure and no v2 runtime import reaches `editor-app/`.
- `DocumentStore` remains the sole source/revision authority. Table mutations use one source-range replacement and normal Store history; resize is runtime-only.
- Valid tables project as widgets; incomplete/unsafe tables remain source. Renderer/widget failures cannot rewrite source.
- Selected vs Editing states, Enter/Tab/Arrow behavior, rectangle/row/column selection, copy/cut/paste, multiline cells, and composition guards are covered.
- Row/column reorder preserves alignment metadata and is undoable; header and last row/column deletion are protected.
- `<br>` is explicit, visible, renderer-independent v2 source. Legacy `<nbr />` remains untouched source and is not silently migrated.
- Remaining compatibility scope is bounded by approved `PD-004` (Office applications unavailable in this environment). Cross-restart width persistence remains explicitly outside D-006.

## Follow-up

No blocker remains for P6. Broader Office application matrix and larger-table performance samples can be added under `PD-004` without changing the authority or UX contract.

