import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore, selectAnyOverlayOpen, loadSidebarOrder, DEFAULT_SIDEBAR_ORDER } from "./uiStore";

const STORAGE_KEY = "tempoterm-sidebar-order";

beforeEach(() =>
  useUiStore.setState({ sidebarView: "explorer", sidebarVisible: false, overlayCount: 0 }),
);

describe("uiStore workspaces view", () => {
  it("selects the workspaces view and reveals the sidebar", () => {
    useUiStore.getState().selectSidebar("workspaces");
    expect(useUiStore.getState().sidebarView).toBe("workspaces");
    expect(useUiStore.getState().sidebarVisible).toBe(true);
  });
});

describe("uiStore openFileFinder", () => {
  it("opens the global file search without touching the sidebar", () => {
    useUiStore.setState({ sidebarView: "notes", sidebarVisible: false, fileFinderOpen: false });

    useUiStore.getState().openFileFinder();

    const state = useUiStore.getState();
    expect(state.fileFinderOpen).toBe(true);
    expect(state.sidebarView).toBe("notes");
    expect(state.sidebarVisible).toBe(false);
  });
});

describe("uiStore overlay counter", () => {
  it("reports an overlay open while the count is positive", () => {
    expect(selectAnyOverlayOpen(useUiStore.getState())).toBe(false);
    useUiStore.getState().pushOverlay();
    expect(selectAnyOverlayOpen(useUiStore.getState())).toBe(true);
  });

  it("tracks stacked overlays and only clears at zero", () => {
    const { pushOverlay, popOverlay } = useUiStore.getState();
    pushOverlay();
    pushOverlay();
    popOverlay();
    expect(selectAnyOverlayOpen(useUiStore.getState())).toBe(true);
    popOverlay();
    expect(selectAnyOverlayOpen(useUiStore.getState())).toBe(false);
  });

  it("never drops below zero", () => {
    useUiStore.getState().popOverlay();
    expect(useUiStore.getState().overlayCount).toBe(0);
  });
});

describe("loadSidebarOrder", () => {
  beforeEach(() => localStorage.clear());

  it("returns the default order when nothing is stored", () => {
    expect(loadSidebarOrder()).toEqual(DEFAULT_SIDEBAR_ORDER);
  });

  it("falls back to the default order on non-array or malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, '{"not":"an array"}');
    expect(loadSidebarOrder()).toEqual(DEFAULT_SIDEBAR_ORDER);
    localStorage.setItem(STORAGE_KEY, "not json at all");
    expect(loadSidebarOrder()).toEqual(DEFAULT_SIDEBAR_ORDER);
  });

  it("honors a saved arrangement", () => {
    const saved = ["ai", "explorer", "workspaces", "sourceControl", "notes", "connections", "sessions"];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    expect(loadSidebarOrder()).toEqual(saved);
  });

  it("drops unknown ids and de-duplicates, keeping first occurrence", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["ai", "bogus", "ai", "explorer", 42, "explorer"]),
    );
    // Known+unique prefix preserved (ai, explorer), then the remaining default
    // panels appended in default order.
    expect(loadSidebarOrder()).toEqual([
      "ai",
      "explorer",
      "workspaces",
      "sourceControl",
      "notes",
      "connections",
      "sessions",
    ]);
  });

  it("appends panels added since the order was saved", () => {
    // An older save that predates the "sessions" panel keeps its arrangement,
    // with the new panel appended rather than lost.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["explorer", "workspaces", "sourceControl", "notes", "ai", "connections"]),
    );
    expect(loadSidebarOrder()).toEqual([
      "explorer",
      "workspaces",
      "sourceControl",
      "notes",
      "ai",
      "connections",
      "sessions",
    ]);
  });
});

describe("uiStore reorderSidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ sidebarOrder: [...DEFAULT_SIDEBAR_ORDER] });
  });

  it("moves an icon from one position to another and persists it", () => {
    // Move "sessions" (last) to the front.
    useUiStore.getState().reorderSidebar(6, 0);
    const order = useUiStore.getState().sidebarOrder;
    expect(order[0]).toBe("sessions");
    expect(order).toHaveLength(DEFAULT_SIDEBAR_ORDER.length);
    // Persisted, so the next load reflects it.
    expect(loadSidebarOrder()).toEqual(order);
  });

  it("ignores out-of-bounds and no-op moves", () => {
    const before = [...useUiStore.getState().sidebarOrder];
    useUiStore.getState().reorderSidebar(-1, 2);
    useUiStore.getState().reorderSidebar(0, 99);
    useUiStore.getState().reorderSidebar(3, 3);
    expect(useUiStore.getState().sidebarOrder).toEqual(before);
  });
});
