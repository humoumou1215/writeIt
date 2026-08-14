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

## 2026-08-11

- **05:28** Updated `Agent.md` (human-requested): directory tree now includes `editor/` Vite demo project + root `index.html` entry page, clarified `editor/`/`index.html` permissions, added CDN-deprecation & Mermaid-integration domain notes to prevent path confusion in future sessions.
- **05:32** Simplified root `index.html` into a minimal entry/navigation page (plan A): only points to `editor/` + run commands; removed CDN history & build details (now only in `editor/README.md`).
- **02:10** Integrated Mermaid into `editor/` demo: `renderPreview` hook renders `mermaid` code blocks to SVG; `/` slash menu lists all **30 diagram types** in 4 groups (via `BlockEdit.buildMenu` + `insert` macro), each inserting a pre-filled example. Created [[Mermaid]] entity page, linked [[CodeMirror]]/[[Crepe Editor]]/[[Index]].
- **02:15** Verified all 30 Mermaid examples with `mermaid.parse` (esbuild-bundled browser build + happy-dom) — 30/30 pass; fixed 9 syntax issues (ASCII identifiers/keys required: C4 `Rel()`, architecture `--` edges, radar/venn/wardley/sankey/requirement ASCII names, packet contiguous blocks). Insert logic tested in node — 30/30.
- **02:40** Added `editor/src/mermaid.md` — standalone catalog of all 30 Mermaid diagram examples (auto-generated from `mermaid-diagrams.ts`, each verified with `mermaid.parse`); toolbar gains a「图表集」button that loads it via `replaceAll`. Verified in node: 30 mermaid code blocks, all language=mermaid, content identical to validated data source.
- **03:05** Slash `/` menu trimmed to 8 curated Mermaid templates in a single「Mermaid」group (Flowchart/Sequence/State/Class/Mindmap/ER/C4/Gantt) via `MERMAID_SLASH_ITEMS`; rendering still supports all 30 types (renderPreview is type-agnostic), `mermaid.md` gallery unchanged.

## 2026-08-11

- **09:50** Built `editor-app/` — full standalone app (Vue 3 + Vite + Tauri 2): file tree with full CRUD, multi-tab editing (per-tab Crepe instance), Ctrl+S + dirty markers + configurable auto-save, 6 themes with chrome color sync, `.md`/`.txt` scope, Windows NSIS target. File system abstracted as `FileSystem` interface (mock / web FS Access API / tauri IPC). Verified: 29 app E2E + 17 mock-fs unit tests + `cargo check` clean.
- **10:20** Merged `editor/` Mermaid capability into `editor-app/` (`src/editor/mermaid.ts` feature factory + `mermaid-diagrams.ts`/`demo.md`/`mermaid.md` copied as single source; mock workspace seeds `Mermaid 图表集.md`). Verified Mermaid preview SVG render + slash menu in browser (5/5 E2E). Documented CodeMirror IntersectionObserver lazy-loading behavior.
- **10:40** Deleted `editor/` (single-page demo) and root `index.html` (stale entry page) — functionality fully superseded by `editor-app/`; assets kept single-source to avoid drift. Updated `Agent.md` (human-requested) + fixed [[Mermaid]] stale paths.

## 2026-08-14

- **12:06** GitHub Actions：Windows 构建新增**免安装便携版**（zip 打包单 exe，Tauri 2 无内置 portable 目标，release exe 自包含）；新增 **macOS 打包**（.app + DMG，macos-13 x64 / macos-14 arm64）。统一为 `.github/workflows/build.yml`（三平台矩阵 + 推 v* 标签由独立 job 统一发 Release，避免并发冲突）；`tauri.conf.json` targets 扩为 `["nsis", "app", "dmg"]`。

- **01:20** editor-app M7b：文件树拖拽移动 + 瞄准定位。HTML5 DnD（dragstart/dragover/drop），落点 = 入目录/同级插入线/拖到根；悬停目录 500ms 自动展开；循环·冲突·空操作拒绝；移动复用 onFileRenamed+updateRefsAfterRename 联动标签与 [[path]] 引用。FS 适配：mock rename 加冲突检测、tauri rename 加 exists 拦截、web rename 补目录递归移动（copyDir）。🎯 定位按钮（替换侧边栏「打开目录」，移入设置）展开祖先链+高亮+滚动。新增 drag-e2e 31/31，全量回归 15 套件全过 + build 通过。实现记录见 `editor-app/docs/design.md` §11 M7b。
