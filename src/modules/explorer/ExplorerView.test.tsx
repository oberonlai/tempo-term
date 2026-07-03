import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";

vi.mock("./lib/fsBridge", () => ({ fsReadDir: vi.fn().mockResolvedValue([]) }));

import { ExplorerView } from "./ExplorerView";
import { useWorkspaceStore } from "@/stores/workspaceStore";

beforeEach(() => {
  useWorkspaceStore.setState({ rootPath: null });
});

describe("ExplorerView remote root", () => {
  it("hides the open-folder and find buttons and shows the remote path", () => {
    useWorkspaceStore.setState({ rootPath: "ssh://c1/home/me" });
    render(<ExplorerView />);
    expect(screen.queryByLabelText("Open folder")).toBeNull();
    expect(screen.queryByLabelText("Find files")).toBeNull();
    expect(screen.getByText("/home/me")).toBeInTheDocument();
  });

  it("keeps the buttons for a local root", () => {
    useWorkspaceStore.setState({ rootPath: "/home/me" });
    render(<ExplorerView />);
    expect(screen.getByLabelText("Open folder")).toBeInTheDocument();
    expect(screen.getByLabelText("Find files")).toBeInTheDocument();
  });
});

describe("ExplorerView expand/collapse toggle", () => {
  it("shows a single toggle button that flips between Expand All and Collapse All on click", () => {
    useWorkspaceStore.setState({ rootPath: "/home/me" });
    render(<ExplorerView />);

    // Merged into one button: no separate Expand All / Collapse All pair.
    expect(screen.queryAllByLabelText("Expand All")).toHaveLength(1);
    expect(screen.queryAllByLabelText("Collapse All")).toHaveLength(0);

    fireEvent.click(screen.getByLabelText("Expand All"));

    expect(screen.getByLabelText("Collapse All")).toBeInTheDocument();
    expect(screen.queryByLabelText("Expand All")).toBeNull();

    fireEvent.click(screen.getByLabelText("Collapse All"));

    expect(screen.getByLabelText("Expand All")).toBeInTheDocument();
    expect(screen.queryByLabelText("Collapse All")).toBeNull();
  });
});
