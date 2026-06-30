import { describe, it, expect } from "vitest";
import { previewWebviewLabel, shouldShowPreview } from "./previewWebview";

describe("previewWebviewLabel", () => {
  it("combines window label and leaf id", () => {
    expect(previewWebviewLabel("main", "pane-abc-1")).toBe("preview-main-pane-abc-1");
  });

  it("keeps the host window label so two windows never collide", () => {
    const a = previewWebviewLabel("main", "pane-x");
    const b = previewWebviewLabel("win-2", "pane-x");
    expect(a).not.toBe(b);
  });

  it("sanitises characters outside the allowed label set", () => {
    expect(previewWebviewLabel("main", "pane a.b#c")).toBe("preview-main-pane_a_b_c");
  });

  it("leaves allowed punctuation intact", () => {
    expect(previewWebviewLabel("main", "a-b_c/d:e")).toBe("preview-main-a-b_c/d:e");
  });
});

describe("shouldShowPreview", () => {
  it("shows only when active, not dragging, and no overlay", () => {
    expect(shouldShowPreview({ isActiveTab: true, dragging: false, anyOverlay: false })).toBe(
      true,
    );
  });

  it("hides when the tab is not active", () => {
    expect(shouldShowPreview({ isActiveTab: false, dragging: false, anyOverlay: false })).toBe(
      false,
    );
  });

  it("hides while a split divider is being dragged", () => {
    expect(shouldShowPreview({ isActiveTab: true, dragging: true, anyOverlay: false })).toBe(
      false,
    );
  });

  it("hides while any overlay is open", () => {
    expect(shouldShowPreview({ isActiveTab: true, dragging: false, anyOverlay: true })).toBe(
      false,
    );
  });
});
