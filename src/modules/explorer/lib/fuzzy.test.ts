import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyRank } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches an empty query against anything", () => {
    expect(fuzzyMatch("", "anything").matched).toBe(true);
  });

  it("matches a subsequence and reports the matched indices", () => {
    const result = fuzzyMatch("app", "App.tsx");
    expect(result.matched).toBe(true);
    expect(result.indices).toEqual([0, 1, 2]);
  });

  it("matches non-contiguous subsequences", () => {
    expect(fuzzyMatch("atx", "App.tsx").matched).toBe(true);
  });

  it("does not match when characters are missing or out of order", () => {
    expect(fuzzyMatch("xpz", "App.tsx").matched).toBe(false);
    expect(fuzzyMatch("ppa", "App.tsx").matched).toBe(false);
  });

  it("is case insensitive", () => {
    expect(fuzzyMatch("APP", "app.tsx").matched).toBe(true);
  });

  it("scores a contiguous match higher than a scattered one", () => {
    const contiguous = fuzzyMatch("tab", "TabBar.tsx");
    const scattered = fuzzyMatch("tab", "t-a-x-b.tsx");
    expect(contiguous.score).toBeGreaterThan(scattered.score);
  });

  it("matches when a space-separated query has each word appear anywhere in the target", () => {
    // The user is thinking "the FileTree file under explorer" and types
    // words in path order; none of those words are literally adjacent, and
    // there is no space character in the path itself.
    expect(fuzzyMatch("file tree", "src/modules/explorer/FileTree.tsx").matched).toBe(true);
  });

  it("does not match a space-separated query when one word is missing from the target", () => {
    expect(fuzzyMatch("file zzzzz", "src/modules/explorer/FileTree.tsx").matched).toBe(false);
  });
});

describe("fuzzyRank", () => {
  const files = [
    "src/modules/terminal/TerminalView.tsx",
    "src/modules/settings/SettingsView.tsx",
    "src/App.tsx",
    "README.md",
  ];

  it("keeps only matching items", () => {
    const ranked = fuzzyRank("settings", files);
    expect(ranked).toEqual(["src/modules/settings/SettingsView.tsx"]);
  });

  it("returns everything for an empty query", () => {
    expect(fuzzyRank("", files)).toHaveLength(files.length);
  });

  it("orders better matches first", () => {
    const ranked = fuzzyRank("view", files);
    expect(ranked[0]).toMatch(/View\.tsx$/);
  });

  it("finds a file via a multi-word query typed in path order", () => {
    const ranked = fuzzyRank("terminal view", files);
    expect(ranked).toEqual(["src/modules/terminal/TerminalView.tsx"]);
  });
});
