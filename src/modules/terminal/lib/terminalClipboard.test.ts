import { describe, expect, it } from "vitest";
import {
  formatImagePathsForTerminal,
  formatPathsForTerminal,
  isImageAttachmentCli,
  isImagePath,
  shellQuotePath,
  shouldAttachImage,
} from "./terminalClipboard";

describe("terminal clipboard helpers", () => {
  it("detects Claude-like CLI commands that should receive Ctrl+V directly", () => {
    expect(isImageAttachmentCli("/opt/homebrew/bin/node /path/to/claude")).toBe(true);
    expect(isImageAttachmentCli("claude")).toBe(true);
    expect(isImageAttachmentCli("codex")).toBe(true);
    expect(isImageAttachmentCli("node /usr/local/bin/gemini")).toBe(true);
    expect(isImageAttachmentCli("/bin/zsh -l")).toBe(false);
  });

  it("formats image paths with a trailing separator", () => {
    expect(formatImagePathsForTerminal(["/tmp/a.png", "/tmp/CleanShot 1.jpg"])).toBe(
      "/tmp/a.png '/tmp/CleanShot 1.jpg' ",
    );
    expect(formatImagePathsForTerminal([])).toBe("");
  });

  it("formats any file or folder path with shell quoting", () => {
    expect(formatPathsForTerminal(["/tmp/a folder", "/Applications"])).toBe(
      "'/tmp/a folder' /Applications ",
    );
  });

  it("detects supported image paths", () => {
    expect(isImagePath("/tmp/a.PNG")).toBe(true);
    expect(isImagePath("/tmp/a.txt")).toBe(false);
  });

  it("only attaches a single image path for image-aware CLIs", () => {
    expect(shouldAttachImage("claude", ["/tmp/a.png"])).toBe(true);
    expect(shouldAttachImage("claude", ["/tmp/a.txt"])).toBe(false);
    expect(shouldAttachImage("claude", ["/tmp/a.png", "/tmp/b.png"])).toBe(false);
    expect(shouldAttachImage("zsh", ["/tmp/a.png"])).toBe(false);
  });

  it("shell-quotes paths only when needed", () => {
    expect(shellQuotePath("/tmp/a.png")).toBe("/tmp/a.png");
    expect(shellQuotePath("/tmp/it's here.png")).toBe("'/tmp/it'\\''s here.png'");
  });
});
