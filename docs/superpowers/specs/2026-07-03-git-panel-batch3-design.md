# Git Panel Batch 3 Design (issue #94, final slice)

Status: approved in conversation on 2026-07-03 (owner: mukiwu)
Scope source: issue #94 item 4 (worktree switching) and item 5 (branch checkout entry point). This batch resolves the last two open items of #94; together with batches 1 (PR #116) and 2 (PR #117) it closes #93 and #94 entirely.

## Goal

Two toolbar-level additions to the Git Graph tab: (1) a worktree selector that lists the repository's worktrees and switches the whole app's workspace root to the chosen one, and (2) a branch-switch menu behind the existing "HEAD: branch" display that actually checks out the chosen branch (the existing branch dropdown remains a pure display filter).

## Decisions already made by the owner

- **Worktree switching means switching the workspace root.** The issue author's stated goal was to see another worktree's staged files; since the sidebar's source-control panel follows the workspace root, switching the root delivers that with no parallel "peek at another repo" state system. Staging/discard semantics stay unambiguous: operations always act on the worktree you are in.
- **Both new controls live in the Git Graph toolbar** (the issue was filed against the Git Graph tab). The worktree selector sits next to the existing branch filter as a second labeled Combobox; the checkout entry reuses the "HEAD: branch" text, which becomes clickable.
- **Known concern, deliberately deferred to manual testing:** a worktree Combobox and a branch-filter Combobox side by side could be confusing (the very worry recorded against #94 item 5 in the batch 2 spec). Mitigation for now is the label text ("分支:" vs "Worktree:") plus the fact that the worktree control is hidden for single-worktree repos. Re-evaluate placement after using the built app; moving the selector is a cheap follow-up if it reads badly.
- **No confirmation dialog on worktree switch.** Switching the root is fully reversible (click back); terminals keep their own cwd and are unaffected. This matches the existing "open folder" behavior.
- **Checkout failure handling is git's own error surfaced through the existing error display** (same as the ref context menu's checkout today). No auto-stash.
- **Branch from `feat/git-panel-batch2`** (PR #117 is open but unmerged; this batch touches the same Git Graph files). Rebase onto master once #117 merges.

## Current state (verified in code)

- `GitGraphTabContent.tsx:67` subscribes to `useWorkspaceStore` `rootPath`; the effect at lines 132-157 re-resolves the repo and reloads the graph whenever the root changes. Worktree switching therefore needs no new linkage: `setRoot(path)` is the whole mechanism.
- Backend already has `git_branch_checkout` and `git_branch_checkout_track`; the Git Graph ref/commit context menus already check out via `runAction` (reload + error surface). The toolbar menu reuses all of it.
- Backend has `git_worktree_info` (single-path introspection for workspace cards) but nothing that lists all worktrees of a repo. That is the only new backend surface in this batch.
- The toolbar shows "HEAD: {currentBranch}" as plain text in roomy mode (GitGraphToolbar.tsx:354) and as a plain text row inside the "⋯" overflow menu in compact mode (GitGraphToolbar.tsx:257).

## Components

### 1. Backend: `git_worktree_list` (new command)

In `src-tauri/src/modules/git/mod.rs`, following the existing `run_git` + `spawn_blocking` + `#[tauri::command]` pattern:

```rust
#[derive(Serialize)]
pub struct WorktreeListItem {
    pub path: String,
    /// Short branch name, or None when the worktree is on a detached HEAD.
    pub branch: Option<String>,
}

pub fn worktree_list(repo_path: &str) -> Result<Vec<WorktreeListItem>, String>;
// command wrapper: git_worktree_list(path: String)
```

Parses `git worktree list --porcelain`: entries are blank-line-separated blocks of `worktree <path>`, `HEAD <sha>`, then `branch refs/heads/<name>` or `detached`. Strip the `refs/heads/` prefix for the branch field. `bare` blocks (a bare main repo) are skipped: they have no working tree to switch to. Pure git CLI, no platform-specific code (Windows-safe).

Which item is "current" is computed on the frontend by comparing each `path` against the repo path already resolved from the workspace root, so the backend stays a stateless list.

### 2. Worktree selector (Git Graph toolbar)

- New bridge fn `gitWorktreeList(repo)` in `src/modules/git-graph/lib/gitGraphBridge.ts`.
- `GitGraphTabContent` fetches the list whenever the resolved repo changes (same effect family as the branches fetch) and passes `worktrees`, `currentWorktreePath`, and `onSelectWorktree` down to `GitGraphToolbar`.
- Toolbar renders a second labeled Combobox ("Worktree:") next to the branch filter, only when `worktrees.length > 1`. Options display `basename(path) (branch)`, mapped back to paths by index. If two options would render the same string (same folder name and same branch), fall back to the full path for the colliding entries so every option stays unique (the Combobox maps selections by string value). The current worktree is the selected value.
- Selecting another worktree calls `useWorkspaceStore.getState().setRoot(path)`. Root change re-resolves the repo, reloads the graph, refetches the worktree list (updating the "current" mark), and the sidebar/file explorer follow automatically.
- Compact mode: same treatment as the branch filter, which stays directly visible in compact mode. No overflow-menu row needed.

### 3. Branch-switch menu (clickable HEAD)

- Roomy mode: the "HEAD: branch" text becomes a button. Clicking opens a popover (same styling as the toolbar's existing gear/overflow popovers) listing local branches and remote branches in two groups.
  - Current branch row shows a check mark; clicking it just closes the menu.
  - Clicking another local branch runs the existing `runAction(() => gitBranchCheckout(repo, name))` (graph reloads on success, git's error shows on failure).
  - Clicking a remote branch opens the existing "create tracking branch" modal flow (`gitBranchCheckoutTrack`), exactly as the ref context menu does today.
  - Both groups are always listed (checking out a remote branch is valid even when remote refs are hidden from the graph display).
- Compact mode: the HEAD row inside the "⋯" overflow menu becomes the same trigger; clicking it closes the overflow menu and opens the branch popover.
- Detached HEAD: the display shows whatever `currentBranch` shows today; the menu itself works unchanged (no row is marked current).

### 4. i18n

`gitGraph` namespace, both locales: `worktree` "Worktree" / "Worktree" (label), `switchBranch` "Switch Branch" / "切換分支" (aria-label/tooltip for the HEAD button), plus the remote-checkout modal strings already exist. Worktree option text is path/branch data, not translated.

## Error handling

- `git worktree list` failure (not a repo, git missing): bridge rejects; the toolbar simply renders no worktree selector (same silent degradation as other optional toolbar data).
- Checkout rejected by git (dirty tree, conflicts): existing `runAction` error surface shows git's message verbatim. No retry, no auto-stash.
- Worktree path no longer exists on disk (stale worktree): `setRoot` to a missing path degrades the same way opening a deleted folder does today; git also reports such worktrees as `prunable`, but handling that is out of scope.

## Testing

- Rust: `worktree_list` parses a porcelain fixture with a main worktree + linked worktree + detached-HEAD worktree; skips `bare`; strips `refs/heads/`; single-worktree repo returns one item.
- Toolbar: selector hidden at `worktrees.length <= 1`, shown with current selected at > 1; selecting another option calls `setRoot` with the mapped path; HEAD button opens the menu in roomy mode; overflow HEAD row opens it in compact mode.
- Tab content: local-branch click invokes `gitBranchCheckout` and reloads; remote-branch click opens the tracking modal; checkout error renders in the existing error surface.

## Out of scope (explicitly)

- Creating, removing, or pruning worktrees.
- Branch create/delete/rename from the new menu (the ref context menu already covers these).
- Auto-stash or any dirty-tree assistance on checkout.
- Moving the worktree selector elsewhere if the side-by-side Combobox layout tests badly (cheap follow-up, not designed in advance).
