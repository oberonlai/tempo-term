import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GitGraph } from "./GitGraph";
import type { CommitNode } from "./types";

const LABELS = {
  emptyTitle: "No commits",
  emptyHint: "",
  loadMore: "Load more",
  refHint: "{{name}}",
} as never;

const COMMIT: CommitNode = {
  hash: "abc1234",
  parents: [],
  author: "a",
  date: "today",
  message: "feat: x",
  refs: [],
};

describe("GitGraph row click area", () => {
  it("selects the commit when clicking the row, including the lane gutter area", () => {
    const onSelect = vi.fn();
    render(
      <GitGraph
        commits={[COMMIT]}
        selectedCommit={null}
        onSelectCommit={onSelect}
        labels={LABELS}
      />,
    );

    const row = screen.getByText("feat: x").closest("div[class*='absolute']");
    expect(row).not.toBeNull();
    // The row must span from the container's left edge so clicks beside the
    // node dot (in the lane gutter) still open the commit detail.
    expect(row!.className).toContain("left-0");
    fireEvent.click(row!);
    expect(onSelect).toHaveBeenCalledWith(COMMIT);
  });
});
