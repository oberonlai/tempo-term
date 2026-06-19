import type { FileStatus } from "./gitBridge";

export interface FolderGroup {
  /** Directory the files live in, "" for the repo root. */
  folder: string;
  files: FileStatus[];
}

export function groupByFolder(files: FileStatus[]): FolderGroup[] {
  const map = new Map<string, FileStatus[]>();
  for (const file of files) {
    const slash = file.path.lastIndexOf("/");
    const folder = slash === -1 ? "" : file.path.slice(0, slash);
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
