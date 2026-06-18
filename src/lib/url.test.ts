import { describe, expect, it } from "vitest";
import { isWebUrl } from "./url";

describe("isWebUrl", () => {
  it("treats an https URL as a web URL", () => {
    expect(isWebUrl("https://example.com")).toBe(true);
  });

  it("treats http and mailto as web URLs", () => {
    expect(isWebUrl("http://example.com/path?q=1")).toBe(true);
    expect(isWebUrl("mailto:hi@example.com")).toBe(true);
    expect(isWebUrl("  https://example.com  ")).toBe(true);
  });

  it("rejects local paths, relative links and non-web schemes", () => {
    expect(isWebUrl("/Users/me/notes/a.md")).toBe(false);
    expect(isWebUrl("./relative/file.txt")).toBe(false);
    expect(isWebUrl("notes/a.md")).toBe(false);
    expect(isWebUrl("file:///Users/me/a.txt")).toBe(false);
    expect(isWebUrl("")).toBe(false);
  });
});
