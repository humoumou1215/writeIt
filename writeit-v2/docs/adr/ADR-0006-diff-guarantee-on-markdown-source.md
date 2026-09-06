# ADR-0006: Diff Guarantee Layer Operates On Markdown Source

- **Status:** Accepted
- **Accepted on:** 2026-09-06
- **Scope:** Git diff, document diff, semantic diff enhancements, and diff rendering
- **Decision source:** [WriteIt v2 Implementation Spec](../IMPLEMENTATION_SPEC.md)

## Context

WriteIt may provide semantic diff views for tables, Mermaid blocks, embeds, or other structured Markdown. Parsers and renderers can fail, and a semantic view can omit changes if it is treated as the only diff. Git and users still need a complete account of source changes.

## Decision

The guaranteed diff layer compares authoritative Markdown source snapshots directly. It does not derive its inputs from editor DOM or rendered HTML. Semantic diff is an optional enhancement layered above that guarantee.

```text
Raw Markdown Diff → Semantic Enhancement → Renderer
```

- Every raw source change receives stable coverage identity within a diff result and remains available in the guarantee model.
- A semantic enhancement may replace the visual presentation of a raw change only while retaining an explicit coverage mapping and a source fallback.
- Enhancement parse failures, partial coverage, or renderer failures degrade affected changes to raw source diff; they may not remove or hide a change.
- Diff diagnostics must report `rawChangeCount`, `representedChangeCount`, and `degradedChangeCount`.
- A completed diff result must satisfy:

```text
representedChangeCount === rawChangeCount
degradedChangeCount <= rawChangeCount
```

Here, “represented” means that a raw change has either a successful semantic representation or a visible raw fallback; it does not require both to be displayed simultaneously.

## Consequences

- Git diff correctness does not depend on table, Mermaid, embed, or other semantic renderers.
- Semantic features can evolve independently and fail safely.
- Diff tests can assert source-level completeness and coverage without a browser.
- Coverage identity and fallback handling add bookkeeping to semantic enhancers and renderers.
- A semantic diff may be less polished or fall back to source lines for unsupported syntax, but it must remain complete.

## Deferred decisions

- The raw diff algorithm, hunk granularity, move detection, and whitespace policy.
- The semantic coverage identifier and mapping representation.
- Review UI choices for switching between semantic and raw presentation.

These choices may evolve only if the source-level completeness invariant remains testable.

## Alternatives considered

- **Use only semantic diff:** rejected because parser or renderer failures could swallow source changes.
- **Use the current CM6 view or DOM as the diff source:** rejected because a projection may be stale or incomplete and is not the document authority.
- **Silently omit unsupported semantic regions:** rejected because it makes completeness impossible to prove.

## Related decisions

- [ADR-0001: Markdown Is The Persistent Data Contract](./ADR-0001-markdown-persistent-data-contract.md)
- [ADR-0002: DocumentStore Is Runtime Content Authority](./ADR-0002-document-store-runtime-content-authority.md)
- [ADR-0003: Editor Views Are Projections](./ADR-0003-editor-views-are-projections.md)
