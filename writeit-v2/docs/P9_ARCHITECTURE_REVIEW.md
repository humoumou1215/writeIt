# P9 Export Architecture Review

## Gate decision

**PASS** — Exporters consume immutable `DocumentSnapshot` plus `ExportContext`; Markdown, PDF, DOCX and custom formats share one orchestration path and batch failures remain itemized.

## Evidence

- `ExportService.snapshot` reads the current `DocumentStore` state and never asks CM6 for DOM or rendered text.
- Built-in exporters provide deterministic output paths, MIME types and bytes for Markdown/PDF/DOCX.
- Custom exporters register through the same contract; mixed-format batches return one success/failure result per item.
- Export errors are isolated and cannot mutate Markdown or persistence state.

## Verification

- Unit contract tests cover source immutability and partial batch failure.
- App export controls expose format selection and a visible result message.
