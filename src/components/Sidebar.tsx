import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, FolderTree, GitBranch, History, LayoutGrid, NotebookPen, Server, type LucideIcon } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
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

// Module-level so the reference stays stable across renders — an inline options
// object would make useSensor/useSensors rebuild the sensors array on every
// render (one happens mid-drag when draggingId updates). The 4px activation
// distance keeps a plain click (panel select) from starting a drag. Mirrors
// TabBar's tab reordering.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 4 } };

/** Common classes for an icon-bar button, active or not. */
function iconButtonClass(active: boolean, dragging: boolean): string {
  return `flex h-7 w-8 select-none items-center justify-center border-b-2 transition-colors ${
    active
      ? "border-accent text-fg"
      : "border-transparent text-fg-subtle hover:border-border-strong hover:text-fg"
  } ${dragging ? "opacity-30" : ""}`;
}

/** One draggable icon-bar entry. The dnd-kit pointer sensor distinguishes a
 *  click (select the panel) from a drag (reorder) via the activation distance,
 *  so no manual drag-vs-click bookkeeping is needed. */
function SidebarIcon({
  id,
  active,
  onSelect,
}: {
  id: SidebarView;
  active: boolean;
  onSelect: (id: SidebarView) => void;
}) {
  const { t } = useTranslation();
  const { icon: Icon, labelKey } = SIDEBAR_TABS[id];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined,
        transition,
      }}
      {...attributes}
      {...listeners}
    >
      <Tooltip label={t(labelKey)} side="bottom">
        <button
          type="button"
          aria-label={t(labelKey)}
          aria-pressed={active}
          onClick={() => onSelect(id)}
          className={iconButtonClass(active, isDragging)}
        >
          <Icon size={15} />
        </button>
      </Tooltip>
    </div>
  );
}

export function Sidebar() {
  const sidebarView = useUiStore((s) => s.sidebarView);
  const selectSidebar = useUiStore((s) => s.selectSidebar);
  const sidebarOrder = useUiStore((s) => s.sidebarOrder);
  const reorderSidebar = useUiStore((s) => s.reorderSidebar);
  // Pointer-based reordering via dnd-kit. HTML5 drag-and-drop is unusable here
  // because Tauri's native drag-drop capture (dragDropEnabled, needed for file
  // drops into the terminal) swallows the webview's HTML5 drag events; dnd-kit's
  // pointer sensor is unaffected and TabBar already reorders tabs the same way.
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));
  const [draggingId, setDraggingId] = useState<SidebarView | null>(null);
  const DraggingIcon = draggingId ? SIDEBAR_TABS[draggingId].icon : null;

  function handleSelect(id: SidebarView) {
    if (id === "workspaces") {
      probeStart();
    }
    selectSidebar(id);
  }

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(event.active.id as SidebarView);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const from = sidebarOrder.indexOf(active.id as SidebarView);
    const to = sidebarOrder.indexOf(over.id as SidebarView);
    reorderSidebar(from, to);
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-r border-border bg-bg-inset">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        <div className="relative flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-1.5">
          <SortableContext items={sidebarOrder} strategy={horizontalListSortingStrategy}>
            {sidebarOrder.map((id) => (
              <SidebarIcon key={id} id={id} active={sidebarView === id} onSelect={handleSelect} />
            ))}
          </SortableContext>
        </div>

        {/* Floating icon that follows the cursor while dragging. */}
        <DragOverlay>
          {DraggingIcon ? (
            <span
              aria-hidden
              className="flex h-7 w-8 items-center justify-center rounded-md border border-border-strong bg-bg-elevated text-fg shadow-lg"
            >
              <DraggingIcon size={15} />
            </span>
          ) : null}
        </DragOverlay>
      </DndContext>

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
