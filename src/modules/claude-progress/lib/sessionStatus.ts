export type SessionStatus = "active" | "thinking" | "waiting-approval" | "idle";

/** OSC code the status hook writes; chosen to avoid known codes. */
export const STATUS_OSC_CODE = 6973;

const STATES: readonly SessionStatus[] = ["active", "thinking", "waiting-approval", "idle"];

/**
 * Claude Code's `Notification` hook is a catch-all keyed by `notification_type`,
 * so the hook forwards that type and we resolve it here. Only the types that map
 * to a real session state are listed; anything else (auth_success, elicitation,
 * …) is ignored so a stray notification never clobbers the live status. In
 * particular `idle_prompt` is "waiting for the user's next message", which is
 * idle, NOT waiting-for-approval.
 */
const NOTIFICATION_STATUS: Record<string, SessionStatus> = {
  permission_prompt: "waiting-approval",
  idle_prompt: "idle",
};

/**
 * Parse an OSC payload emitted by the session-status hook. Two shapes:
 * `tempoterm;status;<state>` for direct state events, and
 * `tempoterm;notify;<notification_type>` for the Notification catch-all.
 * Returns the parsed status, an end signal, or null for anything that isn't
 * ours or doesn't map to a known state.
 */
export function parseStatusOsc(
  payload: string,
): { kind: "status"; status: SessionStatus } | { kind: "end" } | null {
  const parts = payload.split(";");
  if (parts[0] !== "tempoterm") {
    return null;
  }
  if (parts[1] === "notify") {
    // Validate the resolved value is a real state: bracket access on an
    // attacker-controlled key could otherwise surface an inherited member
    // (e.g. "toString" → Object.prototype.toString).
    const status = NOTIFICATION_STATUS[parts[2]];
    return status && (STATES as readonly string[]).includes(status)
      ? { kind: "status", status }
      : null;
  }
  if (parts[1] !== "status") {
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

/**
 * Whether a terminal's foreground command looks like Codex, used for the same
 * crash backstop and to label which agent a pane runs. Matches the `codex`
 * binary by name or path, behind a prefix runner, or the npm package's node
 * command, but not codex appearing only as an argument.
 */
export function isCodexForeground(cmd: string | null): boolean {
  if (!cmd) {
    return false;
  }
  const trimmed = cmd.trim();
  return (
    /^(?:(?:sudo|npx|bunx|yarn\s+run)\s+)?(?:.*\/)?codex(?:\s|$)/i.test(trimmed) ||
    /@openai\/codex\b/i.test(trimmed) ||
    /\bopenai-codex\b/i.test(trimmed)
  );
}

/** True when any agent tempo-term tracks is the foreground process. */
export function isTrackedAgentForeground(cmd: string | null): boolean {
  return isClaudeForeground(cmd) || isCodexForeground(cmd);
}
