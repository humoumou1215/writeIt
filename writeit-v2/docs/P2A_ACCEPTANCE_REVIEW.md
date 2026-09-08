# Phase 2A User Acceptance Review & Remediation

- **Review date:** 2026-09-07
- **Acceptance baseline:** `30d56e3` (`feat(v2): complete P2A editing foundations`)
- **Initial review result:** **CHANGES REQUIRED / HOLD P3**
- **Final gate result (P2A-AR1):** **PASS**
- **Scope:** P2A Editing Assistance & Source UX Foundation

## 1. Gate decision

P2A-00 through P2A-06 remain completed implementation milestones, but user acceptance exposed interaction and source-fidelity gaps. Phase 3 must not start until P2A-R01 through P2A-R06 are complete and P2A-AR1 records a PASS.

Required sequence:

```text
P2A-R01 Caret popup positioning and visible selection
P2A-R02 Slash command group navigation
P2A-R03 Reference completion mode switching
P2A-R04 Popup IME, editability, and lifecycle safety
P2A-R05 Line-ending source fidelity
P2A-R06 Keybinding recorder round-trip edge cases
P2A-AR1 Re-run Phase 2A acceptance gate
```

Each task is independent work. An Agent must execute only the requested Task ID and must not automatically start the next one.

## 2. Acceptance evidence

### 2.1 Selected option leaves the visible menu

On the baseline demo, the slash menu reported:

```text
clientHeight = 286
scrollHeight = 334
selected = Divider
scrollTop = 0
selected visible = false
```

An isolated completion surface with 20 candidates reported:

```text
clientHeight = 286
scrollHeight = 714
selected = Document 20
scrollTop = 0
selected visible = false
```

Both controllers update `selectedIndex` and rebuild the DOM, but neither scrolls the active option into view.

### 2.2 Popup can jump to the document top

With a long document and `/` entered near the lower viewport boundary, the menu fell back to `top: 8px`; because it is absolutely positioned under the editor root, its actual viewport top was approximately `-382.7px`. Both slash and completion position against `trigger.from`, lack viewport fitting, and use editor-top fallback when `coordsAtPos()` is unavailable.

### 2.3 Legacy behavior relevant to acceptance

The legacy reference menu already contains:

- active-entry scrolling in `editor-app/src/editor/ref/menu/RefMenu.vue` (`scrollToHover`);
- `Tab` mode cycling;
- link, editable embed, and readonly embed syntax, including `![[path|ro]]`.

Legacy code remains reference-only; v2 must reimplement the behavior inside the v2 boundaries.

## 3. Findings mapped to remediation

| Finding | Severity | Owner |
|---|---:|---|
| Slash and completion active options do not remain visible during keyboard navigation | HIGH | P2A-R01 |
| Popup is not reliably anchored to the caret and does not fit above/below/right viewport boundaries | HIGH | P2A-R01 |
| Native menu scrollbar is visually inconsistent with the editor surface | LOW | P2A-R01 |
| Slash commands render group headings but have no active-group or Tab navigation | MEDIUM | P2A-R02 |
| Reference completion cannot switch link/editable/readonly modes without rewriting the trigger | MEDIUM | P2A-R03 |
| Slash can consume IME Enter; async completion can fail to refresh after composition cancellation | HIGH | P2A-R04 |
| Popup mutation bridges are not explicitly bound to editable, live Projection lifetime | HIGH | P2A-R04 |
| CRLF/CR/mixed line endings are not covered by the CM6 source-fidelity gate | HIGH | P2A-R05 |
| `Plus`/`Space` key recorder values do not round-trip through canonical keybinding text | MEDIUM | P2A-R06 |
| Demo labels still identify P2A-05 instead of the current acceptance state | LOW | P2A-AR1 |

---

## P2A-R01 — Caret Popup Positioning and Visible Selection

### Goal

Give slash and completion menus one shared, reliable popup behavior: the active option remains visible, the popup follows the current caret, and the popup fits within the visible viewport without jumping to the document top.

### Allowed scope

