# P8 Derived Services + Template Intelligence Architecture Review

## Gate decision

**PASS** — Search/Replace, Outline/Backlinks/composed statistics, Validation and Template catalog/provider contracts derive from authoritative Markdown snapshots. No projection or provider owns document content.

## Evidence

- Search index returns grouped source offsets with case-sensitive/regex modes; `SearchService` caches by query and invalidates on Store/tree changes.
- Replace uses `DocumentStore.applyChange` with revision checks, applies batch matches in reverse order, and reports per-file failures.
- Outline and backlinks retain source offsets; composed-content traversal counts repeated embeds independently and stops cycles with diagnostics.
- Validation rules are isolated; strict save policy is application-owned and never implemented in a CM6 extension.
- Template catalog applies workspace-over-global priority, rescans safely on failure, supports create/insert and source-backed `{{placeholder}}` ranges. Runtime provider contracts are disabled by default and failures are isolated.

## Verification

- `npm run verify` — PASS (unit, browser, typecheck, build)
- Browser evidence: `tests/browser/search-template.spec.ts` covers search → precise navigation → replace and template create.

## Residual bounded risk

Native filesystem watcher integration and executable provider worker/desktop runtime remain P11 adapter work; the P8 contract does not evaluate provider code in the UI realm.
