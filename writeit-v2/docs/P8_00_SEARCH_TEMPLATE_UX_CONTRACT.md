# P8-00 Search / Panel / Template UX Contract

- **Status:** Accepted
- **Accepted on:** 2026-09-09
- **Scope:** P8-01～P8-06 and P8-AR1
- **Authority:** [UX_SPEC.md](./UX_SPEC.md), [ADR-0008](./adr/ADR-0008-template-provider-runtime-boundary.md)

P8 enters through the existing left Search tool while preserving the active editor projection. Search results are grouped by file; selecting a result opens that file and source-range highlights the occurrence. Replace All states its scope and reports per-file success/failure. Outline, Backlinks and document statistics are derived views and never write Markdown. Validation diagnostics are explicit derived results; only application policy can block save. Template catalog/provider results use the existing CommandRegistry and ADR-0008 runtime boundary, with unavailable providers shown as an actionable error.
