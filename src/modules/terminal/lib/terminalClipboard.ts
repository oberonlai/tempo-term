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

export async function saveDroppedImage(file: File): Promise<string> {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  return invoke<string>("terminal_save_dropped_image", {
    name: file.name || undefined,
    mime: file.type || undefined,
    bytes,
  });
}

export function isImageAttachmentCli(command: string | null | undefined): boolean {
  if (!command) {
    return false;
  }
  const normalized = command.toLowerCase();
  return ["claude", "codex", "gemini"].some((name) => normalized.includes(name));
}

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(path);
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
