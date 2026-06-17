import { invoke } from "@tauri-apps/api/core";

export function terminalClipboardImagePaths(): Promise<string[]> {
  return invoke<string[]>("terminal_clipboard_image_paths");
}

export function terminalClipboardText(): Promise<string> {
  return invoke<string>("terminal_clipboard_text");
}

export function prepareClipboardImageAttachment(path: string): Promise<void> {
  return invoke("terminal_prepare_clipboard_image_attachment", { path });
}

export function isImageAttachmentCli(command: string | null | undefined): boolean {
  if (!command) {
    return false;
  }
  const normalized = command.toLowerCase();
  return ["claude", "codex", "gemini"].some((name) => normalized.includes(name));
}

export function formatImagePathsForTerminal(paths: string[]): string {
  return paths.length > 0 ? `${paths.map(shellQuotePath).join(" ")} ` : "";
}

export function shellQuotePath(path: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(path)) {
    return path;
  }
  return `'${path.replace(/'/g, "'\\''")}'`;
}
