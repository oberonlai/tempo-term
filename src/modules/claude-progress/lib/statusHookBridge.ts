import { invoke } from "@tauri-apps/api/core";

/** Write the status hook script and register it in ~/.claude/settings.json. */
export async function installStatusHook(): Promise<void> {
  await invoke("claude_status_hook_install");
}

/** Remove the status hook entries and delete the script. */
export async function uninstallStatusHook(): Promise<void> {
  await invoke("claude_status_hook_uninstall");
}
