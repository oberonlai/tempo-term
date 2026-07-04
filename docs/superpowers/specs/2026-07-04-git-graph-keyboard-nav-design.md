# Git Graph: Keyboard Commit Navigation + Two-Commit Compare Design (issue #100)

Status: approved in conversation on 2026-07-04 (owner: mukiwu)
Scope source: issue #100, all three items in one PR. Related but out of scope: #94 (closed, background context only).

## Goal

Add keyboard navigation to the Git Graph commit list — plain Up/Down between adjacent rows, and Shift+Up/Down that follows the commit's branch line (first-parent chain) instead of the raw row order — plus Shift+click to diff two arbitrary commits against each other.

## Decisions already made by the owner

- **One PR, not phased.** The three items are tightly related (all live in the same keyboard-interaction surface); splitting would leave intermediate states nobody wants shipped alone.
- **Shift+Up/Down semantics = first-parent chain**, confirmed against a diagram of a merge (main branch M merging in a feature branch via D→C→B): Shift+Down from a merge commit always goes to `parents[0]` (main line), never a branch-picker. Shift+Up from a commit finds the one child that continues its exact lane (the straight line in the graph), not a child that merged it in as a side branch. Verified against `computeGraphLayout`'s lane-assignment invariant (below) — this is exact, not a heuristic, in every case except an extremely rare simultaneous-fork tie-break that we're not special-casing.
- **No wraparound at list boundaries** for plain Up/Down (commit history is chronological, not a short filtered list like `FileFinder`'s Cmd+P palette — cycling top-to-bottom isn't intuitive here).
- **Keyboard nav activates per-row on click**, roving-tabindex style like `LauncherPanel`, independent of the toolbar search input's own focus.
- **Compare mode reuses `CommitDetailsPanel`** (header shows two hashes instead of one) rather than a new tab/panel.
- **Exiting compare mode is implicit**: click any commit without Shift → back to single-select. No dedicated "leave compare" control.
- **Any arrow key press while in compare mode exits it** and falls back to single-select navigation, to avoid designing arrow-key semantics on top of a two-commit state.
- **AI "explain this diff" tab is hidden in compare mode** — out of scope, avoids complicating the per-commit AI explain flow.

## Current state (verified in code)

- `GitGraphTabContent.tsx:68` (`GitGraphTabContent`) owns `selected: CommitNode | null` (line 79, plain `useState`, no store) and passes `selectedCommit`/`onSelectCommit` to `GitGraph` (lines 585-586); the details panel mounts at lines 596-614 when `selected && repo`.
- `GitGraph.tsx:45` (`GitGraph`) renders SVG lane lines plus one `<div>` row per commit; both the SVG node button (line 154) and the row `<div>`'s `onClick` (line 207) call `onSelectCommit(commit)` — the whole row is already clickable (from #94 item 1). No `onKeyDown`, `tabIndex`, or focus handling exists anywhere in this module today.
- `graphLayout.ts:75` (`computeGraphLayout`) assigns each commit a `lane` (`CommitLayout.lane`, line 34) by an invariant that matters directly for Shift+Up/Down: when a commit is processed, `activeLanes[lane] = commit.parents[0]` (line 116) — **the commit's own lane is always inherited by its first parent**. Extra (merge-in) parents claim a fresh lane (line 117-119, `claimLane()`). `edges` (line 146-174) records every parent link with `cx`/`px` (child/parent x-coordinates); an edge is visually straight iff `cx === px`, which holds exactly when `child.lane === parent.lane` — i.e., exactly the first-parent, same-lane relationship. This means: (a) "Shift+Down" = look up `parents[0]` directly; (b) "Shift+Up" = find the one edge with `parentIndex === current index && cx === px`, take its `childIndex`. No such lookup exists yet — it needs two new pure functions.
- `GitGraphTabContent.tsx:243-297` already implements "keep paging until a target hash appears, then select it": `usePendingGraphSelectionStore` (`lib/pendingGraphSelectionStore.ts`, whole file) carries a hash from elsewhere in the app (sidebar history) into this effect, which retries `loadMore()` (defined at line 228) up to 5 times as `commits` grows, then calls `setSelected` once the hash is found. **This is directly reusable** for Shift+Up/Down's pagination-boundary case (owner decision: auto-load-more) — no new paging logic needed, just `usePendingGraphSelectionStore.getState().request(targetHash)` from the keyboard handler when the target isn't in the currently loaded `commits`.
- `types.ts:9-16` `CommitNode { hash, parents, author, date, message, refs }`; `types.ts:48-51` `CommitFileChange { status, path }`; `types.ts:54-57` `CommitDetails { message, files: CommitFileChange[] }` — the compare-mode file list reuses `CommitFileChange`, not a new type.
- `CommitDetailsPanel.tsx:152` (`CommitDetailsPanel`) fetches `gitCommitDetails`/`gitCommitFileDiff` keyed on `commit.hash` (effects at lines 185-236), renders a resizable two-column layout: left = metadata + changed-files list (flat/tree toggle, `filesViewMode` line 159), right = Diff/AI tabs (`DiffView` / `DiffExplain`). This entire right column and the flat/tree file list are reusable as-is for compare mode; only the data-fetching effect and the header (lines 255-269, currently `commit.hash` + close button) change.
- Backend `commit_file_diff` (`src-tauri/src/modules/git/mod.rs:1010-1022`) runs `git diff <commit>^1 <commit> -- <file>`; `commit_details` (lines 979-1008) runs `git diff --name-status <commit>^1 <commit>` for the file list. Both are hardcoded to "commit vs. its first parent" — no existing backend command diffs two arbitrary commits. The generalization is mechanical: replace `<commit>^1 <commit>` with `<from> <to>`.
- Keyboard-handling pattern to mirror: `FileFinder.tsx:126-143` (`handleKeyDown`) — `ArrowUp`/`ArrowDown` adjust an index, `e.preventDefault()`, guards IME composition; active row auto-scrolls via a ref + effect (`FileFinder.tsx:104-114`, `scrollIntoView({ block: "nearest" })`). Focus pattern to mirror: `LauncherPanel.tsx:280-284` (`<div ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>`) plus an effect (lines 255-259) calling `rootRef.current?.focus()`.
- Rust test convention: `src-tauri/src/modules/git/mod.rs:1163` `mod tests`, e.g. `worktree_info_reports_branch_for_a_plain_repo` (line 1167) — builds a real temp git repo via `temp_repo_dir(name)` + `run_git(path, &[...])`, asserts, then `std::fs::remove_dir_all`. New backend tests follow this exactly.

