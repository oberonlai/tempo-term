import { describe, it, expect } from "vitest";
import { resolveFileIcon, resolveFolderIcon } from "./resolveIcon";

describe("resolveFileIcon", () => {
  it("maps by extension", () => {
    expect(resolveFileIcon("main.ts")).toBe("typescript");
    expect(resolveFileIcon("app.js")).toBe("javascript");
  });

  it("is case-insensitive", () => {
    expect(resolveFileIcon("App.TS")).toBe("typescript");
    expect(resolveFileIcon("README.MD")).toBe(resolveFileIcon("readme.md"));
  });

  it("prefers an exact filename over its extension", () => {
    // package.json has its own icon, distinct from the generic json icon
    expect(resolveFileIcon("package.json")).toBe("package-json");
    expect(resolveFileIcon("package.json")).not.toBe(resolveFileIcon("data.json"));
  });

  it("resolves extensionless known filenames", () => {
    expect(resolveFileIcon("Dockerfile")).toBe("docker");
  });

  it("falls back to the shortest matching extension suffix", () => {
    // 'b.ts' has no mapping, so it must fall back to 'ts'
    expect(resolveFileIcon("a.b.ts")).toBe("typescript");
  });

  it("falls back to _file for unknown types", () => {
    expect(resolveFileIcon("mystery.zzz")).toBe("_file");
    expect(resolveFileIcon("noextension")).toBe("_file");
  });
});

describe("resolveFolderIcon", () => {
  it("maps known folder names to a folder_ basename", () => {
    expect(resolveFolderIcon("src", false)).toBe("folder_src");
  });

  it("returns the open variant when open", () => {
    expect(resolveFolderIcon("src", true)).toBe("folder_src_open");
  });

  it("falls back to the default folder icon for unknown names", () => {
    expect(resolveFolderIcon("totally-unknown-folder", false)).toBe("_folder");
    expect(resolveFolderIcon("totally-unknown-folder", true)).toBe("_folder_open");
  });

  it("is case-insensitive", () => {
    expect(resolveFolderIcon("SRC", false)).toBe("folder_src");
  });
});
