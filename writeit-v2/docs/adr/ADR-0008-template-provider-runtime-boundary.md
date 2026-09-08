# ADR-0008: Template Providers Run Behind an Explicit Trusted Runtime Boundary

- **Status:** Accepted
- **Accepted on:** 2026-09-08
- **Scope:** Template `rules.ts`, `suggest.ts`, `export.ts` discovery, execution and host capabilities
- **Decision source:** [WriteIt v2 Goal Decision Ledger](../DECISIONS.md)

## Context

Template files may include executable providers for validation, dynamic suggestions and export metadata. Running workspace JavaScript directly inside Vue components, CM6 extensions or the desktop webview would give provider failure and side effects access to editor state, DOM and platform bridges. Calling this code “sandboxed” merely because it runs in a Web Worker would also overstate the security boundary.

The application needs extensibility without letting provider code become a document authority or an implicit unrestricted plugin system.

## Decision

Executable template providers are treated as trusted workspace extensions behind an explicit `TemplateProviderRuntimePort`.

- Static template Markdown and metadata may be discovered without enabling executable providers.
- Executable `rules.ts`, `suggest.ts` and `export.ts` are disabled by default for a workspace. The user must explicitly enable trusted template code for that workspace, and the setting must be visible and revocable.
- Provider code does not run in the Vue component, CM6 extension, core/domain module or main UI event realm. Browser execution uses a dedicated worker/runtime adapter; desktop execution uses an equivalent isolated adapter behind the same port.
- A worker or isolated JavaScript realm is failure containment, not a claimed security sandbox. The UI and documentation must describe enabled provider code as trusted workspace code.
- The runtime receives only validated, serializable, immutable capability inputs such as `DocumentSnapshot`, `SuggestContext`, template metadata and an explicit operation request.
- The host does not expose `DocumentStore`, editor views, DOM, Tauri invoke, Node globals, process/environment access, arbitrary filesystem access or arbitrary network access to providers.
- Provider results cross a validated schema boundary and are size/time/cancellation bounded. A result can propose validation issues, suggestions or export metadata/output, but any Markdown mutation still flows through normal application commands and `DocumentStore` revision checks.
- Provider load, compile, timeout, crash, invalid-result and cancellation failures are isolated and visible. Static template use and normal document editing continue without source mutation.
- CSP/build configuration must not require evaluating provider code in the main application realm. Implementations must not use `eval` or `new Function` in UI/editor code as a shortcut.

## Consequences

- Template intelligence is replaceable and testable through a platform-neutral contract.
- Users make an explicit trust decision before workspace code executes.
- Provider failure cannot directly persist Markdown, call Tauri commands or manipulate editor DOM.
- A robust runtime adapter, message schema, cancellation and resource limits are required in P8/P11.
- This decision reduces exposure but does not make hostile workspace code safe; stronger sandboxing would require a separate security design and ADR.

## Deferred decisions

- Exact module compilation/bundling mechanism and cache invalidation.
- Concrete CPU/time/memory/output limits for browser and desktop adapters.
- Whether a future signed provider/package format can support less-trusted code.
- Optional, separately reviewed network or filesystem capabilities. None are granted by this ADR.

These details may not introduce direct provider access to DocumentStore authority, DOM/editor internals or unrestricted host capabilities.

## Alternatives considered

- **Import workspace modules directly into the application bundle/runtime:** rejected because it couples unbounded side effects to the main UI and platform bridge.
- **Use `eval`/`new Function` in a component:** rejected because it violates the runtime boundary and complicates CSP, cancellation and failure isolation.
- **Call a worker a complete security sandbox:** rejected because ordinary workers do not establish a sufficient hostile-code security boundary.
- **Remove executable template providers entirely:** rejected because validation, dynamic suggestion and custom export are explicit parity obligations; they require a controlled trust model.

## Related decisions

- [ADR-0001: Markdown Is The Persistent Data Contract](./ADR-0001-markdown-persistent-data-contract.md)
- [ADR-0002: DocumentStore Is Runtime Content Authority](./ADR-0002-document-store-runtime-content-authority.md)
- [ADR-0003: Editor Views Are Projections](./ADR-0003-editor-views-are-projections.md)
- [ADR-0006: Diff Guarantee Layer Operates On Markdown Source](./ADR-0006-diff-guarantee-on-markdown-source.md)
