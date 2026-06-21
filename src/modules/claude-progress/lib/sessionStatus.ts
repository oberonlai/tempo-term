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

/**
 * Whether a terminal's foreground command looks like Claude Code, used as a
 * crash backstop: if a pane still shows a status but Claude is no longer in the
 * foreground, the status is stale and gets cleared. Matches the `claude` binary
 * by name or path, and the npm `claude-code` package's node command.
 */
export function isClaudeForeground(cmd: string | null): boolean {
  if (!cmd) {
    return false;
  }
  const trimmed = cmd.trim();
  // Match claude as the executable (bare, path-qualified, or behind a prefix
  // runner like sudo/npx), or the npm package's node command — but not claude
  // appearing only as an argument (e.g. `vim claude.md`), which would wrongly
  // keep a stale status alive.
  return (
    /^(?:(?:sudo|npx|bunx|yarn\s+run)\s+)?(?:.*\/)?claude(?:\s|$)/i.test(trimmed) ||
    /\bclaude-code\b/i.test(trimmed) ||
    /@anthropic-ai\/claude/i.test(trimmed)
  );
}
