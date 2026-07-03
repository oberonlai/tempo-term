import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCollapsedPaths } from "./useCollapsedPaths";

describe("useCollapsedPaths", () => {
  it("starts with nothing collapsed", () => {
    const { result } = renderHook(() => useCollapsedPaths());
    expect(result.current.collapsed.size).toBe(0);
  });

  it("toggle adds a path the first time and removes it the second time", () => {
    const { result } = renderHook(() => useCollapsedPaths());

    act(() => result.current.toggle("dist"));
    expect(result.current.collapsed.has("dist")).toBe(true);

    act(() => result.current.toggle("dist"));
    expect(result.current.collapsed.has("dist")).toBe(false);
  });

  it("reset clears every collapsed path", () => {
    const { result } = renderHook(() => useCollapsedPaths());
    act(() => {
      result.current.toggle("dist");
      result.current.toggle("dist/aaa");
    });

    act(() => result.current.reset());

    expect(result.current.collapsed.size).toBe(0);
  });
});
