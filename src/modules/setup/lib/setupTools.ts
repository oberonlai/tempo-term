import { Channel, invoke } from "@tauri-apps/api/core";

/** Stable ids, kept in sync with the backend registry in modules/setup/mod.rs. */
export type ToolId = "node" | "git" | "gh" | "claude" | "codex" | "antigravity";

/** Per-tool detection result returned by the `detect_tools` command. */
export interface ToolStatus {
  id: ToolId;
  installed: boolean;
  version: string | null;
  meetsMin: boolean;
  /** Whether the current OS has an automated install command for this tool. */
  installable: boolean;
}

/** Full detection payload: per-tool status plus package-manager presence. */
export interface DetectResult {
  tools: ToolStatus[];
  brew: boolean;
  winget: boolean;
}

/** Display metadata for each tool, in the order shown in the wizard. */
export interface ToolMeta {
  id: ToolId;
  /** i18n key suffix under the `onboarding.tools` namespace. */
  name: string;
  /** Official page users can open when there is no automated install. */
  url: string;
}

/**
 * Display registry. The actual detect/install commands live in the Rust
 * backend; this only drives labels, ordering and the "official page" links.
 */
export const TOOL_REGISTRY: ToolMeta[] = [
  { id: "node", name: "node", url: "https://nodejs.org/" },
  { id: "git", name: "git", url: "https://git-scm.com/" },
  { id: "gh", name: "gh", url: "https://cli.github.com/" },
  { id: "claude", name: "claude", url: "https://docs.claude.com/en/docs/claude-code" },
  { id: "codex", name: "codex", url: "https://github.com/openai/codex" },
  { id: "antigravity", name: "antigravity", url: "https://antigravity.google/cli" },
];

/** Run backend detection for every tool. */
export function detectTools(): Promise<DetectResult> {
  return invoke<DetectResult>("detect_tools");
}

/**
 * Install one tool, streaming combined stdout/stderr to `onOutput` line by line.
 * Resolves with the process exit code (0 = success).
 */
export function installTool(id: ToolId, onOutput: (line: string) => void): Promise<number> {
  const channel = new Channel<string>();
  channel.onmessage = (line) => onOutput(line);
  return invoke<number>("install_tool", { id, onOutput: channel });
}

/** Whether a tool counts as ready: installed and meeting its minimum version. */
export function isToolReady(status: ToolStatus): boolean {
  return status.installed && status.meetsMin;
}
