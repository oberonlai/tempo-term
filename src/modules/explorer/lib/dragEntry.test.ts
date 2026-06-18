import { describe, expect, it } from "vitest";
import {
  consumeDragClick,
  fileUrl,
  getDraggedEntry,
  markdownLink,
  setDraggedEntry,
  shellQuotePath,
} from "./dragEntry";

describe("shellQuotePath", () => {
  it("leaves simple paths unquoted", () => {
    expect(shellQuotePath("/Users/me/proj/App.tsx")).toBe("/Users/me/proj/App.tsx");
  });

  it("quotes paths containing spaces", () => {
    expect(shellQuotePath("/Users/me/My Project/a.md")).toBe(
      "'/Users/me/My Project/a.md'",
    );
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuotePath("/a/it's/b")).toBe("'/a/it'\\''s/b'");
  });
});

describe("markdownLink", () => {
  it("builds a markdown link", () => {
    expect(markdownLink("App.tsx", "/x/App.tsx")).toBe("[App.tsx](/x/App.tsx)");
  });
});

describe("fileUrl", () => {
  it("prefixes file://", () => {
    expect(fileUrl("/x/index.html")).toBe("file:///x/index.html");
  });
});

describe("getDraggedEntry / setDraggedEntry", () => {
  it("round-trips the dragged entry and clears to null", () => {
    expect(getDraggedEntry()).toBeNull();
    const entry = { path: "/a/b.ts", name: "b.ts", isDir: false };
    setDraggedEntry(entry);
    expect(getDraggedEntry()).toEqual(entry);
    setDraggedEntry(null);
    expect(getDraggedEntry()).toBeNull();
  });
});

describe("consumeDragClick", () => {
  it("is false when no drag has just finished", () => {
    expect(consumeDragClick()).toBe(false);
  });
});
