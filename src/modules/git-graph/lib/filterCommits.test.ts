import { describe, expect, it } from "vitest";
import { filterCommits } from "./filterCommits";
import type { CommitNode } from "../types";

function commit(overrides: Partial<CommitNode> = {}): CommitNode {
  return {
    hash: "abc1234",
    parents: [],
    author: "Alice",
    date: "2026-06-18 10:00",
    message: "Add login form",
    refs: [],
    ...overrides,
  };
}

describe("filterCommits", () => {
  it("returns all commits when query is empty", () => {
    const commits = [commit(), commit({ hash: "def5678" })];
    expect(filterCommits(commits, "")).toEqual(commits);
  });

  it("returns all commits when query is whitespace", () => {
    const commits = [commit()];
    expect(filterCommits(commits, "   ")).toEqual(commits);
  });

  it("matches on message case-insensitively", () => {
    const commits = [commit({ message: "Fix navbar" }), commit({ message: "Add login" })];
    expect(filterCommits(commits, "LOGIN")).toHaveLength(1);
    expect(filterCommits(commits, "LOGIN")[0].message).toBe("Add login");
  });

  it("matches on author", () => {
    const commits = [commit({ author: "Bob" }), commit({ author: "Alice" })];
    expect(filterCommits(commits, "bob")).toHaveLength(1);
    expect(filterCommits(commits, "bob")[0].author).toBe("Bob");
  });

  it("matches on hash", () => {
    const commits = [commit({ hash: "abc1234" }), commit({ hash: "def5678" })];
    expect(filterCommits(commits, "def")).toHaveLength(1);
    expect(filterCommits(commits, "def")[0].hash).toBe("def5678");
  });

  it("returns empty array when nothing matches", () => {
    const commits = [commit()];
    expect(filterCommits(commits, "zzz")).toEqual([]);
  });
});
