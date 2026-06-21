export type SessionStatus = "active" | "thinking" | "waiting-approval" | "idle";

/** OSC code the status hook writes; chosen to avoid known codes. */
export const STATUS_OSC_CODE = 6973;

const STATES: readonly SessionStatus[] = ["active", "thinking", "waiting-approval", "idle"];

/**
 * Parse a `tempoterm;status;<state>` OSC payload emitted by the session-status
 * hook. Returns the parsed status, an end signal, or null for anything that
 * isn't ours or isn't a known state.
 */
export function parseStatusOsc(
  payload: string,
): { kind: "status"; status: SessionStatus } | { kind: "end" } | null {
  const parts = payload.split(";");
  if (parts[0] !== "tempoterm" || parts[1] !== "status") {
    return null;
  }
  const value = parts[2];
  if (value === "end") {
    return { kind: "end" };
  }
  if ((STATES as readonly string[]).includes(value)) {
    return { kind: "status", status: value as SessionStatus };
  }
  return null;
}
