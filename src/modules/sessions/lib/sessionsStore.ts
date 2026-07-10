import { create } from "zustand";
import {
  sessionsList,
  sessionsPin,
  sessionsStart,
  type SessionAgent,
  type SessionSummary,
} from "./sessionsBridge";

interface SessionsState {
  sessions: SessionSummary[];
  loaded: boolean;
  query: string;
  agentFilter: SessionAgent | "all";
  modelFilter: string;
  selectedId: string | null;
  /** The project cwd shown by the project view, or `null` when it's not
   *  open. Mutually exclusive with `selectedId` — selecting one clears the
   *  other, since the main area shows exactly one of dashboard / project
   *  view / session transcript at a time. */
  selectedProject: string | null;
  /** The project cwd the sidebar is scoped to — set from the currently active
   *  project tab, kept when the active tab switches to the sessions tab (which
   *  has no cwd) so the panel stays scoped to the project the user came from.
   *  `null` before any project tab has been active. */
  scopeCwd: string | null;
  /** Whether the sidebar lists the scoped project's sessions ("project") or
   *  every project's ("user"). Defaults to "project"; the two dashboard
   *  buttons in the panel header flip it. */
  panelScope: "project" | "user";
  /** Reloads `sessions` from the index. Leaves state unchanged on error. */
  refresh: () => Promise<void>;
  /** Starts the backend index (idempotent), then refreshes. */
  start: () => Promise<void>;
  setQuery: (query: string) => void;
  setAgentFilter: (filter: SessionAgent | "all") => void;
  setModelFilter: (model: string) => void;
  select: (id: string | null) => void;
  selectProject: (cwd: string | null) => void;
  /** Locks the sidebar to a project cwd. Ignores empty/unchanged values (the
   *  active tab reports the same cwd on every render) and, on a real change,
   *  snaps `panelScope` back to "project" so landing on a new project tab
   *  always starts scoped to it. */
  setScopeCwd: (cwd: string | null) => void;
  setPanelScope: (scope: "project" | "user") => void;
  /** Flips a session's pinned state optimistically, then persists it;
   *  re-syncs from the backend if the write fails. */
  togglePin: (id: string) => Promise<void>;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  loaded: false,
  query: "",
  agentFilter: "all",
  modelFilter: "all",
  selectedId: null,
  selectedProject: null,
  scopeCwd: null,
  panelScope: "project",

  refresh: async () => {
    try {
      const sessions = await sessionsList();
      set({ sessions, loaded: true });
    } catch {
      // Leave state unchanged; the caller can retry.
    }
  },

  start: async () => {
    try {
      await sessionsStart();
      await get().refresh();
    } catch {
      // Leave state unchanged; the caller can retry.
    }
  },

  setQuery: (query) => set({ query }),
  setAgentFilter: (agentFilter) => set({ agentFilter }),
  setModelFilter: (modelFilter) => set({ modelFilter }),
  select: (selectedId) => set({ selectedId, selectedProject: null }),
  selectProject: (selectedProject) => set({ selectedProject, selectedId: null }),
  setScopeCwd: (cwd) => {
    if (!cwd || cwd === get().scopeCwd) {
      return;
    }
    set({ scopeCwd: cwd, panelScope: "project" });
  },
  setPanelScope: (panelScope) => set({ panelScope }),

  togglePin: async (id) => {
    const before = get().sessions;
    const target = before.find((s) => s.id === id);
    if (!target) {
      return;
    }

    const nextPinned = !target.pinned;
    set({
      sessions: before.map((s) => (s.id === id ? { ...s, pinned: nextPinned } : s)),
    });

    try {
      await sessionsPin(id, nextPinned);
    } catch {
      // The optimistic flip may be wrong; resync from the backend.
      await get().refresh();
    }
  },
}));

/** The sidebar's list scope: every project ("user") or a single project cwd.
 *  In "project" mode an empty/absent cwd falls back to showing everything, so
 *  the list is never stranded before a project tab has been active. */
export type SessionsScope = { mode: "user" } | { mode: "project"; cwd: string | null };

/**
 * Pure selector splitting `sessions` into pinned (sorted by most recently
 * ended) and history (everything else), after applying the project scope, the
 * agent filter, the model filter, and a case-insensitive title/project_cwd
 * query match. Exported for tests and for the sessions panel to derive its two
 * list sections.
 */
export function visibleSessions(
  sessions: SessionSummary[],
  query: string,
  agentFilter: SessionAgent | "all",
  modelFilter: string,
  scope: SessionsScope = { mode: "user" },
): { pinned: SessionSummary[]; history: SessionSummary[] } {
  const q = query.trim().toLowerCase();

  // Scope to a single project by exact cwd match. Antigravity sessions carry
  // an empty project_cwd (the CLI records no cwd), so they never match a real
  // project and are hidden here — surfacing only in the "user" (all) view. An
  // empty scope cwd (no project tab has been active yet) matches everything.
  const scopeCwd = scope.mode === "project" ? scope.cwd : null;

  // Self-heal a stranded model filter: if the selected model is no longer in
  // the dataset at all (its sessions were deleted while the sidebar — and its
  // reset effect — was unmounted), ignore it instead of returning an empty
  // list with no visible way back to "all". Keyed off the raw model set, so a
  // model that still exists but is narrowed to zero by other filters is
  // honored, not clamped.
  const effectiveModelFilter =
    modelFilter === "all" || sessions.some((s) => s.model === modelFilter) ? modelFilter : "all";

  const filtered = sessions.filter((s) => {
    if (scopeCwd && s.project_cwd !== scopeCwd) {
      return false;
    }
    if (agentFilter !== "all" && s.agent !== agentFilter) {
      return false;
    }
    if (effectiveModelFilter !== "all" && s.model !== effectiveModelFilter) {
      return false;
    }
    if (q === "") {
      return true;
    }
    return s.title.toLowerCase().includes(q) || s.project_cwd.toLowerCase().includes(q);
  });

  const pinned = filtered.filter((s) => s.pinned).sort((a, b) => b.ended_at - a.ended_at);
  const history = filtered.filter((s) => !s.pinned);

  return { pinned, history };
}
