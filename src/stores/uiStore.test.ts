import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore, selectAnyOverlayOpen } from "./uiStore";

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
