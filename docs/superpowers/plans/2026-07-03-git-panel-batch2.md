# Git Panel Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sidebar commit rows jump to Git Graph with the commit selected, and both the sidebar's changed-files list and Git Graph's commit-details panel gain a true nested folder tree with recursive folder actions — spec: `docs/superpowers/specs/2026-07-03-git-panel-batch2-design.md`.

**Architecture:** A new pure module `src/lib/fileTree.ts` builds a real nested tree from a flat path list (unlike the deleted `groupByFolder`, which grouped by *immediate* parent only) and collects every file under a folder subtree for recursive actions. Each consumer (sidebar, Git Graph details panel) renders that tree with its own row styling and owns its own collapse state. A tiny zustand store carries a "please select this commit" request across the tab boundary so the sidebar's commit-jump doesn't need to reach into `PaneContent`.

**Tech Stack:** React 18 + TS, zustand, vitest + RTL, existing `ContextMenu`/`Tooltip` components, lucide-react icons already in use (`ChevronDown`, `ChevronRight`, `Folder`, `FolderTree`, `List`).

## Global Constraints

- Branch: `feat/git-panel-batch2` (create from latest `master` — batch 1 must be merged first; if it isn't yet, branch from `feat/git-panel-batch1` instead and note the eventual rebase).
- English commits/comments; conventional commits. i18n strings in both `en` and `zh-Hant`.
- After each task: `pnpm test && pnpm typecheck`.
- No backend changes in this batch (everything is frontend-only: no new Tauri commands, no capability changes) — `/tauri-review` in Task 5 is a quick confirmation pass, not expected to find anything.

---

### Task 1: Shared tree engine — `src/lib/fileTree.ts`

**Files:**
- Create: `src/lib/fileTree.ts`
- Create: `src/lib/fileTree.test.ts`

(`groupByFolder.ts`/`.test.ts` are superseded by this module but stay in place until Task 2 removes their only call site — see Task 2's Files list.)

**Interfaces:**
- Produces (Task 2 and Task 3 both consume these):

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

export function buildFileTree<T extends { path: string }>(files: T[]): TreeNode<T>[];
export function collectDescendantFiles<T>(folder: TreeFolderNode<T>): T[];
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/fileTree.test.ts
import { describe, expect, it } from "vitest";
import { buildFileTree, collectDescendantFiles, type TreeFolderNode } from "./fileTree";

interface Item {
  path: string;
}

function item(path: string): Item {
  return { path };
}

describe("buildFileTree", () => {
  it("nests files under their immediate folder", () => {
    const tree = buildFileTree([item("src/a.ts"), item("src/b.ts")]);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ kind: "folder", name: "src", path: "src" });
    const folder = tree[0] as TreeFolderNode<Item>;
    expect(folder.children.map((c) => c.name)).toEqual(["a.ts", "b.ts"]);
  });

  it("builds real nested folders instead of one group per distinct directory", () => {
    // This is the exact case the owner reported: dist, dist/aaa, dist/bbb must
    // nest, not appear as three parallel top-level groups.
    const tree = buildFileTree([item("dist/aaa/x.ts"), item("dist/bbb/y.ts")]);

    expect(tree).toHaveLength(1);
    const dist = tree[0] as TreeFolderNode<Item>;
    expect(dist).toMatchObject({ kind: "folder", name: "dist", path: "dist" });
    expect(dist.children.map((c) => c.name)).toEqual(["aaa", "bbb"]);
    const aaa = dist.children[0] as TreeFolderNode<Item>;
    expect(aaa.path).toBe("dist/aaa");
    expect(aaa.children).toMatchObject([{ kind: "file", name: "x.ts", path: "dist/aaa/x.ts" }]);
  });

  it("nests three levels deep", () => {
    const tree = buildFileTree([item("a/b/c/file.ts")]);

    const a = tree[0] as TreeFolderNode<Item>;
    const b = a.children[0] as TreeFolderNode<Item>;
    const c = b.children[0] as TreeFolderNode<Item>;
    expect([a.path, b.path, c.path]).toEqual(["a", "a/b", "a/b/c"]);
    expect(c.children).toMatchObject([{ kind: "file", path: "a/b/c/file.ts" }]);
  });

  it("sorts folders before files, alphabetically within each group, at every level", () => {
    const tree = buildFileTree([
      item("README.md"),
      item("src/index.ts"),
      item("docs/guide.md"),
      item("APPENDIX.md"),
    ]);

    expect(tree.map((n) => n.name)).toEqual(["docs", "src", "APPENDIX.md", "README.md"]);
  });

  it("treats a trailing-slash directory entry as a leaf of its parent folder", () => {
    // git reports an untracked directory as one entry ending in "/".
    const tree = buildFileTree([item("a/b/dir/"), item("a/b/file.ts")]);

    const a = tree[0] as TreeFolderNode<Item>;
    const b = a.children[0] as TreeFolderNode<Item>;
    expect(b.children.map((c) => c.name)).toEqual(["dir", "file.ts"]);
    // The leaf's file reference keeps the original untouched path (trailing
    // slash and all) — only the tree's own path/name fields are normalized.
    const dirLeaf = b.children.find((c) => c.name === "dir");
    expect(dirLeaf).toMatchObject({ kind: "file", file: { path: "a/b/dir/" } });
  });
});

