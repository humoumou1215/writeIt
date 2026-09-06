# WriteIt v2 Architecture Decision Records

ADRs record architecture decisions that constrain later implementation. An accepted ADR is not silently rewritten into a different decision: a future incompatible choice must add a superseding ADR and update this index.

## Status meanings

- **Proposed:** under review and not yet an implementation constraint.
- **Accepted:** approved and binding until superseded.
- **Superseded:** replaced by a linked later ADR.
- **Deprecated:** retained as history but no longer recommended.

## Initial decision set

| ADR | Status | Decision |
|---|---|---|
| [ADR-0001](./ADR-0001-markdown-persistent-data-contract.md) | Accepted | Markdown is the persistent data contract. |
| [ADR-0002](./ADR-0002-document-store-runtime-content-authority.md) | Accepted | `DocumentStore` is runtime content authority. |
| [ADR-0003](./ADR-0003-editor-views-are-projections.md) | Accepted | Editor and rendered views are projections. |
| [ADR-0004](./ADR-0004-codemirror-6-primary-editor-architecture.md) | Accepted | CodeMirror 6 is the primary editor architecture; Spike result is GO. |
| [ADR-0005](./ADR-0005-markdown-table-core-and-cm6-widget.md) | Accepted | Markdown Table uses WriteIt Table Core plus a CM6 widget. |
| [ADR-0006](./ADR-0006-diff-guarantee-on-markdown-source.md) | Accepted | The diff guarantee layer operates on Markdown source. |

All six decisions were accepted on 2026-09-06. Their implementation details remain subject to the explicit deferred decisions in each ADR; deferred details may not weaken the accepted invariants.
