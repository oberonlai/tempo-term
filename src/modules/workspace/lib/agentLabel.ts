import type { AgentKind } from "@/modules/claude-progress/lib/codexNormalize";

/** Display label for the agent feeding a workspace card, or null when unknown. */
export function agentLabel(agent: AgentKind | undefined): "Claude" | "Codex" | null {
  if (agent === "codex") return "Codex";
  if (agent === "claude") return "Claude";
  return null;
}
