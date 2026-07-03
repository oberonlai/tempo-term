# Git Panel Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Source-control sidebar becomes actionable (context menu, discard, side-by-side diff tab) and two Git Graph papercuts are fixed — spec: `docs/superpowers/specs/2026-07-02-git-panel-batch1-design.md`.

**Architecture:** A new `diff` pane kind renders a read-only `@codemirror/merge` MergeView comparing a git revision (HEAD or index, fetched via a new `git_file_at_rev` command) against the working tree / index. The sidebar file rows gain left-click (open diff), a hover discard button, and a shared-ContextMenu right-click menu; discard calls a new `git_restore_file` command behind a ConfirmDialog.

**Tech Stack:** React 18 + TS, zustand tabsStore, CodeMirror 6 (`@codemirror/merge` — new dep), Rust `run_git` wrappers, vitest + RTL, Rust `#[cfg(test)]` temp-repo fixtures.

## Global Constraints

- Branch: `feat/git-panel-batch1` (already checked out). English commits/comments; conventional commits.
- Every git-facing Rust command validates args with `ensure_not_flag` and passes paths after `--`.
- All UI strings go through i18n (`en` + `zh-Hant`); tooltips use the shared `Tooltip` (default side top).
- Dialogs use `ConfirmDialog`/`InfoDialog`, never window.confirm.
- After each task: `pnpm test && pnpm typecheck`; Rust tasks also `cargo test -p tempo-term` (run in `src-tauri`).

---

### Task 1: Rust commands `git_file_at_rev` + `git_restore_file`

**Files:**
- Modify: `src-tauri/src/modules/git/mod.rs` (functions near `diff()` ~line 335; commands near `git_diff` ~line 897; tests in the existing `#[cfg(test)]` module)
- Modify: `src-tauri/src/lib.rs` (register both in `invoke_handler!`)

**Interfaces:**
- Produces: `git_file_at_rev(repoPath, rev, path) -> String` where `rev ∈ {"HEAD", ":"}`; returns `""` when the file doesn't exist at that rev. `git_restore_file(repoPath, path) -> ()`.

- [ ] **Step 1: Write failing Rust tests** (in the existing test module, reusing its `temp_repo_dir` fixture style):

```rust
#[test]
fn file_at_rev_reads_head_and_index_versions() {
    let dir = temp_repo_dir("file_at_rev");
    let path = dir.to_string_lossy().to_string();
    run_git(&path, &["init"]).unwrap();
    run_git(&path, &["config", "user.name", "Test"]).unwrap();
    run_git(&path, &["config", "user.email", "test@example.com"]).unwrap();
    std::fs::write(dir.join("a.txt"), "committed\n").unwrap();
    run_git(&path, &["add", "a.txt"]).unwrap();
    run_git(&path, &["commit", "-m", "c1"]).unwrap();
    std::fs::write(dir.join("a.txt"), "staged\n").unwrap();
    run_git(&path, &["add", "a.txt"]).unwrap();

    assert_eq!(file_at_rev(&path, "HEAD", "a.txt").unwrap(), "committed\n");
    assert_eq!(file_at_rev(&path, ":", "a.txt").unwrap(), "staged\n");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn file_at_rev_missing_file_is_empty_and_bad_rev_rejected() {
    let dir = temp_repo_dir("file_at_rev_missing");
    let path = dir.to_string_lossy().to_string();
    run_git(&path, &["init"]).unwrap();
    assert_eq!(file_at_rev(&path, "HEAD", "nope.txt").unwrap(), "");
    assert!(file_at_rev(&path, "HEAD~1", "a.txt").is_err());
    assert!(file_at_rev(&path, "HEAD", "--evil").is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn restore_file_reverts_unstaged_change() {
    let dir = temp_repo_dir("restore_file");
    let path = dir.to_string_lossy().to_string();
    run_git(&path, &["init"]).unwrap();
    run_git(&path, &["config", "user.name", "Test"]).unwrap();
    run_git(&path, &["config", "user.email", "test@example.com"]).unwrap();
    std::fs::write(dir.join("a.txt"), "original\n").unwrap();
    run_git(&path, &["add", "a.txt"]).unwrap();
    run_git(&path, &["commit", "-m", "c1"]).unwrap();
    std::fs::write(dir.join("a.txt"), "dirty\n").unwrap();

    restore_file(&path, "a.txt").unwrap();
    assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "original\n");
    let _ = std::fs::remove_dir_all(&dir);
}
```

