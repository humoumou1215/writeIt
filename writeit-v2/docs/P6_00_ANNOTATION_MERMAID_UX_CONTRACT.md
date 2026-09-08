# P6-00 Annotation / Mermaid UX & Behavior Contract

- **Status:** Accepted
- **Accepted on:** 2026-09-09
- **Scope:** P6-A01～P6-A03 and P6-M01～P6-M02
- **Authority:** [UX_SPEC.md](./UX_SPEC.md), [ADR-0007](./adr/ADR-0007-annotation-workspace-sidecar-persistence.md), [DECISIONS.md](./DECISIONS.md)

## Annotation

### Entry and drawer

- Annotation is entered from a non-empty source selection through the existing editor context action (`Add annotation`) or the configured command. It never inserts a marker into Markdown.
- Details live in a right-side drawer, default width `360px`, with a visible collapse button. A resize handle clamps the drawer to the available window width so the editor remains usable.
- Opening, closing, resizing, selecting, resolving, and replying only changes workspace review/UI state and never creates a `DocumentStore` revision.
- The drawer is available in ordinary editing and review/diff contexts. Review mode may open it automatically when a review anchor is selected; ordinary editing does not steal focus on its own.

### Anchor and card behavior

- Body ranges use a translucent color mark; the active annotation uses a stronger color and focus ring.
- Every card shows status (`Open`, `Resolved`, or `Cannot locate range`) and the source path. A card click scrolls the source projection to its range and briefly focuses it; clicking a body mark activates and scrolls the corresponding card.
- Connector lines are derived from current DOM geometry and recomputed after scroll, resize, drawer changes, source mapping, or window resize. No geometry is persisted.
- Anchor mapping is deterministic and fail-closed. An exact unique selected-text/context match resolves; a deleted, duplicated, or ambiguous match becomes `Cannot locate range` and never points to a nearby phrase. Code-block anchors must remain inside the same fenced block identity or become unresolved.

### Thread and keyboard behavior

- A thread starts with one comment. Replying appends a comment to the same thread; comments are immutable after creation except explicit edit support added later.
- Reply input: `Enter` sends; `Shift+Enter` inserts a newline. IME composition owns its text; composition Enter never sends.
- `Resolve` marks a thread resolved and weakens its body mark/card. `Unresolve` restores the open state. Resolve/unresolve is sidecar state, not Markdown.
- A failed sidecar write is visible and leaves the previous durable state intact; a failed Markdown edit never fabricates an anchor update.

### Sidecar record

Records are versioned and workspace-relative under `.writeit/annotations/`. A record contains annotation id, document identity, anchor range/context fingerprint, thread comments and resolution metadata. JSON shape and sharding remain adapter details; the application uses `AnnotationRepositoryPort` and does not parse filesystem output in the UI.

## Mermaid

- A fenced block whose info string is `mermaid` (case-insensitive) is projected in Live Preview as a diagram card. Unknown fences remain ordinary code/source.
- The card shows the rendered diagram by default. Source is collapsed by default and can be expanded with `Edit source`; expanded source is the authoritative CM6-backed text and updates the diagram after each committed edit.
- Hover/focus exposes light controls: `Edit source`, `Fit`, and `Open source`. A normal click only focuses/highlights the diagram; it does not open a link or mutate Markdown.
- Loading shows a non-destructive loading state. Renderer errors show an explicit error plus `Show source`; the original fence remains visible and editable. Closing/detaching a projection cancels/ignores late results. A late result for an older source revision can never replace a newer diagram.
- The first renderer support matrix covers `flowchart`/`graph` nodes and edges plus a text fallback for other known Mermaid headers. Unsupported/invalid syntax is an error with source fallback, not guessed geometry.
- WriteIt internal References in Mermaid source remain discoverable and clickable in the diagram card. Normal click opens the configured tab policy; a modifier can request split. Broken references show an explicit broken state and never navigate to an unverified target.
- `/` Mermaid templates register through the existing `CommandRegistry`; `@` completion reuses the existing Reference completion provider and only triggers from real Mermaid source input.

## Acceptance mapping

- **P6-A01:** pure annotation/thread/anchor model, deterministic mapping, invalidation and repository contract.
- **P6-A02:** create/reply/resolve flow, CM6 marks, source selection and keyboard/IME behavior.
- **P6-A03:** drawer, active card, connector geometry, narrow-window and review integration.
- **P6-M01:** fenced detection, renderer lifecycle, source fallback, toggle continuity and stale-result guard.
- **P6-M02:** shared commands/completion, reference navigation, and bounded rendering strategy.
- **P6-AR1:** source authority, anchor correctness, renderer failure, async lifecycle, focus/IME and drawer evidence.

