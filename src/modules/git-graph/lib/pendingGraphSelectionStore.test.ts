import { describe, expect, it } from "vitest";
import { usePendingGraphSelectionStore } from "./pendingGraphSelectionStore";

describe("usePendingGraphSelectionStore", () => {
  it("returns and clears the requested hash on consume", () => {
    usePendingGraphSelectionStore.getState().request("abc1234");
    expect(usePendingGraphSelectionStore.getState().hash).toBe("abc1234");

    const consumed = usePendingGraphSelectionStore.getState().consume();

    expect(consumed).toBe("abc1234");
    expect(usePendingGraphSelectionStore.getState().hash).toBeNull();
  });

  it("consume returns null when nothing was requested", () => {
    usePendingGraphSelectionStore.setState({ hash: null });
    expect(usePendingGraphSelectionStore.getState().consume()).toBeNull();
  });
});
