/**
 * Two-way sync between the file explorer root and a terminal's working dir.
 *
 * The terminal already drives the explorer (poll `cwd` → setRoot). For the
 * reverse — explorer root change → `cd` the terminal — we must avoid echoing
 * back the directory the shell is already in, which would loop with the poll.
 */
export function shouldCdToRoot(root: string | null, currentCwd: string): boolean {
  return !!root && root.trim() !== "" && root !== currentCwd;
}
