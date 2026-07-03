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
