import { describe, it, expect } from "vitest";
import { matchesOpenModifier, openModifierLabel } from "./platform";

type Mods = { altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean };
const ev = (m: Mods) => ({ altKey: false, metaKey: false, ctrlKey: false, ...m });

describe("matchesOpenModifier", () => {
  it("mac: Cmd matches", () => {
    expect(matchesOpenModifier(ev({ metaKey: true }), true)).toBe(true);
  });
  it("mac: Alt matches", () => {
    expect(matchesOpenModifier(ev({ altKey: true }), true)).toBe(true);
  });
  it("mac: Ctrl alone does not match", () => {
    expect(matchesOpenModifier(ev({ ctrlKey: true }), true)).toBe(false);
  });
  it("mac: no modifier does not match", () => {
    expect(matchesOpenModifier(ev({}), true)).toBe(false);
  });
  it("non-mac: Ctrl matches", () => {
    expect(matchesOpenModifier(ev({ ctrlKey: true }), false)).toBe(true);
  });
  it("non-mac: Alt matches", () => {
    expect(matchesOpenModifier(ev({ altKey: true }), false)).toBe(true);
  });
  it("non-mac: Cmd alone does not match", () => {
    expect(matchesOpenModifier(ev({ metaKey: true }), false)).toBe(false);
  });
});

describe("openModifierLabel", () => {
  it("mac label", () => expect(openModifierLabel(true)).toBe("Alt / Cmd"));
  it("non-mac label", () => expect(openModifierLabel(false)).toBe("Alt / Ctrl"));
});
