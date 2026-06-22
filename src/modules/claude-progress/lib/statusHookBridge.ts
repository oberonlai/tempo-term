import { invoke } from "@tauri-apps/api/core";

/** Write the status hook script and register it in ~/.claude/settings.json. */
export async function installStatusHook(): Promise<void> {
  await invoke("claude_status_hook_install");
}

/** Remove the status hook entries and delete the script. */
export async function uninstallStatusHook(): Promise<void> {
  await invoke("claude_status_hook_uninstall");
}

/** Write the status hook into Codex's hooks.json and config.toml. */
export async function installCodexStatusHook(): Promise<void> {
  await invoke("codex_status_hook_install");
}

/** Remove our Codex hook entries and delete the script. */
export async function uninstallCodexStatusHook(): Promise<void> {
  await invoke("codex_status_hook_uninstall");
}
