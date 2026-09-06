# ADR-0001: Markdown Is The Persistent Data Contract

- **Status:** Accepted
- **Accepted on:** 2026-09-06
- **Scope:** WriteIt v2 persistence, interoperability, and source editing
- **Decision source:** [WriteIt v2 Implementation Spec](../IMPLEMENTATION_SPEC.md)

## Context

WriteIt documents must remain interoperable with Git, external text editors, and other Markdown tools. A rendered editor model may be richer than Markdown and may not understand every syntax that a document contains. Treating that model as the durable format could rewrite or discard syntax that the application does not recognize.

## Decision

Markdown source is the canonical durable document payload and persistent data contract for every WriteIt document.

- Documents are loaded, saved, recovered, and compared as Markdown source.
- Opening and saving without an edit must preserve source bytes. A targeted edit must not rewrite unrelated source regions.
- Unrecognized Markdown must be preserved. Unsupported syntax may be shown as ordinary source text but must not be discarded.
- Rendered, structured, indexed, or semantic representations are derived data. They must be reproducible from source and must not become the sole persisted copy or the source used for saving.
- A feature that cannot safely interpret a source region must leave that region unchanged and available as source text.
- Derived exports such as PDF or DOCX consume an authoritative Markdown-backed document snapshot; their output format does not replace Markdown as the document contract.

## Consequences

- Git and external-editor interoperability remain first-class requirements.
- Permanent source-fidelity tests are required for no-op saves and targeted edits.
- Rich features need a lossless fallback and may not assume that all Markdown is understood.
- Structured editing may normalize the source inside an explicitly edited region, but it must not silently normalize unrelated content.
- Some rich editing operations are more constrained than operations on an unconstrained document model.

## Deferred decisions

- The supported Markdown dialect and extension policy.
- Formatting-preservation rules inside an intentionally edited structured region.
- Encoding and line-ending policy beyond the no-op byte-fidelity requirement.

These details may be decided in later feature specifications, but they may not weaken the persistent Markdown contract.

## Alternatives considered

- **Use a rich editor/JSON model as the stored format:** rejected because it breaks Markdown interoperability and risks data loss.
- **Convert Markdown to HTML or another format on save:** rejected because the conversion is not a lossless Markdown contract.

## Related decisions

- [ADR-0002: DocumentStore Is Runtime Content Authority](./ADR-0002-document-store-runtime-content-authority.md)
- [ADR-0003: Editor Views Are Projections](./ADR-0003-editor-views-are-projections.md)
- [ADR-0005: Markdown Table Uses WriteIt Table Core + CM6 Widget](./ADR-0005-markdown-table-core-and-cm6-widget.md)
- [ADR-0006: Diff Guarantee Layer Operates On Markdown Source](./ADR-0006-diff-guarantee-on-markdown-source.md)