describe("collectDescendantFiles", () => {
  it("collects files from every nested level under a folder", () => {
    const tree = buildFileTree([
      item("dist/aaa/x.ts"),
      item("dist/bbb/y.ts"),
      item("dist/root.ts"),
    ]);
    const dist = tree[0] as TreeFolderNode<Item>;

    expect(collectDescendantFiles(dist).map((f) => f.path).sort()).toEqual([
      "dist/aaa/x.ts",
      "dist/bbb/y.ts",
      "dist/root.ts",
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run src/lib/fileTree.test.ts` → FAIL (module doesn't exist).
- [ ] **Step 3: Implement**

```ts
// src/lib/fileTree.ts

/** A folder in a file tree built from a flat list of paths. */
export interface TreeFolderNode<T> {
  kind: "folder";
  name: string;
  /** Full path from the list root, e.g. "dist/aaa". */
  path: string;
  children: TreeNode<T>[];
}

/** A file leaf in a file tree. `file` is the original item, untouched. */
export interface TreeFileNode<T> {
  kind: "file";
  name: string;
  path: string;
  file: T;
}

export type TreeNode<T> = TreeFolderNode<T> | TreeFileNode<T>;

interface MutableFolder<T> {
  kind: "folder";
  name: string;
  path: string;
  children: Map<string, MutableFolder<T> | TreeFileNode<T>>;
}

/**
 * Builds a real nested tree from a flat list of paths: every ancestor
 * directory becomes its own parent node, so "dist/aaa/x.ts" and
 * "dist/bbb/y.ts" nest as dist → {aaa → x.ts, bbb → y.ts} instead of
 * "dist/aaa" and "dist/bbb" becoming two unrelated top-level groups.
 */
export function buildFileTree<T extends { path: string }>(files: T[]): TreeNode<T>[] {
  const root: MutableFolder<T> = { kind: "folder", name: "", path: "", children: new Map() };

  function ensureFolder(parent: MutableFolder<T>, name: string, path: string): MutableFolder<T> {
    const existing = parent.children.get(name);
    if (existing && existing.kind === "folder") {
      return existing;
    }
    const folder: MutableFolder<T> = { kind: "folder", name, path, children: new Map() };
    parent.children.set(name, folder);
    return folder;
  }

  for (const file of files) {
    // git reports an untracked directory as a single entry ending in "/";
    // strip it so the entry becomes a leaf of its parent instead of an empty
    // folder node with the same name.
    const normalized = file.path.endsWith("/") ? file.path.slice(0, -1) : file.path;
    const segments = normalized.split("/").filter(Boolean);
    let cursor = root;
    let builtPath = "";
    for (let i = 0; i < segments.length - 1; i++) {
      builtPath = builtPath ? `${builtPath}/${segments[i]}` : segments[i];
      cursor = ensureFolder(cursor, segments[i], builtPath);
    }
    const fileName = segments[segments.length - 1] ?? normalized;
    cursor.children.set(fileName, { kind: "file", name: fileName, path: normalized, file });
  }

  function toSortedArray(folder: MutableFolder<T>): TreeNode<T>[] {
    const entries = Array.from(folder.children.values());
    entries.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    return entries.map((entry) =>
      entry.kind === "folder"
        ? { kind: "folder", name: entry.name, path: entry.path, children: toSortedArray(entry) }
        : entry,
    );
  }

  return toSortedArray(root);
}

/** Every file under a folder, recursing through all descendant folders —
 * the basis for "act on this whole subtree" folder actions. Reads the tree
 * data structure, not rendered DOM, so it is unaffected by collapse state. */
export function collectDescendantFiles<T>(folder: TreeFolderNode<T>): T[] {
  const result: T[] = [];
  for (const child of folder.children) {
    if (child.kind === "file") {
      result.push(child.file);
    } else {
      result.push(...collectDescendantFiles(child));
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests** — `pnpm vitest run src/lib/fileTree.test.ts` → PASS (6 tests).
- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add src/lib/fileTree.ts src/lib/fileTree.test.ts
git commit -m "feat(lib): add nested file-tree builder shared by sidebar and git graph"
```

---

### Task 2: Sidebar tree rendering + recursive folder actions

**Files:**
- Modify: `src/modules/source-control/SourceControlView.tsx`
- Delete: `src/modules/source-control/lib/groupByFolder.ts`, `src/modules/source-control/lib/groupByFolder.test.ts`
- Modify: `src/i18n/locales/{en,zh-Hant}/sourceControl.json`
- Test: `src/modules/source-control/SourceControlView.test.tsx` (extend)

**Interfaces:**
- Consumes: `buildFileTree`, `collectDescendantFiles` (Task 1).
- `StatusRow` gains an `indent?: number` prop (tree depth; defaults to `0`, which reproduces today's flat-mode spacing exactly).

Current `FileList` (SourceControlView.tsx:263-350) has a `viewMode === "folder"` branch that calls `groupByFolder(files)` and renders one flat level. Replace it with a recursive tree renderer; the `viewMode === "flat"` branch (lines 288-304) is untouched.

- [ ] **Step 1: Write the failing tests** (append to `SourceControlView.test.tsx`, reusing its existing mocks/fixtures):

```tsx
describe("SourceControlView nested folder tree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitBridge.gitResolveRepo).mockResolvedValue("/repo");
    vi.mocked(gitBridge.gitLog).mockResolvedValue([]);
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [
        { path: "dist/aaa/x.ts", staged: false, status: "M" },
        { path: "dist/bbb/y.ts", staged: false, status: "M" },
      ],
    });
    useWorkspaceStore.getState().setRoot("/repo");
  });

  it("nests dist/aaa and dist/bbb under a single dist folder instead of two top-level groups", async () => {
    render(<SourceControlView />);
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));

    await screen.findByText("x.ts");
    // Exactly one "dist" folder header exists — aaa/bbb are its children, not
    // separate top-level groups (the bug this batch fixes).
    expect(screen.getAllByText("dist")).toHaveLength(1);
    expect(screen.getByText("aaa")).toBeInTheDocument();
    expect(screen.getByText("bbb")).toBeInTheDocument();
  });

  it("staging the top folder stages every file in the whole subtree, not just direct children", async () => {
    render(<SourceControlView />);
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));
    await screen.findByText("x.ts");

    // aria-label is `${folderActionLabel}: ${path}`, e.g. "Stage Folder
    // (Including Subfolders): dist" once Task 2's wording update lands.
    fireEvent.click(screen.getByRole("button", { name: /stage folder.*: dist$/i }));

    await waitFor(() => {
      expect(gitBridge.gitStage).toHaveBeenCalledWith("/repo", "dist/aaa/x.ts");
      expect(gitBridge.gitStage).toHaveBeenCalledWith("/repo", "dist/bbb/y.ts");
    });
  });

  it("collapsing a folder hides its nested subtree", async () => {
    render(<SourceControlView />);
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));
    await screen.findByText("x.ts");

    fireEvent.click(screen.getByRole("button", { name: "Collapse dist" }));

    expect(screen.queryByText("x.ts")).not.toBeInTheDocument();
    expect(screen.queryByText("aaa")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run src/modules/source-control/SourceControlView.test.tsx` → the nesting/recursive-stage/collapse tests fail against the current flat grouping.
- [ ] **Step 3: Implement.**

Add the import and remove the old one:

```ts
// replace this line:
import { groupByFolder } from "./lib/groupByFolder";
// with:
import { buildFileTree, collectDescendantFiles, type TreeFolderNode, type TreeNode } from "@/lib/fileTree";
```

Add `ChevronDown`, `ChevronRight` to the existing lucide-react import list (SourceControlView.tsx:3-21).

Give `StatusRow` an `indent` prop and switch its fixed horizontal padding to depth-scaled inline padding:

```tsx
function StatusRow({
  file,
  displayPath,
  repoPath,
  actionIcon: ActionIcon,
  actionLabel,
  onAction,
  onOpen,
  onRequestDiscard,
  indent = 0,
}: {
  file: FileStatus;
  displayPath?: string;
  repoPath: string;
  actionIcon: typeof Plus;
  actionLabel: string;
  onAction: (path: string) => void;
  onOpen: (path: string) => void;
  onRequestDiscard?: (path: string) => void;
  /** Tree depth for indentation; 0 (default) matches flat mode's spacing. */
  indent?: number;
}) {
  // ...unchanged body...
  return (
    <li
      onClick={() => onOpen(file.path)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{ paddingLeft: `${indent * 14 + 12}px` }}
      className="group flex cursor-pointer items-center gap-2 py-1 pr-3 text-sm hover:bg-bg-elevated/60"
    >
      {/* ...unchanged children... */}
    </li>
  );
}
```

(Only the `<li>`'s `className`/`style` change: drop `px-3`, add `pr-3` + the inline `paddingLeft`. Everything else in `StatusRow` is unchanged.)

Add a recursive tree-rows renderer and rewrite `FileList`'s folder branch:

```tsx
/** Recursively renders one level of a changed-files tree: folder headers with
 * a collapse toggle and a subtree-wide action button, file rows via StatusRow. */
function FileTreeRows({
  nodes,
  depth,
  collapsed,
  onToggleCollapse,
  repoPath,
  actionIcon: ActionIcon,
  actionLabel,
  folderActionLabel,
  onFileAction,
  onFolderAction,
  onFileOpen,
  onRequestDiscard,
}: {
  nodes: TreeNode<FileStatus>[];
  depth: number;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
  repoPath: string;
  actionIcon: typeof Plus;
  actionLabel: string;
  folderActionLabel: string;
  onFileAction: (path: string) => void;
  onFolderAction: (paths: string[]) => void;
  onFileOpen: (path: string) => void;
  onRequestDiscard?: (path: string) => void;
}) {
  const { t } = useTranslation("sourceControl");
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "file") {
          return (
            <StatusRow
              key={node.path}
              file={node.file}
              // basename (not node.name) re-appends the trailing "/" git
              // status uses for an untracked directory, e.g. "dir/" — the
              // tree's own `name` is the bare segment "dir", used for
              // sorting/keys, not display.
              displayPath={basename(node.file.path)}
              repoPath={repoPath}
              actionIcon={ActionIcon}
              actionLabel={actionLabel}
              onAction={onFileAction}
              onOpen={onFileOpen}
              onRequestDiscard={onRequestDiscard}
              indent={depth}
            />
          );
        }
        const isCollapsed = collapsed.has(node.path);
        return (
          <li key={node.path}>
            <div
              style={{ paddingLeft: `${depth * 14 + 12}px` }}
              className="group flex items-center gap-1 py-1 pr-3 text-sm hover:bg-bg-elevated/60"
            >
              <button
                type="button"
                onClick={() => onToggleCollapse(node.path)}
                aria-label={isCollapsed ? t("expandFolder", { name: node.name }) : t("collapseFolder", { name: node.name })}
                className="flex shrink-0 items-center text-fg-subtle hover:text-fg"
              >
                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </button>
              <Folder size={13} className="shrink-0 text-fg-subtle" />
              <Tooltip label={node.path} className="min-w-0 flex-1">
                <span className="min-w-0 flex-1 truncate text-fg-muted">{node.name}</span>
              </Tooltip>
              <Tooltip label={`${folderActionLabel}: ${node.path}`}>
                <button
                  type="button"
                  aria-label={`${folderActionLabel}: ${node.path}`}
                  onClick={() => onFolderAction(collectDescendantFiles(node).map((f) => f.path))}
                  className="rounded p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
                >
                  <ActionIcon size={14} />
                </button>
              </Tooltip>
            </div>
            {!isCollapsed && (
              <ul>
                <FileTreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  collapsed={collapsed}
                  onToggleCollapse={onToggleCollapse}
                  repoPath={repoPath}
                  actionIcon={ActionIcon}
                  actionLabel={actionLabel}
                  folderActionLabel={folderActionLabel}
                  onFileAction={onFileAction}
                  onFolderAction={onFolderAction}
                  onFileOpen={onFileOpen}
                  onRequestDiscard={onRequestDiscard}
                />
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}
```

Rewrite `FileList` (drop the now-dead `rootFolderLabel` prop and the `groupByFolder`/`basename`-per-group logic; each `FileList` instance owns its own collapse state so the staged and unstaged sections never share it):

```tsx
function FileList({
  files,
  viewMode,
  actionIcon,
  actionLabel,
  folderActionLabel,
  repoPath,
  onFileAction,
  onFolderAction,
  onFileOpen,
  onRequestDiscard,
}: {
  files: FileStatus[];
  viewMode: ViewMode;
  actionIcon: typeof Plus;
  actionLabel: string;
  folderActionLabel: string;
  repoPath: string;
  onFileAction: (path: string) => void;
  onFolderAction: (paths: string[]) => void;
  onFileOpen: (path: string) => void;
  onRequestDiscard?: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (viewMode === "flat") {
    return (
      <ul>
        {files.map((file) => (
          <StatusRow
            key={file.path}
            file={file}
            repoPath={repoPath}
            actionIcon={actionIcon}
            actionLabel={actionLabel}
            onAction={onFileAction}
            onOpen={onFileOpen}
            onRequestDiscard={onRequestDiscard}
          />
        ))}
      </ul>
    );
  }

  function toggleFolder(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  return (
    <ul>
      <FileTreeRows
        nodes={buildFileTree(files)}
        depth={0}
        collapsed={collapsed}
        onToggleCollapse={toggleFolder}
        repoPath={repoPath}
        actionIcon={actionIcon}
        actionLabel={actionLabel}
        folderActionLabel={folderActionLabel}
        onFileAction={onFileAction}
        onFolderAction={onFolderAction}
        onFileOpen={onFileOpen}
        onRequestDiscard={onRequestDiscard}
      />
    </ul>
  );
}
```

Remove the now-unused `basename` re-export path for folder grouping — `basename` (SourceControlView.tsx:248-255) stays (still used by the discard-confirm dialog message), only its old call site inside `FileList`'s folder branch goes away with the rewrite above.

Update both `<FileList ... />` call sites in `SourceControlView` (around lines 582 and 627) to drop the now-removed `rootFolderLabel={t("rootFolder")}` prop.

i18n additions (`sourceControl.json`, both locales): `expandFolder` "Expand {{name}}" / "展開 {{name}}", `collapseFolder` "Collapse {{name}}" / "收合 {{name}}". Update wording (not new keys) for the two existing folder-action labels so the recursive scope is explicit: `stageFolder` → "Stage Folder (Including Subfolders)" / "暫存資料夾（含子資料夾）", `unstageFolder` → "Unstage Folder (Including Subfolders)" / "取消暫存資料夾（含子資料夾）". Remove the now-dead `rootFolder` key from both locale files (nothing references it once root-level files render as plain top-level rows instead of a synthetic "(root)" group).

- [ ] **Step 4: Run tests** — `pnpm vitest run src/modules/source-control` → three pre-existing tests in the `"SourceControlView folder view"` block (added before this batch) now fail on the exact-string wording change; update them:
  - `"stages every file in a folder..."` (SourceControlView.test.tsx:139-153): change `screen.getByRole("button", { name: "Stage folder: src" })` to `{ name: "Stage Folder (Including Subfolders): src" }`.
  - `"unstages every file in a folder..."` (SourceControlView.test.tsx:155-176): change `{ name: "Unstage folder: src" }` to `{ name: "Unstage Folder (Including Subfolders): src" }`.
  - `"labels an untracked directory entry by name..."` (SourceControlView.test.tsx:178-190): no code change expected — this test should keep passing as-is once `displayPath={basename(node.file.path)}` is used (verifies the fix above); if it fails, that's a signal the basename wiring was missed.
  - After these edits: `pnpm vitest run src/modules/source-control` → PASS.
- [ ] **Step 5: Delete the superseded files**

```bash
git rm src/modules/source-control/lib/groupByFolder.ts src/modules/source-control/lib/groupByFolder.test.ts
```

- [ ] **Step 6: Verify + commit**

```bash
pnpm test && pnpm typecheck
git add -A src
git commit -m "feat(source-control): true nested folder tree with recursive actions

Folders now nest (dist -> aaa, bbb) instead of each distinct directory
becoming its own top-level group, and a folder's stage/unstage button
acts on every file in its subtree, not just direct children. Folders
are collapsible (default expanded) and each changed-files section
(staged/unstaged) owns independent collapse state."
```

---

### Task 3: Git Graph changed-files tree view

**Files:**
- Modify: `src/modules/git-graph/CommitDetailsPanel.tsx`
- Modify: `src/modules/git-graph/GitGraphTabContent.tsx` (labels wiring only)
- Modify: `src/i18n/locales/{en,zh-Hant}/gitGraph.json`
- Test: `src/modules/git-graph/CommitDetailsPanel.test.tsx` (create — none exists yet)

**Interfaces:**
- Consumes: `buildFileTree` (Task 1); `CommitDetailsLabels` gains `viewFolder: string` and `viewFlat: string`.

Current changed-files list (CommitDetailsPanel.tsx:204-232) is always flat and virtualized via `useVirtualRows`/`fileListRef`. Add a flat/tree toggle; tree mode renders the full node list directly inside the same scroll container (no virtualization — commit file counts are small in practice, per the design doc), flat mode is untouched.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/modules/git-graph/CommitDetailsPanel.test.tsx
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

const LABELS = {
  author: "Author", date: "Date", changedFiles: "Changed Files", noChanges: "No changes",
  noDiff: "No diff", noFileSelected: "Select a file", close: "Close", diffTab: "Diff",
  aiTab: "AI Explain", aiGenerate: "Explain", aiExplaining: "...", aiRegenerate: "Regen",
  aiNeedKey: "No key", aiEmpty: "Empty", viewFolder: "Group by folder", viewFlat: "Flat view",
  expandFolder: (name: string) => `Expand ${name}`,
  collapseFolder: (name: string) => `Collapse ${name}`,
};

const COMMIT: CommitNode = {
  hash: "abc1234", parents: [], author: "a", date: "today", message: "feat: x", refs: [],
};

describe("CommitDetailsPanel changed-files tree", () => {
  it("nests dist/aaa and dist/bbb under one dist folder in tree mode", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({
      message: "feat: x",
      files: [
        { status: "M", path: "dist/aaa/x.ts" },
        { status: "M", path: "dist/bbb/y.ts" },
      ],
    });
    render(<CommitDetailsPanel repo="/repo" commit={COMMIT} onClose={() => {}} labels={LABELS} />);
    await screen.findByText("dist/aaa/x.ts");

    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));

    await waitFor(() => expect(screen.getAllByText("dist")).toHaveLength(1));
    expect(screen.getByText("aaa")).toBeInTheDocument();
    expect(screen.getByText("x.ts")).toBeInTheDocument();
  });

  it("collapsing a folder in tree mode hides its files", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({
      message: "feat: x",
      files: [{ status: "M", path: "dist/aaa/x.ts" }],
    });
    render(<CommitDetailsPanel repo="/repo" commit={COMMIT} onClose={() => {}} labels={LABELS} />);
    await screen.findByText("dist/aaa/x.ts");
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));
    await screen.findByText("dist");

    fireEvent.click(screen.getByRole("button", { name: "Collapse dist" }));

    expect(screen.queryByText("x.ts")).not.toBeInTheDocument();
  });

  it("clicking a nested file in tree mode loads its diff", async () => {
    vi.mocked(gitCommitDetails).mockResolvedValue({
      message: "feat: x",
      files: [{ status: "M", path: "dist/aaa/x.ts" }],
    });
    render(<CommitDetailsPanel repo="/repo" commit={COMMIT} onClose={() => {}} labels={LABELS} />);
    await screen.findByText("dist/aaa/x.ts");
    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));
    await screen.findByText("x.ts");

    fireEvent.click(screen.getByText("x.ts"));

    await waitFor(() =>
      expect(gitCommitFileDiff).toHaveBeenCalledWith("/repo", "abc1234", "dist/aaa/x.ts"),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run src/modules/git-graph/CommitDetailsPanel.test.tsx` → FAIL (no toggle button, `viewFolder` label unused, flat-only rendering).
- [ ] **Step 3: Implement.**

Add to the top of `CommitDetailsPanel.tsx`: import `FolderTree`, `List`, `ChevronDown`, `ChevronRight` from `lucide-react` (alongside the existing `X` import), and `buildFileTree`, `collectDescendantFiles` is NOT needed here (read-only, no folder actions) — only `buildFileTree` and the `TreeNode`/`TreeFolderNode` types from `@/lib/fileTree`.

Extend `CommitDetailsLabels`:

```ts
export interface CommitDetailsLabels {
  // ...existing fields...
  viewFolder: string;
  viewFlat: string;
  /** "Expand {{name}}" / "Collapse {{name}}" — {{name}} is filled by the caller. */
  expandFolder: (name: string) => string;
  collapseFolder: (name: string) => string;
}
```

`expandFolder`/`collapseFolder` are functions (not plain strings) so `DetailsTreeRows`, which is recursive and renders one row per node, can produce a per-folder label without needing an i18n hook of its own — `GitGraphTabContent` closes over its own `t()` when building these two functions (see below), keeping every string in this component sourced from `labels`, matching this file's existing convention (it never calls `useTranslation` for display text itself, only for `i18n.language`).

Add local state and a recursive read-only tree renderer inside `CommitDetailsPanel.tsx`:

```tsx
type FilesViewMode = "flat" | "folder";

function DetailsTreeRows({
  nodes,
  depth,
  collapsed,
  onToggleCollapse,
  selectedFile,
  onSelectFile,
  labels,
}: {
  nodes: TreeNode<CommitFileChange>[];
  depth: number;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  labels: Pick<CommitDetailsLabels, "expandFolder" | "collapseFolder">;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "file") {
          return (
            <button
              key={node.path}
              type="button"
              onClick={() => onSelectFile(node.file.path)}
              style={{ height: `${FILE_ROW_HEIGHT}px`, paddingLeft: `${depth * 14 + 8}px` }}
              className={`flex w-full items-center gap-2 rounded pr-2 text-left font-mono text-[13px] ${
                selectedFile === node.file.path
                  ? "bg-bg-elevated text-fg"
                  : "text-fg-muted hover:bg-bg-elevated/50"
              }`}
            >
              <span
                className={`w-3 shrink-0 font-semibold ${STATUS_COLORS[node.file.status] ?? "text-fg-muted"}`}
              >
                {node.file.status}
              </span>
              <span className="truncate">{node.name}</span>
            </button>
          );
        }
        const isCollapsed = collapsed.has(node.path);
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => onToggleCollapse(node.path)}
              aria-label={isCollapsed ? labels.expandFolder(node.name) : labels.collapseFolder(node.name)}
              style={{ height: `${FILE_ROW_HEIGHT}px`, paddingLeft: `${depth * 14 + 8}px` }}
              className="flex w-full items-center gap-1 pr-2 text-left font-mono text-[13px] text-fg-subtle hover:bg-bg-elevated/50"
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <span className="truncate">{node.name}</span>
            </button>
            {!isCollapsed && (
              <DetailsTreeRows
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
                onToggleCollapse={onToggleCollapse}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                labels={labels}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
```

Inside `CommitDetailsPanel`, add state and the toggle button, and branch the render:

```tsx
const [filesViewMode, setFilesViewMode] = useState<FilesViewMode>("flat");
const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

function toggleDetailsFolder(path: string) {
  setCollapsedFolders((prev) => {
    const next = new Set(prev);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    return next;
  });
}
```

Reset `collapsedFolders` to empty whenever the commit changes (add `setCollapsedFolders(new Set())` next to the existing `setSelectedFile(null)` reset in the commit-change effect at CommitDetailsPanel.tsx:90-112) so switching commits doesn't carry over stale collapse state.

Add the toggle button next to `labels.changedFiles` (CommitDetailsPanel.tsx:198-200 area):

```tsx
<div className="mt-2 flex items-center justify-between text-[13px] font-medium text-fg-subtle">
  <span>{labels.changedFiles} ({details?.files.length ?? 0})</span>
  <Tooltip label={filesViewMode === "flat" ? labels.viewFolder : labels.viewFlat}>
    <button
      type="button"
      aria-label={filesViewMode === "flat" ? labels.viewFolder : labels.viewFlat}
      onClick={() => setFilesViewMode((m) => (m === "flat" ? "folder" : "flat"))}
      className="rounded p-0.5 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
    >
      {filesViewMode === "flat" ? <FolderTree size={13} /> : <List size={13} />}
    </button>
  </Tooltip>
</div>
```

Branch the list body: keep the existing virtualized flat rendering (CommitDetailsPanel.tsx:201-232) exactly as-is under `filesViewMode === "flat"`; add a tree branch that renders `DetailsTreeRows` with `buildFileTree(files)` directly (no virtualization, no `translateY`/`totalHeight` spacer — just a plain `<div>` inside the existing `fileListRef` wrapper so the shared scroll container still measures it correctly):

```tsx
{details && files.length === 0 ? (
  <div className="mt-1 text-[13px] text-fg-subtle">{labels.noChanges}</div>
) : filesViewMode === "flat" ? (
  <div ref={fileListRef} style={{ height: `${filesWindow.totalHeight}px` }} className="relative mt-0.5">
    {/* ...unchanged translateY + visibleFiles.map body... */}
  </div>
) : (
  <div ref={fileListRef} className="relative mt-0.5">
    <DetailsTreeRows
      nodes={buildFileTree(files)}
      depth={0}
      collapsed={collapsedFolders}
      onToggleCollapse={toggleDetailsFolder}
      selectedFile={selectedFile}
      onSelectFile={setSelectedFile}
      labels={labels}
    />
  </div>
)}
```

In `GitGraphTabContent.tsx`, extend `detailsLabels` (around line 278-293) with the four new fields:

```ts
viewFolder: t("details.viewFolder"),
viewFlat: t("details.viewFlat"),
expandFolder: (name: string) => t("details.expandFolder", { name }),
collapseFolder: (name: string) => t("details.collapseFolder", { name }),
```

i18n additions under the `details` object in both `gitGraph.json` locales: `viewFolder` "Group by folder" / "依資料夾分組", `viewFlat` "Flat view" / "扁平檢視" (matching `sourceControl.json`'s existing wording for the same concept), `expandFolder` "Expand {{name}}" / "展開 {{name}}", `collapseFolder` "Collapse {{name}}" / "收合 {{name}}" (same wording as Task 2's sidebar keys, kept as separate keys in this namespace since `sourceControl.json` and `gitGraph.json` are independent i18n files).

- [ ] **Step 4: Run tests** — `pnpm vitest run src/modules/git-graph/CommitDetailsPanel.test.tsx` → PASS.
- [ ] **Step 5: Verify + commit**

```bash
pnpm test && pnpm typecheck
git add -A src
git commit -m "feat(git-graph): add folder-tree view to the commit details file list

Mirrors the sidebar's nested tree (dist -> aaa, bbb instead of parallel
top-level groups). Read-only: folders only expand/collapse, no action
buttons. Tree mode skips virtualization since a single commit's file
count is normally small; the existing flat mode keeps its virtualized
rendering unchanged."
```

---

### Task 4: Commit jump — sidebar history row → Git Graph selection

**Files:**
- Create: `src/modules/git-graph/lib/pendingGraphSelectionStore.ts`
- Create: `src/modules/git-graph/lib/pendingGraphSelectionStore.test.ts`
- Modify: `src/modules/source-control/SourceControlView.tsx` (`HistoryRow`)
- Modify: `src/modules/git-graph/GitGraphTabContent.tsx`
- Modify: `src/i18n/locales/{en,zh-Hant}/sourceControl.json`
- Test: `src/modules/source-control/SourceControlView.test.tsx`, `src/modules/git-graph/GitGraphTabContent.test.tsx` (extend if present, else create focused on this behavior)

**Interfaces:**
- Produces: `usePendingGraphSelectionStore` with `request(hash: string): void` and `consume(): string | null`.

- [ ] **Step 1: Write the failing store test**

```ts
// src/modules/git-graph/lib/pendingGraphSelectionStore.test.ts
import { describe, expect, it } from "vitest";
import { usePendingGraphSelectionStore } from "./pendingGraphSelectionStore";

describe("usePendingGraphSelectionStore", () => {
  it("returns and clears the requested hash on consume", () => {
    usePendingGraphSelectionStore.getState().request("abc1234");
    expect(usePendingGraphSelectionStore.getState().hash).toBe("abc1234");

    const consumed = usePendingGraphSelectionStore.getState().consume();

    expect(consumed).toBe("abc1234");
    expect(usePendingGraphSelectionStore.getState().hash).toBeNull();
  });

  it("consume returns null when nothing was requested", () => {
    expect(usePendingGraphSelectionStore.getState().consume()).toBeNull();
  });
});
```

- [ ] **Step 2: Verify failure** — `pnpm vitest run src/modules/git-graph/lib/pendingGraphSelectionStore.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
// src/modules/git-graph/lib/pendingGraphSelectionStore.ts
import { create } from "zustand";

interface PendingGraphSelectionState {
  hash: string | null;
  /** Ask the Git Graph tab to select this commit once it can. */
  request: (hash: string) => void;
  /** Read and clear the pending hash; null if nothing is pending. */
  consume: () => string | null;
}

/**
 * Carries a "select this commit" request from the sidebar's history list to
 * the Git Graph tab, which is a singleton (openGitGraphTab always focuses the
 * one existing tab) so there is no per-tab PaneContent field to put this in.
 */
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

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Write the failing sidebar test** (append to `SourceControlView.test.tsx`):

```tsx
import { usePendingGraphSelectionStore } from "@/modules/git-graph/lib/pendingGraphSelectionStore";

describe("SourceControlView commit jump", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitBridge.gitResolveRepo).mockResolvedValue("/repo");
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({ branch: "main", staged: [], unstaged: [] });
    vi.mocked(gitBridge.gitLog).mockResolvedValue([
      { id: "abc1234", summary: "feat: x", author: "a", timestamp: 1 },
    ]);
    useWorkspaceStore.getState().setRoot("/repo");
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
    usePendingGraphSelectionStore.setState({ hash: null });
  });

  it("opens the Git Graph tab and requests selection of the clicked commit", async () => {
    render(<SourceControlView />);
    fireEvent.click(await screen.findByText("feat: x"));

    expect(usePendingGraphSelectionStore.getState().hash).toBe("abc1234");
    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].kind).toBe("git-graph");
  });

  it("offers the same jump from the context menu", async () => {
    render(<SourceControlView />);
    fireEvent.contextMenu(await screen.findByText("feat: x"));
    fireEvent.click(screen.getByRole("menuitem", { name: "View in Git Graph" }));

    expect(usePendingGraphSelectionStore.getState().hash).toBe("abc1234");
  });
});
```

- [ ] **Step 6: Verify failure**, **Step 7: Implement** — in `SourceControlView.tsx`, update `HistoryRow`:

```tsx
function HistoryRow({ commit }: { commit: CommitInfo }) {
  const { t } = useTranslation("sourceControl");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function viewInGraph() {
    usePendingGraphSelectionStore.getState().request(commit.id);
    useTabsStore.getState().openGitGraphTab();
  }

  return (
    <li
      onClick={viewInGraph}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      className="cursor-pointer py-1 text-xs hover:bg-bg-elevated/60"
    >
      <span className="font-mono text-fg-subtle">{commit.id}</span>
      <span className="ml-2 text-fg-muted">{commit.summary}</span>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              id: "viewInGraph",
              label: t("menuViewInGraph"),
              icon: GitCompare,
              group: 0,
              onSelect: viewInGraph,
            },
            {
              id: "copyHash",
              label: t("menuCopyHash"),
              icon: Clipboard,
              group: 1,
              onSelect: () => void navigator.clipboard.writeText(commit.id),
            },
            {
              id: "copyMessage",
              label: t("menuCopyMessage"),
              icon: ClipboardList,
              group: 1,
              onSelect: () => void navigator.clipboard.writeText(commit.summary),
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </li>
  );
}
```

Add the import: `import { usePendingGraphSelectionStore } from "@/modules/git-graph/lib/pendingGraphSelectionStore";` at the top of `SourceControlView.tsx`. `GitCompare` is already imported (used by `StatusRow`'s menu).

i18n addition (`sourceControl.json`, both locales): `menuViewInGraph` "View in Git Graph" / "在 Git Graph 中查看".

- [ ] **Step 8: Run** — PASS.
- [ ] **Step 9: Write the failing Git Graph consumption test.** Check whether `src/modules/git-graph/GitGraphTabContent.test.tsx` exists; if not, create it following the mocking pattern used elsewhere in this module (mock `./lib/gitGraphBridge` and `./lib/gitGraphBridge`'s `gitResolveRepo` re-export from source-control, provide a `useWorkspaceStore` root):

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { GitGraphTabContent } from "./GitGraphTabContent";
import { usePendingGraphSelectionStore } from "./lib/pendingGraphSelectionStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

vi.mock("@/modules/source-control/lib/gitBridge", () => ({
  gitResolveRepo: vi.fn().mockResolvedValue("/repo"),
}));

vi.mock("./lib/gitGraphBridge", () => ({
  gitGraphLog: vi.fn(),
  gitBranches: vi.fn().mockResolvedValue([]),
  gitFetch: vi.fn(),
  gitCommitDetails: vi.fn().mockResolvedValue({ message: "", files: [] }),
  gitCommitFileDiff: vi.fn().mockResolvedValue(""),
}));

import { gitGraphLog } from "./lib/gitGraphBridge";

function commitList(hashes: string[], hasMore: boolean) {
  return {
    commits: hashes.map((hash) => ({
      hash, parents: [], author: "a", date: "d", message: `msg ${hash}`, refs: [],
    })),
    hasMore,
  };
}

describe("GitGraphTabContent pending commit selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePendingGraphSelectionStore.setState({ hash: null });
    useWorkspaceStore.getState().setRoot("/repo");
  });

  it("selects the pending commit once it is loaded", async () => {
    vi.mocked(gitGraphLog).mockResolvedValue(commitList(["aaa1111", "bbb2222"], false));
    usePendingGraphSelectionStore.getState().request("bbb2222");

    render(<GitGraphTabContent />);

    await waitFor(() => expect(screen.getByText("msg bbb2222")).toBeInTheDocument());
    // Selecting opens the details panel, which fetches this commit's details.
    await waitFor(() => expect(screen.getAllByText("bbb2222").length).toBeGreaterThan(0));
    expect(usePendingGraphSelectionStore.getState().hash).toBeNull();
  });

  it("loads more pages to find a pending commit not on the first page, up to a cap", async () => {
    vi.mocked(gitGraphLog)
      .mockResolvedValueOnce(commitList(["aaa1111"], true))
      .mockResolvedValueOnce(commitList(["aaa1111", "ccc3333"], false));
    usePendingGraphSelectionStore.getState().request("ccc3333");

    render(<GitGraphTabContent />);

    await waitFor(() => expect(screen.getByText("msg ccc3333")).toBeInTheDocument());
    expect(usePendingGraphSelectionStore.getState().hash).toBeNull();
  });

  it("gives up silently once hasMore is false and the hash is never found", async () => {
    vi.mocked(gitGraphLog).mockResolvedValue(commitList(["aaa1111"], false));
    usePendingGraphSelectionStore.getState().request("zzz9999");

    render(<GitGraphTabContent />);

    await waitFor(() => expect(screen.getByText("msg aaa1111")).toBeInTheDocument());
    await waitFor(() => expect(usePendingGraphSelectionStore.getState().hash).toBeNull());
  });
});
```

- [ ] **Step 10: Verify failure.**
- [ ] **Step 11: Implement** in `GitGraphTabContent.tsx`:

```ts
import { usePendingGraphSelectionStore } from "./lib/pendingGraphSelectionStore";
```

Add, after the existing `reload`/`loadMore` definitions (near line 205, after `loadMore`'s `useCallback`):

```ts
// Consume a pending "select this commit" request from the sidebar's history
// list. If the commit isn't in the currently loaded page, page in more
// history (capped) before giving up silently — this only fails when the
// commit belongs to a branch/filter the graph isn't currently showing.
const pendingSelectionAttempts = useRef(0);
useEffect(() => {
  const pendingHash = usePendingGraphSelectionStore.getState().hash;
  if (!pendingHash || commits.length === 0) {
    return;
  }
  const match = commits.find(
    (c) => c.hash.startsWith(pendingHash) || pendingHash.startsWith(c.hash),
  );
  if (match) {
    setSelected(match);
    usePendingGraphSelectionStore.getState().consume();
    pendingSelectionAttempts.current = 0;
    return;
  }
  if (hasMore && pendingSelectionAttempts.current < 5) {
    pendingSelectionAttempts.current += 1;
    loadMore();
  } else {
    usePendingGraphSelectionStore.getState().consume();
    pendingSelectionAttempts.current = 0;
  }
}, [commits, hasMore, loadMore]);
```

`useRef` is already imported in this file (GitGraphTabContent.tsx:1).

- [ ] **Step 12: Run tests** — `pnpm vitest run src/modules/git-graph/GitGraphTabContent.test.tsx src/modules/source-control/SourceControlView.test.tsx` → PASS.
- [ ] **Step 13: Verify + commit**

```bash
pnpm test && pnpm typecheck
git add -A src
git commit -m "feat(git-graph): jump from a sidebar commit to its Git Graph selection

Left-click (and a new context-menu item) on a 近期提交 row opens/focuses
the Git Graph tab and selects that commit. A tiny store carries the
target hash across the tab boundary since the graph tab is a singleton
with no per-open PaneContent field; if the commit isn't in the loaded
page yet, the graph pages in more history (capped at 5 attempts) before
giving up silently."
```

---

### Task 5: Reviews, verification, build

- [ ] **Step 1:** `pnpm test && pnpm typecheck` — full green.
- [ ] **Step 2:** Run `/code-review` and `/tauri-review` (the latter should be a quick pass — no backend or capability changes in this batch); fix CRITICAL/HIGH (and reasonable MEDIUM) findings; re-run until clean.
- [ ] **Step 3:** Verify in the running app (`pnpm tauri dev`) on a scratch repo with a multi-level directory structure (e.g. `dist/aaa/x.ts`, `dist/bbb/y.ts`, a root-level file):
  - Sidebar folder view: `dist` shows as one node with `aaa`/`bbb` nested under it; staging `dist` stages both nested files; collapsing `dist` hides the subtree; independent collapse state between the staged and unstaged sections.
  - Git Graph details panel: toggle to tree view on a commit that touched nested paths; collapse/expand; click a nested file loads its diff.
  - Commit jump: click a 近期提交 row → Git Graph tab opens/focuses and that commit is selected and its details panel opens; try it both when the Git Graph tab is already open and when it isn't yet.
- [ ] **Step 4:** Local build for owner testing: `export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/tempo-term.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" && pnpm tauri build`, then open the bundled app.
