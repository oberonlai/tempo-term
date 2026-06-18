import { describe, expect, it } from "vitest";
import { shouldReloadFromDisk } from "./reload";

describe("shouldReloadFromDisk", () => {
  it("reloads when no buffer is open yet", () => {
    expect(shouldReloadFromDisk(undefined)).toBe(true);
  });

  it("reloads a clean buffer so external edits show up on reopen", () => {
    expect(shouldReloadFromDisk({ content: "v1", baseline: "v1" })).toBe(true);
  });

  it("keeps a dirty buffer so unsaved edits are not clobbered", () => {
    expect(shouldReloadFromDisk({ content: "edited", baseline: "v1" })).toBe(false);
  });
});
