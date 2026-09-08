# P12 Release Candidate Audit

## Decision

**PASS** — G0–G7 gates have evidence and local checkpoint commits. Source authority, projection-only rendering, raw diff guarantee, failure isolation and privacy defaults remain intact.

## Gate evidence

- `npm run verify` is the required final browser/unit/typecheck/build gate.
- Node 22 is pinned in CI workflow; this host's Node 23 is within the supported development range.
- macOS unsigned webview bundle smoke is available through `npm run desktop:package-smoke`; Windows packaging is defined in `.github/workflows/desktop-package.yml`.
- Feature-map granular workflows are classified below; only approved deferrals remain.

## Approved deferrals carried to RC

- Native Windows execution and macOS Tauri launch require their target hosts/toolchains.
- Advanced Git copy/move/whitespace blame heuristics, Linux packaging, signing/notarization/store release and final legacy-tree cutover remain explicitly deferred by the Goal contract.

No unclassified P0/P1 release blocker is present in the v2 source tree.
