import { describe, expect, it } from "vitest";
import {
  fileUriToPath,
  imageFilesFromDrop,
  imagePathsFromDrop,
  pathsFromDrop,
} from "./terminalDrop";

describe("terminal drop helpers", () => {
  it("converts file URIs to local paths", () => {
    expect(fileUriToPath("file:///Users/me/CleanShot%202026.png")).toBe(
      "/Users/me/CleanShot 2026.png",
    );
  });

  it("ignores non-file URIs", () => {
    expect(fileUriToPath("https://example.com/a.png")).toBeNull();
  });

  it("extracts image paths from uri-list drops", () => {
    const data = {
      getData: (type: string) =>
        type === "text/uri-list"
          ? "file:///Users/me/a.png\nfile:///Users/me/readme.txt"
          : "",
      files: [],
    } as unknown as DataTransfer;

    expect(imagePathsFromDrop(data)).toEqual(["/Users/me/a.png"]);
  });

  it("extracts all paths from uri-list drops", () => {
    const data = {
      getData: (type: string) =>
        type === "text/uri-list"
          ? "file:///Users/me/a.png\nfile:///Users/me/readme.txt\nfile:///Users/me/folder"
          : "",
      files: [],
    } as unknown as DataTransfer;

    expect(pathsFromDrop(data)).toEqual([
      "/Users/me/a.png",
      "/Users/me/readme.txt",
      "/Users/me/folder",
    ]);
  });

  it("extracts image files when paths are not exposed", () => {
    const image = new File(["png"], "a.png", { type: "image/png" });
    const text = new File(["txt"], "a.txt", { type: "text/plain" });
    const data = {
      items: [
        { kind: "file", type: "image/png", getAsFile: () => image },
        { kind: "file", type: "text/plain", getAsFile: () => text },
      ],
      files: [text],
    } as unknown as DataTransfer;

    expect(imageFilesFromDrop(data)).toEqual([image]);
  });
});
