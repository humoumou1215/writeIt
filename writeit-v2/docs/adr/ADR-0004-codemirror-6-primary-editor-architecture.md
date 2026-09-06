# ADR-0004: CodeMirror 6 Is The Primary Editor Architecture

- **Status:** Accepted
- **Accepted on:** 2026-09-06
- **Scope:** WriteIt v2 editor surface
- **Decision basis:** [CM6 Architecture Spike](../../../experiments/cm6-spike/SPIKE-REPORT.md), final result **GO**
- **Decision source:** [WriteIt v2 Implementation Spec](../IMPLEMENTATION_SPEC.md)

## Context

The v2 editor needs a mature transaction model, extensibility for Markdown features, and a clear integration boundary with the Markdown-first core. The architecture spike demonstrated source fidelity, a single `DocumentStore` authority, multi-projection editing, table-core separation, revision/stale handling, lifecycle behavior, and source-based diff feasibility.

The spike still has room to broaden its spreadsheet-application compatibility matrix and large-table performance observations. The project owner accepted **GO** with those items tracked as post-GO compatibility and optimization work rather than architecture-gate blockers.

## Decision

CodeMirror 6 is the primary editor architecture for WriteIt v2.

- CM6 is used for the interactive source-editor projection and its editor extensions/widgets.
- CM6 transactions are adapted to `DocumentStore` mutations; an `EditorView` is never the runtime content authority.
- Core/domain code remains independent of CodeMirror, Vue, the DOM, and Tauri.
- Specialized features such as tables, Mermaid, and embeds are projections/extensions layered on top of source-preserving Markdown behavior.
- This decision does not require every future view to be editable or rendered by CM6.
- Broader office-application clipboard compatibility and performance tuning may evolve adapters and widgets without reopening this ADR, unless evidence shows that an architecture invariant cannot be met.

## Consequences

- The project can use CM6 transactions, decorations, widgets, change mapping, and lifecycle APIs for editor behavior.
- The editor adapter must define synchronization origins, revision checks, stale handling, and deterministic cleanup.
- Widget behavior involving IME, clipboard, focus, selection, and DOM lifecycle still requires targeted browser and real-environment validation.
- Large or numerous projections require performance budgets and measurements; the GO decision is not a claim that all future workloads are already optimized.
- Core behavior can be unit-tested without a browser or CM6.
- Existing legacy editor technology is not a v2 runtime dependency, so migration requires deliberate reimplementation rather than direct reuse.

## Deferred decisions

- The exact CM6 extension bundle, keymap, theme, and package composition.
- Performance budgets and the breadth of the office-application compatibility matrix.
- Feature-specific rendering choices that do not change CM6's role as the primary interactive editor.

## Alternatives considered

- **Continue with the legacy rich-editor stack:** rejected because its rich-model round trips and legacy manager ownership make Markdown fidelity and one-authority synchronization harder to guarantee.
- **Adopt Milkdown, Crepe, or ProseMirror for the v2 primary editor:** rejected because it would retain the rich-editor architecture that v2 is separating from the Markdown-first core; the CM6 spike supplied direct feasibility evidence for the selected route.
- **Build a bespoke editor:** rejected because it would duplicate mature transaction, selection, mapping, and extension infrastructure.

## Evidence

- [CM6 Spike acceptance report](../../../experiments/cm6-spike/SPIKE-REPORT.md)
- [CM6 Spike implementation and validation notes](../../../experiments/cm6-spike/README.md)

## Related decisions

- [ADR-0001: Markdown Is The Persistent Data Contract](./ADR-0001-markdown-persistent-data-contract.md)
- [ADR-0002: DocumentStore Is Runtime Content Authority](./ADR-0002-document-store-runtime-content-authority.md)
- [ADR-0003: Editor Views Are Projections](./ADR-0003-editor-views-are-projections.md)
- [ADR-0005: Markdown Table Uses WriteIt Table Core + CM6 Widget](./ADR-0005-markdown-table-core-and-cm6-widget.md)
