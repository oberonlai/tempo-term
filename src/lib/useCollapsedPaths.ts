import { useCallback, useState } from "react";

/** Shared collapse-state manager for the sidebar and Git Graph tree views. */
export function useCollapsedPaths(): {
  collapsed: Set<string>;
  toggle: (path: string) => void;
  reset: () => void;
} {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Stable references so callers can safely list `toggle`/`reset` in a
  // useEffect dependency array without the effect re-running on every render.
  const toggle = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => setCollapsed(new Set()), []);

  return { collapsed, toggle, reset };
}
