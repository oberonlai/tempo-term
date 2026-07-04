# Git Graph Keyboard Navigation and Compare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Up/Down and Shift+Up/Down keyboard navigation to the Git Graph commit list, plus Shift+click to diff two arbitrary commits, per issue #100 and the approved design at `docs/superpowers/specs/2026-07-04-git-graph-keyboard-nav-design.md`.

**Architecture:** Two new pure Rust commands generalize the existing "commit vs. its first parent" diff endpoints to "diff between two arbitrary commits". Two new pure TypeScript functions expose the existing lane-layout algorithm's first-parent/lane-continuation relationships for keyboard traversal. Commit selection becomes a `GraphSelection` union (`single` | `compare`) threaded through `GitGraph` → `GitGraphTabContent` → `CommitDetailsPanel`.

**Tech Stack:** React + TypeScript (Vitest + React Testing Library), Rust (Tauri commands, `#[cfg(test)]` unit tests against real temp git repos).

## Global Constraints

- Shift+Down always follows the commit's first parent (`parents[0]`); there is never a "pick which branch" UI, even at a merge commit.
- Plain Up/Down clamp at the list's top/bottom — no wraparound.
- Compare mode exits back to single-select on a plain click (no Shift) on any commit, or on any arrow-key press (plain or Shift).
- The AI "explain this diff" tab is not shown while in compare mode.
- `pnpm vitest run <file>` (the `test` script) does not type-check the whole project — it transpiles each test file independently, so a task can turn its own test file green even while a sibling file it calls into still has the *old* prop shape. Only `pnpm typecheck` (`tsc --noEmit`) checks the whole project at once. Because Tasks 3-5 change a prop contract shared across three files, the whole-project `pnpm typecheck` is expected to fail until Task 5 lands — verify each of Tasks 3-5 by running only that task's own test file, and treat `pnpm typecheck` as the final gate in Task 6, not a per-task gate.

---

### Task 1: Backend — diff between two arbitrary commits

**Files:**
- Modify: `src-tauri/src/modules/git/mod.rs` (add `commit_range_files`, `commit_range_file_diff`, their `#[tauri::command]` wrappers, and tests)
- Modify: `src-tauri/src/lib.rs` (register the two new commands)

