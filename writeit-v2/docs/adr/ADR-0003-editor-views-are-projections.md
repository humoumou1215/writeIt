# ADR-0003: Editor Views Are Projections

- **Status:** Accepted
- **Accepted on:** 2026-09-06
- **Scope:** CM6 editors, embeds, previews, diff views, and widgets
- **Decision source:** [WriteIt v2 Implementation Spec](../IMPLEMENTATION_SPEC.md)

## Context

WriteIt needs several ways to display or edit the same document. These surfaces have their own selections, focus, DOM, scroll position, and editor state, but those local concerns must not create another document authority.

## Decision

Every editor view and rendered surface is a projection of authoritative, Markdown-backed source state.

A live editable projection is attached to a `DocumentStore` document revision. A read-only or comparison projection, such as a Diff View, may derive from one or more immutable source-backed snapshots. In either case, the projection is not a content authority.

A projection may own:

- selection and focus;
- DOM, editor state, and widget lifecycle;
- a revision-tagged local text replica required by the editor implementation;
- displayed revision and stale status;
- scroll and other view-local state.

A projection must not decide what gets persisted. User edits are submitted to `DocumentStore`; store updates are applied back to attached projections using an explicit synchronization origin so they cannot loop back as new user edits. A projection that cannot render or apply a revision must report a visible degraded or stale state and retain access to source rather than replacing it with a lossy representation.

## Consequences

- Main editors, embeds, read-only previews, Mermaid previews, tables, and diff views share one ownership rule.
- Multiple projections can display one document without duplicating authoritative content.
- Projection adapters must implement revision checks, origin guards, failure handling, and deterministic attach/update/detach cleanup.
- Lifecycle and stale-state diagnostics are architecture requirements, not optional UI details.
- Projection implementations carry synchronization and browser-lifecycle complexity even though domain behavior remains outside the view.

## Deferred decisions

- The concrete projection protocol and subscription API.
- Selection and position mapping between revisions.
- Recovery UX for stale, failed, or detached projections.
- Which read-only projections use CM6 versus another renderer.

## Alternatives considered

- **Make each editor view a self-contained document model:** rejected because it duplicates authority and makes synchronization and persistence ambiguous.
- **Treat rendered output as authoritative:** rejected because rendering is lossy and can fail for unknown syntax.

## Related decisions

- [ADR-0001: Markdown Is The Persistent Data Contract](./ADR-0001-markdown-persistent-data-contract.md)
- [ADR-0002: DocumentStore Is Runtime Content Authority](./ADR-0002-document-store-runtime-content-authority.md)
- [ADR-0004: CodeMirror 6 Is The Primary Editor Architecture](./ADR-0004-codemirror-6-primary-editor-architecture.md)
- [ADR-0006: Diff Guarantee Layer Operates On Markdown Source](./ADR-0006-diff-guarantee-on-markdown-source.md)
