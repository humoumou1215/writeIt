# P6 Annotation + Mermaid Architecture & Product Gate

**Result: PASS**

- **Date:** 2026-09-09
- **Checkpoint:** G2
- **Tasks:** P6-00, P6-A01, P6-A02, P6-A03, P6-M01, P6-M02, P6-AR1
- **Contract:** [P6-00 Annotation / Mermaid UX Contract](./P6_00_ANNOTATION_MERMAID_UX_CONTRACT.md)
- **ADR:** [ADR-0007](./adr/ADR-0007-annotation-workspace-sidecar-persistence.md)

## Evidence

| Area | Evidence | Result |
|---|---|---|
| Annotation domain / anchors | `tests/unit/core/annotation/{anchor,thread}.test.ts` (5): deterministic unique/context mapping, deletion/ambiguity, code-block fail-closed, immutable thread operations | PASS |
| Annotation sidecar service | `tests/unit/application/annotation/service.test.ts` (3): list/create/reply/resolve/reanchor and failed sidecar write safety | PASS |
| CM6 projection | `tests/integration/editor/cm6/annotation-projection.test.ts` (1): source-positioned mark, activation callback, zero Markdown revision | PASS |
| Drawer / review journey | `tests/browser/annotation-review.spec.ts` (1): mark/card activation, reply Enter, resolve, resize, source edit and unresolved anchor state | PASS |
| Mermaid source-backed widget | `tests/unit/core/mermaid/parser.test.ts` (3), `tests/integration/editor/cm6/mermaid-projection.test.ts` (5): fenced detection, flowchart/text fallback, source edit, error fallback, stale result and missing reference feedback | PASS |
| Mermaid commands / completion | `tests/unit/application/commands/mermaid.test.ts` (2), completion trigger regression in `tests/unit/application/assistance/completion.test.ts` (8) | PASS |
| Mermaid browser journey | `tests/browser/mermaid-preview.spec.ts` (1): live render, source mutation, unavailable/available references, normal/split navigation | PASS |
| Full regression | `npm run verify`: 76 Vitest files / 453 tests, 76 Chromium tests, typecheck and build green | PASS |

## Gate audit

- Annotation state is sidecar/application data; CM6 marks, drawer cards, active state, connectors and resize are projections/UI state and never become Markdown or a second Document authority.
- Anchor mapping is deterministic and fail-closed. Deleted, ambiguous, context-mismatched and code-block-changed ranges remain visible as unresolved instead of guessing a nearby phrase.
- Reply, resolve/unresolve and drawer open/close/resize do not change `DocumentStore` revision. Source edits still use the existing CM6 → DocumentStore mutation path.
- Mermaid fences remain source-backed. Live Preview renders a widget, source editing dispatches a normal CM6 transaction, and renderer errors or late results cannot rewrite or hide the source.
- Internal Mermaid references retain source semantics; available targets expose normal/split navigation and unavailable targets show an explicit disabled missing state.
- Mermaid templates use the shared `CommandRegistry`; `@` completion continues to use the existing reference provider and trigger core.
- Core modules remain free of Vue/DOM/CM6/Tauri dependencies and no runtime import reaches `editor-app/`.

## Remaining risks

- Visibility-based Mermaid virtualization and extreme-document performance are intentionally deferred; current rendering is bounded by the existing Live Preview surface and preserves source/diagnostic fidelity.
- Native filesystem-backed annotation adapter remains a P11 platform task; the application contract and in-memory failure semantics are covered here.

## Next

P7-00 — Git / Diff UX & Port Contract
