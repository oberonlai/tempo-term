import { describe, expect, it } from "vitest";
import { isEmptyProgress, useProgressStore } from "./progressStore";
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

describe("sessionEpochs", () => {
  it("increments a cwd's epoch each time its session resets", () => {
    useProgressStore.setState({ sessions: {}, sessionEpochs: {} });
    useProgressStore.getState().pushLines("/a", "claude", [], true);
    expect(useProgressStore.getState().sessionEpochs["/a"]).toBe(1);
    useProgressStore.getState().pushLines("/a", "claude", [], true);
    expect(useProgressStore.getState().sessionEpochs["/a"]).toBe(2);
  });

  it("does not bump the epoch on a non-reset append", () => {
    useProgressStore.setState({ sessions: {}, sessionEpochs: { "/a": 1 } });
    useProgressStore.getState().pushLines("/a", "claude", [], false);
    expect(useProgressStore.getState().sessionEpochs["/a"]).toBe(1);
  });
});

describe("per-agent normalizer selection", () => {
  it("rebuilds the normalizer when the agent changes for a cwd", () => {
    useProgressStore.setState({ sessions: {}, sessionEpochs: {} });
    const store = useProgressStore.getState();
    // A Codex tool starts under codex.
    store.pushLines("/p", "codex", [
      JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "c1", arguments: "{}" } }),
    ], false);
    expect(useProgressStore.getState().sessions["/p"].activities).toHaveLength(1);

    // Switching the same cwd to claude starts fresh (no leftover codex activity).
    store.pushLines("/p", "claude", [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash" }] } }),
    ], false);
    const activities = useProgressStore.getState().sessions["/p"].activities;
    expect(activities).toHaveLength(1);
    expect(activities[0].id).toBe("t1");
  });
});
