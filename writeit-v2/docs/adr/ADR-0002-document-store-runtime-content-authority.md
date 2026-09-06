# ADR-0002: DocumentStore Is Runtime Content Authority

- **Status:** Accepted
- **Accepted on:** 2026-09-06
- **Scope:** Runtime document state and source mutations
- **Decision source:** [WriteIt v2 Implementation Spec](../IMPLEMENTATION_SPEC.md)

## Context

A document can be displayed by a main editor, embeds, previews, diff views, and other projections at the same time. If each surface owns editable content, the application can create divergent Markdown, revisions, and save results.

## Decision

`DocumentStore` is the single runtime authority for each document's Markdown and revision.

A document's authoritative state includes, at minimum:

```text
Document {
  id
  path
  markdown
  revision
  persistedRevision
}
```

- Every source mutation is applied through the store and records an explicit origin.
- A source-changing operation produces a new authoritative revision. The exact revision representation is deferred, but revision comparison must support stale and conflict detection.
- Persistence consumes a store snapshot at a known revision. A successful save advances `persistedRevision` for the revision that was actually persisted.
- Projections consume store state and submit edit intents or source changes to the store.
- An editor may hold the text required by its local editor state, but that text is a revision-tagged replica: it must not be persisted as an independent authority or silently overwrite a newer store revision.
- Immutable persisted, Git, or comparison snapshots may be diff inputs; they do not become a second live document authority.

## Consequences

- Multi-view synchronization has one clear authority: projections consume store state and submit changes to the store.
- Dirty state and save-conflict decisions can be expressed in terms of revisions.
- Store APIs and events become the stable boundary for editor, filesystem, history, and future platform adapters.
- All mutation paths must pass through one boundary, which increases the importance of explicit transaction, error, and observability design in the store.
- Projection integration must detect stale displayed revisions instead of silently overwriting newer source.

## Deferred decisions

- Concrete `DocumentId`, `DocumentPath`, and `Revision` representations.
- Reload, external-change, merge, and save-conflict policy.
- History grouping, undo/redo commands, and retention limits.
- The exact mutation/change-set API and origin taxonomy.

These are Phase 1 and Phase 3 decisions; none may introduce another live Markdown authority.

## Alternatives considered

- **Let the active editor own content:** rejected because embeds and non-active views would become second authorities.
- **Merge content independently in every projection:** rejected because it hides ownership and makes revision and conflict behavior non-deterministic.

## Related decisions

- [ADR-0001: Markdown Is The Persistent Data Contract](./ADR-0001-markdown-persistent-data-contract.md)
- [ADR-0003: Editor Views Are Projections](./ADR-0003-editor-views-are-projections.md)
- [ADR-0006: Diff Guarantee Layer Operates On Markdown Source](./ADR-0006-diff-guarantee-on-markdown-source.md)
