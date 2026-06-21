import { describe, expect, it } from "vitest";
import { parseStatusOsc } from "./sessionStatus";

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
