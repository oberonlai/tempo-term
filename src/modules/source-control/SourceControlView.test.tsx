import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import "@/i18n";
import { SourceControlView } from "./SourceControlView";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import * as gitBridge from "./lib/gitBridge";

vi.mock("./lib/gitBridge", () => ({
  gitResolveRepo: vi.fn(),
  gitStatus: vi.fn(),
  gitStage: vi.fn(),
  gitUnstage: vi.fn(),
  gitCommit: vi.fn(),
  gitLog: vi.fn(),
  gitDiff: vi.fn(),
  gitPush: vi.fn(),
}));

describe("SourceControlView folder view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitBridge.gitResolveRepo).mockResolvedValue("/repo");
    vi.mocked(gitBridge.gitLog).mockResolvedValue([]);
    vi.mocked(gitBridge.gitStage).mockResolvedValue(undefined);
    vi.mocked(gitBridge.gitUnstage).mockResolvedValue(undefined);
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({
      branch: "main",
      staged: [],
      unstaged: [
        { path: "src/a.ts", staged: false, status: "M" },
        { path: "src/b.ts", staged: false, status: "M" },
        { path: "docs/c.md", staged: false, status: "M" },
      ],
    });
    useWorkspaceStore.getState().setRoot("/repo");
  });

  it("stages every file in a folder when the folder's stage button is clicked", async () => {
    render(<SourceControlView />);
    await screen.findByText("src/a.ts");

    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));

    const stageSrc = await screen.findByRole("button", { name: "Stage folder: src" });
    fireEvent.click(stageSrc);

    await waitFor(() => {
      expect(gitBridge.gitStage).toHaveBeenCalledWith("/repo", "src/a.ts");
    });
    expect(gitBridge.gitStage).toHaveBeenCalledWith("/repo", "src/b.ts");
    expect(gitBridge.gitStage).not.toHaveBeenCalledWith("/repo", "docs/c.md");
  });

  it("unstages every file in a folder when the folder's unstage button is clicked", async () => {
    vi.mocked(gitBridge.gitStatus).mockResolvedValue({
      branch: "main",
      staged: [
        { path: "src/a.ts", staged: true, status: "M" },
        { path: "src/b.ts", staged: true, status: "M" },
      ],
      unstaged: [],
    });

    render(<SourceControlView />);
    await screen.findByText("src/a.ts");

    fireEvent.click(screen.getByRole("button", { name: "Group by folder" }));

    const unstageSrc = await screen.findByRole("button", { name: "Unstage folder: src" });
    fireEvent.click(unstageSrc);

    await waitFor(() => {
      expect(gitBridge.gitUnstage).toHaveBeenCalledWith("/repo", "src/a.ts");
    });
    expect(gitBridge.gitUnstage).toHaveBeenCalledWith("/repo", "src/b.ts");
  });
});
