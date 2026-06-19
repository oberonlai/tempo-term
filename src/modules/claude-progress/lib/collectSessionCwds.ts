import type { Tab } from "@/stores/tabsStore";
import { type LayoutNode, paneOf } from "@/modules/terminal/lib/terminalLayout";

/**
 * Add every terminal pane's session cwd under `node` to `cwds`, in a single
 * pass over the layout tree.
 */
function collectCwdsFromNode(
  node: LayoutNode,
  tabCwd: string | undefined,
  cwds: Set<string>,
): void {
  if (node.kind === "leaf") {
    const pane = paneOf(node);
    if (pane.kind === "terminal") {
      const cwd = pane.cwd || tabCwd;
      if (cwd) {
        cwds.add(cwd);
      }
    }
    return;
  }
  collectCwdsFromNode(node.children[0], tabCwd, cwds);
  collectCwdsFromNode(node.children[1], tabCwd, cwds);
}

/**
 * Every distinct directory a Claude session could be running in, one per open
 * terminal pane.
 *
 * A pane's live cwd (saved to `pane.cwd` as the shell `cd`s around) wins, so the
 * panel follows the directory the user actually ran `claude` in — not just the
 * tab's starting directory. A pane that hasn't reported its cwd yet (freshly
 * spawned, or an inactive split that never polled) falls back to the tab's
 * initial cwd so its session is still found. Empty results are skipped.
 *
 * Runs as a selector on every relevant store update, so it walks each tab's
 * pane tree once (O(panes)) instead of re-finding each leaf from the root.
 */
export function collectSessionCwds(tabs: Tab[]): string[] {
  const cwds = new Set<string>();
  for (const tab of tabs) {
    collectCwdsFromNode(tab.paneTree, tab.cwd, cwds);
  }
  return [...cwds];
}