- [ ] **Step 2: Run to verify failure** — `cd src-tauri && cargo test file_at_rev restore_file` → compile error (functions missing).
- [ ] **Step 3: Implement**

```rust
/// Content of `path` at `rev`, where rev is limited to "HEAD" (last commit)
/// or ":" (the index). A file missing at that rev is an empty document, not
/// an error, so new files diff as all-added.
pub fn file_at_rev(repo_path: &str, rev: &str, path: &str) -> Result<String, String> {
    if rev != "HEAD" && rev != ":" {
        return Err(format!("unsupported rev: {rev}"));
    }
    ensure_not_flag(path)?;
    match run_git(repo_path, &["show", &format!("{rev}:{path}")]) {
        Ok(content) => Ok(content),
        Err(err) if err.contains("does not exist") || err.contains("exists on disk, but not in") => {
            Ok(String::new())
        }
        Err(err) => Err(err),
    }
}

/// Discard unstaged changes to one tracked file (`git restore -- <path>`).
pub fn restore_file(repo_path: &str, path: &str) -> Result<(), String> {
    ensure_not_flag(path)?;
    run_git(repo_path, &["restore", "--", path]).map(|_| ())
}
```

Commands (beside `git_diff`):

```rust
#[tauri::command]
pub fn git_file_at_rev(repo_path: String, rev: String, path: String) -> Result<String, String> {
    file_at_rev(&repo_path, &rev, &path)
}

#[tauri::command]
pub fn git_restore_file(repo_path: String, path: String) -> Result<(), String> {
    restore_file(&repo_path, &path)
}
```

Register both names in `lib.rs`'s `invoke_handler!` list next to `git_diff`. Adjust the missing-file error match to whatever message the tests reveal (`git show` wording differs by version — make the test drive the exact patterns; falling back to treating any "fatal: path ..." error as empty is acceptable if scoped to the `show` call).

- [ ] **Step 4: Run tests** — `cargo test file_at_rev restore_file` → PASS; `cargo test` (module) still green.
- [ ] **Step 5: Frontend bridge** — append to `src/modules/source-control/lib/gitBridge.ts`:

```ts
/** rev is "HEAD" (last commit) or ":" (the index). Missing at rev = "". */
export function gitFileAtRev(repoPath: string, rev: "HEAD" | ":", path: string): Promise<string> {
  return invoke<string>("git_file_at_rev", { repoPath, rev, path });
}

export function gitRestoreFile(repoPath: string, path: string): Promise<void> {
  return invoke<void>("git_restore_file", { repoPath, path });
}
```

- [ ] **Step 6: Verify + commit**

```bash
pnpm typecheck && git add -A src-tauri src/modules/source-control/lib/gitBridge.ts
git commit -m "feat(git): add file-at-rev and restore-file commands"
```

---

### Task 2: `diff` pane kind + `openDiffTab`

**Files:**
- Modify: `src/modules/terminal/lib/terminalLayout.ts:14-20` (PaneContent union)
- Modify: `src/stores/tabsStore.ts` (TabKind:43, restore switch ~348, `singleLeafContentEquals` ~264, new `openDiffTab` beside `openGitGraphTab` ~571; persistence mapping if tabs serialize `path`)
- Modify: `src/components/TabBar.tsx` + `src/modules/workspace/WorkspacePanel.tsx` `tabIcon` switches (add `case "diff": return GitCompare` from lucide)
- Test: `src/stores/tabsStore.test.ts` (or the existing tabsStore test file — extend)

**Interfaces:**
- Produces: `PaneContent` variant `{ kind: "diff"; path: string; staged: boolean }`; `openDiffTab(path: string, staged: boolean): string` with focus-existing dedup on `path`+`staged`; TabKind gains `"diff"`.

