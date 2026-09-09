# ADR-0007: Annotations Persist as Workspace Sidecar Review Data

- **Status:** Accepted
- **Accepted on:** 2026-09-08
- **Scope:** Annotation identity, anchors, persistence, collaboration and failure behavior
- **Decision source:** [WriteIt v2 Goal Decision Ledger](../DECISIONS.md)

## Context

WriteIt annotations need threads, replies, resolution state and source anchors. Injecting that state into Markdown would change documents for a review-only feature, interfere with external Markdown tools and Git diffs, and tempt UI decorations to become a second document representation. Keeping annotations only in browser/UI memory would instead make review state non-durable and impossible to share or diagnose.

The persistent Markdown contract applies to document content. Review metadata may be persisted separately if its ownership and failure behavior are explicit and it never becomes a competing Markdown authority.

## Decision

Annotations are versioned workspace sidecar review data stored under `.writeit/annotations/` through an `AnnotationRepositoryPort`.

- Annotation text, thread/reply state, resolved state and anchor metadata are never inserted into the document Markdown body.
- `core/annotation` owns platform-independent annotation, thread, anchor and resolution models. It does not depend on Vue, DOM, CM6, browser storage, filesystem APIs or Tauri.
- Application services coordinate `DocumentStore` snapshots with `AnnotationRepositoryPort`. Filesystem/Tauri/browser implementations are platform adapters.
- Each persisted record identifies a logical document using a normalized workspace-relative path or a stable mapping maintained by the repository adapter, plus a source-backed range and context fingerprint sufficient for deterministic re-anchoring.
- Re-anchoring is derived from authoritative Markdown snapshots. If a location cannot be resolved reliably, the annotation becomes explicitly unresolved; it must not be attached to merely nearby text.
- Decorations, cards and connector lines are projections. They may cache geometry and UI state, but those values are not persisted as source anchors or review authority.
- Sidecar writes use versioned schemas and guarded/atomic replacement where the adapter can provide it. Conflicts, partial failures and unsupported strong writes remain visible and may not be reported as success.
- `.writeit/annotations/` is ordinary workspace metadata that may be version-controlled for collaboration. WriteIt does not silently edit `.gitignore`, stage or commit it.
- Document mutations and annotation mutations remain explicit application operations. A failed annotation update must not roll back or overwrite a newer Markdown revision; a failed document edit must not fabricate a successful anchor update.

## Consequences

- Markdown stays interoperable and source diffs are not polluted by review UI state.
- Annotations can be durable, shareable and independently versioned.
- Rename/move/delete flows must coordinate sidecar identity and report partial failure; this requires application-level tests rather than CM6-only behavior.
- External file edits can make anchors unresolved. The UI must represent that uncertainty instead of guessing.
- Repository users may see `.writeit/annotations/` changes in Git and can choose their own ignore policy.

## Deferred decisions

- Exact JSON schema, sharding and filename encoding inside `.writeit/annotations/`.
- Whether a future server-backed repository synchronizes the same port.
- Advanced anchor recovery across large rewrites or branch merges.
- Retention/garbage-collection policy for deleted documents.

These details may not move annotations into Markdown body, DOM state or a second live Document content authority.

## Alternatives considered

- **Inline Markdown markers/comments:** rejected because review state would mutate the content contract and create noisy or tool-specific source.
- **UI/localStorage only:** rejected because review data would not be durable, workspace-scoped or safely shareable.
- **Store annotation state inside DocumentStore Markdown records:** rejected because annotations are review metadata, not authoritative document content.
- **Attach to nearest text after any failure:** rejected because a plausible but incorrect annotation is more dangerous than an explicit unresolved state.

## Related decisions

- [ADR-0001: Markdown Is The Persistent Data Contract](./ADR-0001-markdown-persistent-data-contract.md)
- [ADR-0002: DocumentStore Is Runtime Content Authority](./ADR-0002-document-store-runtime-content-authority.md)
- [ADR-0003: Editor Views Are Projections](./ADR-0003-editor-views-are-projections.md)
- [ADR-0006: Diff Guarantee Layer Operates On Markdown Source](./ADR-0006-diff-guarantee-on-markdown-source.md)
