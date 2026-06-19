import { describe, expect, it } from "vitest";
import { activeCount, isEmptyProgress } from "./progressStore";
import { emptyProgressState, reduceProgress } from "./progressState";

describe("isEmptyProgress", () => {
  it("is true for a fresh empty state", () => {
    expect(isEmptyProgress(emptyProgressState())).toBe(true);
  });

  it("is false once a tool has run, even after it finished", () => {
    let state = reduceProgress(emptyProgressState(), { kind: "tool:start", id: "t1", name: "Bash" });
    state = reduceProgress(state, { kind: "tool:end", id: "t1", name: "Bash", ok: true });

    expect(isEmptyProgress(state)).toBe(false);
  });
});

describe("activeCount", () => {
  it("counts only running activities and subagents, not finished ones", () => {
    let state = reduceProgress(emptyProgressState(), { kind: "tool:start", id: "t1", name: "Bash" });
    state = reduceProgress(state, { kind: "tool:start", id: "t2", name: "Read" });
    state = reduceProgress(state, { kind: "tool:end", id: "t1", name: "Bash", ok: true });
    state = reduceProgress(state, {
      kind: "subagent:start",
      id: "a1",
      agentType: "explorer",
      description: "x",
    });

    expect(activeCount(state)).toBe(2);
  });
});