**Interfaces:**
- Consumes: `CommitFileChange { status: String, path: String }` (already defined at `mod.rs:75`), `run_git(repo_path: &str, args: &[&str]) -> Result<String, String>` (`mod.rs:499`), `ensure_not_flag(value: &str) -> Result<(), String>` (`mod.rs:527`), `parse_name_status_line(line: &str) -> Option<CommitFileChange>` (`mod.rs:697`).
- Produces: `pub fn commit_range_files(repo_path: &str, from: &str, to: &str) -> Result<Vec<CommitFileChange>, String>`, `pub fn commit_range_file_diff(repo_path: &str, from: &str, to: &str, file: &str) -> Result<String, String>`, Tauri commands `git_commit_range_files` and `git_commit_range_file_diff` (used by Task 5's frontend bridge).

- [ ] **Step 1: Write the failing test**

Open `src-tauri/src/modules/git/mod.rs` and find the `mod tests` block (starts at line 1163). Add this test right after the `flag_like_arguments_are_rejected_before_running_git` test (which ends around line 1524):

```rust
    #[test]
    fn commit_range_files_and_diff_between_arbitrary_commits() {
        let dir = temp_repo_dir("range-diff");
        let path = dir.to_string_lossy().to_string();
        run_git(&path, &["init", "-b", "main"]).unwrap();
        run_git(&path, &["config", "user.email", "t@t.dev"]).unwrap();
        run_git(&path, &["config", "user.name", "Tester"]).unwrap();

        std::fs::write(dir.join("a.txt"), "line1\n").unwrap();
        run_git(&path, &["add", "a.txt"]).unwrap();
        run_git(&path, &["commit", "-m", "first"]).unwrap();
        let first = run_git(&path, &["rev-parse", "HEAD"]).unwrap().trim().to_string();

        std::fs::write(dir.join("a.txt"), "line1\nline2\n").unwrap();
        run_git(&path, &["commit", "-am", "second"]).unwrap();

        std::fs::write(dir.join("b.txt"), "new file\n").unwrap();
        run_git(&path, &["add", "b.txt"]).unwrap();
        run_git(&path, &["commit", "-am", "third"]).unwrap();
        let third = run_git(&path, &["rev-parse", "HEAD"]).unwrap().trim().to_string();

        // first..third skips the middle commit entirely — proves this isn't
        // limited to adjacent parent-child pairs like commit_details is.
        let files = commit_range_files(&path, &first, &third).unwrap();
        let mut paths: Vec<_> = files.iter().map(|f| f.path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, vec!["a.txt", "b.txt"]);
        assert!(files.iter().any(|f| f.path == "a.txt" && f.status == "M"));
        assert!(files.iter().any(|f| f.path == "b.txt" && f.status == "A"));

        let diff = commit_range_file_diff(&path, &first, &third, "a.txt").unwrap();
        assert!(diff.contains("+line2"));

        let _ = std::fs::remove_dir_all(&dir);
    }
```

Also extend the existing `flag_like_arguments_are_rejected_before_running_git` test (around line 1505-1524) by adding these two lines right before its closing `}`:

```rust
        assert!(commit_range_files("/no/such/repo", "-x", "HEAD").is_err());
        assert!(commit_range_file_diff("/no/such/repo", "HEAD", "-x", "a.txt").is_err());
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test commit_range`
Expected: compile error — `commit_range_files` and `commit_range_file_diff` are not defined.

- [ ] **Step 3: Implement the two pure functions**

In `src-tauri/src/modules/git/mod.rs`, find `commit_file_diff` (ends at line 1022, right before the blank line and `#[tauri::command]` at line 1024). Insert these two new functions between the end of `commit_file_diff` and the `#[tauri::command]` line:

```rust
/// 兩個任意 commit 之間變更的檔案清單(`git diff --name-status from to`)。
/// 不像 commit_details 限定「對第一個 parent」，from/to 可以是歷史上任意兩點。
pub fn commit_range_files(
    repo_path: &str,
    from: &str,
    to: &str,
) -> Result<Vec<CommitFileChange>, String> {
    let from = from.trim();
    let to = to.trim();
    if from.is_empty() || to.is_empty() {
        return Err("commit hash is required".to_string());
    }
    ensure_not_flag(from)?;
    ensure_not_flag(to)?;

    let name_status = run_git(repo_path, &["diff", "--name-status", from, to])?;
    let files = name_status
        .lines()
        .filter_map(parse_name_status_line)
        .collect();
    Ok(files)
}

/// 兩個任意 commit 之間、單一檔案的 diff(`git diff from to -- file`)。
pub fn commit_range_file_diff(
    repo_path: &str,
    from: &str,
    to: &str,
    file: &str,
) -> Result<String, String> {
    let from = from.trim();
    let to = to.trim();
    if from.is_empty() || to.is_empty() {
        return Err("commit hash is required".to_string());
    }
    ensure_not_flag(from)?;
    ensure_not_flag(to)?;

    run_git(repo_path, &["diff", from, to, "--", file])
}
```

Then find `git_commit_file_diff` (the `#[tauri::command]` wrapper, ends around line 1160, right before `#[cfg(test)]` at line 1162). Insert these two wrappers between the end of `git_commit_file_diff` and `#[cfg(test)]`:

```rust
#[tauri::command]
pub fn git_commit_range_files(
    repo_path: String,
    from: String,
    to: String,
) -> Result<Vec<CommitFileChange>, String> {
    commit_range_files(&repo_path, &from, &to)
}

#[tauri::command]
pub fn git_commit_range_file_diff(
    repo_path: String,
    from: String,
    to: String,
    file: String,
) -> Result<String, String> {
    commit_range_file_diff(&repo_path, &from, &to, &file)
}
```

- [ ] **Step 4: Register the two new commands in `lib.rs`**

In `src-tauri/src/lib.rs`, find the `use modules::git::{...}` block (starts at line 22). Change:

```rust
use modules::git::{
    git_branch_checkout, git_branch_checkout_track, git_branch_create_at, git_branch_delete,
    git_branches, git_cherry_pick, git_commit, git_commit_details, git_commit_file_diff, git_diff,
    git_fetch, git_file_at_rev, git_graph_log, git_log, git_merge, git_pull, git_push,
    git_push_delete, git_rebase, git_reset, git_resolve_repo, git_restore_file, git_revert,
    git_stage, git_status, git_tag_create, git_tag_delete, git_unstage, git_worktree_info,
    git_worktree_list,
};
```

to:

```rust
use modules::git::{
    git_branch_checkout, git_branch_checkout_track, git_branch_create_at, git_branch_delete,
    git_branches, git_cherry_pick, git_commit, git_commit_details, git_commit_file_diff,
    git_commit_range_file_diff, git_commit_range_files, git_diff, git_fetch, git_file_at_rev,
    git_graph_log, git_log, git_merge, git_pull, git_push, git_push_delete, git_rebase, git_reset,
    git_resolve_repo, git_restore_file, git_revert, git_stage, git_status, git_tag_create,
    git_tag_delete, git_unstage, git_worktree_info, git_worktree_list,
};
```

Then find the `generate_handler!` list entries (around lines 196-197):

```rust
            git_commit_details,
            git_commit_file_diff,
```

Change to:

```rust
            git_commit_details,
            git_commit_file_diff,
            git_commit_range_files,
            git_commit_range_file_diff,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test commit_range`
Expected: PASS (2 tests: `commit_range_files_and_diff_between_arbitrary_commits` and the extended `flag_like_arguments_are_rejected_before_running_git`)

Run: `cd src-tauri && cargo test flag_like_arguments`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/modules/git/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add backend commands to diff two arbitrary commits"
```

---

### Task 2: Frontend — first-parent and lane-continuation lookups

**Files:**
- Modify: `src/modules/git-graph/lib/graphLayout.ts`
- Test: `src/modules/git-graph/lib/graphLayout.test.ts`

**Interfaces:**
- Consumes: `GraphLayoutCommit { hash: string; parents: string[] }`, `GraphEdge { cx, cy, px, py, lane, childIndex, parentIndex, colorIndex }`, `computeGraphLayout` (all already in `graphLayout.ts`).
- Produces: `firstParentRowIndex(commits: readonly GraphLayoutCommit[], index: number): number | null`, `laneContinuationRowIndex(edges: readonly GraphEdge[], index: number): number | null` (both consumed by Task 3's `GitGraph.tsx`).

- [ ] **Step 1: Write the failing tests**

Open `src/modules/git-graph/lib/graphLayout.test.ts`. Add these imports to the existing `import { ... } from "./graphLayout";` at the top:

```ts
import {
  computeGraphLayout,
  DEFAULT_GEOMETRY,
  edgePath,
  firstParentRowIndex,
  laneContinuationRowIndex,
  laneX,
  type GraphEdge,
} from "./graphLayout";
```

Then append these two new `describe` blocks at the end of the file:

```ts
describe("firstParentRowIndex", () => {
  it("finds the row of the first parent in a simple chain", () => {
    const commits = [commit("c", ["b"]), commit("b", ["a"]), commit("a", [])];
    expect(firstParentRowIndex(commits, 0)).toBe(1);
    expect(firstParentRowIndex(commits, 1)).toBe(2);
  });

  it("returns null for a root commit with no parents", () => {
    const commits = [commit("a", [])];
    expect(firstParentRowIndex(commits, 0)).toBeNull();
  });

  it("returns null when the first parent is not loaded in the page", () => {
    const commits = [commit("only", ["missing-parent"])];
    expect(firstParentRowIndex(commits, 0)).toBeNull();
  });

  it("always follows the first parent from a merge commit, not the merged-in branch", () => {
    const commits = [commit("m", ["a", "b"]), commit("b", ["a"]), commit("a", [])];
    expect(firstParentRowIndex(commits, 0)).toBe(2); // "a" (index 2), not "b" (index 1)
  });

  it("resolves a short-hash parent reference by prefix", () => {
    const commits = [commit("abcdef1", ["abc"]), commit("abc", [])];
    expect(firstParentRowIndex(commits, 0)).toBe(1);
  });
});

describe("laneContinuationRowIndex", () => {
  it("finds the child that continues the same lane going up", () => {
    const commits = [commit("c", ["b"]), commit("b", ["a"]), commit("a", [])];
    const { edges } = computeGraphLayout(commits);
    expect(laneContinuationRowIndex(edges, 1)).toBe(0); // b's continuation is c
    expect(laneContinuationRowIndex(edges, 2)).toBe(1); // a's continuation is b
  });

  it("returns null for the newest commit on a lane", () => {
    const commits = [commit("c", ["b"]), commit("b", ["a"]), commit("a", [])];
    const { edges } = computeGraphLayout(commits);
    expect(laneContinuationRowIndex(edges, 0)).toBeNull();
  });

  it("skips the merge-in bend and finds the straight-line child at a fork", () => {
    // m merges a and b; from a's perspective going up, the straight
    // continuation is m (same lane), not the b->a bend.
    const commits = [commit("m", ["a", "b"]), commit("b", ["a"]), commit("a", [])];
    const { edges } = computeGraphLayout(commits);
    expect(laneContinuationRowIndex(edges, 2)).toBe(0); // a -> m, straight
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/modules/git-graph/lib/graphLayout.test.ts`
Expected: FAIL — `firstParentRowIndex` and `laneContinuationRowIndex` are not exported from `./graphLayout`.

- [ ] **Step 3: Implement the two functions**

In `src/modules/git-graph/lib/graphLayout.ts`, add these two functions after `computeGraphLayout` (after its closing `}` at line 177, before `edgePath` at line 180):

```ts
/**
 * Row index of `commits[index]`'s first parent within the same array. Null
 * if the commit has no parent, or its first parent isn't loaded in `commits`
 * yet (the caller should page in more history and retry).
 */
export function firstParentRowIndex(
  commits: readonly GraphLayoutCommit[],
  index: number,
): number | null {
  const parentHash = commits[index]?.parents[0];
  if (!parentHash) {
    return null;
  }
  const found = commits.findIndex(
    (c) =>
      c.hash === parentHash || c.hash.startsWith(parentHash) || parentHash.startsWith(c.hash),
  );
  return found === -1 ? null : found;
}

/**
 * Row index of the one commit whose first-parent edge continues
 * `commits[index]`'s exact lane going up (newer) — the straight line in the
 * graph, not a merge-in bend. Null if `commits[index]` is the newest commit
 * on its lane.
 */
export function laneContinuationRowIndex(
  edges: readonly GraphEdge[],
  index: number,
): number | null {
  const edge = edges.find((e) => e.parentIndex === index && e.cx === e.px);
  return edge ? edge.childIndex : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/modules/git-graph/lib/graphLayout.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add src/modules/git-graph/lib/graphLayout.ts src/modules/git-graph/lib/graphLayout.test.ts
git commit -m "feat: add first-parent and lane-continuation lookups to graph layout"
```

---

### Task 3: `GraphSelection` type and `GitGraph.tsx` keyboard + shift-click

**Files:**
- Modify: `src/modules/git-graph/types.ts`
- Modify: `src/modules/git-graph/GitGraph.tsx`
- Test: `src/modules/git-graph/GitGraph.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `firstParentRowIndex`, `laneContinuationRowIndex` (Task 2), `usePendingGraphSelectionStore` (existing, `lib/pendingGraphSelectionStore.ts`).
- Produces: `GraphSelection` type (`{ mode: "single"; commit: CommitNode } | { mode: "compare"; from: CommitNode; to: CommitNode }`, in `types.ts`, consumed by Tasks 4-5). `GitGraph`'s new prop contract: `selection: GraphSelection | null` (was `selectedCommit: CommitNode | null`), `onSelectCommit: (commit: CommitNode, options: { shiftKey: boolean }) => void` (was `(commit: CommitNode) => void`) — consumed by Task 4.

**Note:** After this task, `GitGraphTabContent.tsx` (unmodified until Task 4) will fail `pnpm typecheck` because it still passes the old `selectedCommit`/`onSelectCommit` prop shape. This is expected — verify this task with `pnpm vitest run src/modules/git-graph/GitGraph.test.tsx` only.

- [ ] **Step 1: Add the `GraphSelection` type**

In `src/modules/git-graph/types.ts`, add this after the `CommitNode` interface (after its closing `}` at line 16, before `GraphLog` at line 19):

```ts
/**
 * What the Git Graph commit list currently has selected: one commit, or two
 * commits being compared. `from`/`to` are ordered older/newer by list
 * position, not by click order.
 */
export type GraphSelection =
  | { mode: "single"; commit: CommitNode }
  | { mode: "compare"; from: CommitNode; to: CommitNode };
```

- [ ] **Step 2: Write the failing tests**

Replace the entire contents of `src/modules/git-graph/GitGraph.test.tsx` with:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GitGraph } from "./GitGraph";
import { usePendingGraphSelectionStore } from "./lib/pendingGraphSelectionStore";
import type { CommitNode } from "./types";

const LABELS = {
  emptyTitle: "No commits",
  emptyHint: "",
  loadMore: "Load more",
  refHint: "{{name}}",
} as never;

function commit(hash: string, parents: string[], message = hash): CommitNode {
  return { hash, parents, author: "a", date: "today", message, refs: [] };
}

function container(text: string): HTMLElement {
  return screen.getByText(text).closest("div.flex-1.overflow-auto") as HTMLElement;
}

describe("GitGraph row click area", () => {
  const COMMIT = commit("abc1234", [], "feat: x");

  it("selects the commit when clicking the row, including the lane gutter area", () => {
    const onSelect = vi.fn();
    render(
      <GitGraph commits={[COMMIT]} selection={null} onSelectCommit={onSelect} labels={LABELS} />,
    );

    const row = screen.getByText("feat: x").closest("div[class*='absolute']");
    expect(row).not.toBeNull();
    // The row must span from the container's left edge so clicks beside the
    // node dot (in the lane gutter) still open the commit detail.
    expect(row!.className).toContain("left-0");
    fireEvent.click(row!);
    expect(onSelect).toHaveBeenCalledWith(COMMIT, { shiftKey: false });
  });

  it("passes shiftKey through to onSelectCommit for compare mode", () => {
    const onSelect = vi.fn();
    render(
      <GitGraph commits={[COMMIT]} selection={null} onSelectCommit={onSelect} labels={LABELS} />,
    );

    const row = screen.getByText("feat: x").closest("div[class*='absolute']");
    fireEvent.click(row!, { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(COMMIT, { shiftKey: true });
  });
});

describe("GitGraph keyboard navigation", () => {
  const commits = [
    commit("c", ["b"], "msg c"),
    commit("b", ["a"], "msg b"),
    commit("a", [], "msg a"),
  ];

  function renderGraph(selected: CommitNode, onSelect = vi.fn()) {
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: selected }}
        onSelectCommit={onSelect}
        labels={LABELS}
      />,
    );
    return onSelect;
  }

  it("ArrowDown moves to the adjacent row below", () => {
    const onSelect = renderGraph(commits[0]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith(commits[1], { shiftKey: false });
  });

  it("ArrowUp moves to the adjacent row above", () => {
    const onSelect = renderGraph(commits[1]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith(commits[0], { shiftKey: false });
  });

  it("clamps at the bottom without wrapping", () => {
    const onSelect = renderGraph(commits[2]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowDown" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clamps at the top without wrapping", () => {
    const onSelect = renderGraph(commits[0]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowUp" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Shift+ArrowDown follows the first-parent chain", () => {
    const onSelect = renderGraph(commits[0]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowDown", shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(commits[1], { shiftKey: false });
  });

  it("Shift+ArrowUp no-ops on the newest commit of a lane", () => {
    const onSelect = renderGraph(commits[0]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowUp", shiftKey: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Shift+ArrowUp follows the lane continuation", () => {
    const onSelect = renderGraph(commits[1]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowUp", shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(commits[0], { shiftKey: false });
  });

  it("Shift+ArrowDown no-ops at a root commit", () => {
    const onSelect = renderGraph(commits[2]);
    fireEvent.keyDown(container("msg c"), { key: "ArrowDown", shiftKey: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Shift+ArrowDown requests pagination when the parent is not loaded", () => {
    usePendingGraphSelectionStore.setState({ hash: null });
    const rootless = [commit("only", ["missing-parent"], "msg only")];
    render(
      <GitGraph
        commits={rootless}
        selection={{ mode: "single", commit: rootless[0] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );
    fireEvent.keyDown(container("msg only"), { key: "ArrowDown", shiftKey: true });
    expect(usePendingGraphSelectionStore.getState().hash).toBe("missing-parent");
  });
});

describe("GitGraph compare-mode highlighting", () => {
  it("marks both endpoints as selected", () => {
    const commits = [commit("c", ["b"], "msg c"), commit("b", ["a"], "msg b")];
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "compare", from: commits[1], to: commits[0] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );
    const rowC = screen.getByText("msg c").closest("div[class*='absolute']");
    const rowB = screen.getByText("msg b").closest("div[class*='absolute']");
    expect(rowC!.className).toContain("border-border-strong");
    expect(rowB!.className).toContain("border-border-strong");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/modules/git-graph/GitGraph.test.tsx`
Expected: FAIL — `GitGraph` doesn't accept a `selection` prop yet, and `onSelectCommit` is called with only one argument.

- [ ] **Step 4: Update `GitGraph.tsx`'s imports and props**

In `src/modules/git-graph/GitGraph.tsx`, change the import block (lines 1-11) from:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, GitBranch, Tag, User } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import type { CommitNode, CommitRef } from "./types";
import {
  computeGraphLayout,
  DEFAULT_GEOMETRY,
  edgePath,
} from "./lib/graphLayout";
import { isCurrentCommit } from "./lib/currentCommit";
import { BRANCH_COLORS } from "./lib/branchColors";
```

to:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, GitBranch, Tag, User } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import type { CommitNode, CommitRef, GraphSelection } from "./types";
import {
  computeGraphLayout,
  DEFAULT_GEOMETRY,
  edgePath,
  firstParentRowIndex,
  laneContinuationRowIndex,
} from "./lib/graphLayout";
import { isCurrentCommit } from "./lib/currentCommit";
import { BRANCH_COLORS } from "./lib/branchColors";
import { usePendingGraphSelectionStore } from "./lib/pendingGraphSelectionStore";
```

Change the props interface (lines 20-29) from:

```tsx
interface GitGraphProps {
  commits: CommitNode[];
  selectedCommit: CommitNode | null;
  onSelectCommit: (commit: CommitNode) => void;
  onCommitContextMenu?: (commit: CommitNode, x: number, y: number) => void;
  onRefContextMenu?: (ref: CommitRef, x: number, y: number) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  labels: GitGraphLabels;
}
```

to:

```tsx
interface GitGraphProps {
  commits: CommitNode[];
  selection: GraphSelection | null;
  onSelectCommit: (commit: CommitNode, options: { shiftKey: boolean }) => void;
  onCommitContextMenu?: (commit: CommitNode, x: number, y: number) => void;
  onRefContextMenu?: (ref: CommitRef, x: number, y: number) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  labels: GitGraphLabels;
}
```

Change the component's destructured parameters (lines 45-54) from:

```tsx
export function GitGraph({
  commits,
  selectedCommit,
  onSelectCommit,
  onCommitContextMenu,
  onRefContextMenu,
  hasMore = false,
  onLoadMore,
  labels,
}: GitGraphProps) {
```

to:

```tsx
export function GitGraph({
  commits,
  selection,
  onSelectCommit,
  onCommitContextMenu,
  onRefContextMenu,
  hasMore = false,
  onLoadMore,
  labels,
}: GitGraphProps) {
```

- [ ] **Step 5: Add the click/keyboard handlers**

Still in `GitGraph.tsx`, right after `const { layouts, edges } = useMemo(() => computeGraphLayout(commits), [commits]);` (line 75), add:

```tsx

  const activeHash =
    selection?.mode === "single"
      ? selection.commit.hash
      : selection?.mode === "compare"
        ? selection.to.hash
        : null;

  const isSelectedHash = (hash: string) =>
    selection?.mode === "compare"
      ? hash === selection.from.hash || hash === selection.to.hash
      : hash === activeHash;

  function selectFromClick(commit: CommitNode, event: { shiftKey: boolean }) {
    scrollRef.current?.focus();
    onSelectCommit(commit, { shiftKey: event.shiftKey });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (commits.length === 0 || !activeHash) {
      return;
    }
    const currentIndex = commits.findIndex((c) => c.hash === activeHash);
    if (currentIndex === -1) {
      return;
    }
    if (event.key === "ArrowDown" && !event.shiftKey) {
      event.preventDefault();
      const targetIndex = Math.min(currentIndex + 1, commits.length - 1);
      if (targetIndex !== currentIndex) {
        onSelectCommit(commits[targetIndex], { shiftKey: false });
      }
    } else if (event.key === "ArrowUp" && !event.shiftKey) {
      event.preventDefault();
      const targetIndex = Math.max(currentIndex - 1, 0);
      if (targetIndex !== currentIndex) {
        onSelectCommit(commits[targetIndex], { shiftKey: false });
      }
    } else if (event.key === "ArrowDown" && event.shiftKey) {
      event.preventDefault();
      const parentHash = commits[currentIndex].parents[0];
      if (!parentHash) {
        return;
      }
      const targetIndex = firstParentRowIndex(commits, currentIndex);
      if (targetIndex !== null) {
        onSelectCommit(commits[targetIndex], { shiftKey: false });
      } else {
        usePendingGraphSelectionStore.getState().request(parentHash);
      }
    } else if (event.key === "ArrowUp" && event.shiftKey) {
      event.preventDefault();
      const targetIndex = laneContinuationRowIndex(edges, currentIndex);
      if (targetIndex !== null) {
        onSelectCommit(commits[targetIndex], { shiftKey: false });
      }
    }
  }
```

- [ ] **Step 6: Wire the handlers into the render**

Still in `GitGraph.tsx`, change the scroll container's opening tag (lines 100-107) from:

```tsx
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        onScroll={(event) => {
          const target = event.currentTarget;
          setViewport({ scrollTop: target.scrollTop, height: target.clientHeight });
        }}
      >
```

to:

```tsx
      <div
        ref={scrollRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex-1 overflow-auto outline-none"
        onScroll={(event) => {
          const target = event.currentTarget;
          setViewport({ scrollTop: target.scrollTop, height: target.clientHeight });
        }}
      >
```

Change the SVG node button (lines 148, 154) from:

```tsx
              const isSelected = selectedCommit?.hash === commit.hash;
```

(this appears twice, once for the node at line 148 and once for the row at line 191 — replace **both** occurrences with:)

```tsx
              const isSelected = isSelectedHash(commit.hash);
```

Change the node button's `onClick` (line 154) from:

```tsx
                    onClick={() => onSelectCommit(commit)}
```

to:

```tsx
                    onClick={(e) => selectFromClick(commit, e)}
```

Change the row `<div>`'s `onClick` (line 207) from:

```tsx
                  onClick={() => onSelectCommit(commit)}
```

to:

```tsx
                  onClick={(e) => selectFromClick(commit, e)}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run src/modules/git-graph/GitGraph.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 8: Commit**

```bash
git add src/modules/git-graph/types.ts src/modules/git-graph/GitGraph.tsx src/modules/git-graph/GitGraph.test.tsx
git commit -m "feat: add keyboard navigation and shift-click selection to GitGraph"
```

---

### Task 4: `GitGraphTabContent.tsx` — compare-mode selection state

**Files:**
- Modify: `src/modules/git-graph/GitGraphTabContent.tsx`

**Interfaces:**
- Consumes: `GraphSelection` type, `GitGraph`'s new `selection`/`onSelectCommit` contract (Task 3).
- Produces: nothing new consumed by other tasks directly, but this task changes `CommitDetailsPanel`'s call site to pass `selection={selection}` instead of `commit={selected}` — Task 5 must land for the whole project to typecheck again (see Global Constraints note).

**Note:** No dedicated test file changes are required — the existing `GitGraphTabContent.test.tsx` asserts on rendered DOM text (e.g. the commit hash appearing once details are shown), which stays identical in single-select mode. This task is verified by confirming those existing assertions still pass, plus a manual compare-mode check in Task 6's end-to-end pass (`CommitDetailsPanel` doesn't yet render compare mode until Task 5, so an automated compare-mode test belongs there).

- [ ] **Step 1: Run the existing test file to confirm the starting baseline**

Run: `pnpm vitest run src/modules/git-graph/GitGraphTabContent.test.tsx`
Expected: PASS (this establishes the baseline before this task's changes — these tests must still pass after Step 2 below)

- [ ] **Step 2: Replace the `selected` state with `selection`, and add `handleSelectCommit`**

In `src/modules/git-graph/GitGraphTabContent.tsx`, change the type import (line 38) from:

```tsx
import type { Branch, CommitNode, CommitRef, CommitOrder, GraphOptions } from "./types";
```

to:

```tsx
import type { Branch, CommitNode, CommitRef, CommitOrder, GraphOptions, GraphSelection } from "./types";
```

Change the state declaration (line 79) from:

```tsx
  const [selected, setSelected] = useState<CommitNode | null>(null);
```

to:

```tsx
  const [selection, setSelection] = useState<GraphSelection | null>(null);
```

Add a new `handleSelectCommit` callback right after the `loadMore` callback (after its closing `}, [...]);` around line 235, before the `// Consume a pending "select this commit" request...` comment at line 237):

```tsx

  // Plain click/arrow-nav selects one commit. Shift+click while a commit is
  // already selected (single or as the "to" side of an existing compare)
  // pairs it with the new one, ordered older ("from") to newer ("to") by
  // position in `commits` — the list is already newest-first, so no extra
  // git call is needed to know which side is which.
  const handleSelectCommit = useCallback(
    (commit: CommitNode, { shiftKey }: { shiftKey: boolean }) => {
      if (!shiftKey) {
        setSelection({ mode: "single", commit });
        return;
      }
      setSelection((prev) => {
        const anchor =
          prev?.mode === "single" ? prev.commit : prev?.mode === "compare" ? prev.to : null;
        if (!anchor || anchor.hash === commit.hash) {
          return { mode: "single", commit };
        }
        const anchorIndex = commits.findIndex((c) => c.hash === anchor.hash);
        const commitIndex = commits.findIndex((c) => c.hash === commit.hash);
        const [from, to] = anchorIndex > commitIndex ? [anchor, commit] : [commit, anchor];
        return { mode: "compare", from, to };
      });
    },
    [commits],
  );
```

- [ ] **Step 3: Update the pending-selection effect**

In the same file, find the pending-hash effect (around lines 262-270):

```tsx
    const visibleMatch = visibleCommits.find((c) => hashMatches(c.hash));
    if (visibleMatch) {
      setSelected(visibleMatch);
      usePendingGraphSelectionStore.getState().consume();
      pendingSelectionAttempts.current = 0;
      return;
    }
```

Change `setSelected(visibleMatch);` to:

```tsx
      setSelection({ mode: "single", commit: visibleMatch });
```

- [ ] **Step 4: Update the `GitGraph` and `CommitDetailsPanel` render**

Find the render block (around lines 583-614):

```tsx
          <GitGraph
            commits={visibleCommits}
            selectedCommit={selected}
            onSelectCommit={setSelected}
            onCommitContextMenu={(commit, x, y) =>
              setMenu({ type: "commit", commit, x, y })
            }
            onRefContextMenu={(ref, x, y) => setMenu({ type: "ref", ref, x, y })}
            hasMore={hasMore}
            onLoadMore={loadMore}
            labels={labels}
          />
        </div>
        {selected && repo && (
          <>
            <Resizer
              orientation="horizontal"
              onResize={(delta) =>
                setDetailsHeight((h) => Math.min(700, Math.max(120, h - delta)))
              }
              onResizeEnd={persistDetailsHeight}
            />
            <div style={{ height: `${detailsHeight}px` }} className="shrink-0">
              <CommitDetailsPanel
                repo={repo}
                commit={selected}
                onClose={() => setSelected(null)}
                labels={detailsLabels}
              />
            </div>
          </>
        )}
```

Change to:

```tsx
          <GitGraph
            commits={visibleCommits}
            selection={selection}
            onSelectCommit={handleSelectCommit}
            onCommitContextMenu={(commit, x, y) =>
              setMenu({ type: "commit", commit, x, y })
            }
            onRefContextMenu={(ref, x, y) => setMenu({ type: "ref", ref, x, y })}
            hasMore={hasMore}
            onLoadMore={loadMore}
            labels={labels}
          />
        </div>
        {selection && repo && (
          <>
            <Resizer
              orientation="horizontal"
              onResize={(delta) =>
                setDetailsHeight((h) => Math.min(700, Math.max(120, h - delta)))
              }
              onResizeEnd={persistDetailsHeight}
            />
            <div style={{ height: `${detailsHeight}px` }} className="shrink-0">
              <CommitDetailsPanel
                repo={repo}
                selection={selection}
                onClose={() => setSelection(null)}
                labels={detailsLabels}
              />
            </div>
          </>
        )}
```

- [ ] **Step 5: Run the existing tests**

Run: `pnpm vitest run src/modules/git-graph/GitGraphTabContent.test.tsx`
Expected: PASS (same tests as Step 1's baseline — `selected`/`selection` is an internal rename, so the DOM output they assert on is unchanged). Note: `pnpm typecheck` will still fail at this point because `CommitDetailsPanel` hasn't been updated to accept `selection` yet — that's expected until Task 5.

- [ ] **Step 6: Commit**

```bash
git add src/modules/git-graph/GitGraphTabContent.tsx
git commit -m "feat: track compare-mode selection state in GitGraphTabContent"
```

---

### Task 5: Bridge functions + `CommitDetailsPanel.tsx` compare mode

**Files:**
- Modify: `src/modules/git-graph/lib/gitGraphBridge.ts`
- Modify: `src/modules/git-graph/CommitDetailsPanel.tsx`
- Test: `src/modules/git-graph/CommitDetailsPanel.test.tsx`
- Test: `src/modules/git-graph/GitGraphTabContent.test.tsx` (adds the end-to-end compare-mode flow; Task 4 already established the pending-selection baseline in this same file)

**Interfaces:**
- Consumes: `git_commit_range_files`/`git_commit_range_file_diff` Tauri commands (Task 1), `GraphSelection` type (Task 3), `selection` prop now passed by `GitGraphTabContent` (Task 4).
- Produces: `gitCommitRangeFiles(repoPath, from, to): Promise<CommitFileChange[]>`, `gitCommitRangeFileDiff(repoPath, from, to, file): Promise<string>`. `CommitDetailsPanel`'s new prop contract: `selection: GraphSelection` (was `commit: CommitNode`) — this is the last piece of the shared prop-shape change, so `pnpm typecheck` becomes green again after this task.

- [ ] **Step 1: Write the failing tests**

Open `src/modules/git-graph/CommitDetailsPanel.test.tsx`. Change the import and mock at the top from:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { CommitDetailsPanel } from "./CommitDetailsPanel";
import { gitCommitDetails, gitCommitFileDiff } from "./lib/gitGraphBridge";
import type { CommitNode } from "./types";

vi.mock("./lib/gitGraphBridge", () => ({
  gitCommitDetails: vi.fn(),
  gitCommitFileDiff: vi.fn().mockResolvedValue(""),
}));
```

to:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { CommitDetailsPanel } from "./CommitDetailsPanel";
import {
  gitCommitDetails,
  gitCommitFileDiff,
  gitCommitRangeFiles,
  gitCommitRangeFileDiff,
} from "./lib/gitGraphBridge";
import type { CommitNode } from "./types";

vi.mock("./lib/gitGraphBridge", () => ({
  gitCommitDetails: vi.fn(),
  gitCommitFileDiff: vi.fn().mockResolvedValue(""),
  gitCommitRangeFiles: vi.fn(),
  gitCommitRangeFileDiff: vi.fn().mockResolvedValue(""),
}));
```

Change all three existing `render(<CommitDetailsPanel repo="/repo" commit={COMMIT} onClose={() => {}} labels={LABELS} />)` calls (lines 52, 67, 82) to:

```tsx
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "single", commit: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );
```

Then append this new `describe` block at the end of the file:

```tsx

describe("CommitDetailsPanel compare mode", () => {
  const OTHER: CommitNode = {
    hash: "def5678",
    parents: [],
    author: "b",
    date: "yesterday",
    message: "fix: y",
    refs: [],
  };

  it("shows both hashes in the header and fetches the range diff", async () => {
    vi.mocked(gitCommitRangeFiles).mockResolvedValue([{ status: "M", path: "a.ts" }]);
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "compare", from: OTHER, to: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );

    expect(await screen.findByText("def5678 .. abc1234")).toBeInTheDocument();
    await waitFor(() =>
      expect(gitCommitRangeFileDiff).toHaveBeenCalledWith("/repo", "def5678", "abc1234", "a.ts"),
    );
  });

  it("hides the AI tab in compare mode", async () => {
    vi.mocked(gitCommitRangeFiles).mockResolvedValue([{ status: "M", path: "a.ts" }]);
    render(
      <CommitDetailsPanel
        repo="/repo"
        selection={{ mode: "compare", from: OTHER, to: COMMIT }}
        onClose={() => {}}
        labels={LABELS}
      />,
    );
    await screen.findByText("a.ts");
    expect(screen.queryByRole("button", { name: "AI Explain" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/modules/git-graph/CommitDetailsPanel.test.tsx`
Expected: FAIL — `CommitDetailsPanel` doesn't accept a `selection` prop, and `gitCommitRangeFiles`/`gitCommitRangeFileDiff` aren't exported from the bridge.

- [ ] **Step 3: Add the bridge functions**

In `src/modules/git-graph/lib/gitGraphBridge.ts`, change the type import (line 2) from:

```ts
import type { Branch, CommitDetails, GraphLog, GraphOptions } from "../types";
```

to:

```ts
import type { Branch, CommitDetails, CommitFileChange, GraphLog, GraphOptions } from "../types";
```

Then add these two functions right after `gitCommitFileDiff` (after its closing `}` around line 122, before the `WorktreeItem` interface):

```ts

/** Read the file list changed between two arbitrary commits (name-status). */
export function gitCommitRangeFiles(
  repoPath: string,
  from: string,
  to: string,
): Promise<CommitFileChange[]> {
  return invoke<CommitFileChange[]>("git_commit_range_files", { repoPath, from, to });
}

/** Read a single file's diff between two arbitrary commits. */
export function gitCommitRangeFileDiff(
  repoPath: string,
  from: string,
  to: string,
  file: string,
): Promise<string> {
  return invoke<string>("git_commit_range_file_diff", { repoPath, from, to, file });
}
```

- [ ] **Step 4: Update `CommitDetailsPanel.tsx`'s imports and props**

In `src/modules/git-graph/CommitDetailsPanel.tsx`, change the bridge import (line 9) from:

```tsx
import { gitCommitDetails, gitCommitFileDiff } from "./lib/gitGraphBridge";
```

to:

```tsx
import {
  gitCommitDetails,
  gitCommitFileDiff,
  gitCommitRangeFiles,
  gitCommitRangeFileDiff,
} from "./lib/gitGraphBridge";
```

Change the type import (line 14) from:

```tsx
import type { CommitDetails, CommitFileChange, CommitNode, DiffLine } from "./types";
```

to:

```tsx
import type { CommitDetails, CommitFileChange, DiffLine, GraphSelection } from "./types";
```

Change the props interface (lines 38-43) from:

```tsx
interface CommitDetailsPanelProps {
  repo: string;
  commit: CommitNode;
  onClose: () => void;
  labels: CommitDetailsLabels;
}
```

to:

```tsx
interface CommitDetailsPanelProps {
  repo: string;
  selection: GraphSelection;
  onClose: () => void;
  labels: CommitDetailsLabels;
}
```

- [ ] **Step 5: Update the component body**

Change the component signature (line 152) from:

```tsx
export function CommitDetailsPanel({ repo, commit, onClose, labels }: CommitDetailsPanelProps) {
```

to:

```tsx
export function CommitDetailsPanel({ repo, selection, onClose, labels }: CommitDetailsPanelProps) {
```

Right after the destructured props (before `const [details, setDetails] = useState...` at line 153), add:

```tsx
  const isCompare = selection.mode === "compare";
  // Non-null only in single mode; used for the author/date/message block and
  // the AI-explain tab, both of which only make sense for one commit. Safe to
  // assert `!` where used below because both are unreachable while isCompare
  // is true (the AI tab button that would flip `tab` to "ai" isn't rendered).
  const singleCommit = selection.mode === "single" ? selection.commit : null;
  const rangeKey =
    selection.mode === "single" ? selection.commit.hash : `${selection.from.hash}..${selection.to.hash}`;
  const headerHash =
    selection.mode === "single" ? selection.commit.hash : `${selection.from.hash} .. ${selection.to.hash}`;
```

Change the data-fetch effect (lines 185-208) from:

```tsx
  // Load message + changed files when the commit changes; auto-open first file.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDetails(null);
    setSelectedFile(null);
    setDiffLines([]);
    resetCollapsedFolders();
    gitCommitDetails(repo, commit.hash)
      .then((d) => {
        if (cancelled) {
          return;
        }
        setDetails(d);
        setSelectedFile(d.files[0]?.path ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(getErrorMessage(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo, commit.hash, resetCollapsedFolders]);
```

to:

```tsx
  // Load message + changed files when the selection changes; auto-open first
  // file. Compare mode has no single message, so `details.message` stays "".
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDetails(null);
    setSelectedFile(null);
    setDiffLines([]);
    resetCollapsedFolders();
    const request =
      selection.mode === "single"
        ? gitCommitDetails(repo, selection.commit.hash)
        : gitCommitRangeFiles(repo, selection.from.hash, selection.to.hash).then((files) => ({
            message: "",
            files,
          }));
    request
      .then((d) => {
        if (cancelled) {
          return;
        }
        setDetails(d);
        setSelectedFile(d.files[0]?.path ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(getErrorMessage(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo, selection, resetCollapsedFolders]);
```

Change the diff-fetch effect (lines 212-236) from:

```tsx
  // Lazily load the selected file's diff (both parsed lines and raw text), and
  // reset to the Diff tab when the file changes.
  useEffect(() => {
    setTab("diff");
    if (!selectedFile) {
      setDiffLines([]);
      setDiffText("");
      return;
    }
    let cancelled = false;
    gitCommitFileDiff(repo, commit.hash, selectedFile)
      .then((diff) => {
        if (!cancelled) {
          setDiffText(diff);
          setDiffLines(parseDiffLines(diff));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDiffText("");
          setDiffLines([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo, commit.hash, selectedFile]);
```

to:

```tsx
  // Lazily load the selected file's diff (both parsed lines and raw text), and
  // reset to the Diff tab when the file changes.
  useEffect(() => {
    setTab("diff");
    if (!selectedFile) {
      setDiffLines([]);
      setDiffText("");
      return;
    }
    let cancelled = false;
    const request =
      selection.mode === "single"
        ? gitCommitFileDiff(repo, selection.commit.hash, selectedFile)
        : gitCommitRangeFileDiff(repo, selection.from.hash, selection.to.hash, selectedFile);
    request
      .then((diff) => {
        if (!cancelled) {
          setDiffText(diff);
          setDiffLines(parseDiffLines(diff));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDiffText("");
          setDiffLines([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo, selection, selectedFile]);
```

Change the `useVirtualRows` call (lines 244-250) from:

```tsx
  const filesWindow = useVirtualRows(
    files.length,
    FILE_ROW_HEIGHT,
    FILE_OVERSCAN,
    commit.hash,
    { listRef: fileListRef },
  );
```

to:

```tsx
  const filesWindow = useVirtualRows(
    files.length,
    FILE_ROW_HEIGHT,
    FILE_OVERSCAN,
    rangeKey,
    { listRef: fileListRef },
  );
```

Change the header (lines 256-258) from:

```tsx
        <span className="select-all font-mono text-xs font-semibold text-accent">
          {commit.hash}
        </span>
```

to:

```tsx
        <span className="select-all font-mono text-xs font-semibold text-accent">
          {headerHash}
        </span>
```

Change the metadata block (lines 281-293) from:

```tsx
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[13px] text-fg-subtle">
            <span>
              {labels.author}: {commit.author}
            </span>
            <span>
              {labels.date}: {commit.date}
            </span>
          </div>
          {details && (
            <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] text-fg">
              {details.message}
            </pre>
          )}
```

to:

```tsx
          {singleCommit && (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[13px] text-fg-subtle">
                <span>
                  {labels.author}: {singleCommit.author}
                </span>
                <span>
                  {labels.date}: {singleCommit.date}
                </span>
              </div>
              {details && (
                <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] text-fg">
                  {details.message}
                </pre>
              )}
            </>
          )}
```

Change the AI tab button (lines 379-389) from:

```tsx
                <button
                  type="button"
                  onClick={() => setTab("ai")}
                  className={`rounded px-2 py-0.5 text-[13px] ${
                    tab === "ai"
                      ? "bg-bg-elevated text-fg"
                      : "text-fg-subtle hover:text-fg"
                  }`}
                >
                  {labels.aiTab}
                </button>
```

to:

```tsx
                {!isCompare && (
                  <button
                    type="button"
                    onClick={() => setTab("ai")}
                    className={`rounded px-2 py-0.5 text-[13px] ${
                      tab === "ai"
                        ? "bg-bg-elevated text-fg"
                        : "text-fg-subtle hover:text-fg"
                    }`}
                  >
                    {labels.aiTab}
                  </button>
                )}
```

Change the `DiffExplain` usage (around line 395-410) from:

```tsx
                  <DiffExplain
                    key={`${commit.hash}|${selectedFile}`}
                    commitHash={commit.hash}
                    file={selectedFile}
```

to:

```tsx
                  <DiffExplain
                    key={`${singleCommit!.hash}|${selectedFile}`}
                    commitHash={singleCommit!.hash}
                    file={selectedFile}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/modules/git-graph/CommitDetailsPanel.test.tsx`
Expected: PASS (all tests, including the three pre-existing ones updated in Step 1)

- [ ] **Step 7: Add an end-to-end compare-mode test through `GitGraphTabContent`**

This is the first point where the full click → shift-click → compare UI → plain-click-collapses flow can be exercised through real components (Task 4 added the state logic, but `CommitDetailsPanel` couldn't render compare mode until this task). Open `src/modules/git-graph/GitGraphTabContent.test.tsx` and update the bridge mock (lines 13-20) from:

```tsx
vi.mock("./lib/gitGraphBridge", () => ({
  gitGraphLog: vi.fn(),
  gitBranches: vi.fn().mockResolvedValue([]),
  gitFetch: vi.fn(),
  gitCommitDetails: vi.fn().mockResolvedValue({ message: "", files: [] }),
  gitCommitFileDiff: vi.fn().mockResolvedValue(""),
  gitWorktreeList: vi.fn().mockResolvedValue([]),
}));

import { gitGraphLog, gitWorktreeList } from "./lib/gitGraphBridge";
```

to:

```tsx
vi.mock("./lib/gitGraphBridge", () => ({
  gitGraphLog: vi.fn(),
  gitBranches: vi.fn().mockResolvedValue([]),
  gitFetch: vi.fn(),
  gitCommitDetails: vi.fn().mockResolvedValue({ message: "", files: [] }),
  gitCommitFileDiff: vi.fn().mockResolvedValue(""),
  gitCommitRangeFiles: vi.fn().mockResolvedValue([]),
  gitCommitRangeFileDiff: vi.fn().mockResolvedValue(""),
  gitWorktreeList: vi.fn().mockResolvedValue([]),
}));

import { gitGraphLog, gitWorktreeList } from "./lib/gitGraphBridge";
```

Then append this new `describe` block at the end of the file:

```tsx

describe("GitGraphTabContent compare mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitWorktreeList).mockResolvedValue([]);
    usePendingGraphSelectionStore.setState({ hash: null });
    useWorkspaceStore.getState().setRoot("/repo");
  });

  it("shift-clicking a second commit shows the compare header, and a plain click collapses back", async () => {
    vi.mocked(gitGraphLog).mockImplementation(async () =>
      commitList(["aaa1111", "bbb2222"], false),
    );

    render(<GitGraphTabContent />);
    await waitFor(() => screen.getByText("msg aaa1111"));

    const rowA = screen.getByText("msg aaa1111").closest("div[class*='absolute']")!;
    const rowB = screen.getByText("msg bbb2222").closest("div[class*='absolute']")!;

    fireEvent.click(rowA);
    fireEvent.click(rowB, { shiftKey: true });

    // aaa1111 is the newer commit (index 0), bbb2222 the older one (index 1):
    // from (older) .. to (newer).
    await waitFor(() => expect(screen.getByText("bbb2222 .. aaa1111")).toBeInTheDocument());

    fireEvent.click(rowA);

    await waitFor(() => expect(screen.getAllByText("aaa1111").length).toBeGreaterThan(0));
    expect(screen.queryByText("bbb2222 .. aaa1111")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run src/modules/git-graph/GitGraphTabContent.test.tsx`
Expected: PASS (all tests, including the new compare-mode test and every pre-existing pending-selection test from Task 4's baseline)

- [ ] **Step 9: Run the full frontend test suite and typecheck**

Run: `pnpm vitest run`
Expected: PASS (every test file)

Run: `pnpm typecheck`
Expected: PASS — this is the first point since Task 3 where the whole project type-checks cleanly again.

- [ ] **Step 10: Commit**

```bash
git add src/modules/git-graph/lib/gitGraphBridge.ts src/modules/git-graph/CommitDetailsPanel.tsx src/modules/git-graph/CommitDetailsPanel.test.tsx src/modules/git-graph/GitGraphTabContent.test.tsx
git commit -m "feat: add two-commit compare mode to CommitDetailsPanel"
```

---

### Task 6: Final verification

**Files:** none (verification only; fix forward in the relevant file from Tasks 1-5 if something surfaces here)

- [ ] **Step 1: Run the full frontend suite**

Run: `pnpm vitest run`
Expected: PASS, 0 failures

- [ ] **Step 2: Run the full frontend typecheck**

Run: `pnpm typecheck`
Expected: PASS, 0 errors

- [ ] **Step 3: Run the full Rust test suite**

Run: `cd src-tauri && cargo test`
Expected: PASS, 0 failures

- [ ] **Step 4: Build and manually verify in the running app**

Build a local test copy per this project's documented local-build command:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/tempo-term.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  && pnpm tauri build
```

Open the built app (`src-tauri/target/release/bundle/macos/TempoTerm.app`) against a real git repo with at least one merge commit in its history (this repo itself works), open the Git Graph tab, and manually verify:

1. Click a commit row — it gets selected and the details panel opens.
2. Press `ArrowDown` / `ArrowUp` repeatedly — selection moves one row at a time, stops (doesn't wrap) at the top and bottom of the loaded list.
3. Select a merge commit, press `Shift+ArrowDown` — selection jumps to the merge's first parent (the mainline side), not the merged-in branch.
4. From that first-parent commit, press `Shift+ArrowUp` — selection jumps back to the merge commit.
5. Select a commit's feature-branch history, press `Shift+ArrowDown` repeatedly toward the bottom of the loaded list — more history pages in automatically and selection keeps moving (no dead stop mid-branch).
6. Click one commit, then Shift+click a different one — the details panel switches to showing `hash1 .. hash2` with a combined changed-files list and diff, and the "AI Explain" tab is gone.
7. Click any commit without Shift — compare mode ends, back to single-commit details.
8. While in compare mode, press a plain arrow key — compare mode ends and selection moves normally from where the arrow key would put it.

- [ ] **Step 5: Report results**

If all manual checks in Step 4 pass, the feature is complete — no further commit needed for this task (it's verification-only). If any check fails, identify which of Tasks 1-5 owns the affected file, fix it there with its own updated test, and re-run Steps 1-4 of this task.
