import { create } from "zustand";
import type { SessionStatus } from "./sessionStatus";

interface SessionStatusState {
  /** Live Claude status per terminal leaf id; absence means no badge. */
  statuses: Record<string, SessionStatus>;
  setStatus: (leafId: string, status: SessionStatus) => void;
  clear: (leafId: string) => void;
}

export const useSessionStatusStore = create<SessionStatusState>((set) => ({
  statuses: {},
  setStatus: (leafId, status) =>
    set((s) => ({ statuses: { ...s.statuses, [leafId]: status } })),
  clear: (leafId) =>
    set((s) => {
      if (!(leafId in s.statuses)) {
        return s;
      }
      const next = { ...s.statuses };
      delete next[leafId];
      return { statuses: next };
    }),
}));
