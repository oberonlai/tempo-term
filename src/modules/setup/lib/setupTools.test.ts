import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class {
    onmessage: ((m: unknown) => void) | null = null;
  },
}));

import {
  detectTools,
  installTool,
  isToolReady,
  TOOL_REGISTRY,
  type ToolStatus,
} from "./setupTools";

beforeEach(() => {
  invoke.mockReset();
});

function status(overrides: Partial<ToolStatus>): ToolStatus {
  return {
    id: "node",
    installed: true,
    version: "22.0.0",
    meetsMin: true,
    installable: true,
    ...overrides,
  };
}

describe("isToolReady", () => {
  it("is ready only when installed and meeting the minimum version", () => {
    expect(isToolReady(status({}))).toBe(true);
    expect(isToolReady(status({ installed: false, meetsMin: false }))).toBe(false);
    expect(isToolReady(status({ installed: true, meetsMin: false }))).toBe(false);
  });
});

describe("TOOL_REGISTRY", () => {
  it("lists all six tools with unique ids and official urls", () => {
    const ids = TOOL_REGISTRY.map((t) => t.id);
    expect(ids).toEqual(["node", "git", "gh", "claude", "codex", "antigravity"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TOOL_REGISTRY.every((t) => t.url.startsWith("https://"))).toBe(true);
  });
});

describe("detectTools / installTool bridge", () => {
  it("detectTools invokes the detect_tools command", async () => {
    invoke.mockResolvedValueOnce({ tools: [], brew: true, winget: false });
    await detectTools();
    expect(invoke.mock.calls[0][0]).toBe("detect_tools");
  });

  it("installTool passes the id and a Channel wired to onOutput", async () => {
    invoke.mockResolvedValueOnce(0);
    const lines: string[] = [];
    await installTool("git", (line) => lines.push(line));

    const call = invoke.mock.calls.find(([cmd]) => cmd === "install_tool");
    const args = call?.[1] as { id: string; onOutput: { onmessage: (m: string) => void } };
    expect(args.id).toBe("git");
    args.onOutput.onmessage("cloning…");
    expect(lines).toEqual(["cloning…"]);
  });
});
