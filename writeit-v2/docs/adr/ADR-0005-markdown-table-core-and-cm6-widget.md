# ADR-0005: Markdown Table Uses WriteIt Table Core + CM6 Widget

- **Status:** Accepted
- **Accepted on:** 2026-09-06
- **Scope:** Markdown table parsing, editing, and presentation
- **Decision basis:** [CM6 Architecture Spike](../../../experiments/cm6-spike/SPIKE-REPORT.md), final result **GO**
- **Decision source:** [WriteIt v2 Implementation Spec](../IMPLEMENTATION_SPEC.md)

## Context

Tables benefit from structured selection and cell operations, but table syntax is still part of the Markdown persistent contract. Putting table semantics directly in a CM6 widget would couple source behavior to the editor, make pure testing difficult, and encourage rewriting more of the document than the table region.

The CM6 spike demonstrated a browser-independent table core, CM6 widget interaction, local Markdown writeback, source history, and clipboard transformations. Additional office-application interoperability and broader performance measurements remain post-GO validation work rather than blockers for this boundary decision.

## Decision

Table behavior is split between a platform-independent WriteIt Table Core and a CM6 widget projection.

- `core/table` owns parsing, the table model, serialization, selection semantics, operations, and pure clipboard data transformations such as TSV/HTML conversion.
- The CM6 table widget owns interaction, rendering, focus, composition, selection presentation, and DOM lifecycle. Browser clipboard I/O stays outside the table core.
- Table edits are translated into source changes limited to the relevant table region; they must not rewrite the whole document or unrelated Markdown.
- Undo/redo and durable edit history belong to `DocumentStore` source history, not to a second permanent widget or table history.
- The table core has no dependency on CM6, Vue, the DOM, browser clipboard APIs, or Tauri.
- If a table cannot be safely parsed or rendered, the original Markdown remains available and editable as source text.

## Consequences

- Table rules, operations, serialization, and edge cases can be tested as pure unit tests.
- The same table semantics can support future projections without moving domain logic into the UI.
- Widget failures do not authorize data loss or replacement of source.
- The widget must explicitly handle browser concerns such as IME, clipboard MIME data, focus, and lifecycle.
- Serialization may normalize formatting inside an intentionally edited table region; source-fidelity tests must prove that unrelated regions remain unchanged.
- Compatibility and performance findings can drive adapter/widget improvements without moving table semantics out of the core.

## Deferred decisions

- The P5 dialect, malformed fallback, edited-region canonicalization, row/column reorder, runtime-only column resize, and baseline office clipboard matrix are resolved by [P5-00 Table UX & Behavior Contract](../P5_00_TABLE_UX_CONTRACT.md).
- Cross-restart column-width persistence remains deferred and would require a separate decision; widths do not enter Markdown.
- Office applications unavailable in the current environment and broader performance samples remain post-baseline compatibility evidence under `PD-004`.

## Alternatives considered

- **Put all table behavior in a CM6 extension:** rejected because it couples domain rules to one editor and is difficult to test independently.
- **Use a rich-editor table node as the document model:** rejected because it creates a competing representation and risks lossy Markdown round trips.
- **Parse and serialize the whole document for each table edit:** rejected because it risks unrelated Markdown rewrites and violates source-fidelity goals.

## Evidence

- [CM6 Spike acceptance report](../../../experiments/cm6-spike/SPIKE-REPORT.md)
- [CM6 Spike implementation and validation notes](../../../experiments/cm6-spike/README.md)

## Related decisions

- [ADR-0001: Markdown Is The Persistent Data Contract](./ADR-0001-markdown-persistent-data-contract.md)
- [ADR-0002: DocumentStore Is Runtime Content Authority](./ADR-0002-document-store-runtime-content-authority.md)
- [ADR-0003: Editor Views Are Projections](./ADR-0003-editor-views-are-projections.md)
- [ADR-0004: CodeMirror 6 Is The Primary Editor Architecture](./ADR-0004-codemirror-6-primary-editor-architecture.md)
