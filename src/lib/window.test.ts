import { afterEach, describe, expect, it, vi } from "vitest";

const { getCurrentWindow } = vi.hoisted(() => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow }));

import { isMainWindow, perWindowStorage } from "./window";

afterEach(() => {
  getCurrentWindow.mockReset();
  localStorage.clear();
});

describe("isMainWindow", () => {
  it("is true for the main window label", () => {
    getCurrentWindow.mockReturnValue({ label: "main" });
    expect(isMainWindow()).toBe(true);
  });

  it("is false for any other window label", () => {
    getCurrentWindow.mockReturnValue({ label: "win-1" });
    expect(isMainWindow()).toBe(false);
  });

  it("falls back to true when there is no Tauri runtime", () => {
    getCurrentWindow.mockImplementation(() => {
      throw new Error("no __TAURI_INTERNALS__");
    });
    expect(isMainWindow()).toBe(true);
  });
});

describe("perWindowStorage", () => {
  it("uses localStorage in the main window", () => {
    getCurrentWindow.mockReturnValue({ label: "main" });
    const storage = perWindowStorage();
    storage.setItem("k", "v");
    expect(localStorage.getItem("k")).toBe("v");
  });

  it("uses private in-memory storage in a secondary window", () => {
    getCurrentWindow.mockReturnValue({ label: "win-1" });
    const storage = perWindowStorage();
    storage.setItem("k", "v");
    expect(localStorage.getItem("k")).toBeNull();
    expect(storage.getItem("k")).toBe("v");
    storage.removeItem("k");
    expect(storage.getItem("k")).toBeNull();
  });
});
