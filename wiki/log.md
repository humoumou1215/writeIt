# Log — Milkdown Wiki

Append-only activity timeline. Pi appends one line per meaningful operation. Never edit or delete past entries; add new lines at the bottom.

## 2026-08-10

- **21:21** Initialized LLM Wiki structure (`wiki/` with `concepts/`, `entities/`, `sources/`, `syntheses/`) per Karpathy spec.
- **21:21** Ingested corpus `raw/milkdown-docs/` (38 files: 34 `.md`, 2 `.json`, 2 `.ts`; 30 module API docs + build scripts). Source-of-truth recorded in [[Milkdown Docs Corpus]].
- **21:21** Created 8 concept pages: [[Milkdown Architecture]], [[Ctx Slice Timer]], [[Plugin System]], [[Preset CommonMark GFM]], [[Transformer]], [[Component System]], [[Crepe Editor]], [[AI Feature]].
- **21:21** Created 8 entity pages: [[Milkdown]], [[Crepe]], [[ProseMirror]], [[CodeMirror]], [[KaTeX]], [[Twemoji]], [[Refractor]], [[Nord Theme]].
- **21:21** Created synthesis [[Overview]] and master [[Index]] (19 pages total, with raw→wiki module map).
- **21:21** Wrote `Agent.md` (Pi's operating schema: structure, permissions, conventions, Ingest/Query/Lint workflows).
- **Status:** Initial knowledge indexing complete. Wiki is ready for queries.

## 2026-08-10

- **22:20** Ingested new corpus `raw/milkdown-srouce/` — the full Milkdown pnpm monorepo source (35 packages). Recorded provenance in [[Milkdown Source Repository]].
- **22:20** Created concept pages [[Monorepo & Build System]] (pnpm layout, toolchain, build/release scripts) and [[Package Catalog]] (all 35 packages grouped with dependency edges).
- **22:20** Created entity page [[Milkdown Monorepo]] (the repo as an entity).
- **22:20** Updated [[Overview]] with a "source repository" section; added the 4 pages to [[Index]] with a `raw/milkdown-srouce/` module map (wiki now 23 pages).
- **22:20** [LINT] Reconciled plugin count: source repo has **17 plugins**; [[Plugin System]] previously listed 16 (added `plugin-automd`) and [[Overview]] said "~15" (corrected to 17).
