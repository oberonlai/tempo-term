import { describe, it, expect } from "vitest";
import { agentLabel } from "./agentLabel";

describe("agentLabel", () => {
  it('returns "Codex" for codex agent', () => {
    expect(agentLabel("codex")).toBe("Codex");
  });

  it('returns "Claude" for claude agent', () => {
    expect(agentLabel("claude")).toBe("Claude");
  });

  it("returns null for undefined", () => {
    expect(agentLabel(undefined)).toBeNull();
  });
});
