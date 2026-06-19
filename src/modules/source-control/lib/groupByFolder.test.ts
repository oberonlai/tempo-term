import { describe, expect, it } from "vitest";
import { groupByFolder } from "./groupByFolder";
import type { FileStatus } from "./gitBridge";

function f(path: string): FileStatus {
  return { path, staged: false, status: "M" };
}

describe("groupByFolder", () => {
  it("puts files from the same folder in one group keyed by that folder", () => {
    const groups = groupByFolder([f("src/a.ts"), f("src/b.ts")]);

    expect(groups).toHaveLength(1);
    expect(groups[0].folder).toBe("src");
    expect(groups[0].files.map((x) => x.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("separates distinct folders and sorts groups by folder name", () => {
    const groups = groupByFolder([f("src/b.ts"), f("docs/a.md"), f("src/a.ts")]);

    expect(groups.map((g) => g.folder)).toEqual(["docs", "src"]);
  });

  it("groups repo-root files under an empty key and lists them last", () => {
    const groups = groupByFolder([f("README.md"), f("src/a.ts")]);

    expect(groups.map((g) => g.folder)).toEqual(["src", ""]);
    expect(groups.find((g) => g.folder === "")?.files.map((x) => x.path)).toEqual([
      "README.md",
    ]);
  });

  it("treats a trailing-slash directory entry as a leaf of its parent folder", () => {
    // git reports an untracked directory as one entry ending in "/".
    const groups = groupByFolder([f("a/b/dir/"), f("a/b/file.ts")]);

    expect(groups).toHaveLength(1);
    expect(groups[0].folder).toBe("a/b");
    expect(groups[0].files.map((x) => x.path)).toEqual(["a/b/dir/", "a/b/file.ts"]);
  });
});
