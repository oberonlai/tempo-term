# Git Panel Batch 1 Design (issues #93 / #94, first slice)

Status: approved in conversation on 2026-07-02 (owner: mukiwu)
Scope source: issue #93 items 2–3, issue #94 items 1 and 6, plus an owner-requested side-by-side diff tab that supersedes the issue's "jump to Git Graph" idea for viewing uncommitted changes.

## Goal

Make the source-control sidebar actionable (context menu, discard, diff viewing) and fix two Git Graph interaction papercuts. Batches 2–3 (Working copy node, cross-panel navigation, branch/worktree switching, tree view) are out of scope and tracked separately.

## Decisions already made by the owner

- Context menu on file rows modeled on VS Code's source-control menu, localized wording:
  暫存 / 取消暫存、捨棄變更、開啟檔案、在新分頁開啟、在 Finder 顯示、複製路徑、複製相對路徑、顯示 diff.
- "顯示 diff" opens a **new tab with a side-by-side comparison** — explicitly NOT wired to Git Graph.
- Left-click on a file row opens that diff tab (VS Code behavior). Re-clicking the same file focuses the existing tab.
- 捨棄變更 (discard) applies to **tracked files only**, restores the file to HEAD, and always confirms first. Untracked files get no discard action in this batch.
- Discard appears only in the 變更 (unstaged) section, matching VS Code where the staged section offers only Unstage.

## Components

### 1. Diff tab (new pane kind)

- `PaneContent` gains `{ kind: "diff"; path: string; staged: boolean }` (`src/modules/terminal/lib/terminalLayout.ts`). `singleLeafContentEquals` compares `path` + `staged`.
- New `openDiffTab(path, staged)` in `tabsStore` following the `openGitGraphTab` focus-existing-or-create pattern. Tab title: file basename; icon: `GitCompare` (lucide).
- Viewer: `@codemirror/merge` `MergeView` (new dependency, same CodeMirror 6 stack as the editor), read-only both sides, reusing the editor's existing language/highlight configuration by file extension and the app theme.
- Comparison semantics (VS Code parity):
  - Row from 變更 (unstaged) section → left = index version (`git show :<path>`), right = working-tree file from disk.
  - Row from 暫存 (staged) section → left = HEAD version (`git show HEAD:<path>`), right = index version.
  - Untracked file → left = empty document, right = disk content (renders as all-added).
- The diff tab loads content on mount and re-reads when the tab regains focus; no live file watching in this batch.
- Deleted files: left = prior version, right = empty document.

### 2. Backend commands (Rust, `src-tauri/src/modules/git/mod.rs`)

- `git_file_at_rev(repo_path, rev, path) -> String`: wraps `git show <rev>:<path>` with `rev` limited to the literal values `HEAD` or `:` (reject anything else — the frontend only ever needs these two), `ensure_not_flag(path)`, and path passed after `--` where applicable. Missing-at-rev (new file) returns empty string rather than an error.
- `git_restore_file(repo_path, path) -> ()`: wraps `git restore -- <path>`. Tracked-unstaged only by contract; the frontend never calls it for untracked or staged rows.
- Both registered in `lib.rs`, both with unit tests beside the existing ones (temp repo fixtures already exist in the test module).
- Frontend bridge functions `gitFileAtRev`, `gitRestoreFile` added to `src/modules/source-control/lib/gitBridge.ts`.

### 3. Source-control panel interactions (`SourceControlView.tsx`)

- **File row context menu** via the shared `ContextMenu` component (same usage pattern as `FileTree.tsx`), items grouped:
  - group 0: 開啟檔案 (`openFromSidebar` editor), 在新分頁開啟 (`openInNewTab` editor), 顯示 diff (`openDiffTab`)
  - group 1: 暫存 or 取消暫存 (section-dependent)
  - group 2: 複製路徑, 複製相對路徑 (absolute = repo root + path)
  - group 3 (danger): 捨棄變更 — unstaged tracked rows only
  - 在 Finder 顯示 (`fsReveal`) sits in group 2 with the copy actions.
- **Row hover action**: the 變更 section gains a discard icon button (lucide `Undo2`) next to the existing `+`, per the issue's request to mirror the stage buttons. Staged section keeps `−` only.
- **Left-click on a file row** → `openDiffTab(path, stagedSection)`.
- **Discard confirmation**: existing `ConfirmDialog`, danger-styled confirm, message naming the file and stating the change cannot be undone.
- **Commit row context menu** (近期提交): 複製 hash, 複製提交訊息 — copy-only in this batch; "view in Git Graph" arrives with batch 2. `git_log` already returns the short hash and the summary line; message copy copies the summary (the one-line subject), which is all the sidebar has.
- **Suppress the system context menu** on the panel container (`onContextMenu` preventDefault at the panel root) so right-clicks that miss a row don't show the WebView menu.

### 4. Git Graph papercuts

- **Full-row click** (`GitGraph.tsx`): commit rows currently start at `left-[100px]`, leaving the node-lane gutter inert. Extend each row's hit area to the full width (row at `left-0` with `pl-[100px]`; hover background spans the lane area — visually verify the SVG lanes remain legible under the hover tint, `z`-order keeps node buttons clickable above the row).
- **Compact "⋯" menu** (`GitGraphToolbar.tsx`): investigation shows the overflow menu already contains refresh / fetch / remote toggle / tags / stashes / order. Task is to reproduce the issue's screenshot state, identify any genuinely unreachable action in compact mode (branch filter while searching is one suspect), fix the gap if real, otherwise document the finding on the issue.

## Error handling

- Backend command failures (e.g. file deleted between status refresh and action) surface via the existing error surfacing used by stage/unstage — refresh status afterwards so stale rows disappear.
- `git_restore_file` refreshes the status list on success; the diff tab for that file, if open, shows the restored (now unchanged) content on next focus.

## Testing

- Rust: unit tests for `git_file_at_rev` (HEAD version, index version, new file empty, flag-smuggling rejected) and `git_restore_file` (modified file restored, exercised in a temp repo).
- Frontend (vitest + RTL): context-menu items render per section (staged vs unstaged vs untracked), discard flows through ConfirmDialog before calling the bridge, left-click calls `openDiffTab`, `openDiffTab` dedups on same path+staged, Git Graph row click registers in the former gutter area.
- MergeView rendering is verified manually in the running app (jsdom cannot measure CodeMirror layout).

## Out of scope (explicitly)

- Open File (HEAD), Reveal in Explorer View (no file-locating mechanism in the explorer yet)
- Working copy node in Git Graph, cross-panel jump, branch/worktree switching, tree view of changed files (batches 2–3)
- Discard for untracked files (delete semantics deferred)
- Live-updating diff tab contents while files change on disk
