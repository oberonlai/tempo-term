import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FileFinder } from "./FileFinder";
import { useTabsStore } from "@/stores/tabsStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("./lib/fsBridge", () => ({
  fsListFiles: vi.fn(() => Promise.resolve(["/p/main.ts", "/p/util.ts"])),
}));

describe("FileFinder opening a file", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
  });

  it("opens the selected file via openFromSidebar instead of openEditorTab", async () => {
    render(<FileFinder root="/p" onClose={() => {}} />);
    await waitFor(() => screen.getByText("main.ts"));

    fireEvent.click(screen.getByText("main.ts"));

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    const pane = tabs[0].paneTree;
    expect(pane.kind === "leaf" && pane.pane).toMatchObject({
      kind: "editor",
      path: "/p/main.ts",
    });
  });

  it("splits into the active tab when a file is already open, instead of opening a second tab", async () => {
    useTabsStore.getState().openEditorTab("/p/main.ts");
    render(<FileFinder root="/p" onClose={() => {}} />);
    await waitFor(() => screen.getByText("util.ts"));

    fireEvent.click(screen.getByText("util.ts"));

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    const tab = useTabsStore.getState().tabs[0];
    expect(tab.paneTree.kind).toBe("split");
  });
});

describe("FileFinder keyboard navigation", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("moves the active selection down with ArrowDown and opens it on Enter", async () => {
    render(<FileFinder root="/p" onClose={() => {}} />);
    await waitFor(() => screen.getByText("util.ts"));

    const input = screen.getByLabelText("findFiles");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    const pane = tabs[0].paneTree;
    expect(pane.kind === "leaf" && pane.pane).toMatchObject({
      kind: "editor",
      path: "/p/util.ts",
    });
  });

  it("wraps to the last result when ArrowUp is pressed at the top", async () => {
    render(<FileFinder root="/p" onClose={() => {}} />);
    await waitFor(() => screen.getByText("util.ts"));

    const input = screen.getByLabelText("findFiles");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    const tabs = useTabsStore.getState().tabs;
    const pane = tabs[0].paneTree;
    expect(pane.kind === "leaf" && pane.pane).toMatchObject({
      kind: "editor",
      path: "/p/util.ts",
    });
  });

  it("ignores Enter while an IME composition is in progress", async () => {
    render(<FileFinder root="/p" onClose={() => {}} />);
    await waitFor(() => screen.getByText("main.ts"));

    const input = screen.getByLabelText("findFiles");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(useTabsStore.getState().tabs).toHaveLength(0);
  });

  it("does not steal the active selection when the list scrolls under a stationary cursor", async () => {
    // A plain mouseenter fires when the row scrolls under an unmoving
    // pointer (e.g. keyboard-driven scrolling), which would otherwise fight
    // with ArrowDown/ArrowUp. Only an actual mouse move should reclaim
    // selection from the keyboard.
    render(<FileFinder root="/p" onClose={() => {}} />);
    await waitFor(() => screen.getByText("util.ts"));

    const input = screen.getByLabelText("findFiles");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.mouseEnter(screen.getByText("main.ts"));
    fireEvent.keyDown(input, { key: "Enter" });

    const tabs = useTabsStore.getState().tabs;
    const pane = tabs[0].paneTree;
    expect(pane.kind === "leaf" && pane.pane).toMatchObject({
      kind: "editor",
      path: "/p/util.ts",
    });
  });

  it("re-scrolls the active row into view when the result set changes even if the index stays the same", async () => {
    // The active index resets to 0 on every keystroke, so a query change
    // that keeps it at 0 must still re-scroll — otherwise a list the user
    // had wheel-scrolled away from the top stays scrolled after filtering.
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    render(<FileFinder root="/p" onClose={() => {}} />);
    await waitFor(() => screen.getByText("util.ts"));
    const callsAfterMount = scrollSpy.mock.calls.length;

    const input = screen.getByLabelText("findFiles");
    fireEvent.change(input, { target: { value: "u" } });
    await waitFor(() => screen.getByText("util.ts"));

    expect(scrollSpy.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });
});

describe("FileFinder at pane capacity", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
  });

  it("shows an InfoDialog instead of opening a 9th pane", async () => {
    useTabsStore.getState().openEditorTab("/0.ts");
    for (let i = 1; i < 8; i++) {
      useTabsStore.getState().openFromSidebar({ kind: "editor", path: `/${i}.ts` });
    }
    render(<FileFinder root="/p" onClose={() => {}} />);
    await waitFor(() => screen.getByText("main.ts"));

    fireEvent.click(screen.getByText("main.ts"));

    expect(screen.getByText("paneCapacityAlert")).toBeInTheDocument();
  });
});
