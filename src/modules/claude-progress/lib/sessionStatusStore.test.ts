import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStatusStore } from "./sessionStatusStore";

beforeEach(() => useSessionStatusStore.setState({ statuses: {} }));

describe("sessionStatusStore", () => {
  it("sets and overwrites a leaf's status", () => {
    useSessionStatusStore.getState().setStatus("leaf-1", "active");
    expect(useSessionStatusStore.getState().statuses["leaf-1"]).toBe("active");
    useSessionStatusStore.getState().setStatus("leaf-1", "idle");
    expect(useSessionStatusStore.getState().statuses["leaf-1"]).toBe("idle");
  });

  it("clears a leaf", () => {
    useSessionStatusStore.getState().setStatus("leaf-1", "active");
    useSessionStatusStore.getState().clear("leaf-1");
    expect(useSessionStatusStore.getState().statuses["leaf-1"]).toBeUndefined();
  });

  it("clearing an unknown leaf is a no-op", () => {
    const before = useSessionStatusStore.getState().statuses;
    useSessionStatusStore.getState().clear("missing");
    expect(useSessionStatusStore.getState().statuses).toBe(before);
  });
});
