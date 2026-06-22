import { create } from "zustand";
import { createNormalizer, type Normalizer } from "./normalize";
import { createCodexNormalizer, type AgentKind } from "./codexNormalize";
import { emptyProgressState, reduceProgress, type ProgressState } from "./progressState";

interface ProgressStoreState {
  /** Accumulated progress per watched project directory (keyed by cwd). */
  sessions: Record<string, ProgressState>;
  /**
   * A per-cwd counter bumped whenever that directory switches to a new session
   * (a reset). Consumers watch it to know when to refetch derived data like the
   * session title.
   */
  sessionEpochs: Record<string, number>;
  /** The agent currently feeding each cwd (keyed by cwd). */
  agents: Record<string, AgentKind>;
  /**
   * Feed raw transcript lines (from the backend watcher) for one cwd. `reset`
   * marks the first batch of a newly started session, clearing prior progress.
   * `agent` selects the normalizer; switching agent for a cwd rebuilds it fresh.
   */
  pushLines: (cwd: string, agent: AgentKind, lines: string[], reset: boolean) => void;
  /** Keep only the sessions for `cwds`; drop progress for directories no longer watched. */
  syncSessions: (cwds: string[]) => void;
}

// Each cwd's normalizer is stateful (it pairs tool calls with their results), so
// the normalizers live alongside the store, one per watched directory.
const normalizers = new Map<string, Normalizer>();
const normalizerAgents = new Map<string, AgentKind>();

function makeNormalizer(agent: AgentKind): Normalizer {
  return agent === "codex" ? createCodexNormalizer() : createNormalizer();
}

function normalizerFor(cwd: string, agent: AgentKind): Normalizer {
  let normalizer = normalizers.get(cwd);
  if (!normalizer || normalizerAgents.get(cwd) !== agent) {
    normalizer = makeNormalizer(agent);
    normalizers.set(cwd, normalizer);
    normalizerAgents.set(cwd, agent);
  }
  return normalizer;
}

export const useProgressStore = create<ProgressStoreState>((set) => ({
  sessions: {},
  sessionEpochs: {},
  agents: {},

  pushLines: (cwd, agent, lines, reset) =>
    set((state) => {
      // A reset (new session) or an agent switch for this cwd starts fresh so the
      // old session's or other agent's leftovers can't linger.
      const fresh = reset || normalizerAgents.get(cwd) !== agent;
      if (fresh) {
        normalizers.set(cwd, makeNormalizer(agent));
        normalizerAgents.set(cwd, agent);
      }
      // A new session for this cwd: bump its epoch so title consumers refetch.
      const sessionEpochs = fresh
        ? { ...state.sessionEpochs, [cwd]: (state.sessionEpochs[cwd] ?? 0) + 1 }
        : state.sessionEpochs;
      const normalizer = normalizerFor(cwd, agent);
      const previous = fresh ? undefined : state.sessions[cwd];
      let next = previous ?? emptyProgressState();
      for (const line of lines) {
        for (const event of normalizer.push(line)) {
          next = reduceProgress(next, event);
        }
      }
      const agents = state.agents[cwd] === agent ? state.agents : { ...state.agents, [cwd]: agent };
      if (next === previous) {
        return { sessionEpochs, agents };
      }
      // Don't materialize an empty session for a cwd whose lines produced nothing.
      if (!fresh && previous === undefined && isEmptyProgress(next)) {
        return { sessionEpochs, agents };
      }
      return { sessions: { ...state.sessions, [cwd]: next }, sessionEpochs, agents };
    }),

  syncSessions: (cwds) =>
    set((state) => {
      const keep = new Set(cwds);
      for (const cwd of normalizers.keys()) {
        if (!keep.has(cwd)) {
          normalizers.delete(cwd);
          normalizerAgents.delete(cwd);
        }
      }
      const sessions: Record<string, ProgressState> = {};
      for (const [cwd, progress] of Object.entries(state.sessions)) {
        if (keep.has(cwd)) {
          sessions[cwd] = progress;
        }
      }
      const agents: Record<string, AgentKind> = {};
      for (const [cwd, kind] of Object.entries(state.agents)) {
        if (keep.has(cwd)) {
          agents[cwd] = kind;
        }
      }
      return { sessions, agents };
    }),
}));

/** True when a session has nothing worth showing (no activities, subagents, or todos). */
export function isEmptyProgress(progress: ProgressState): boolean {
  return (
    progress.activities.length === 0 &&
    progress.subagents.length === 0 &&
    progress.todos.length === 0
  );
}
