import { describe, expect, it } from "vitest";
import { AtlasPressureGuard } from "./webglAtlasGuard";

describe("AtlasPressureGuard", () => {
  it("requests a clear once the absolute page count reaches the threshold", () => {
    const guard = new AtlasPressureGuard(3, 1000, () => 0);
    expect(guard.recordPageAdded()).toBe(false); // 1
    expect(guard.recordPageAdded()).toBe(false); // 2
    expect(guard.recordPageAdded()).toBe(true);  // 3 -> clear
  });

  it("does not reset page count after a clear — pages still exist in the atlas", () => {
    // clearTextureAtlas() empties pages in place but keeps them. The atlas is
    // still at `threshold` pages after a clear; any new page above that line
    // should re-trigger immediately once the cooldown has elapsed.
    let t = 0;
    const guard = new AtlasPressureGuard(2, 1000, () => t);
    guard.recordPageAdded();
    expect(guard.recordPageAdded()).toBe(true);  // fires at page 2
    // Re-rasterisation fills the existing 2 pages without firing onAdd, so
    // the guard receives no more events. Now the terminal needs a 3rd page.
    t = 2000; // well past the cooldown
    expect(guard.recordPageAdded()).toBe(true);  // page 3 >= threshold (2) → fire
  });

  it("does not clear again within the cooldown window (loop backstop)", () => {
    let t = 0;
    const guard = new AtlasPressureGuard(2, 1000, () => t);
    guard.recordPageAdded();
    expect(guard.recordPageAdded()).toBe(true);  // clear at t=0, page count=2
    t = 200; // still inside the 1000ms cooldown
    expect(guard.recordPageAdded()).toBe(false); // page 3 >= threshold but blocked
    t = 1200; // cooldown elapsed
    expect(guard.recordPageAdded()).toBe(true);  // page 4 >= threshold → fire
  });

  it("decrements page count when a page is removed (atlas merges or shrinks)", () => {
    const guard = new AtlasPressureGuard(3, 1000, () => 0);
    guard.recordPageAdded(); // 1
    guard.recordPageAdded(); // 2
    guard.recordPageRemoved(); // back to 1
    expect(guard.recordPageAdded()).toBe(false); // 2 < 3
    expect(guard.recordPageAdded()).toBe(true);  // 3 -> fire
  });
});
