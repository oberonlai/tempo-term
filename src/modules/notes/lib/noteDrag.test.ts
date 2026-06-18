import { describe, expect, it, vi } from "vitest";
import { applyNoteDrop, dropEdge, resolveNoteDrop } from "./noteDrag";

function stubRect(el: HTMLElement, top: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({
      top,
      height,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("dropEdge", () => {
  it("returns 'before' when the cursor is in the top half of a row", () => {
    // Row spans y = 100..140 (top 100, height 40); cursor at 110 → top half.
    expect(dropEdge(100, 40, 110)).toBe("before");
  });

  it("returns 'after' when the cursor is in the bottom half of a row", () => {
    expect(dropEdge(100, 40, 130)).toBe("after");
  });

  it("treats the exact midpoint as 'after'", () => {
    expect(dropEdge(100, 40, 120)).toBe("after");
  });
});

describe("resolveNoteDrop", () => {
  it("resolves a note row to a note target with edge position", () => {
    const li = document.createElement("li");
    li.setAttribute("data-note-id", "n1");
    stubRect(li, 100, 40);
    expect(resolveNoteDrop(li, 110)).toEqual({
      kind: "note",
      noteId: "n1",
      position: "before",
    });
  });

  it("resolves a folder header to a folder target", () => {
    const div = document.createElement("div");
    div.setAttribute("data-folder-id", "f1");
    expect(resolveNoteDrop(div, 0)).toEqual({ kind: "folder", folderId: "f1" });
  });

  it("resolves the bare root container to a root target", () => {
    const root = document.createElement("div");
    root.setAttribute("data-notes-root", "");
    expect(resolveNoteDrop(root, 0)).toEqual({ kind: "root" });
  });

  it("returns null when the cursor is outside the notes sidebar", () => {
    expect(resolveNoteDrop(document.createElement("div"), 0)).toBeNull();
    expect(resolveNoteDrop(null, 0)).toBeNull();
  });

  it("prefers the note row when a note sits inside a folder subtree", () => {
    const folderWrap = document.createElement("div");
    folderWrap.setAttribute("data-folder-id", "f1");
    const li = document.createElement("li");
    li.setAttribute("data-note-id", "n1");
    stubRect(li, 100, 40);
    folderWrap.appendChild(li);
    expect(resolveNoteDrop(li, 130)).toEqual({
      kind: "note",
      noteId: "n1",
      position: "after",
    });
  });
});

describe("applyNoteDrop", () => {
  it("reorders relative to the target note when dropped on another note", () => {
    const reorderNote = vi.fn();
    const moveNote = vi.fn();
    applyNoteDrop({ kind: "note", noteId: "target", position: "after" }, "dragged", {
      reorderNote,
      moveNote,
    });
    expect(reorderNote).toHaveBeenCalledWith("dragged", "target", "after");
    expect(moveNote).not.toHaveBeenCalled();
  });

  it("ignores a note dropped onto itself", () => {
    const reorderNote = vi.fn();
    const moveNote = vi.fn();
    applyNoteDrop({ kind: "note", noteId: "same", position: "before" }, "same", {
      reorderNote,
      moveNote,
    });
    expect(reorderNote).not.toHaveBeenCalled();
    expect(moveNote).not.toHaveBeenCalled();
  });

  it("moves the note into a folder when dropped on a folder", () => {
    const reorderNote = vi.fn();
    const moveNote = vi.fn();
    applyNoteDrop({ kind: "folder", folderId: "f1" }, "dragged", { reorderNote, moveNote });
    expect(moveNote).toHaveBeenCalledWith("dragged", "f1");
    expect(reorderNote).not.toHaveBeenCalled();
  });

  it("moves the note to the root when dropped on the root zone", () => {
    const reorderNote = vi.fn();
    const moveNote = vi.fn();
    applyNoteDrop({ kind: "root" }, "dragged", { reorderNote, moveNote });
    expect(moveNote).toHaveBeenCalledWith("dragged", null);
  });

  it("does nothing when there is no drop target", () => {
    const reorderNote = vi.fn();
    const moveNote = vi.fn();
    applyNoteDrop(null, "dragged", { reorderNote, moveNote });
    expect(reorderNote).not.toHaveBeenCalled();
    expect(moveNote).not.toHaveBeenCalled();
  });
});
