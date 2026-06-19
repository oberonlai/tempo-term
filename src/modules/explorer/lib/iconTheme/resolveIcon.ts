import { fileExtensions, fileNames } from "./catppuccin/fileIcons";
import { folderNames } from "./catppuccin/folderIcons";

// The vendored tables are reduce-built reverse maps (key -> icon basename).
// Re-key them lowercase once so lookups are case-insensitive.
function toLowerMap(source: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, icon] of Object.entries(source)) {
    map.set(key.toLowerCase(), icon);
  }
  return map;
}

const byFileName = toLowerMap(fileNames as Record<string, string>);
const byExtension = toLowerMap(fileExtensions as Record<string, string>);
const byFolderName = toLowerMap(folderNames as Record<string, string>);

/**
 * Resolve a file name to a Catppuccin icon basename.
 * Priority: exact file name -> longest matching dotted extension suffix -> `_file`.
 */
export function resolveFileIcon(fileName: string): string {
  const lower = fileName.toLowerCase();

  const exact = byFileName.get(lower);
  if (exact) {
    return exact;
  }

  // Try progressively shorter dotted suffixes so multi-part extensions
  // (e.g. `component.test.tsx`) can match before the final segment.
  const parts = lower.split(".");
  for (let i = 1; i < parts.length; i++) {
    const hit = byExtension.get(parts.slice(i).join("."));
    if (hit) {
      return hit;
    }
  }

  return "_file";
}

/**
 * Resolve a folder name to a Catppuccin icon basename.
 * Known names already carry the `folder_` prefix in the table; the open
 * state appends an `_open` suffix. Unknown names fall back to `_folder`.
 */
export function resolveFolderIcon(folderName: string, open: boolean): string {
  const base = byFolderName.get(folderName.toLowerCase());
  if (!base) {
    return open ? "_folder_open" : "_folder";
  }
  return open ? `${base}_open` : base;
}
