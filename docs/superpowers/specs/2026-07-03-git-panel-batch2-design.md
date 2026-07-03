# Git Panel Batch 2 Design (issues #93 / #94, second slice)

Status: approved in conversation on 2026-07-03 (owner: mukiwu)
Scope source: issue #93 item 1 (commit half only) and issue #94 item 2, re-scoped after batch 1 (PR #116) shipped an independent diff tab that already satisfies the "view uncommitted changes" need.

## Goal

Two independent improvements: (1) clicking a commit in the sidebar's 近期提交 list jumps to the Git Graph tab with that commit selected, and (2) both the sidebar's changed-files list and the Git Graph commit-details panel gain a true nested folder tree (not the current flat grouping-by-immediate-parent) with recursive folder actions.

## Decisions already made by the owner

- **Working copy node (#94 item 3) is dropped**, not deferred — the independent diff tab from batch 1 already covers per-file uncommitted-diff viewing, so the node's original job is gone and the owner does not want it as a bare visual indicator either.
- **Batch 3 candidates, not in this batch**: #94 item 4 (worktree switching — no backend support to list all worktrees yet) and #94 item 5 (branch checkout entry point in the toolbar — needs a UI-placement decision to avoid confusing the existing filter dropdown).
- **Shared tree engine, not shared UI**: one data/logic module (`src/lib/fileTree.ts`) used by both surfaces; each surface keeps its own row rendering because the sidebar's rows (stage/discard buttons, context menu) and Git Graph's rows (read-only, click-to-diff) are too different to share a single component profitably.
- **Tree default state: fully expanded** on open, in both surfaces.
- **Recursive folder actions**: clicking a folder's stage/unstage button in the sidebar applies to every file in that entire subtree (all descendant levels, not just direct children) — matching VS Code's Source Control tree. Folder-level discard is explicitly out of scope for this batch (too destructive to batch under one click without a per-file confirmation list; revisit later if requested).
- **Git Graph's tree is read-only**: folders only expand/collapse; no per-folder action buttons.
- **Commit jump trigger**: left-click on a 近期提交 row (currently dead) opens/focuses the Git Graph tab and selects that commit. A context-menu item ("在 Git Graph 中查看") does the same as a secondary entry point.

## Components

### 1. Shared tree engine — `src/lib/fileTree.ts` (new)

Pure data functions, no rendering, no framework imports beyond types:

```ts
export interface TreeFolderNode<T> {
  kind: "folder";
  name: string;
  /** Full path from the list root, e.g. "dist/aaa". */
  path: string;
  children: TreeNode<T>[];
}

export interface TreeFileNode<T> {
  kind: "file";
  name: string;
  path: string;
  file: T;
}

export type TreeNode<T> = TreeFolderNode<T> | TreeFileNode<T>;

/** Builds a true nested tree from a flat list of paths — unlike the existing
 * groupByFolder, a path's ancestors all become real parent nodes instead of
 * each distinct directory becoming its own top-level group. */
export function buildFileTree<T extends { path: string }>(files: T[]): TreeNode<T>[];

/** Every file under a folder node, recursing through all descendant folders —
 * the basis for "act on this whole subtree" folder actions. */
export function collectDescendantFiles<T>(folder: TreeFolderNode<T>): T[];
```

Sorting: folders before files at each level, alphabetical within each group (mirrors the existing `groupByFolder` root-last convention is dropped — with true nesting there is no more "root files after named folders" special case: root-level files and folders just sort together by the same folders-first-then-alphabetical rule at the top level).

Untracked directories reported by git as a single path ending in `/` are normalized the same way `groupByFolder` already does (strip the trailing slash before splitting), preserved as a behavior, not reimplemented differently.

Collapse state is NOT part of this module — each consumer owns a `Set<string>` of collapsed folder paths via local `useState`, since the two surfaces have no shared collapse UI to synchronize.

### 2. Sidebar tree (`SourceControlView.tsx`, `FileList`/`StatusRow`)

- `FileList`'s `viewMode === "folder"` branch now calls `buildFileTree(files)` and renders it recursively instead of `groupByFolder`'s flat grouping. `groupByFolder.ts` and its test are deleted (the config's remaining reference in `SourceControlView.tsx` moves to the new tree renderer).
- New recursive `TreeNode` renderer (a component, e.g. `FileTreeNode`, inside `SourceControlView.tsx` or a co-located file) — folders render a header row (chevron + folder icon + name + stage/unstage icon acting on `collectDescendantFiles`), files render the existing `StatusRow`.
- Collapse state: `const [collapsed, setCollapsed] = useState<Set<string>>(new Set())` in `SourceControlView`, passed down; toggling a folder adds/removes its path. Starts empty (= all expanded).
- The folder action button's aria-label/tooltip clarifies it acts on the whole subtree (e.g. "暫存資料夾（含子資料夾）") so the recursive scope isn't a silent surprise.
- `collectDescendantFiles` reads from the tree data structure, not the rendered DOM — a folder action affects every descendant file regardless of whether nested subfolders are currently collapsed or expanded.
- "扁平檢視" (`viewMode === "flat"`) is unchanged.

### 3. Git Graph tree (`CommitDetailsPanel.tsx`)

- New flat/tree toggle button in the panel header (mirrors the sidebar's `viewFolder`/`viewFlat` button — same icon pair, `FolderTree`/`List`), local `viewMode` state, default `"flat"` (preserves current behavior until the owner opts in; the *tree itself* defaults expanded once toggled on, per the owner's decision above — the toggle's own default is a separate, uncontroversial choice to avoid changing the panel's out-of-the-box look).
- Tree mode calls `buildFileTree(details.files)` (`CommitFileChange[]`, which only has `path`+`status` — the generic constraint `T extends { path: string }` accepts it with no changes needed).
- Folder rows: chevron + folder icon + name only, no action buttons. Clicking a file row keeps today's behavior (loads that file's diff via `gitCommitFileDiff`).
- The existing virtualized flat list (`useVirtualRows`) is flat-mode only; tree mode renders the (typically much smaller, since a single commit's file count is usually modest) node list directly without virtualization. If a commit ever has thousands of changed files this could be revisited, but it's not a batch-2 concern.

### 4. Commit jump (`93` item 1, commit half)

**New store** — `src/modules/git-graph/lib/pendingGraphSelectionStore.ts`:

```ts
import { create } from "zustand";

interface PendingGraphSelectionState {
  hash: string | null;
  request: (hash: string) => void;
  consume: () => string | null;
}

export const usePendingGraphSelectionStore = create<PendingGraphSelectionState>((set, get) => ({
  hash: null,
  request: (hash) => set({ hash }),
  consume: () => {
    const hash = get().hash;
    set({ hash: null });
    return hash;
  },
}));
```

- `SourceControlView.tsx`'s `HistoryRow`: left-click on the `<li>` calls `usePendingGraphSelectionStore.getState().request(commit.id)` then `useTabsStore.getState().openGitGraphTab()`. The context menu gains a `menuViewInGraph` item doing the same two calls.
- `GitGraphTabContent.tsx`: a `useEffect` (subscribed to the store's `hash` and to `commits`/`hasMore`) that, whenever a pending hash exists and `commits` changes:
  1. Searches loaded `commits` for a matching short-hash prefix (sidebar's `CommitInfo.id` and the graph's `CommitNode.hash` are both git's abbreviated hash from the same underlying commit, so exact string equality is expected in the common case; fall back to prefix match defensively since abbreviation lengths could in theory differ).
  2. If found: call `setSelected(commit)` and `consume()` the store (clearing the pending hash so it doesn't re-trigger).
  3. If not found and `hasMore` is true: call `loadMore()` (existing pagination) and leave the pending hash in place for the next `commits` update to retry.
  4. If not found and `hasMore` is false: `consume()` and give up silently — this only happens if the commit belongs to history outside the current branch/filter view, an edge case not worth surfacing an error for.
  5. A retry counter (module-local or component ref) caps this loop at 5 `loadMore` calls so a truly-missing hash can't spin forever.
- Since `openGitGraphTab()` already focuses an existing singleton tab (`singleLeafContentEquals` on `git-graph` returns true unconditionally), no `PaneContent` changes are needed — the store is the only new plumbing required to pass the target commit across the tab boundary.

i18n keys (en / zh-Hant), `sourceControl` namespace: `menuViewInGraph` "View in Git Graph" / "在 Git Graph 中查看"; `stageFolderRecursive`/`unstageFolderRecursive` tooltip text if distinct wording from the existing `stageFolder`/`unstageFolder` is wanted (default: reuse existing keys, append "（含子資料夾）" only if user testing shows the plain label is ambiguous — start with the existing keys unchanged to avoid unnecessary string churn, per YAGNI).

`gitGraph` namespace: no existing `viewFolder`/`viewFlat` keys in `gitGraph.json` (checked), so add them directly: `viewFolder` "Group by Folder" / "依資料夾分組", `viewFlat` "Flat View" / "扁平檢視" (matching `sourceControl.json`'s existing wording for the same concept).

## Error handling

- `buildFileTree`/`collectDescendantFiles` are pure and cannot fail (no I/O, no external calls) — no error handling needed there.
- Commit-jump's "not found" path (§4.4 above) is a deliberate silent no-op, not surfaced as an error, matching the low-stakes nature of the edge case.
- Folder-level stage/unstage reuses the existing per-file `gitStage`/`gitUnstage` bridge calls in a loop (same pattern already used by "全部暫存" and the current folder-group buttons) — no new error surface.

## Testing

- `src/lib/fileTree.test.ts`: multi-level nesting (`a/b/c/file.ts` produces three nested folder levels), root-level files and folders sorted together, `collectDescendantFiles` returns files from all depths including nested folders, untracked-directory trailing-slash normalization.
- Sidebar: folder stage button stages every descendant file (multi-level fixture), collapse/expand hides/shows a folder's subtree, existing flat-mode tests untouched.
- Git Graph details panel: flat/tree toggle renders the same files either way, tree collapse behavior, clicking a nested file still loads its diff.
- Commit jump: left-click opens the tab and selects the commit already in the loaded page; context-menu entry does the same; requesting a hash not yet loaded triggers `loadMore` and resolves once it arrives (mock `hasMore`/`loadMore`); a hash that's never found after `hasMore` goes false clears the pending state without throwing.

## Out of scope (explicitly)

- Working copy node in Git Graph (dropped, not deferred — see Decisions).
- Worktree switching, branch checkout toolbar entry point (#94 items 4–5 — batch 3 candidates, pending their own scoping conversation).
- Folder-level discard (only per-file discard exists, from batch 1).
- Virtualizing the Git Graph tree view for very large single-commit file counts.
