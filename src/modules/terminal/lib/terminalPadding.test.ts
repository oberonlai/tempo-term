import { describe, expect, it } from "vitest";
import { applyTerminalPadding } from "./terminalPadding";

describe("applyTerminalPadding", () => {
  it("sets equal padding in pixels on the given element", () => {
    const el = document.createElement("div");
    applyTerminalPadding(el, 24);
    expect(el.style.padding).toBe("24px");
  });
});