- `writeit-v2/src/editor/cm6/extensions/`
- a small shared CM6 popup/geometry helper under `writeit-v2/src/editor/cm6/`
- `writeit-v2/src/style.css`
- related unit/integration/browser tests
- this review document and `STATUS.md` only when recording completion

### Read first

- `AGENTS.md`
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md` Phase 2A
- `writeit-v2/docs/STATUS.md`
- this document, especially §2
- `slash-quick-insert.ts`, `completion.ts`, and their existing tests
- only for behavior reference: `editor-app/src/editor/ref/menu/RefMenu.vue`

### Implementation requirements

1. Slash and completion must share the same positioning and active-option visibility policy; do not fix only one surface.
2. Anchor at the collapsed primary caret/current trigger end (`trigger.to`), not the trigger opener.
3. Prefer below-caret placement; when space is insufficient, place above the caret.
4. Clamp horizontally and vertically to the visible viewport/editor boundary with a small gap. The menu must never overlap the caret rectangle.
5. If coordinates are temporarily unavailable, do not fall back to document/editor top. Hide or retain the last valid placement until a geometry update can position safely.
6. Reposition on relevant CM6 geometry changes, editor/page scrolling, and viewport resize without using timeout/sleep as synchronization.
7. After ArrowUp/ArrowDown or programmatic selection changes, scroll the selected option with nearest-edge behavior. Wrapping from last to first and first to last must also restore visibility.
8. Constrain menu height to available space and add a subtle cross-browser scrollbar style with visible hover/drag affordance.
9. Popup navigation and positioning must not change Markdown, DocumentStore revision, selection, or history.
10. Preserve keyboard, mouse, Escape, async provider, and accessibility behavior already covered by P2A tests.

### Tests

- Pure geometry tests where practical: below, above, left/right clamp, unavailable coordinates.
- Integration tests for both slash and completion active-option visibility.
- Chromium browser tests with at least 20 items, wraparound navigation, long/scrolled document, near-bottom caret, near-right caret, page/editor scroll, and resize.
- Assert selected option remains fully visible and popup does not intersect the caret.
- Assert Store Markdown and revision are unchanged while only navigating/repositioning.

### Acceptance criteria

- The two §2 reproductions no longer fail.
- A selected item is always visible after keyboard navigation.
- Popup stays adjacent to the caret and flips above it at the lower boundary.
- No fallback can send an open popup to the document head or outside the viewport.
- Scrollbar presentation is deliberate and consistent on Chromium.
- Existing unit, integration, browser, typecheck, and build gates pass.

### Completion evidence

- Shared `editor/cm6/caret-popup.ts` policy anchors both surfaces at `trigger.to`, fits them inside the visible editor/viewport intersection, flips above at the lower boundary, and hides when coordinates are unavailable.
- Both controllers reposition on CM6 geometry, editor/page scroll, resize, and observed editor size changes; active options use nearest-edge menu-only scrolling.
- Unit geometry coverage, jsdom integration coverage for both surfaces, and Chromium coverage with 24 items verify wraparound visibility, lower/right boundaries, long documents, editor/page scrolling, resize, and unchanged source/revision.
- Verification: `npm run test`, `npm run test:browser`, `npm run typecheck`, and `npm run build` pass.

### Out of scope

- Slash group tabs and group switching (P2A-R02).
- Reference insertion modes (P2A-R03).
- Real workspace reference data (P4).
- Template or Mermaid providers (P6/P8).

---

## P2A-R02 — Slash Command Group Navigation

### Goal

Make `Command.group` a user-visible navigation mechanism so large command catalogs do not require traversing every command with ArrowUp/ArrowDown.

### Allowed scope

- slash quick-insert application/editor contracts and implementation
- slash menu styles
- App demo providers needed to expose multiple groups for acceptance
- related unit/integration/browser tests
- this review document and `STATUS.md` only when recording completion

### Read first

- P2A-R01 result
- P2A Command Registry and Slash Quick Insert sections in the SPEC
- `application/commands/{registry,quick-insert}.ts`
- `editor/cm6/extensions/slash-quick-insert.ts`

### Implementation requirements

1. Derive unique groups from available filtered commands in deterministic registration order.
2. Render a clear group selector distinct from group content headings.
3. `Tab` selects the next non-empty group; `Shift+Tab` selects the previous non-empty group and prevents focus from leaving the editor while the menu is open.
4. Mouse selection of a group is supported without moving the CM6 caret.
5. Switching group selects its first available command. ArrowUp/ArrowDown navigate and wrap only within the active group.
6. Query filtering remains global; if the active group becomes empty, select the first remaining non-empty group deterministically.
7. Enter executes only the selected command from the active group; Escape keeps existing dismissal semantics.
8. Group switching must not mutate Markdown or rerun unrelated commands.
9. Future Template/Mermaid providers must add groups through registration data, not menu-specific conditionals.

### Tests

- Unit tests for deterministic grouping/filtering.
- Integration and Chromium tests with at least three groups and enough entries to overflow.
- Cover Tab, Shift+Tab, mouse group selection, Arrow navigation, filtering that removes the active group, Enter, and Escape.
- Assert group-only navigation does not change source/revision.

### Acceptance criteria

- A user can reach each command group with Tab/Shift+Tab.
- Arrow keys never require traversing commands from inactive groups.
- Multiple providers can contribute groups without editor adapter changes.
- P2A-R01 positioning/visibility behavior remains intact.

### Completion evidence

- Slash commands are filtered globally, grouped in deterministic first-registration order, and rendered through a provider-supplied group selector; the active group alone owns ArrowUp/ArrowDown selection.
- Tab/Shift+Tab, mouse group selection, active-group fallback after filtering, and source/revision-preserving navigation are covered by jsdom integration tests and a Chromium overflow harness with 36 commands across three groups.
- Built-in Markdown commands now expose Headings, Lists, and Blocks groups without menu-specific provider conditionals.
- Verification: `npm run test`, `npm run test:browser`, `npm run typecheck`, and `npm run build` pass.

### Out of scope

- Implementing complete Template or Mermaid command sets.
- Reference completion modes.
- Configurable keybinding Settings UI.

---

## P2A-R03 — Reference Completion Mode Switching

### Goal

Allow one reference completion session to switch among link, editable embed, and readonly embed modes without changing source until the user selects a candidate.

### Allowed scope

- completion application contracts and CM6 surface
- demo reference provider and styles
- related unit/integration/browser tests
- minimal feature-map clarification if needed
- this review document and `STATUS.md` only when recording completion

### Read first

- P2A Completion Engine and P4 Reference sections in the SPEC
- `application/assistance/completion.ts`
- `editor/cm6/extensions/completion.ts`
- legacy syntax evidence listed in §2.3

### Implementation requirements

1. Keep trigger detection separate from insertion mode.
2. Support provider-declared modes with stable IDs; the reference provider uses `link`, `embed`, and `embed-readonly`.
3. Initial mode is `link` for `@` and `[[`, and `embed` for `![[`.
4. While a reference completion menu is open, `Tab` cycles forward and `Shift+Tab` cycles backward through modes.
5. Render and expose the active mode accessibly; mouse mode selection is supported without moving the editor caret.
6. Switching mode must not rewrite the typed trigger, change DocumentStore revision, or unnecessarily refetch identical candidates.
7. Applying the selected file produces exactly:
   - link: `[[path]]`
   - editable embed: `![[path]]`
   - readonly embed: `![[path|ro]]`
8. The completion engine must remain provider-oriented; generic CM6 code must not hardcode workspace paths or reference resolution business logic.
9. P4 remains responsible for real workspace candidates, entities, and resolution.

### Tests

- Pure mode/trigger mapping tests.
- Integration and Chromium tests for all three trigger forms, Tab/Shift+Tab wraparound, mouse mode selection, query preservation, and exact applied Markdown.
- Assert source and revision remain unchanged until candidate application.
- Cover full-width trigger normalization with mode switching.

### Acceptance criteria

- Starting from `@`, the user can reach and apply all three exact Markdown forms.
- Typed `[[` and `![[` select intuitive initial modes.
- Mode switching does not disturb query, candidate selection, source, history, or caret.
- Existing completion provider isolation and IME behavior remain intact.

### Completion evidence

- Completion providers can declare stable insertion modes and a trigger-dependent initial mode; the CM6 adapter keeps mode changes separate from trigger detection and provider querying.
- The demo reference provider exposes `link`, `embed`, and `embed-readonly`; `@`/`[[` start in link mode and `![[` starts in editable embed mode.
- Tab/Shift+Tab and mouse selection preserve the query, selected candidate, caret, DocumentStore source/revision/history, and candidate list; applying emits exactly `[[path]]`, `![[path]]`, or `![[path|ro]]`.
- Integration and Chromium coverage includes all trigger forms, full-width normalization, mode wraparound, accessible active mode state, mouse focus preservation, and no-refetch navigation.
- Verification: `npm run test`, `npm run test:browser`, `npm run typecheck`, and `npm run build` pass.

### Out of scope

- Real workspace reference enumeration and second-level entity candidates (P4).
- Embed rendering/editing (P4-09).
- Reference context-menu type conversion (P4-08).

---

## P2A-R04 — Popup IME, Editability, and Lifecycle Safety

### Goal

Ensure slash/completion interactions cannot submit during composition or mutate a Document after their Projection is readonly, stale, or destroyed.

### Allowed scope

- slash/completion CM6 adapters
- SingleDocumentView-owned mutation capability/lifecycle seam if required
- related application contracts and tests
- this review document and `STATUS.md` only when recording completion

### Read first

- ADR-0002 and ADR-0003
- P2/P2A authority and IME acceptance rules
- `single-document-view.ts`, `slash-quick-insert.ts`, `completion.ts`

### Implementation requirements

1. Slash must ignore Enter/navigation submission while `event.isComposing`, keyCode 229, controller composition state, or `view.composing` indicates composition.
2. Composition start hides/cancels stale popup work; composition end deterministically reevaluates the current trigger without fixed delays.
3. Completion must restart a pending provider query after composition cancellation when source/trigger did not change; it must not remain permanently at “No suggestions”.
4. Popup mutations must use a capability bound to one editable, live Projection rather than unrestricted `store + locator` authority.
5. Revalidate trigger, source, expected revision, editability, and Projection generation/lifetime after every awaited provider/command step and before Store mutation.
6. Destroy/readonly transition/dismissal invalidates pending mutation capability. Late async results may be discarded but must never change Markdown.
7. Failures remain diagnosable and do not damage or partially rewrite source.

### Tests

- Real Chromium IME coverage for slash and completion Enter behavior.
- Pending provider + composition cancel + unchanged source.
- Readonly Projection with an active-looking trigger cannot execute.
- Destroy immediately after async command/completion starts; late resolution does not mutate Store.
- Source/revision race before async resolution is rejected safely.

### Acceptance criteria

- IME candidate confirmation never executes a slash/completion item.
- Readonly and destroyed Projections cannot mutate DocumentStore through popup adapters.
- No timeout/sleep is used as a state protocol.
- Existing Store authority and projection lifecycle tests pass.

### Completion evidence

- Slash and completion key handlers now ignore composition-owned Enter/navigation when controller state, `event.isComposing`, keyCode 229, or `view.composing` indicates an active IME session. Composition start invalidates stale popup work; composition end uses CM6/event-order reconciliation and re-queries an unchanged completion trigger without a timer protocol.
- `SingleDocumentView` injects a projection-scoped mutation capability through a private CM6 facet. Popup adapters no longer receive `store + locator`; the capability checks live/editable/fresh projection state and expected revision before every source mutation, and is invalidated on composition cancellation, dismissal, readonly/destroyed lifecycle, and failed mount teardown.
- Async slash commands and completion edits capture the source revision and a popup generation token. Late provider/command results, readonly/stale projections, destroyed views, and source/revision races are rejected without changing Markdown; failures remain exposed through the popup diagnostic attribute.
- `tests/integration/editor/cm6/popup-lifecycle.test.ts` covers IME Enter/keyCode 229, slash availability cancellation, completion query restart, readonly projections, destroyed command results, and revision races. Chromium coverage in `tests/browser/popup-lifecycle.spec.ts` covers slash/completion IME events, pending query restart, readonly completion, and destruction races.
- Verification: `npm run test`, `npm run test:browser`, `npm run typecheck`, and `npm run build` pass.

### Out of scope

- P3 close-confirm UI.
- P4 embed UI.
- General command cancellation outside editor popup invocation.

---

## P2A-R05 — Line-ending Source Fidelity

### Goal

Make CM6 mounting and targeted editing preserve CRLF, CR, LF, and mixed-line-ending Markdown according to the permanent source-fidelity gate.

### Allowed scope

- CM6 projection/source mapping
- minimal Core source-change contract changes only if required and architecture-compatible
- source-fidelity fixtures and unit/integration/browser tests
- ADR/SPEC update only if an unavoidable decision changes an accepted invariant
- this review document and `STATUS.md` only when recording completion

### Read first

- ADR-0001 through ADR-0003
- SPEC Source Fidelity Gate
- `single-document-view.ts`
- existing source-fidelity corpus/tests

### Implementation requirements

1. Opening/mounting a document without edits must not change its authoritative bytes, revision, dirty state, or line endings.
2. A targeted edit must preserve untouched line endings and avoid whole-document newline normalization.
3. CM6 offset-to-authoritative-source mapping must be explicit and tested; do not assume `Text.toString()` offsets equal original CRLF/mixed-source offsets.
4. Store remains the only authoritative Markdown. A normalized editor projection must not become a second authority.
5. Do not silently adopt global LF normalization. If implementation requires changing the persistent contract, stop and propose a superseding ADR.

### Tests

- LF, CRLF, CR, and mixed-line-ending fixtures.
- Mount/no edit/no-op persistence leaves source byte-for-byte unchanged.
- Targeted insertion, deletion, undo/redo, Store fan-out, and raw/live toggle preserve unrelated separators.
- Real Chromium coverage for CRLF and mixed line endings.

### Acceptance criteria

- All line-ending fixtures pass the permanent source-fidelity gate.
- Merely opening a Windows document cannot make it dirty or stale.
- A one-word edit cannot produce a whole-file newline diff.

### Completion evidence

- `editor/cm6/projection/source-fidelity.ts` keeps an LF-normalized CM6 projection plus an explicit projected-boundary → authoritative-source map for CRLF, CR, LF, and mixed input.
- CM6 `ChangeSet` edits and popup full-document replacements map only their changed ranges back to `DocumentStore`; untouched source separators are not normalized. Store fan-out, undo/redo, and no-edit dirty/revision behavior are covered by integration tests.
- Permanent source-fidelity fixtures cover LF, CRLF, CR, and mixed endings; Chromium covers CRLF and mixed targeted edits without a whole-file newline rewrite.
- Verification: `npm run test`, `npm run test:browser`, `npm run typecheck`, and `npm run build` pass.

### Out of scope

- User-configurable line-ending conversion.
- General file encoding detection beyond the existing Markdown string contract.

---

## P2A-R06 — Keybinding Recorder Round-trip Edge Cases

### Goal

Ensure canonical keybinding strings can represent and round-trip real `KeyboardEvent` values for Plus and Space without ambiguous separators.

### Allowed scope

- `application/commands/keybindings.ts`
- related unit/property-style tests
- this review document and `STATUS.md` only when recording completion

### Read first

- P2A-06 task contract and current keybinding tests
- future P3-05 Settings UI requirements

### Implementation requirements

1. Preserve unambiguous canonical tokens such as `Plus` and `Space`; do not serialize the key as the `+` delimiter itself.
2. `formatKeybindingInput` must accept real `KeyboardEvent.key` values `'+'` and `' '`.
3. For every supported recorded key, parsing the formatted value must reproduce the same normalized stroke.
4. Conflict detection and registry resolution must use the corrected canonical form atomically.
5. Existing aliases remain backward compatible where unambiguous.

### Tests

- `Ctrl+Plus`, `Mod+Plus`, `Ctrl+Space`, bare Plus/Space, shifted plus/equal behavior, and conflict detection.
- Table-driven invariant: `parse(format(input))` succeeds and normalizes deterministically for all supported aliases/recorder values.

### Acceptance criteria

- Plus and Space can be recorded, persisted, parsed, displayed, and resolved.
- Canonical output never produces ambiguous `Ctrl++` text.
- Existing keybinding tests pass.

### Completion evidence

- Recorder input normalizes literal `KeyboardEvent.key` values `'+'` and `' '` to the canonical `Plus` and `Space` tokens before modifiers are serialized; existing `plus`, `space`, `Mod`, and CM6 key aliases remain accepted where unambiguous.
- Table-driven unit coverage verifies `parse(format(input))` for bare and modified Plus/Space values, shifted Plus/equal values, and canonical normalization; conflict detection and registry resolution use `Ctrl+Plus` atomically.
- Verification: `npm run test`, `npm run typecheck`, and `npm run build` pass.

### Out of scope

- P3 Shortcut Settings UI and persistence.
- Multi-stroke chords.
- Platform-specific display glyphs.

---

## P2A-AR1 — Re-run Phase 2A Acceptance Gate

### Goal

Verify all remediation evidence, perform the user-facing acceptance journey, and decide PASS or CHANGES REQUIRED before P3.

### Allowed scope

- review evidence and test execution
- `writeit-v2/docs/P2A_ACCEPTANCE_REVIEW.md`
- `writeit-v2/docs/STATUS.md`
- minor demo labels/documentation only; no new product capability

### Read first

- all P2A remediation results
- Phase 2A acceptance criteria in the SPEC
- current STATUS and this document

### Implementation requirements

1. Re-run unit/integration, Chromium browser, typecheck, build, and architecture boundaries.
2. Manually verify both slash and completion with long candidate lists at top, middle, bottom, and right viewport boundaries.
3. Verify slash group switching and all three reference modes.
4. Verify Chinese IME composition, readonly/destroy races, line-ending corpus, raw/live toggle continuity, and keybinding round trips.
5. Update the demo phase label and README to the accepted state if all checks pass.
6. Record PASS or remaining blockers. Only PASS may set the next task to P3-01.

### Tests

```bash
cd writeit-v2
npm run test
npm run test:browser
npm run typecheck
npm run build
```

Also execute the manual user acceptance checklist above on a real Chromium browser.

### Acceptance criteria

- Every P2A-R01 through P2A-R06 acceptance criterion has linked evidence.
- No known HIGH P2A finding remains open.
- User-facing acceptance is PASS.
- STATUS truthfully points to P3-01 only after PASS.

### Completion evidence — P2A-AR1

- **Gate result: PASS.** P2A-R01 through P2A-R06 completion evidence is recorded above; no HIGH P2A finding remains open and the P3 HOLD is lifted.
- Interactive Chromium smoke covered 24-item slash/completion menus at top, middle, lower, and right editor boundaries, wraparound visibility, slash group navigation, all three reference insertion modes, IME composition dismissal/reopen, readonly/destroy races, and Raw Source/Live Preview continuity. The permanent browser suite covers the remaining line-ending and lifecycle assertions.
- `npm run test`: PASS — architecture boundary check, 24 test files, 145 tests.
- `npm run test:browser`: PASS — 19 Chromium tests.
- `npm run typecheck`: PASS.
- `npm run build`: PASS — Vite production build completed; only the existing non-blocking chunk-size warning remains.
- Demo label and `README.md` now identify the accepted P2A gate. The next permitted task is P3-01.

### Out of scope

- Implementing P3 capabilities.
- Real P4 workspace reference provider.
- Expanding Template/Mermaid business features.
