# Git Panel Batch 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Git Graph toolbar gains a worktree selector (switches the app's workspace root) and a branch-switch menu behind the "HEAD: branch" display — spec: `docs/superpowers/specs/2026-07-03-git-panel-batch3-design.md`.

**Architecture:** One new backend command (`git_worktree_list`, parses `git worktree list --porcelain`) is the only new backend surface. The toolbar renders a second labeled Combobox for worktrees (hidden for single-worktree repos) whose selection calls `useWorkspaceStore.setRoot` — the existing root-change effect in `GitGraphTabContent` does all the reloading. The "HEAD: branch" text becomes a button opening a popover of local + remote branches; checkout reuses the existing `runAction`/`gitBranchCheckout`/tracking-modal flows from the ref context menu.

**Tech Stack:** Rust (git subprocess via existing `run_git`), React 18 + TS, zustand, vitest + RTL, existing `Combobox`/`Tooltip` components.

## Global Constraints

- Branch: `feat/git-panel-batch3` (created from `feat/git-panel-batch2`; rebase onto master once PR #117 merges).
- English commits/comments; conventional commits. i18n strings in both `en` and `zh-Hant`.
- After each task: `pnpm test && pnpm typecheck`; Task 1 also `cargo test` in `src-tauri`.
- Backend addition is one read-only command; no capability/config changes. Pure `git` CLI parsing, no platform-specific code (must compile on Windows CI).

---

### Task 1: Backend — `worktree_list` + `git_worktree_list` command

**Files:**
- Modify: `src-tauri/src/modules/git/mod.rs` (types near `WorktreeInfo` ~line 225, impl near `worktree_info` ~line 256, command wrapper near `git_worktree_info` ~line 385, tests in the existing `mod tests`)
- Modify: `src-tauri/src/lib.rs` (import list ~line 27, invoke handler list ~line 169)

**Interfaces:**
- Produces (Task 2 consumes): command `git_worktree_list(path: String) -> Result<Vec<WorktreeListItem>, String>` where `WorktreeListItem` serializes as `{ path: string, branch: string | null }`.

- [ ] **Step 1: Write the failing tests** (append inside `mod tests` in `mod.rs`, following the `worktree_info_*` fixture style):

```rust
#[test]
fn worktree_list_reports_main_and_linked_worktrees() {
    let dir = temp_repo_dir("wtl-main");
    let path = dir.to_string_lossy().to_string();
    run_git(&path, &["init", "-b", "main"]).unwrap();
    run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
    run_git(&path, &["config", "user.name", "Tester"]).unwrap();
    std::fs::write(dir.join("a.txt"), "hi").unwrap();
    run_git(&path, &["add", "."]).unwrap();
    run_git(&path, &["commit", "-m", "init"]).unwrap();

    let wt_dir = std::env::temp_dir().join(format!("tempoterm-git-wtl-linked-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&wt_dir);
    let wt_path = wt_dir.to_string_lossy().to_string();
    run_git(&path, &["worktree", "add", "-b", "feature", &wt_path]).unwrap();

    let items = worktree_list(&path).unwrap();
    assert_eq!(items.len(), 2);
    // Paths from git are canonicalized (e.g. /private/var vs /var on macOS),
    // so assert on the unambiguous basename instead of full equality.
    assert!(items[0].path.ends_with("wtl-main") || items[0].path.contains("wtl-main"));
    assert_eq!(items[0].branch.as_deref(), Some("main"));
    assert_eq!(items[1].branch.as_deref(), Some("feature"));

    run_git(&path, &["worktree", "remove", "--force", &wt_path]).unwrap();
    let _ = std::fs::remove_dir_all(&wt_dir);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn worktree_list_reports_detached_worktree_without_branch() {
    let dir = temp_repo_dir("wtl-detached");
    let path = dir.to_string_lossy().to_string();
    run_git(&path, &["init", "-b", "main"]).unwrap();
    run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
    run_git(&path, &["config", "user.name", "Tester"]).unwrap();
    std::fs::write(dir.join("a.txt"), "hi").unwrap();
    run_git(&path, &["add", "."]).unwrap();
    run_git(&path, &["commit", "-m", "init"]).unwrap();

    let wt_dir = std::env::temp_dir().join(format!("tempoterm-git-wtl-det-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&wt_dir);
    let wt_path = wt_dir.to_string_lossy().to_string();
    run_git(&path, &["worktree", "add", "--detach", &wt_path]).unwrap();

    let items = worktree_list(&path).unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[1].branch, None);

    run_git(&path, &["worktree", "remove", "--force", &wt_path]).unwrap();
    let _ = std::fs::remove_dir_all(&wt_dir);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn worktree_list_returns_single_item_for_a_plain_repo() {
    let dir = temp_repo_dir("wtl-single");
    let path = dir.to_string_lossy().to_string();
    run_git(&path, &["init", "-b", "main"]).unwrap();
    run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
    run_git(&path, &["config", "user.name", "Tester"]).unwrap();
    std::fs::write(dir.join("a.txt"), "hi").unwrap();
    run_git(&path, &["add", "."]).unwrap();
    run_git(&path, &["commit", "-m", "init"]).unwrap();

    let items = worktree_list(&path).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].branch.as_deref(), Some("main"));

    let _ = std::fs::remove_dir_all(&dir);
}
```

- [ ] **Step 2: Run to verify failure** — `cd src-tauri && cargo test worktree_list` → FAIL (function not found).
- [ ] **Step 3: Implement** (place the struct next to `WorktreeInfo`, the function next to `worktree_info`, the command next to `git_worktree_info`):

```rust
/// One entry of `git worktree list`: the worktree's absolute path and its
/// checked-out branch (None on a detached HEAD). Bare entries are skipped.
#[derive(Debug, Clone, Serialize)]
pub struct WorktreeListItem {
    pub path: String,
    pub branch: Option<String>,
}

/// Lists every worktree of the repository via `git worktree list --porcelain`:
/// blank-line-separated blocks of `worktree <path>`, `HEAD <sha>`, then
/// `branch refs/heads/<name>` or `detached`. A `bare` block has no working
/// tree to switch to, so it is dropped.
pub fn worktree_list(repo_path: &str) -> Result<Vec<WorktreeListItem>, String> {
    let stdout = run_git(repo_path, &["worktree", "list", "--porcelain"])?;
    let mut items = Vec::new();
    let mut path: Option<String> = None;
    let mut branch: Option<String> = None;
    let mut bare = false;

    let mut flush = |path: &mut Option<String>, branch: &mut Option<String>, bare: &mut bool, items: &mut Vec<WorktreeListItem>| {
        if let Some(p) = path.take() {
            if !*bare {
                items.push(WorktreeListItem { path: p, branch: branch.take() });
            }
        }
        *branch = None;
        *bare = false;
    };

    for line in stdout.lines() {
        if line.is_empty() {
            flush(&mut path, &mut branch, &mut bare, &mut items);
        } else if let Some(rest) = line.strip_prefix("worktree ") {
            path = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("branch ") {
            branch = Some(rest.strip_prefix("refs/heads/").unwrap_or(rest).to_string());
        } else if line == "bare" {
            bare = true;
        }
        // `HEAD <sha>` and `detached` lines are ignored: branch simply stays
        // None for a detached worktree.
    }
    flush(&mut path, &mut branch, &mut bare, &mut items);
    Ok(items)
}
```

Command wrapper (next to `git_worktree_info`, same spawn_blocking rationale):

```rust
#[tauri::command]
pub async fn git_worktree_list(path: String) -> Result<Vec<WorktreeListItem>, String> {
    tauri::async_runtime::spawn_blocking(move || worktree_list(&path))
        .await
        .map_err(|e| e.to_string())?
}
```

In `src-tauri/src/lib.rs`: add `git_worktree_list` to the `use ...::git::{...}` import list (alphabetical, next to `git_worktree_info`) and to the `tauri::generate_handler![...]` list (same neighborhood).

- [ ] **Step 4: Run tests** — `cd src-tauri && cargo test worktree_list` → 3 PASS. Then `cargo test` (full) → PASS.
- [ ] **Step 5: Typecheck frontend untouched, commit**

```bash
cd src-tauri && cargo fmt
git add src-tauri/src/modules/git/mod.rs src-tauri/src/lib.rs
git commit -m "feat(git): add git_worktree_list command"
```

---

### Task 2: Worktree selector in the Git Graph toolbar

**Files:**
- Modify: `src/modules/git-graph/lib/gitGraphBridge.ts` (new bridge fn + type)
- Modify: `src/modules/git-graph/GitGraphToolbar.tsx` (selector UI + labels)
- Modify: `src/modules/git-graph/GitGraphTabContent.tsx` (fetch + wiring)
- Modify: `src/i18n/locales/en/gitGraph.json`, `src/i18n/locales/zh-Hant/gitGraph.json`
- Test: `src/modules/git-graph/GitGraphToolbar.test.tsx` (extend), `src/modules/git-graph/GitGraphTabContent.test.tsx` (extend)

**Interfaces:**
- Consumes: `git_worktree_list` (Task 1).
- Produces: `GitGraphToolbar` props gain `worktrees: WorktreeItem[]`, `currentWorktreePath: string | null`, `onSelectWorktree: (path: string) => void`; labels gain `worktree: string`. Bridge exports `interface WorktreeItem { path: string; branch: string | null }` and `gitWorktreeList(repo: string): Promise<WorktreeItem[]>`.

- [ ] **Step 1: Write the failing toolbar tests** (append to `GitGraphToolbar.test.tsx`; extend the `labels` fixture with `worktree: "Worktree"` and add the new props to `renderToolbar`'s defaults: `worktrees: []`, `currentWorktreePath: null`, `onSelectWorktree: vi.fn()`):

```tsx
describe("worktree selector", () => {
  const twoWorktrees = [
    { path: "/repos/app", branch: "master" },
    { path: "/repos/app-dev", branch: "feature" },
  ];

  it("is hidden when the repo has a single worktree", () => {
    renderToolbar({ worktrees: [{ path: "/repos/app", branch: "master" }], currentWorktreePath: "/repos/app" });
    expect(screen.queryByText("Worktree:")).not.toBeInTheDocument();
  });

  it("shows the current worktree as the selected value when there are several", () => {
    renderToolbar({ worktrees: twoWorktrees, currentWorktreePath: "/repos/app" });
    expect(screen.getByText("Worktree:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Worktree" })).toHaveTextContent("app (master)");
  });

  it("selecting another worktree reports its path", () => {
    const onSelectWorktree = vi.fn();
    renderToolbar({ worktrees: twoWorktrees, currentWorktreePath: "/repos/app", onSelectWorktree });

    fireEvent.click(screen.getByRole("button", { name: "Worktree" }));
    fireEvent.click(screen.getByText("app-dev (feature)"));

    expect(onSelectWorktree).toHaveBeenCalledWith("/repos/app-dev");
  });

  it("falls back to full paths when two options would collide", () => {
    renderToolbar({
      worktrees: [
        { path: "/a/repo", branch: "main" },
        { path: "/b/repo", branch: "main" },
      ],
      currentWorktreePath: "/a/repo",
    });
    expect(screen.getByRole("button", { name: "Worktree" })).toHaveTextContent("/a/repo");
  });
});
```

Note: the `Combobox` trigger renders as a button whose accessible name comes from `ariaLabel` — check the existing branch-filter tests in this file for the exact query convention and mirror it; adjust the `getByRole` queries above if the component exposes a different role (e.g. the trigger may need `{ name: "Worktree" }` on a `button` with `aria-label`).

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run src/modules/git-graph/GitGraphToolbar.test.tsx` → new tests FAIL (no worktree UI; missing props cause TS errors in the test file first — that is the expected RED).
- [ ] **Step 3: Implement the bridge** (append to `gitGraphBridge.ts`, following its existing style):

```ts
export interface WorktreeItem {
  path: string;
  /** Checked-out branch, or null when the worktree is on a detached HEAD. */
  branch: string | null;
}

export function gitWorktreeList(repo: string): Promise<WorktreeItem[]> {
  return invoke<WorktreeItem[]>("git_worktree_list", { path: repo });
}
```

- [ ] **Step 4: Implement the toolbar selector.** In `GitGraphToolbar.tsx`:

Extend the labels interface and props:

```ts
export interface GitGraphToolbarLabels {
  // ...existing fields...
  worktree: string;
}

interface GitGraphToolbarProps {
  // ...existing fields...
  worktrees: WorktreeItem[];
  currentWorktreePath: string | null;
  onSelectWorktree: (path: string) => void;
}
```

Import the type: `import type { WorktreeItem } from "./lib/gitGraphBridge";`

Add option-building above the component (module scope, exported for nothing — plain helpers):

```ts
/** Last path segment; handles both / and \ separators (git on Windows may
 * print either). */
function worktreeBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

interface WorktreeOption {
  label: string;
  path: string;
}

/** "basename (branch)" per worktree; colliding labels fall back to the full
 * path so every Combobox option string stays unique (selection maps back by
 * string value). */
function buildWorktreeOptions(worktrees: WorktreeItem[]): WorktreeOption[] {
  const base = worktrees.map((w) => ({
    label: w.branch ? `${worktreeBasename(w.path)} (${w.branch})` : worktreeBasename(w.path),
    path: w.path,
  }));
  const counts = new Map<string, number>();
  for (const option of base) {
    counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
  }
  return base.map((option) =>
    (counts.get(option.label) ?? 0) > 1 ? { ...option, label: option.path } : option,
  );
}

/** Trailing-slash-insensitive path equality (resolve_repo trims, git doesn't). */
function samePath(a: string, b: string): boolean {
  return a.replace(/[\\/]+$/, "") === b.replace(/[\\/]+$/, "");
}
```

Inside the component, after `branchOptions`:

```ts
const worktreeOptions = buildWorktreeOptions(worktrees);
const currentWorktree =
  currentWorktreePath === null
    ? undefined
    : worktreeOptions.find((o) => samePath(o.path, currentWorktreePath));
const showWorktreeControls = showBranchControls && worktreeOptions.length > 1;
```

Render, inside the left `<div className="flex min-w-0 items-center gap-3">`, directly after the `showBranchControls && (...)` branch block (so it sits next to the branch filter and also steps aside for compact search):

```tsx
{showWorktreeControls && (
  <div className="flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
    <span className="shrink-0">{labels.worktree}:</span>
    <Combobox
      value={currentWorktree?.label ?? (currentWorktreePath ? worktreeBasename(currentWorktreePath) : "")}
      options={worktreeOptions.map((o) => o.label)}
      onChange={(label) => {
        const picked = worktreeOptions.find((o) => o.label === label);
        if (picked && (!currentWorktree || picked.path !== currentWorktree.path)) {
          onSelectWorktree(picked.path);
        }
      }}
      ariaLabel={labels.worktree}
      className="w-44"
    />
  </div>
)}
```

- [ ] **Step 5: Wire the tab content.** In `GitGraphTabContent.tsx`:

Add `gitWorktreeList` and the type to the existing bridge import; add state + fetch effect next to the repo-resolve effect:

```ts
const [worktrees, setWorktrees] = useState<WorktreeItem[]>([]);

// The worktree set only changes on external `git worktree add/remove`, so
// fetch once per resolved repo; a failure (not a repo) just hides the control.
useEffect(() => {
  if (!repo) {
    setWorktrees([]);
    return;
  }
  let cancelled = false;
  gitWorktreeList(repo)
    .then((list) => {
      if (!cancelled) {
        setWorktrees(list);
      }
    })
    .catch(() => {
      if (!cancelled) {
        setWorktrees([]);
      }
    });
  return () => {
    cancelled = true;
  };
}, [repo]);

const handleSelectWorktree = useCallback((path: string) => {
  // Switching worktree = switching the app's workspace root; the rootPath
  // effect above re-resolves the repo and reloads everything.
  useWorkspaceStore.getState().setRoot(path);
}, []);
```

Toolbar wiring (new props on `<GitGraphToolbar ...>`): `worktrees={worktrees}`, `currentWorktreePath={repo}` (resolve_repo returns the current worktree's own toplevel — verified against `Repository::discover` + `workdir()`), `onSelectWorktree={handleSelectWorktree}`.

Labels: add `worktree: t("toolbar.worktree"),` to `toolbarLabels`.

- [ ] **Step 6: i18n.** Add under `toolbar` in both locales: en `"worktree": "Worktree"`, zh-Hant `"worktree": "Worktree"` (proper noun, untranslated per the spec).
- [ ] **Step 7: Write the failing tab-content test** (append to `GitGraphTabContent.test.tsx`; add `gitWorktreeList: vi.fn().mockResolvedValue([])` to the existing `./lib/gitGraphBridge` mock so other tests keep passing):

```tsx
describe("worktree selector wiring", () => {
  it("switches the workspace root when another worktree is picked", async () => {
    vi.mocked(gitGraphLog).mockResolvedValue(commitList(["aaa1111"], false));
    vi.mocked(gitWorktreeList).mockResolvedValue([
      { path: "/repo", branch: "master" },
      { path: "/repo-dev", branch: "feature" },
    ]);

    render(<GitGraphTabContent />);
    fireEvent.click(await screen.findByRole("button", { name: "Worktree" }));
    fireEvent.click(screen.getByText("repo-dev (feature)"));

    await waitFor(() => expect(useWorkspaceStore.getState().rootPath).toBe("/repo-dev"));
  });
});
```

(Import `gitWorktreeList` alongside the other mocked bridge fns; the toolbar aria-label comes from the real i18n key, so use the English string the `en` locale produces — check what `t("toolbar.worktree")` renders in this test setup and match it.)

- [ ] **Step 8: Run all touched tests** — `pnpm vitest run src/modules/git-graph` → PASS.
- [ ] **Step 9: Verify + commit**

```bash
pnpm test && pnpm typecheck
git add -A src
git commit -m "feat(git-graph): worktree selector that switches the workspace root

Lists the repo's worktrees (new git_worktree_list command) in a second
labeled Combobox next to the branch filter, hidden for single-worktree
repos. Picking one calls setRoot, and the existing root-change effect
re-resolves and reloads the graph; sidebar and file explorer follow the
same store. Colliding display labels fall back to full paths."
```

---

### Task 3: Branch-switch menu behind "HEAD: branch"

**Files:**
- Modify: `src/modules/git-graph/GitGraphToolbar.tsx` (HEAD button + `BranchMenu` popover, roomy + compact)
- Modify: `src/modules/git-graph/GitGraphTabContent.tsx` (checkout wiring; extract `openCheckoutRemoteModal` shared with the ref menu)
- Modify: `src/i18n/locales/en/gitGraph.json`, `src/i18n/locales/zh-Hant/gitGraph.json`
- Test: `src/modules/git-graph/GitGraphToolbar.test.tsx` (extend)

**Interfaces:**
- Consumes: existing `gitBranchCheckout`, `gitBranchCheckoutTrack`, `runAction`, `setModal`, `splitRemoteRef` (all already in `GitGraphTabContent.tsx`).
- Produces: `GitGraphToolbar` props gain `onCheckoutBranch: (name: string) => void` and `onCheckoutRemoteBranch: (name: string) => void`; labels gain `switchBranch: string`.

- [ ] **Step 1: Write the failing toolbar tests** (append; extend `labels` fixture with `switchBranch: "Switch Branch"` and `renderToolbar` defaults with `onCheckoutBranch: vi.fn()`, `onCheckoutRemoteBranch: vi.fn()`; widen the `branches` fixture with a second local branch `{ name: "dev", isRemote: false }`):

```tsx
describe("branch-switch menu", () => {
  it("opens from the HEAD button and lists local branches with the current one checked", () => {
    renderToolbar({ currentBranch: "master" });
    setToolbarWidth(800);

    fireEvent.click(screen.getByRole("button", { name: "Switch Branch" }));

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("master")).toBeInTheDocument();
    expect(within(menu).getByText("dev")).toBeInTheDocument();
  });

  it("clicking another local branch checks it out", () => {
    const onCheckoutBranch = vi.fn();
    renderToolbar({ currentBranch: "master", onCheckoutBranch });
    setToolbarWidth(800);

    fireEvent.click(screen.getByRole("button", { name: "Switch Branch" }));
    fireEvent.click(within(screen.getByRole("menu")).getByText("dev"));

    expect(onCheckoutBranch).toHaveBeenCalledWith("dev");
  });

  it("clicking the current branch closes without checking out", () => {
    const onCheckoutBranch = vi.fn();
    renderToolbar({ currentBranch: "master", onCheckoutBranch });
    setToolbarWidth(800);

    fireEvent.click(screen.getByRole("button", { name: "Switch Branch" }));
    fireEvent.click(within(screen.getByRole("menu")).getByText("master"));

    expect(onCheckoutBranch).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("clicking a remote branch routes to the tracking flow", () => {
    const onCheckoutRemoteBranch = vi.fn();
    renderToolbar({ currentBranch: "master", onCheckoutRemoteBranch });
    setToolbarWidth(800);

    fireEvent.click(screen.getByRole("button", { name: "Switch Branch" }));
    fireEvent.click(within(screen.getByRole("menu")).getByText("origin/master"));

    expect(onCheckoutRemoteBranch).toHaveBeenCalledWith("origin/master");
  });

  it("compact mode reaches the same menu through the overflow HEAD row", () => {
    const onCheckoutBranch = vi.fn();
    renderToolbar({ currentBranch: "master", onCheckoutBranch });
    setToolbarWidth(400);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch Branch" }));
    fireEvent.click(within(screen.getByRole("menu")).getByText("dev"));

    expect(onCheckoutBranch).toHaveBeenCalledWith("dev");
  });
});
```

(Existing tests that assert the HEAD text via plain text queries may need updating from a `<span>` to a `<button>` — run and adjust queries, not behavior.)

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run src/modules/git-graph/GitGraphToolbar.test.tsx` → new tests FAIL.
- [ ] **Step 3: Implement in `GitGraphToolbar.tsx`.**

Labels + props:

```ts
export interface GitGraphToolbarLabels {
  // ...existing + worktree...
  switchBranch: string;
}

interface GitGraphToolbarProps {
  // ...existing + worktree props...
  onCheckoutBranch: (name: string) => void;
  onCheckoutRemoteBranch: (name: string) => void;
}
```

State: `const [branchMenuOpen, setBranchMenuOpen] = useState(false);`

New popover component at the bottom of the file (next to `ActionRow`):

```tsx
interface BranchMenuProps {
  locals: Branch[];
  remotes: Branch[];
  currentBranch: string;
  onCheckoutBranch: (name: string) => void;
  onCheckoutRemoteBranch: (name: string) => void;
  onClose: () => void;
}

/** The checkout popover behind the HEAD display. Locals check out directly;
 * remotes route to the create-tracking-branch modal owned by the tab. */
function BranchMenu({
  locals,
  remotes,
  currentBranch,
  onCheckoutBranch,
  onCheckoutRemoteBranch,
  onClose,
}: BranchMenuProps) {
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden="true" />
      <div
        role="menu"
        className="absolute right-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-border-strong bg-bg-elevated p-1 shadow-lg"
      >
        {locals.map((b) => (
          <button
            key={b.name}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              if (b.name !== currentBranch) {
                onCheckoutBranch(b.name);
              }
            }}
            className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-inset hover:text-fg"
          >
            <span className="truncate font-mono">{b.name}</span>
            {b.name === currentBranch && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
          </button>
        ))}
        {remotes.length > 0 && (
          <>
            <div className="my-1 border-t border-border" />
            {remotes.map((b) => (
              <button
                key={b.name}
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onCheckoutRemoteBranch(b.name);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-inset hover:text-fg"
              >
                <span className="truncate font-mono">{b.name}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </>
  );
}
```

Roomy mode: replace the HEAD `<span>` (currently `className="ml-1 whitespace-nowrap font-mono text-[11px] text-fg-subtle"`) with a button + anchored menu:

```tsx
<div className="relative">
  <Tooltip label={labels.switchBranch}>
    <button
      type="button"
      aria-label={labels.switchBranch}
      aria-expanded={branchMenuOpen}
      onClick={() => setBranchMenuOpen((v) => !v)}
      className="ml-1 whitespace-nowrap rounded px-1 py-0.5 font-mono text-[11px] text-fg-subtle hover:bg-bg-elevated hover:text-fg"
    >
      {labels.head}: {currentBranch}
    </button>
  </Tooltip>
  {branchMenuOpen && (
    <BranchMenu
      locals={locals}
      remotes={remotes}
      currentBranch={currentBranch}
      onCheckoutBranch={onCheckoutBranch}
      onCheckoutRemoteBranch={onCheckoutRemoteBranch}
      onClose={() => setBranchMenuOpen(false)}
    />
  )}
</div>
```

Compact mode: turn the overflow menu's HEAD text `<div>` into a button that hands off to the branch menu, and render the menu inside the same relative container as the ⋯ button (a sibling of the overflow popover):

```tsx
{/* inside the overflow popover, replacing the plain HEAD div */}
<button
  type="button"
  aria-label={labels.switchBranch}
  onClick={() => {
    setOverflowOpen(false);
    setBranchMenuOpen(true);
  }}
  className="flex w-full items-center rounded px-2 py-1.5 text-left font-mono text-[11px] text-fg-subtle hover:bg-bg-inset hover:text-fg"
>
  {labels.head}: {currentBranch}
</button>
```

```tsx
{/* sibling of the overflow popover, inside the compact-mode relative div */}
{branchMenuOpen && (
  <BranchMenu
    locals={locals}
    remotes={remotes}
    currentBranch={currentBranch}
    onCheckoutBranch={onCheckoutBranch}
    onCheckoutRemoteBranch={onCheckoutRemoteBranch}
    onClose={() => setBranchMenuOpen(false)}
  />
)}
```

- [ ] **Step 4: Wire the tab content.** In `GitGraphTabContent.tsx`, extract the remote-checkout modal (used today only inside `refMenuItems`, `onCheckoutRemote`) into a shared callback placed next to `handleFetch`:

```ts
// Shared by the ref context menu and the toolbar's branch menu: prompt for a
// local name, then create the tracking branch.
const openCheckoutRemoteModal = useCallback(
  (refName: string) => {
    const { branch } = splitRemoteRef(refName);
    setModal({
      title: t("modal.checkoutRemote.title"),
      confirmLabel: t("modal.checkoutRemote.confirm"),
      fields: [
        {
          key: "name",
          label: t("modal.branchName"),
          placeholder: t("modal.branchPlaceholder"),
          required: true,
          defaultValue: branch,
        },
      ],
      onConfirm: (values) =>
        void runAction(() => gitBranchCheckoutTrack(repo!, values.name, refName)),
    });
  },
  [t, runAction, repo],
);
```

Replace the inline body of `onCheckoutRemote` in `refMenuItems` with `openCheckoutRemoteModal(ref.name)`, and pass to the toolbar:

```tsx
onCheckoutBranch={(name) => void runAction(() => gitBranchCheckout(repo!, name))}
onCheckoutRemoteBranch={openCheckoutRemoteModal}
```

Labels: `switchBranch: t("toolbar.switchBranch"),`.

- [ ] **Step 5: i18n.** Under `toolbar` in both locales: en `"switchBranch": "Switch Branch"`, zh-Hant `"switchBranch": "切換分支"`.
- [ ] **Step 6: Run tests** — `pnpm vitest run src/modules/git-graph` → PASS (fix any pre-existing HEAD-text queries per Step 1's note).
- [ ] **Step 7: Verify + commit**

```bash
pnpm test && pnpm typecheck
git add -A src
git commit -m "feat(git-graph): branch-switch menu behind the HEAD display

The toolbar's HEAD text becomes a button (roomy) and the overflow HEAD
row a trigger (compact), both opening a popover of local and remote
branches. Locals check out via the existing runAction flow; remotes
reuse the ref menu's create-tracking-branch modal, now extracted into a
shared openCheckoutRemoteModal. The branch filter dropdown remains a
pure display filter."
```

---

### Task 4: Reviews, verification, build

- [ ] **Step 1:** `pnpm test && pnpm typecheck` and `cd src-tauri && cargo test` — full green.
- [ ] **Step 2:** Run `/code-review`; fix CRITICAL/HIGH (and reasonable MEDIUM) findings; re-run until clean. Run `/tauri-review` for the new backend command (read-only, no capability changes expected).
- [ ] **Step 3:** Verify in the running app (`pnpm tauri dev`) on this repo itself (create a scratch worktree first: `git worktree add ../tempo-term-scratch -b scratch-test`):
  - Worktree selector appears with two entries; picking the scratch one switches the file explorer, sidebar and graph; picking back returns. Selector hidden after `git worktree remove ../tempo-term-scratch` + refresh (re-open tab or switch root).
  - HEAD button opens the branch menu in roomy width; checkout of another local branch reloads the graph and updates HEAD; checkout with dirty tree shows git's error inline; remote branch opens the tracking modal.
  - Narrow the pane below 620px: ⋯ → HEAD row → same menu works. Also confirm the worktree selector + branch filter side-by-side layout doesn't crowd the toolbar (the deferred confusion concern — note the verdict for the owner).
- [ ] **Step 4:** Local build for owner testing: `export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/tempo-term.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" && pnpm tauri build`, then open the bundled app.
