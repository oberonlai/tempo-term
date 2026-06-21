import { describe, expect, it } from "vitest";
import { isClaudeForeground, parseStatusOsc } from "./sessionStatus";

describe("parseStatusOsc", () => {
  it("parses a status payload", () => {
    expect(parseStatusOsc("tempoterm;status;active")).toEqual({
      kind: "status",
      status: "active",
    });
    expect(parseStatusOsc("tempoterm;status;waiting-approval")).toEqual({
      kind: "status",
      status: "waiting-approval",
    });
  });

  it("parses an end payload", () => {
    expect(parseStatusOsc("tempoterm;status;end")).toEqual({ kind: "end" });
  });

  it("ignores payloads without the tempoterm prefix", () => {
    expect(parseStatusOsc("something;else")).toBeNull();
  });

  it("ignores unknown states", () => {
    expect(parseStatusOsc("tempoterm;status;bogus")).toBeNull();
  });
});

describe("isClaudeForeground", () => {
  it("matches the claude binary, by name or path", () => {
    expect(isClaudeForeground("claude")).toBe(true);
    expect(isClaudeForeground("/Users/me/.local/bin/claude")).toBe(true);
    expect(isClaudeForeground("node /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js")).toBe(
      true,
    );
  });

  it("matches claude run behind a prefix runner", () => {
    expect(isClaudeForeground("sudo claude")).toBe(true);
    expect(isClaudeForeground("npx claude")).toBe(true);
  });

  it("does not match a plain shell or other commands", () => {
    expect(isClaudeForeground("zsh")).toBe(false);
    expect(isClaudeForeground("-zsh")).toBe(false);
    expect(isClaudeForeground("node server.js")).toBe(false);
    expect(isClaudeForeground(null)).toBe(false);
    expect(isClaudeForeground("")).toBe(false);
  });

  it("does not match claude only appearing as an argument", () => {
    expect(isClaudeForeground("vim claude.md")).toBe(false);
    expect(isClaudeForeground("cat claude.log")).toBe(false);
  });
});
