import { createEvent, fireEvent, render, screen } from "@testing-library/react";
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

  it("blocks the browser's native text-selection drag on a shift-mousedown, but not a plain one", () => {
    render(
      <GitGraph commits={[COMMIT]} selection={null} onSelectCommit={vi.fn()} labels={LABELS} />,
    );
    const row = screen.getByText("feat: x").closest("div[class*='absolute']")!;

    const shiftMouseDown = createEvent.mouseDown(row, { shiftKey: true });
    fireEvent(row, shiftMouseDown);
    expect(shiftMouseDown.defaultPrevented).toBe(true);

    const plainMouseDown = createEvent.mouseDown(row, { shiftKey: false });
    fireEvent(row, plainMouseDown);
    expect(plainMouseDown.defaultPrevented).toBe(false);
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

describe("GitGraph compare-mode exit at boundaries", () => {
  const commits = [
    commit("c", ["b"], "msg c"),
    commit("b", ["a"], "msg b"),
    commit("a", [], "msg a"),
  ];

  it("plain ArrowDown at the bottom still collapses out of compare mode", () => {
    const onSelect = vi.fn();
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "compare", from: commits[0], to: commits[2] }}
        onSelectCommit={onSelect}
        labels={LABELS}
      />,
    );
    fireEvent.keyDown(container("msg c"), { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith(commits[2], { shiftKey: false });
  });

  it("plain ArrowUp at the top still collapses out of compare mode", () => {
    const onSelect = vi.fn();
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "compare", from: commits[2], to: commits[0] }}
        onSelectCommit={onSelect}
        labels={LABELS}
      />,
    );
    fireEvent.keyDown(container("msg c"), { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith(commits[0], { shiftKey: false });
  });

  it("Shift+ArrowDown at a root commit still collapses out of compare mode", () => {
    const onSelect = vi.fn();
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "compare", from: commits[0], to: commits[2] }}
        onSelectCommit={onSelect}
        labels={LABELS}
      />,
    );
    fireEvent.keyDown(container("msg c"), { key: "ArrowDown", shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(commits[2], { shiftKey: false });
  });

  it("Shift+ArrowUp on the newest commit of a lane still collapses out of compare mode", () => {
    const onSelect = vi.fn();
    render(
      <GitGraph
        commits={commits}
        selection={{ mode: "compare", from: commits[2], to: commits[0] }}
        onSelectCommit={onSelect}
        labels={LABELS}
      />,
    );
    fireEvent.keyDown(container("msg c"), { key: "ArrowUp", shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(commits[0], { shiftKey: false });
  });
});

describe("GitGraph auto-scroll", () => {
  const commits = [
    commit("c", ["b"], "msg c"),
    commit("b", ["a"], "msg b"),
    commit("a", [], "msg a"),
  ];

  it("scrolls down so the newly active row's bottom edge is visible", () => {
    const { rerender } = render(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: commits[0] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );
    const scrollContainer = container("msg c");
    Object.defineProperty(scrollContainer, "clientHeight", { value: 40, configurable: true });
    scrollContainer.scrollTop = 0;

    rerender(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: commits[2] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );

    // commits[2] ("a") is row index 2: y = 20 + 2*36 = 92, half-height 18 =>
    // bottom edge at 110, below the 40px-tall visible window starting at 0.
    expect(scrollContainer.scrollTop).toBe(70);
  });

  it("does not scroll when the newly active row is already fully visible", () => {
    const { rerender } = render(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: commits[0] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );
    const scrollContainer = container("msg c");
    Object.defineProperty(scrollContainer, "clientHeight", { value: 200, configurable: true });
    scrollContainer.scrollTop = 0;

    rerender(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: commits[1] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );

    expect(scrollContainer.scrollTop).toBe(0);
  });

  it("does not re-scroll when layouts change but the active commit stays the same (e.g. pagination)", () => {
    const { rerender } = render(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: commits[0] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );
    const scrollContainer = document.querySelector("div.flex-1.overflow-auto") as HTMLElement;
    Object.defineProperty(scrollContainer, "clientHeight", { value: 200, configurable: true });
    // The user manually scrolled away from the active row to browse history.
    scrollContainer.scrollTop = 500;

    // More history pages in: `commits` gets a new array identity (and thus a
    // new `layouts` object from useMemo), but the selection is unchanged.
    const morePages = [...commits, commit("z", [], "msg z")];
    rerender(
      <GitGraph
        commits={morePages}
        selection={{ mode: "single", commit: commits[0] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );

    expect(scrollContainer.scrollTop).toBe(500);
  });

  it("still scrolls once the active commit's layout becomes available after a hash change with no layout yet", () => {
    const missing = commit("x", [], "msg x");
    const { rerender } = render(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: commits[0] }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );
    const scrollContainer = document.querySelector("div.flex-1.overflow-auto") as HTMLElement;
    Object.defineProperty(scrollContainer, "clientHeight", { value: 40, configurable: true });
    scrollContainer.scrollTop = 0;

    // Selection points at a commit whose layout doesn't exist yet (e.g. its
    // page is still loading) — the effect must bail without "consuming"
    // this hash change.
    rerender(
      <GitGraph
        commits={commits}
        selection={{ mode: "single", commit: missing }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );
    expect(scrollContainer.scrollTop).toBe(0);

    // The commit's page finishes loading: it's now in commits/layouts, and
    // the selection is unchanged. The scroll must still happen here, not be
    // silently skipped because the earlier render already "used up" the
    // hash change.
    const loaded = [...commits, missing];
    rerender(
      <GitGraph
        commits={loaded}
        selection={{ mode: "single", commit: missing }}
        onSelectCommit={vi.fn()}
        labels={LABELS}
      />,
    );

    // "x" is row index 3: y = 20 + 3*36 = 128, bottom edge 146, beyond the
    // 40px-tall window starting at 0 => scrollTop becomes 146 - 40 = 106.
    expect(scrollContainer.scrollTop).toBe(106);
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
