import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, FolderTree, GitBranch, History, LayoutGrid, NotebookPen, Server, type LucideIcon } from "lucide-react";
import { ExplorerView } from "@/modules/explorer/ExplorerView";
import { SourceControlView } from "@/modules/source-control/SourceControlView";
import { AIView } from "@/modules/ai/AIView";
import { NotesSidebar } from "@/modules/notes/NotesSidebar";
import { WorkspacePanel } from "@/modules/workspace/WorkspacePanel";
import { ConnectionsPanel } from "@/modules/ssh/ConnectionsPanel";
import { SessionsPanel } from "@/modules/sessions/SessionsPanel";
import { Tooltip } from "@/components/Tooltip";
import { useUiStore, type SidebarView } from "@/stores/uiStore";
import { probeStart } from "@/lib/perfProbe";

interface SidebarTab {
  icon: LucideIcon;
  labelKey: string;
}

const SIDEBAR_TABS: Record<SidebarView, SidebarTab> = {
  workspaces: { icon: LayoutGrid, labelKey: "nav.workspaces" },
  explorer: { icon: FolderTree, labelKey: "nav.explorer" },
  sourceControl: { icon: GitBranch, labelKey: "nav.git" },
  notes: { icon: NotebookPen, labelKey: "nav.notes" },
  ai: { icon: Bot, labelKey: "nav.ai" },
  connections: { icon: Server, labelKey: "nav.connections" },
  sessions: { icon: History, labelKey: "nav.sessions" },
};

export function Sidebar() {
  const { t } = useTranslation();
  const sidebarView = useUiStore((s) => s.sidebarView);
  const selectSidebar = useUiStore((s) => s.selectSidebar);
  const sidebarOrder = useUiStore((s) => s.sidebarOrder);
  const reorderSidebar = useUiStore((s) => s.reorderSidebar);
  // Pointer-based reordering. HTML5 drag-and-drop is unusable here because
  // Tauri's native drag-drop capture (dragDropEnabled, needed for file drops
  // into the terminal) swallows the webview's drag events, so we drive the
  // reorder with raw pointer events instead.
  const barRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // Insertion gap (0…length) the icon would drop into, plus the x-offset (px,
  // relative to the icon bar) to paint the divider at. null while not dragging.
  const [insertion, setInsertion] = useState<{ gap: number; x: number } | null>(null);
  // The floating ghost icon's viewport position while dragging.
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  // True once the pointer has moved past the drag threshold, so the following
  // click is a drag release and must not also select the panel.
  const draggedRef = useRef(false);
  // Pointer x at press time, kept in a ref so the move listener can measure the
  // drag threshold without re-subscribing on every position change.
  const startXRef = useRef(0);

  // Map a viewport x-coordinate to the insertion gap between icons (0…length)
  // and the divider's x-offset relative to the icon bar.
  function insertionFromClientX(clientX: number): { gap: number; x: number } | null {
    const bar = barRef.current;
    if (!bar) {
      return null;
    }
    const barRect = bar.getBoundingClientRect();
    const buttons = Array.from(bar.querySelectorAll("button"));
    for (let i = 0; i < buttons.length; i += 1) {
      const rect = buttons[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        return { gap: i, x: rect.left - barRect.left };
      }
    }
    const last = buttons[buttons.length - 1]?.getBoundingClientRect();
    return { gap: buttons.length, x: last ? last.right - barRect.left : 0 };
  }

  function handlePointerDown(e: React.PointerEvent, startIndex: number) {
    if (e.button !== 0) {
      return;
    }
    startXRef.current = e.clientX;
    draggedRef.current = false;
    setDragIndex(startIndex);
  }

  // Window-level pointer listeners live for the duration of a drag only, driven
  // by dragIndex. Binding them here (rather than imperatively in the pointerdown
  // handler) guarantees the cleanup runs even if the component unmounts
  // mid-drag — e.g. the user hides the sidebar with a shortcut — so no listener
  // is left firing setState on an unmounted component.
  useEffect(() => {
    if (dragIndex === null) {
      return;
    }
    const from = dragIndex;

    function onMove(ev: PointerEvent) {
      if (!draggedRef.current && Math.abs(ev.clientX - startXRef.current) < 4) {
        return;
      }
      draggedRef.current = true;
      setInsertion(insertionFromClientX(ev.clientX));
      setGhost({ x: ev.clientX, y: ev.clientY });
    }

    function onUp(ev: PointerEvent) {
      if (draggedRef.current) {
        const drop = insertionFromClientX(ev.clientX);
        if (drop) {
          // A gap after the dragged slot shifts left by one once the item is
          // pulled out, so map the gap to the post-removal target index.
          const target = drop.gap > from ? drop.gap - 1 : drop.gap;
          reorderSidebar(from, target);
        }
      }
      setDragIndex(null);
      setInsertion(null);
      setGhost(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragIndex, reorderSidebar]);

  const ghostId = dragIndex !== null ? sidebarOrder[dragIndex] : null;
  const GhostIcon = ghostId ? SIDEBAR_TABS[ghostId].icon : null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-r border-border bg-bg-inset">
      <div ref={barRef} className="relative flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-1.5">
        {sidebarOrder.map((id, index) => {
          const { icon: Icon, labelKey } = SIDEBAR_TABS[id];
          const active = sidebarView === id;
          return (
            <Tooltip key={id} label={t(labelKey)} side="bottom">
              <button
                type="button"
                aria-label={t(labelKey)}
                aria-pressed={active}
                onPointerDown={(e) => handlePointerDown(e, index)}
                onClick={() => {
                  // Swallow the click that ends a drag so it does not also
                  // switch panels.
                  if (draggedRef.current) {
                    draggedRef.current = false;
                    return;
                  }
                  if (id === "workspaces") probeStart();
                  selectSidebar(id);
                }}
                className={`flex h-7 w-8 select-none items-center justify-center border-b-2 transition-colors ${
                  active
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-subtle hover:border-border-strong hover:text-fg"
                } ${ghost && dragIndex === index ? "opacity-30" : ""}`}
              >
                <Icon size={15} />
              </button>
            </Tooltip>
          );
        })}

        {/* Insertion divider — a vertical line marking where the icon will land. */}
        {insertion && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1 bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-accent transition-[left] duration-100 ease-out"
            style={{ left: insertion.x }}
          />
        )}
      </div>

      {/* Floating ghost that follows the cursor while dragging. */}
      {ghost && GhostIcon && (
        <span
          aria-hidden
          className="pointer-events-none fixed z-[200] flex h-7 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border border-border-strong bg-bg-elevated text-fg shadow-lg"
          style={{ left: ghost.x, top: ghost.y }}
        >
          <GhostIcon size={15} />
        </span>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {/*
         * WorkspacePanel stays mounted and is just hidden when another sidebar
         * view is active. Unmounting it drops the cached worktree / title / PR
         * fetches and re-fires N IPC calls per cwd on every switch back, which
         * is the main contributor to the multi-second sidebar-switch jank. The
         * other panels still mount conditionally because their state cleanup
         * on unmount is cheap and their cards do not chain IPC storms.
         */}
        <div className="h-full w-full" hidden={sidebarView !== "workspaces"}>
          <WorkspacePanel />
        </div>
        {sidebarView === "explorer" && <ExplorerView />}
        {sidebarView === "sourceControl" && <SourceControlView />}
        {sidebarView === "notes" && <NotesSidebar />}
        {sidebarView === "ai" && <AIView />}
        {sidebarView === "connections" && <ConnectionsPanel />}
        {sidebarView === "sessions" && <SessionsPanel />}
      </div>
    </div>
  );
}
