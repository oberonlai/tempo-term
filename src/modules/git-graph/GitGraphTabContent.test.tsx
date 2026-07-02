import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { GitGraphTabContent } from "./GitGraphTabContent";
import { usePendingGraphSelectionStore } from "./lib/pendingGraphSelectionStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

vi.mock("@/modules/source-control/lib/gitBridge", () => ({
  gitResolveRepo: vi.fn().mockResolvedValue("/repo"),
}));

vi.mock("./lib/gitGraphBridge", () => ({
  gitGraphLog: vi.fn(),
  gitBranches: vi.fn().mockResolvedValue([]),
  gitFetch: vi.fn(),
  gitCommitDetails: vi.fn().mockResolvedValue({ message: "", files: [] }),
  gitCommitFileDiff: vi.fn().mockResolvedValue(""),
}));

import { gitGraphLog } from "./lib/gitGraphBridge";

function commitList(hashes: string[], hasMore: boolean) {
  return {
    commits: hashes.map((hash) => ({
      hash,
      parents: [],
      author: "a",
      date: "d",
      message: `msg ${hash}`,
      refs: [],
    })),
    hasMore,
  };
}

describe("GitGraphTabContent pending commit selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePendingGraphSelectionStore.setState({ hash: null });
    useWorkspaceStore.getState().setRoot("/repo");
  });

  it("selects the pending commit once it is loaded", async () => {
    vi.mocked(gitGraphLog).mockResolvedValue(commitList(["aaa1111", "bbb2222"], false));
    usePendingGraphSelectionStore.getState().request("bbb2222");

    render(<GitGraphTabContent />);

    await waitFor(() => expect(screen.getByText("msg bbb2222")).toBeInTheDocument());
    // Selecting opens the details panel, which fetches this commit's details.
    await waitFor(() => expect(screen.getAllByText("bbb2222").length).toBeGreaterThan(0));
    expect(usePendingGraphSelectionStore.getState().hash).toBeNull();
  });

  it("loads more pages to find a pending commit not on the first page, up to a cap", async () => {
    vi.mocked(gitGraphLog)
      .mockResolvedValueOnce(commitList(["aaa1111"], true))
      .mockResolvedValueOnce(commitList(["aaa1111", "ccc3333"], false));
    usePendingGraphSelectionStore.getState().request("ccc3333");

    render(<GitGraphTabContent />);

    await waitFor(() => expect(screen.getByText("msg ccc3333")).toBeInTheDocument());
    expect(usePendingGraphSelectionStore.getState().hash).toBeNull();
  });

  it("gives up silently once hasMore is false and the hash is never found", async () => {
    vi.mocked(gitGraphLog).mockResolvedValue(commitList(["aaa1111"], false));
    usePendingGraphSelectionStore.getState().request("zzz9999");

    render(<GitGraphTabContent />);

    await waitFor(() => expect(screen.getByText("msg aaa1111")).toBeInTheDocument());
    await waitFor(() => expect(usePendingGraphSelectionStore.getState().hash).toBeNull());
  });
});
