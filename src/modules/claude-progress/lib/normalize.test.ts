import { describe, expect, it } from "vitest";
import { createNormalizer } from "./normalize";

// Fixtures below mirror the real shape of Claude Code transcript JSONL lines
// (verified against an actual session): assistant messages carry a
// `message.content[]` array whose items are `text`, `thinking`, or `tool_use`.

describe("createNormalizer", () => {
  it("emits tool:start when an assistant message calls a tool", () => {
    const normalizer = createNormalizer();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
        ],
      },
    });

    expect(normalizer.push(line)).toEqual([
      { kind: "tool:start", id: "toolu_1", name: "Bash" },
    ]);
  });

  it("emits tool:end with ok=true when the matching tool_result arrives", () => {
    const normalizer = createNormalizer();
    normalizer.push(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
          ],
        },
      }),
    );

    const resultLine = JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: false }],
      },
    });

    expect(normalizer.push(resultLine)).toEqual([
      { kind: "tool:end", id: "toolu_1", name: "Bash", ok: true },
    ]);
  });

  it("emits subagent:start (not tool:start) when an Agent is launched", () => {
    const normalizer = createNormalizer();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_a",
            name: "Agent",
            input: {
              description: "查通知機制",
              subagent_type: "claude-code-guide",
              prompt: "long prompt...",
            },
          },
        ],
      },
    });

    expect(normalizer.push(line)).toEqual([
      {
        kind: "subagent:start",
        id: "toolu_a",
        agentType: "claude-code-guide",
        description: "查通知機制",
      },
    ]);
  });

  it("emits subagent:end with stats when an Agent finishes", () => {
    const normalizer = createNormalizer();
    normalizer.push(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_a",
              name: "Agent",
              input: { description: "查通知機制", subagent_type: "claude-code-guide" },
            },
          ],
        },
      }),
    );

    const doneLine = JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "toolu_a", is_error: false }],
      },
      toolUseResult: {
        agentId: "a4e70451abe2b6b59",
        agentType: "claude-code-guide",
        status: "completed",
        totalDurationMs: 211420,
        totalTokens: 89732,
        totalToolUseCount: 16,
      },
    });

    expect(normalizer.push(doneLine)).toEqual([
      {
        kind: "subagent:end",
        id: "toolu_a",
        agentType: "claude-code-guide",
        ok: true,
        durationMs: 211420,
        tokens: 89732,
        toolUseCount: 16,
      },
    ]);
  });

  it("ignores an unparseable (half-written) line without throwing", () => {
    const normalizer = createNormalizer();
    expect(normalizer.push('{"type":"assistant","message"')).toEqual([]);
    expect(normalizer.push("")).toEqual([]);
  });
});
