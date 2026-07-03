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

  it("keeps both entries when a file and a folder share the exact same name", () => {
    // e.g. a single "config" file got deleted and replaced by a "config/"
    // directory in the same uncommitted change — git status reports both a
    // deleted "config" entry and a new "config/default.json" entry.
    const tree = buildFileTree([item("config"), item("config/default.json")]);

    expect(tree).toHaveLength(2);
    const folder = tree.find((n) => n.kind === "folder") as TreeFolderNode<Item>;
    const file = tree.find((n) => n.kind === "file");
    expect(folder).toMatchObject({ kind: "folder", name: "config", path: "config" });
    expect(folder.children).toMatchObject([{ kind: "file", path: "config/default.json" }]);
    expect(file).toMatchObject({ kind: "file", name: "config", path: "config" });
  });

  it("keeps both entries when the same-name collision happens in the other file/folder order", () => {
    const tree = buildFileTree([item("config/default.json"), item("config")]);

    expect(tree).toHaveLength(2);
    const folder = tree.find((n) => n.kind === "folder") as TreeFolderNode<Item>;
    expect(folder.children).toMatchObject([{ kind: "file", path: "config/default.json" }]);
    expect(tree.find((n) => n.kind === "file")).toMatchObject({ path: "config" });
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
