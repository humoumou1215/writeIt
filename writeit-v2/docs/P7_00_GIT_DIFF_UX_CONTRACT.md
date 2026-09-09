# P7-00 Git / Diff / Blame UX & Port Contract

- **Status:** Accepted
- **Accepted on:** 2026-09-09
- **Scope:** P7-01～P7-06 and P7-AR1
- **Authority:** [UX_SPEC.md](./UX_SPEC.md), [ADR-0006](./adr/ADR-0006-diff-guarantee-on-markdown-source.md)

## User entry and navigation

- The left Workspace `Git` tool is the visible entry point. It keeps the active editor mounted while showing repository, branch, worktree changed files and history.
- A changed file opens a comparison target: `Worktree ↔ HEAD`, a selected commit, or a two-commit range. The selected target is explicit in the toolbar.
- File History lists commit id, author, timestamp and summary; selecting an item opens its file snapshot/diff. Blame is a projection toggle in the editor and never edits Markdown.

## Diff layout

- Unified is the default; Split is a session-only view toggle. Both render the same source-level raw changes.
- Every raw line/hunk is represented before optional Table/Mermaid/Embed semantic enhancement. Hunk navigation reports current/total and can fold context.
- If semantic parsing or rich rendering fails, the raw source diff remains visible with a degraded diagnostic.

## Destructive actions

- File and hunk discard are explicit confirmation actions. Only a worktree-editable target can be discarded.
- Dirty/open Documents require a save/discard conflict choice; failed filesystem or Git operations leave the Store, file system and UI unchanged or visibly failed.

## Machine-readable ports

`GitRepositoryPort` owns repository/branch/worktree/history/content/diff operations and returns structured values; UI never parses CLI text. `GitBlamePort` returns source-line provenance and file history records. Ports expose `isGitRepository`, stable ids, paths, status, and typed errors for non-Git and command failures.

## Blame semantics

- Provenance attaches to Markdown source lines/ranges. Uncommitted or newly added lines are `Local changes`; uncertain mapping is `Unknown`, never a neighboring commit.
- A blame row includes commit id, author name/email, author time, summary, and original path/line when available. Click/hover opens commit detail/diff.
- Blame/history caches invalidate on HEAD, path or options changes. Closing blame changes only projection/UI state.
