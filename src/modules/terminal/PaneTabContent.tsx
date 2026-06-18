import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { cursorPosition } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { TerminalView } from "./TerminalView";
import { PaneToolbar } from "./PaneToolbar";
import { dropPathsIntoTerminal, writeToTerminal } from "./lib/terminalBus";
import {
  computeLayout,
  computeSplitters,
  type PaneContent,
  type SplitterInfo,
} from "./lib/terminalLayout";
import { EditorTabContent } from "@/modules/editor/EditorTabContent";
import { NoteTabContent } from "@/modules/notes/NoteTabContent";
import { PreviewTabContent } from "@/modules/preview/PreviewTabContent";
import { GitGraphTabContent } from "@/modules/git-graph/GitGraphTabContent";
import { dropOverlayClassName, useEntryDragging } from "@/components/EntryDropOverlay";
import {
  fileUrl,
  getDraggedEntry,
  shellQuotePath,
  type DraggedEntry,
} from "@/modules/explorer/lib/dragEntry";
import { insertLinkIntoNote } from "@/modules/notes/lib/noteBus";
import { useTabsStore, type Tab } from "@/stores/tabsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const MIN_FRACTION = 0.1;
const MAX_FRACTION = 0.9;

/** The leaf id of the pane under the given client-space point, if any. */
function paneLeafAt(clientX: number, clientY: number): string | null {
  return (
    document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-pane-leaf]")?.dataset
      .paneLeaf ?? null
  );
}

/**
 * Renders one tab as a recursive split of panes. Each leaf shows a terminal,
 * editor, note, preview, or git graph, and the toolbar splits the active pane
 * into any of those. Works for every tab kind, not just terminals.
 */
