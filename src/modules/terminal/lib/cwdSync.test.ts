import { describe, expect, it } from "vitest";
import { shouldCdToRoot } from "./cwdSync";

describe("shouldCdToRoot", () => {
  it("cds when the explorer root differs from the shell cwd", () => {
    expect(shouldCdToRoot("/a", "/b")).toBe(true);
  });

  it("does not cd when the root is the dir the shell is already in (loop guard)", () => {
    expect(shouldCdToRoot("/a", "/a")).toBe(false);
  });

  it("does not cd for a null or empty root", () => {
    expect(shouldCdToRoot(null, "/b")).toBe(false);
    expect(shouldCdToRoot("", "/b")).toBe(false);
  });
});
