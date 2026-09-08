# P5-00 Table UX & Behavior Contract

- **Status:** Accepted
- **Accepted on:** 2026-09-09
- **Scope:** P5-01～P5-05 implementation and P5-AR1 review
- **Authority:** [UX_SPEC.md](./UX_SPEC.md), [ADR-0005](./adr/ADR-0005-markdown-table-core-and-cm6-widget.md), [DECISIONS.md](./DECISIONS.md)

## 1. Persistent contract and parsing boundary

WriteIt recognizes a conservative pipe-table dialect:

- a header row followed immediately by an alignment separator row;
- one or more columns, with optional outer pipes;
- `:---`, `:---:`, `---:` and `---` alignment cells;
- escaped pipes and pipes inside backtick code spans do not split a cell;
- physical newlines end a row; a logical newline inside a cell is persisted as visible `<br>` or `<br />` source and canonicalized to `<br>` after an intentional edit.

An untouched recognized table is byte-for-byte stable. An intentional table operation may canonicalize only that table region. Text outside the replaced source range is never rewritten.

Incomplete, ambiguous, or unsafe input remains ordinary Markdown source. In particular, a missing/invalid separator, an unterminated code span, inconsistent row width, or a row containing unsupported block structure does not become a widget. WriteIt must not repair, truncate, or consume it. When the source becomes valid again, Live Preview may project it as a table.

Raw Source always exposes the exact authoritative Markdown. Switching Raw Source ↔ Live Preview does not mutate source, create history, or move authority out of `DocumentStore`.

## 2. `<br>` compatibility decision

P5 adopts `<br>` as the persistent cell-newline representation.

Evidence:

1. The accepted CM6 spike serializes logical cell newlines as `<br>` and preserves the table as one physical Markdown row (`experiments/cm6-spike/src/table/core.ts`).
2. The legacy clipboard path emits `<br>` for HTML and TSV multiline cells (`editor-app/src/editor/table/clipboard.ts`).
3. The legacy Milkdown document parser required a private `<nbr />` workaround because that parser stripped `<br>` inside tables (`editor-app/src/editor/table/schema.ts`, `editor-app/tests/e2e/table-enhance-e2e.js`). This is an adapter limitation, not a portable Markdown contract.
4. P5 owns its parser and widget. It will decode `<br>`, `<br/>`, and `<br />` case-insensitively into logical `\n`, render a real line break, and serialize edited content as `<br>`.

Legacy `<nbr>` is accepted as plain inline source, not silently reinterpreted. Migration, if ever required, must be an explicit command because opening a document cannot change its bytes.

## 3. Cell states and keyboard behavior

Every active cell is in exactly one interaction state:

| State | Entry | Visual/caret | Typing | Enter | Tab / Shift+Tab | Escape |
|---|---|---|---|---|---|---|
| Selected | single click, arrow navigation, committed edit | selected cell/region; no text caret | replaces the active cell, then enters Editing | same column in next data row; at the last data row, append a row and move into it | next/previous cell in row-major order; forward from the final cell appends a row | clears table selection and returns focus to source |
| Editing | double click, printable input on Selected, explicit edit action | active-cell outline and text caret | edits at the caret | inserts logical `\n`, persisted as `<br>` | commits, then moves next/previous; never moves during IME composition | commits and returns to Selected |

Arrow keys move between cells only in Selected. In Editing they move the text caret. Header cells participate in horizontal navigation and editing; vertical movement from a header enters the first data row. Destructive operations never delete the only column or the header plus sole data row.

## 4. Selection model

- Single click creates a one-cell selection and establishes its anchor.
- Shift-click and Shift+Arrow extend from the anchor to a rectangular head.
- Pointer drag selects the rectangle from the pressed anchor to the hovered cell.
- Clicking a row grip selects the entire row; Shift-click extends to a contiguous row range.
- Clicking a column grip selects the entire column; Shift-click extends to a contiguous column range.
- The normalized rectangle is the unit for copy, cut, clear, and paste anchoring. Discontiguous selection is out of scope.
- A uniform selection background, distinct active-cell outline, and `aria-selected`/grid coordinates expose the same state visually and accessibly.

## 5. Clipboard and IME

Copy and cut publish both:

- `text/plain`: RFC-4180-style TSV fields with quotes for tabs, quotes, and logical newlines;
- `text/html`: a minimal escaped `<table>` whose logical newlines are `<br>`.

Paste prefers a usable HTML table, then falls back to quoted TSV/plain text. HTML parsing keeps only row/cell text and `<br>` newlines; scripts, styles, formulas, merged-cell metadata, and arbitrary attributes are discarded. A matrix pastes from the selection's top-left cell and grows rows/columns as needed. A 1×1 value replaces the selected rectangle; a larger matrix is not repeated to fit a differently sized selection.

Excel, Numbers, Google Sheets, WPS, and LibreOffice are compatibility targets. Automated coverage guarantees deterministic TSV/HTML and multiline behavior; existing WPS evidence is retained. Applications unavailable in the test environment are recorded under approved deferral PD-004 rather than guessed.

Composition events own text until `compositionend`. Enter, Tab, arrows, clipboard shortcuts, selection replacement, and structural commands must not commit, navigate, or reorder while composition is active.

## 6. Structural entry points

Controls are contextual rather than a permanent toolbar:

- hover/focus reveals compact row grips on the left and column grips above;
- the active grip menu provides insert before/after, delete, and move commands;
- a lightweight trailing `+` adds a row or column;
- the command registry exposes the same add/delete/move actions for `/` commands and configurable shortcuts;
- context menu actions target the active cell or normalized row/column selection.

Each structural command is one Table Core operation and one `DocumentStore` history entry.

## 7. Resize and reorder

- A column boundary drag changes only projection/workspace runtime width state. It never changes Markdown and is reset after application restart.
- Widths have a readable minimum and may make the table horizontally scrollable; columns are not forced into unreadable equal widths.
- Row and column grip drags show a clear insertion marker. Dropping applies a Table Core reorder to Markdown through the normal source-change path and is undoable/redoable.
- A no-op drop, cancelled drag, or resize does not create a source revision.
- Reorder preserves cell values and column alignment metadata; moving a column moves its alignment with it. The header row is fixed as the header and is not reorderable among data rows.

## 8. P5 acceptance mapping

- **P5-01:** conservative parser, byte-stable untouched round trip, `<br>` codec, canonical local serialization, TSV/HTML codec, malformed fallback.
- **P5-02:** immutable selection and table operations, source-range changes, add/delete/move/paste/clear, undo/redo through `DocumentStore`.
- **P5-03:** CM6 widget projection, Raw/Live continuity, Selected/Editing states, contextual grips, runtime width state and graceful fallback.
- **P5-04:** rectangle/row/column selection, clipboard MIME behavior, keyboard rules, composition guards, multiline fixtures.
- **P5-05:** command registry integration, add/delete/reorder/resize controls, source-fidelity and advanced browser journeys.
- **P5-AR1:** review this contract against unit, integration, browser, malformed-source, Raw/Live, and renderer-failure evidence.

