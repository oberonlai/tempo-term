import type { FileStatus } from "./gitBridge";

export interface FolderGroup {
  /** Directory the files live in, "" for the repo root. */
  folder: string;
  files: FileStatus[];
}

export function groupByFolder(files: FileStatus[]): FolderGroup[] {
  const map = new Map<string, FileStatus[]>();
  for (const file of files) {
    // git reports an untracked directory as a single entry ending in "/"; drop
    // it so the entry buckets under its parent instead of forming its own folder.
    const normalized = file.path.endsWith("/") ? file.path.slice(0, -1) : file.path;
    const slash = normalized.lastIndexOf("/");
    const folder = slash === -1 ? "" : normalized.slice(0, slash);
    const existing = map.get(folder);
    if (existing) {
      existing.push(file);
    } else {
      map.set(folder, [file]);
    }
  }
  return Array.from(map, ([folder, groupFiles]) => ({ folder, files: groupFiles })).sort(
    (a, b) => {
      // Repo-root files (folder "") sit below the named folders.
      if (a.folder === "") return 1;
      if (b.folder === "") return -1;
      return a.folder.localeCompare(b.folder);
    },
  );
}