export function PaneTabContent({ tab }: { tab: Tab }) {
  const { t } = useTranslation();
  const setActiveLeaf = useTabsStore((s) => s.setActiveLeaf);
  const resizePane = useTabsStore((s) => s.resizePane);
  const splitPaneWith = useTabsStore((s) => s.splitPaneWith);
  const setPaneContent = useTabsStore((s) => s.setPaneContent);
  const closePane = useTabsStore((s) => s.closePane);
  const isActiveTab = useTabsStore((s) => s.activeId === tab.id);
  const paneAreaRef = useRef<HTMLDivElement>(null);
  const dragging = useEntryDragging();
  // New terminal panes (incl. splits) start in the explorer's current dir, not
  // the tab's original cwd — so a split follows where you've navigated to.
  const rootPath = useWorkspaceStore((s) => s.rootPath);

  const panes = computeLayout(tab.paneTree);
  const splitters = computeSplitters(tab.paneTree);
  const multiple = panes.length > 1;

  // Single-file panes (editor/preview) reject folders; terminal/note take both.
  function canDrop(content: PaneContent, entry: DraggedEntry): boolean {
    if (content.kind === "editor" || content.kind === "preview") {
      return !entry.isDir;
    }
    return true;
  }

  function handleDrop(content: PaneContent, leafId: string, entry: DraggedEntry) {
    switch (content.kind) {
      case "terminal":
        setActiveLeaf(tab.id, leafId);
        if (!dropPathsIntoTerminal(leafId, [entry.path])) {
          writeToTerminal(leafId, `${shellQuotePath(entry.path)} `);
        }
        break;
      case "editor":
        if (!entry.isDir) {
          setPaneContent(tab.id, leafId, { kind: "editor", path: entry.path });
        }
        break;
      case "note":
        insertLinkIntoNote(content.noteId, entry.name, entry.path);
        break;
      case "preview":
        if (!entry.isDir) {
          setPaneContent(tab.id, leafId, { kind: "preview", url: fileUrl(entry.path) });
        }
        break;
    }
  }

  const panesRef = useRef(panes);
  panesRef.current = panes;
  const handleDropRef = useRef(handleDrop);
  handleDropRef.current = handleDrop;
  const canDropRef = useRef(canDrop);
  canDropRef.current = canDrop;
  const [hoverLeaf, setHoverLeaf] = useState<string | null>(null);
  const hoverLeafRef = useRef<string | null>(null);
  hoverLeafRef.current = hoverLeaf;
  // CSS-screen position of the webview content's top-left, captured from the
  // dragstart event (its screenX/clientX are reliable; cursorPosition's screen
  // origin is not, e.g. on a monitor placed above the main one). Then
  // client = cursorCss - offset.
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const onDragStart = (event: DragEvent) => {
      dragOffsetRef.current = {
        x: event.screenX - event.clientX,
        y: event.screenY - event.clientY,
      };
    };
    document.addEventListener("dragstart", onDragStart, true);
    return () => document.removeEventListener("dragstart", onDragStart, true);
  }, []);

  // WKWebView only fires dragstart/dragend for in-webview element drags — the
  // intermediate drag/dragover/drop events are swallowed. So we resolve the drop
  // from the dragend cursor position (capture phase, so we read the dragged
  // entry before FileTree's own onDragEnd clears it in the bubble phase).
  useEffect(() => {
    const onDragEnd = (event: DragEvent) => {
      const entry = getDraggedEntry();
      const leaf = paneLeafAt(event.clientX, event.clientY) ?? hoverLeafRef.current;
      setHoverLeaf(null);
      if (!entry || !leaf) {
        return;
      }
      const pane = panesRef.current.find((p) => p.id === leaf);
      if (pane && canDropRef.current(pane.content, entry)) {
        handleDropRef.current(pane.content, leaf, entry);
      }
    };
    document.addEventListener("dragend", onDragEnd, true);
    return () => document.removeEventListener("dragend", onDragEnd, true);
  }, []);

  // No move events fire mid-drag, so poll the OS cursor position to highlight the
  // pane under the cursor. cursorPosition is physical; divide by devicePixelRatio
  // for CSS-screen px, then subtract the webview's CSS-screen offset for client px.
  useEffect(() => {
    if (!dragging) {
      setHoverLeaf(null);
      return;
    }
    let active = true;
    void (async () => {
      while (active) {
        try {
          const cursor = await cursorPosition();
          const dpr = window.devicePixelRatio || 1;
          const offset = dragOffsetRef.current;
          const leaf = paneLeafAt(cursor.x / dpr - offset.x, cursor.y / dpr - offset.y);
          setHoverLeaf((prev) => (prev === leaf ? prev : leaf));
        } catch {
          // ignore a failed read; retry next tick
        }
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    })();
    return () => {
      active = false;
    };
  }, [dragging]);

  function startDrag(e: ReactMouseEvent, splitter: SplitterInfo) {
    e.preventDefault();
    e.stopPropagation();
    const container = paneAreaRef.current;
    if (!container) {
      return;
    }
    const isRow = splitter.direction === "row";
    // The split's own area stays fixed while only its ratio changes, so the
    // snapshot rect captured here keeps the maths correct through the drag.
    const span = isRow ? splitter.rect.width : splitter.rect.height;
    const start = isRow ? splitter.rect.left : splitter.rect.top;

    document.body.style.cursor = isRow ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    function onMove(ev: MouseEvent) {
      const box = container!.getBoundingClientRect();
      const pct = isRow
        ? ((ev.clientX - box.left) / box.width) * 100
        : ((ev.clientY - box.top) / box.height) * 100;
      let fraction = span > 0 ? (pct - start) / span : 0.5;
      fraction = Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, fraction));
      resizePane(tab.id, splitter.id, [fraction, 1 - fraction]);
    }
    function onUp() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className="flex h-full flex-col bg-bg-inset">
      <div className="flex h-7 shrink-0 items-center justify-end gap-0.5 border-b border-border px-2">
        <PaneToolbar tabId={tab.id} leafId={tab.activeLeafId} />
      </div>

      <div ref={paneAreaRef} className="relative min-h-0 flex-1">
        {panes.map((pane) => {
          const active = pane.id === tab.activeLeafId;
          const draggedEntry = dragging ? getDraggedEntry() : null;
          const dropOk = draggedEntry ? canDrop(pane.content, draggedEntry) : false;
          return (
            <div
              key={pane.id}
              data-pane-leaf={pane.id}
              onMouseDown={() => setActiveLeaf(tab.id, pane.id)}
              style={{
                position: "absolute",
                left: `${pane.rect.left}%`,
                top: `${pane.rect.top}%`,
                width: `${pane.rect.width}%`,
                height: `${pane.rect.height}%`,
              }}
              className={`p-1 ${multiple ? "border border-border" : ""} ${
                active && multiple ? "border-accent" : ""
              }`}
            >
              {multiple && (
                <button
                  type="button"
                  aria-label={t("workspace.closePane")}
                  title={t("workspace.closePane")}
                  onClick={(e) => {
                    e.stopPropagation();
                    closePane(tab.id, pane.id);
                  }}
                  className="absolute right-1.5 top-1.5 z-10 rounded bg-bg-inset/80 p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
                >
                  <X size={12} />
                </button>
              )}
              {pane.content.kind === "editor" ? (
                <EditorTabContent path={pane.content.path} />
              ) : pane.content.kind === "note" ? (
                <NoteTabContent noteId={pane.content.noteId} tabId={tab.id} />
              ) : pane.content.kind === "preview" ? (
                <PreviewTabContent url={pane.content.url} />
              ) : pane.content.kind === "git-graph" ? (
                <GitGraphTabContent />
              ) : (
                <TerminalView
                  active={active}
                  cwdTracking={active && isActiveTab}
                  cwd={rootPath ?? tab.cwd}
                  leafId={pane.id}
                  onExit={() => closePane(tab.id, pane.id)}
                  onOpenFile={(absolutePath) =>
                    splitPaneWith(tab.id, pane.id, { kind: "editor", path: absolutePath }, "row")
                  }
                />
              )}

              {/* Highlight only the pane under the cursor while dragging an
                  explorer entry. The drop itself is handled by the document-level
                  drag/dragend listeners above, since WKWebView swallows the
                  webview's own HTML5 drop events when dragDropEnabled is on. */}
              {dragging && pane.id === hoverLeaf && (
                <div className={dropOverlayClassName(dropOk)} />
              )}
            </div>
          );
        })}

        {/* Draggable dividers, one per split, sitting on the pane borders */}
        {splitters.map((splitter) => {
          const isRow = splitter.direction === "row";
          const dividerPct = isRow
            ? splitter.rect.left + splitter.rect.width * splitter.fraction
            : splitter.rect.top + splitter.rect.height * splitter.fraction;
          return (
            <div
              key={splitter.id}
              onMouseDown={(e) => startDrag(e, splitter)}
              style={
                isRow
                  ? {
                      position: "absolute",
                      left: `${dividerPct}%`,
                      top: `${splitter.rect.top}%`,
                      height: `${splitter.rect.height}%`,
                      width: 8,
                      transform: "translateX(-50%)",
                    }
                  : {
                      position: "absolute",
                      top: `${dividerPct}%`,
                      left: `${splitter.rect.left}%`,
                      width: `${splitter.rect.width}%`,
                      height: 8,
                      transform: "translateY(-50%)",
                    }
              }
              className={`z-20 transition-colors hover:bg-accent/40 ${
                isRow ? "cursor-col-resize" : "cursor-row-resize"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
