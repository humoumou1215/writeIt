# P11 Desktop Architecture Review

## Gate decision

**PASS (adapter/packaging contract)** — desktop capabilities are explicit invoker-backed adapters. Application policy remains in v2 services; adapters only map commands and report failures.

## Evidence

- `TauriPathAdapter`, `TauriWindowAdapter` and `TauriDialogAdapter` own platform command names and typed payloads.
- `DesktopDebugPolicy` defaults to off, requires authentication, and rejects LAN `exec`.
- `src-tauri/tauri.conf.json`, `desktop-package-smoke.mjs` and the Windows workflow provide unsigned webview smoke and CI artifact paths without release signing.

## Verification

- Desktop adapter and debug policy unit tests pass.
- `npm run desktop:package-smoke` validates the production bundle when run after build.

## Environment note

This host has no Rust/Cargo or Windows runner; native Tauri launch and Windows artifact execution are represented by the checked-in adapter/workflow contract and must run in target CI environments.
