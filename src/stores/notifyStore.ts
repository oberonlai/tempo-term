import { create } from "zustand";

interface Notice {
  text: string;
}

interface NotifyState {
  notice: Notice | null;
  /** Post a transient app-wide notice (bottom-right toast, auto-dismisses). */
  notify: (text: string) => void;
  clear: () => void;
}

export const useNotifyStore = create<NotifyState>((set) => ({
  notice: null,
  // A fresh object per post so re-posting the same text still restarts the
  // toast's dismiss timer (the effect keys on object identity, not the text).
  notify: (text) => set({ notice: { text } }),
  clear: () => set({ notice: null }),
}));
