import { describe, expect, it } from "vitest";
import { createTerminal } from "./createTerminal";

describe("createTerminal search", () => {
  it("exposes a search addon that finds text already in the buffer", async () => {
    const { term, search } = createTerminal();
    const container = document.createElement("div");
    document.body.appendChild(container);
    term.open(container);

    await new Promise<void>((resolve) => term.write("the quick brown fox\r\n", resolve));

    expect(search.findNext("brown")).toBe(true);
    expect(search.findNext("zebra")).toBe(false);

    term.dispose();
    container.remove();
  });
});
