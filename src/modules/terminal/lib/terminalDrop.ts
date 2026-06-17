import { isImagePath } from "./terminalClipboard";

type FileWithPath = File & { path?: string };

export function imagePathsFromDrop(data: DataTransfer): string[] {
  return pathsFromDrop(data).filter(isImagePath);
}

export function pathsFromDrop(data: DataTransfer): string[] {
  const candidates = [
    ...pathsFromUriList(data.getData("text/uri-list")),
    ...pathsFromPlainText(data.getData("text/plain")),
    ...pathsFromFiles(data.files),
  ];
  return unique(candidates);
}

export function imageFilesFromDrop(data: DataTransfer): File[] {
  const fromItems = Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  if (fromItems.length > 0) {
    return fromItems;
  }
  return Array.from(data.files).filter((file) => file.type.startsWith("image/"));
}

function pathsFromUriList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(fileUriToPath)
    .filter((path): path is string => path !== null);
}

function pathsFromPlainText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => fileUriToPath(line) ?? line)
    .filter((line) => line.startsWith("/"));
}

function pathsFromFiles(files: FileList): string[] {
  return Array.from(files)
    .map((file) => (file as FileWithPath).path)
    .filter((path): path is string => Boolean(path));
}

export function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) {
    return null;
  }
  try {
    return decodeURIComponent(new URL(uri).pathname);
  } catch {
    return null;
  }
}

function unique(paths: string[]): string[] {
  return Array.from(new Set(paths));
}