## Components

### 1. `graphLayout.ts`: two new pure helpers

```ts
/** Row index of `commits[index]`'s first parent, or null if it has none or
 *  isn't in the currently loaded `commits` (caller pages in more history). */
export function firstParentRowIndex(
  commits: readonly GraphLayoutCommit[],
  index: number,
): number | null;

/** Row index of the one commit that continues `commits[index]`'s exact lane
 *  going up (newer) — the straight-line child, not a merge-in child. Null if
 *  `commits[index]` is the newest commit on its lane. */
export function laneContinuationRowIndex(
  edges: readonly GraphEdge[],
  index: number,
): number | null;
```

`firstParentRowIndex` reads `commits[index].parents[0]` and finds its row by hash (reuse `resolveParent`'s prefix-matching rule since short/long hash mixes are already a real case in this codebase). `laneContinuationRowIndex` scans `layout.edges` for the one entry with `parentIndex === index && cx === px`.

Unit tests in `graphLayout.test.ts` alongside the existing lane-assignment tests: a straight chain, a merge (Shift+Down from the merge commit lands on the first parent, not the merged-in one), and a branch tip (Shift+Up from the newest commit on a lane returns null).

### 2. `GitGraph.tsx`: keyboard handling

- The row list's scroll container (`scrollRef`, line 100) gains `tabIndex={-1}` and `onKeyDown`.
- `onSelectCommit` already exists as the single source of truth for "commit becomes selected" (used by both click handlers today); the keyboard handler computes a target row and calls the same callback plus `.focus()`s the container on click so keyboard nav "activates" per the owner's decision.
- Plain `ArrowUp`/`ArrowDown`: move to the adjacent row in `commits` (index ± 1), clamped at the array bounds (no wraparound).
- `Shift+ArrowDown`: `firstParentRowIndex(commits, selectedIndex)`. If it resolves inside the loaded `commits`, select that row directly. If it's null because the parent isn't loaded yet, call `usePendingGraphSelectionStore.getState().request(parentHash)` — the existing effect in `GitGraphTabContent` (lines 243-297) takes it from there (pages in more history, selects once found). If the commit has no parent at all (root commit), no-op.
- `Shift+ArrowUp`: `laneContinuationRowIndex(edges, selectedIndex)` (the `edges` already destructured from `computeGraphLayout(commits)` at `GitGraph.tsx:75`). Null means this is the newest commit on its lane — no-op (this direction never needs pagination since "newer" is always already loaded).
- All four handlers call `e.preventDefault()` and scroll the resulting row into view (reuse the `scrollIntoView({ block: "nearest" })` pattern from `FileFinder.tsx`).
- Any of the four handlers, when a compare-mode selection is active (see below), first collapses back to single-select on the row the navigation lands on.

### 3. `GitGraphTabContent.tsx`: compare-mode state

- Selection state becomes a small discriminated union instead of the plain `CommitNode | null`:
  ```ts
  type GraphSelection =
    | { mode: "single"; commit: CommitNode }
    | { mode: "compare"; from: CommitNode; to: CommitNode }
    | null;
  ```
  (`from` is always the chronologically older of the two, `to` the newer — decided by comparing their indices in `commits`, since the list is already ordered newest-first; no extra git call needed.)
- `GitGraph`'s row click handler: plain click → `{ mode: "single", commit }`. Shift+click while a selection already exists → `{ mode: "compare", from, to }` using the existing selected commit as the other endpoint. Shift+click with nothing currently selected behaves like a plain click (standard shift-click convention — you need an anchor first).
- The details panel branches on `selection.mode`: `mode: "single"` renders `CommitDetailsPanel` unchanged; `mode: "compare"` renders it in the new compare mode (next section).

### 4. `CommitDetailsPanel.tsx`: compare mode

- Props grow to accept either a single `commit` or a `{ from, to }` pair (a union prop, mirroring the store's `GraphSelection`) so this stays one component rather than a fork.
- Header (currently just `commit.hash` + close, lines 255-269): compare mode shows `{from.hash} .. {to.hash}`.
- The data-fetch effect (lines 185-208, currently `gitCommitDetails(repo, commit.hash)`) branches: single mode unchanged; compare mode calls the new `gitCommitRangeFiles(repo, from.hash, to.hash)` for the file list, and skips the message paragraph (a range has no single commit message — the metadata row above the file list is simply omitted in compare mode).
- The per-file diff effect (lines 212-236, currently `gitCommitFileDiff`) branches to `gitCommitRangeFileDiff(repo, from.hash, to.hash, selectedFile)` in compare mode. `DiffView` and the flat/tree file list are unchanged — both already operate on `CommitFileChange[]` / `DiffLine[]`, agnostic to how the diff was produced.
- The AI tab button (lines 379-389) is not rendered in compare mode (owner decision).

### 5. Backend: two new commands mirroring the existing per-commit ones

In `src-tauri/src/modules/git/mod.rs`, next to `commit_details`/`commit_file_diff`:

```rust
pub fn commit_range_files(repo_path: &str, from: &str, to: &str) -> Result<Vec<ChangedFile>, String>;
// `git diff --name-status <from> <to>` — same parsing as commit_details's file-list half.
// command wrapper: git_commit_range_files(repo_path, from, to)

pub fn commit_range_file_diff(repo_path: &str, from: &str, to: &str, file: &str) -> Result<String, String>;
// `git diff <from> <to> -- <file>` — same shape as commit_file_diff, no ^1 / root-commit fallback needed
// since both endpoints are always real, already-loaded commits.
// command wrapper: git_commit_range_file_diff(repo_path, from, to, file)
```

`ChangedFile` reuses whatever struct `commit_details` already serializes to the frontend's `CommitFileChange` (same `{status, path}` shape) — no new backend type.

### 6. Frontend bridge

`lib/gitGraphBridge.ts` gets `gitCommitRangeFiles(repo, from, to)` and `gitCommitRangeFileDiff(repo, from, to, file)`, following the exact `invoke(...)` wrapper shape already used by `gitCommitDetails`/`gitCommitFileDiff` (lines 116-122 for the latter).

## Error handling

- `firstParentRowIndex`/`laneContinuationRowIndex` return `null` for "nothing to move to" — callers no-op rather than throwing; this covers root commits, lane tips, and (rare) unresolvable hashes the same way.
- Shift+Down pagination retry reuses `usePendingGraphSelectionStore`'s existing 5-attempt budget (`GitGraphTabContent.tsx:283`) and silent give-up — if the parent truly can't be found (shallow clone, corrupted history), navigation just stays put after 5 failed page-ins, same as the existing "jump from sidebar" feature degrades today.
- `git_commit_range_files`/`git_commit_range_file_diff` failures (e.g. one hash no longer resolves) surface through the same `error` state and `role="alert"` banner `CommitDetailsPanel` already renders (line 271) for the single-commit path.

## Testing

- `graphLayout.test.ts`: unit tests for `firstParentRowIndex` and `laneContinuationRowIndex` — straight chain, merge commit, branch tip, and a not-yet-loaded parent (hash absent from the array).
- `GitGraph.test.tsx`: `fireEvent.keyDown(container, { key: "ArrowDown" })` / `"ArrowUp"` move selection between adjacent rows and clamp at the ends (pattern from `FileFinder.test.tsx`); `fireEvent.keyDown(container, { key: "ArrowDown", shiftKey: true })` selects the first-parent row directly when loaded, and calls `usePendingGraphSelectionStore.getState().request` when not; `fireEvent.click(row, { shiftKey: true })` after an initial plain click produces a compare selection; a bare click afterward collapses back to single-select.
- `CommitDetailsPanel.test.tsx`: compare-mode props render the two-hash header, call `gitCommitRangeFiles`/`gitCommitRangeFileDiff` instead of the single-commit bridge functions, and hide the AI tab.
- Rust `mod.rs` tests: `commit_range_files` and `commit_range_file_diff` against a temp repo with at least two branches and a merge (reuse the `temp_repo_dir` + `run_git` helpers already used by the worktree tests at line 1167 onward) — verifying `git diff --name-status`/`git diff -- file` between two arbitrary hashes, not just parent-child pairs.

## Out of scope (explicitly)

- Any "pick which branch to follow" UI at a merge/fork commit — Shift+Down is always first-parent, unconditionally.
- Wraparound navigation.
- A dedicated "exit compare mode" button.
- AI diff explanation for a two-commit compare.
- Handling the rare simultaneous-fork tie-break case in `laneContinuationRowIndex` where two children could both claim the same parent's lane — accepted as a known, exceedingly unlikely edge case per the approved design.