- [ ] **Step 1: Write failing test** (mirror the existing openGitGraphTab tests' store setup):

```ts
describe("openDiffTab", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
  });

  it("creates a diff tab titled by basename and focuses the same file on re-open", () => {
    const first = useTabsStore.getState().openDiffTab("/repo/src/App.tsx", false);
    expect(useTabsStore.getState().tabs[0].title).toBe("App.tsx");
    const again = useTabsStore.getState().openDiffTab("/repo/src/App.tsx", false);
    expect(again).toBe(first);
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("treats staged and unstaged diffs of the same file as distinct tabs", () => {
    useTabsStore.getState().openDiffTab("/repo/a.ts", false);
    useTabsStore.getState().openDiffTab("/repo/a.ts", true);
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Verify failure** — `pnpm vitest run src/stores` → openDiffTab undefined.
- [ ] **Step 3: Implement** — add the union member; extend `singleLeafContentEquals` with `if (pane.kind === "diff" && content.kind === "diff") return pane.path === content.path && pane.staged === content.staged;`; add `"diff"` to TabKind and the restore switch (`content = { kind: "diff", path: t.path ?? "", staged: t.staged ?? false }` — persist `staged` alongside `path` the same way editor persists `path`); implement `openDiffTab` cloning the `openGitGraphTab` body with the dedup predicate `t.kind === "diff" && singleLeafContentEquals(t, { kind: "diff", path, staged })`, title `path.split(/[\\/]/).pop() ?? path`.
- [ ] **Step 4: Icon switches** — both `tabIcon` functions gain `case "diff": return GitCompare;` (import from lucide-react). TypeScript exhaustiveness will point at any missed switch.
- [ ] **Step 5: Verify + commit** — `pnpm test && pnpm typecheck`; `git commit -am "feat(tabs): add diff pane kind with focus-existing open"`.

---

### Task 3: DiffTabContent (MergeView) + pane wiring

**Files:**
- Create: `src/modules/diff/DiffTabContent.tsx`
- Create: `src/modules/diff/DiffTabContent.test.tsx`
- Modify: `src/modules/terminal/PaneTabContent.tsx` (lazy import + render branch beside the `git-graph` branch at ~451)
- Modify: `package.json` (add `@codemirror/merge`)
- Modify: `src/i18n/locales/{en,zh-Hant}/sourceControl.json` (keys below)

**Interfaces:**
- Consumes: `gitFileAtRev`, `gitResolveRepo`, `gitStatus` (Task 1 bridge + existing), `fsReadFile` (`src/modules/explorer/lib/fsBridge.ts:33`), `loadLanguageExtension` (`src/modules/editor/lib/language.ts`), fontFamily/fontSize stores as used in `EditorTabContent.tsx:89-105`.
- Produces: `<DiffTabContent path={string} staged={boolean} />`.

- [ ] **Step 1: Install dep** — `pnpm add @codemirror/merge`.
- [ ] **Step 2: Write failing test** (jsdom can't measure MergeView; test the data contract):

```tsx
// mocks: gitBridge (gitResolveRepo→"/repo", gitFileAtRev), fsBridge (fsReadFile)
it("loads index vs worktree for an unstaged diff", async () => {
  vi.mocked(gitFileAtRev).mockResolvedValue("old\n");
  vi.mocked(fsReadFile).mockResolvedValue("new\n");
  render(<DiffTabContent path="/repo/a.ts" staged={false} />);
  await waitFor(() => expect(gitFileAtRev).toHaveBeenCalledWith("/repo", ":", "a.ts"));
  expect(fsReadFile).toHaveBeenCalledWith("/repo/a.ts");
});

it("loads HEAD vs index for a staged diff", async () => {
  vi.mocked(gitFileAtRev).mockResolvedValue("x");
  render(<DiffTabContent path="/repo/a.ts" staged={true} />);
  await waitFor(() =>
    expect(gitFileAtRev).toHaveBeenNthCalledWith(1, "/repo", "HEAD", "a.ts"));
  expect(gitFileAtRev).toHaveBeenNthCalledWith(2, "/repo", ":", "a.ts");
});
```

- [ ] **Step 3: Verify failure**, **Step 4: Implement**:

```tsx
/**
 * Read-only side-by-side comparison for one file's uncommitted changes.
 * Unstaged tab: index (left) vs working tree (right). Staged tab: HEAD (left)
 * vs index (right). Contents load on mount; MergeView computes the diff.
 */
export function DiffTabContent({ path, staged }: { path: string; staged: boolean }) { ... }
```

Implementation notes (concrete, follow in order):
1. Resolve the repo once: `gitResolveRepo(dirname(path))` — reuse `dirname` from `src/modules/explorer/lib/paths.ts`; compute the repo-relative path by stripping `repo + "/"` prefix.
2. Fetch left/right: unstaged → `[gitFileAtRev(repo, ":", rel), fsReadFile(path).catch(() => "")]`; staged → `[gitFileAtRev(repo, "HEAD", rel), gitFileAtRev(repo, ":", rel)]`.
3. Build the view in a `useEffect`: `new MergeView({ a: { doc: left, extensions }, b: { doc: right, extensions }, parent: containerRef.current, gutter: true })` where `extensions = [EditorState.readOnly.of(true), EditorView.editable.of(false), theme, languageExt]`; theme mirrors `EditorTabContent.tsx:91-94` (fontSize/fontFamily from the same stores); `languageExt` from `await loadLanguageExtension(path)` resolved before constructing (single async load, then build). Destroy the view in the effect cleanup.
4. Header bar above the view: filename + a badge `t("sourceControl:diffStaged")` / `t("sourceControl:diffUnstaged")` so the two tab variants are distinguishable.
5. Re-fetch on window focus (`focus` event listener) per spec — rebuild docs via `view.a.dispatch({changes: {from: 0, to: view.a.state.doc.length, insert: next}})` style updates, or simplest: re-run the load effect keyed on a `refreshKey` state bumped by the focus listener.

i18n keys (both locales): `diffStaged` ("Staged" / "已暫存"), `diffUnstaged` ("Working tree" / "工作區"), `diffLoadError` ("Couldn't load the comparison" / "無法載入比對內容").

- [ ] **Step 5: Wire the pane** — in `PaneTabContent.tsx` add a lazy import mirroring GitGraphTabContent (line 28) and a render branch: `pane.content.kind === "diff" ? <DiffTabContent path={pane.content.path} staged={pane.content.staged} /> : ...`.
- [ ] **Step 6: Verify + commit** — `pnpm test && pnpm typecheck`; `git commit -am "feat(diff): add side-by-side diff tab backed by @codemirror/merge"`.

---

### Task 4: Sidebar interactions (context menu, discard, left-click)

**Files:**
- Modify: `src/modules/source-control/SourceControlView.tsx` (StatusRow ~49-88, FileList ~101, history list ~446-460, panel root ~281)
- Modify: `src/i18n/locales/{en,zh-Hant}/sourceControl.json`
- Test: `src/modules/source-control/SourceControlView.test.tsx` (extend existing)

**Interfaces:**
- Consumes: `openDiffTab` (Task 2), `gitRestoreFile` (Task 1), shared `ContextMenu` (`src/components/ContextMenu.tsx` — usage pattern `FileTree.tsx:56,285-288,339-346`), `ConfirmDialog`, `fsReveal` (`src/modules/explorer/lib/fsBridge.ts`), `openFromSidebar`/`openInNewTab` (tabsStore), `relativePath` (`src/modules/explorer/lib/paths.ts`).

Behavior to implement (StatusRow gains `staged: boolean` and `repoPath: string` props, or a context object — pick the smallest prop set):
1. Row `<li>` gets `onClick={() => openDiffTab(absPath, staged)}` (absPath = `repoPath + "/" + file.path`), `cursor-pointer`, and `onContextMenu` opening the shared ContextMenu at cursor.
2. Menu items (per spec grouping): 開啟檔案 (`openFromSidebar({kind:"editor",path:absPath})`), 在新分頁開啟 (`openInNewTab`), 顯示 diff (`openDiffTab`); 暫存/取消暫存 (existing handlers); 複製路徑 / 複製相對路徑 / 在 Finder 顯示 (`navigator.clipboard.writeText`, `fsReveal`); danger group 捨棄變更 — only when `!staged && file.status !== "?"`.
3. Hover discard button (lucide `Undo2`, Tooltip label 捨棄變更) in the unstaged section next to `+` — hidden for untracked (`file.status === "?"`) rows; opens the same ConfirmDialog.
4. ConfirmDialog: title `discardTitle`, message `discardMessage` (interpolate filename, state irreversibility), confirm label `discardConfirm` (danger), on confirm → `gitRestoreFile(repoPath, file.path)` then `refresh()`.
5. History rows: `onContextMenu` menu with 複製 hash (`commit.id`) and 複製提交訊息 (`commit.summary`).
6. Panel root div: `onContextMenu={(e) => e.preventDefault()}` so misses don't show the system menu (row handlers stopPropagation to layer their menu).

i18n keys (en / zh-Hant): `menuOpenFile` "Open File"/"開啟檔案", `menuOpenInNewTab` "Open in New Tab"/"在新分頁開啟", `menuShowDiff` "Show Diff"/"顯示 diff", `menuCopyPath` "Copy Path"/"複製路徑", `menuCopyRelativePath` "Copy Relative Path"/"複製相對路徑", `menuRevealFinder` "Reveal in Finder"/"在 Finder 顯示", `discard` "Discard Changes"/"捨棄變更", `discardTitle` "Discard Changes"/"捨棄變更", `discardMessage` "Discard changes to {{name}}? This cannot be undone."/"要捨棄 {{name}} 的變更嗎？這個動作無法復原", `discardConfirm` "Discard"/"捨棄", `menuCopyHash` "Copy Hash"/"複製 hash", `menuCopyMessage` "Copy Message"/"複製提交訊息".

- [ ] **Step 1..n (TDD, one behavior at a time):** for each behavior write the RTL test first, watch it fail, implement, watch it pass. Required tests at minimum:

```tsx
it("opens a diff tab when a changed file row is clicked", ...)        // asserts openDiffTab spy / tabs state
it("shows discard only for tracked unstaged rows", ...)               // untracked row lacks the button & menu item
it("confirms before discarding and calls gitRestoreFile", ...)        // ConfirmDialog flow
it("right-click opens the custom menu with stage/copy items", ...)    // menuitem roles
it("history row right-click offers copy hash", ...)
```

- [ ] **Final step: Verify + commit** — `pnpm test && pnpm typecheck`; `git commit -am "feat(source-control): clickable rows, context menus and per-file discard"`.

---

### Task 5: Git Graph full-row click

**Files:**
- Modify: `src/modules/git-graph/GitGraph.tsx:218-230` (row positioning)
- Test: `src/modules/git-graph/GitGraph.test.tsx` (extend if present; else assert via GitGraphTabContent test utilities)

- [ ] **Step 1: Failing test** — render a graph with one commit, click at the row element (which should now span from the left edge), assert `onSelectCommit` fires. Concretely: change assertion target to the row's computed class (`left-0`) or click the row and check selection state.
- [ ] **Step 2: Implement** — row div: `left-[100px]` → `left-0`, add `pl-[100px]` to preserve text alignment (padding container already has `px-3`; fold the paddings: keep `pr-3 py-1`, replace `px-3` with `pl-[112px] pr-3` — 100px gutter + original 12px). Node buttons are `z-10` (`GitGraph.tsx:181`) and remain above the row hover background; the SVG is `pointer-events-none` so row clicks in the gutter land on the row.
- [ ] **Step 3: Visual check in the running app** — hover tint spans the lane gutter; lanes stay legible; node click still selects.
- [ ] **Step 4: Verify + commit** — `pnpm test && pnpm typecheck`; `git commit -am "fix(git-graph): make the full commit row clickable"`.

---

### Task 6: Compact "⋯" toolbar verification

**Files:**
- Possibly modify: `src/modules/git-graph/GitGraphToolbar.tsx`

- [ ] **Step 1: Reproduce** — run the app, narrow the Git Graph pane below 620px, open "⋯". Compare available actions against roomy mode (branch filter, remote toggle, search, tags/stashes/order, refresh, fetch).
- [ ] **Step 2: Decide** — if an action is genuinely unreachable in compact mode (suspect: branch filter while search is expanded, per `showBranchControls` logic ~line 157), move it into the overflow menu with a matching row; if everything is reachable, note the finding for the PR body / issue comment instead.
- [ ] **Step 3: If code changed:** add a test in `GitGraphToolbar.test.tsx` (compact-mode tests exist ~line 99) asserting the recovered action appears in the menu; `pnpm test && pnpm typecheck`; `git commit -am "fix(git-graph): expose <action> from the compact overflow menu"`.

---

### Task 7: Reviews, verification, build

- [ ] **Step 1:** `pnpm test && pnpm typecheck && (cd src-tauri && cargo test)` — full green.
- [ ] **Step 2:** Run `/code-review` and `/tauri-review`; fix CRITICAL/HIGH (and reasonable MEDIUM) findings; re-run until clean.
- [ ] **Step 3:** Verify in the running app (`pnpm tauri dev`): click a changed file → side-by-side diff tab; staged vs unstaged variants; discard flow end-to-end on a scratch repo; context menus; Git Graph row click; compact toolbar.
- [ ] **Step 4:** Local build for owner testing: `export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/tempo-term.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" && pnpm tauri build`, then open the bundled app.
