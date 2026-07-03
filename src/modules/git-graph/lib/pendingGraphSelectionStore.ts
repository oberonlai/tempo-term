import { create } from "zustand";

interface PendingGraphSelectionState {
  hash: string | null;
  /** Ask the Git Graph tab to select this commit once it can. */
  request: (hash: string) => void;
  /** Read and clear the pending hash; null if nothing is pending. */
  consume: () => string | null;
}

/**
 * Carries a "select this commit" request from the sidebar's history list to
 * the Git Graph tab, which is a singleton (openGitGraphTab always focuses the
 * one existing tab) so there is no per-tab PaneContent field to put this in.
 */
export const usePendingGraphSelectionStore = create<PendingGraphSelectionState>((set, get) => ({
  hash: null,
  request: (hash) => set({ hash }),
  consume: () => {
    const hash = get().hash;
    set({ hash: null });
    return hash;
  },
}));
