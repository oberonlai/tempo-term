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
  author: "Author",
  date: "Date",
  changedFiles: "Changed Files",
  noChanges: "No changes",
  noDiff: "No diff",
  noFileSelected: "Select a file",
  close: "Close",
  diffTab: "Diff",
  aiTab: "AI Explain",
  aiGenerate: "Explain",
  aiExplaining: "...",
  aiRegenerate: "Regen",
  aiNeedKey: "No key",
  aiEmpty: "Empty",
  viewFolder: "Group by folder",
  viewFlat: "Flat view",
  expandFolder: (name: string) => `Expand ${name}`,
  collapseFolder: (name: string) => `Collapse ${name}`,
};

const COMMIT: CommitNode = {
  hash: "abc1234",
  parents: [],
  author: "a",
  date: "today",
  message: "feat: x",
  refs: [],
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
