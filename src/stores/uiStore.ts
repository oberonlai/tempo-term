import { create } from "zustand";

export type SidebarView = "workspaces" | "explorer" | "sourceControl" | "ai" | "notes" | "connections" | "logs";

interface UiState {
  sidebarView: SidebarView;
  sidebarVisible: boolean;
  settingsOpen: boolean;
  terminalOpen: boolean;
  fileFinderOpen: boolean;
  portsPanelOpen: boolean;
  /**
   * Number of full-screen overlays (modals, dialogs, context menus) currently
   * mounted. The native preview webview floats above all DOM, so it must hide
   * itself whenever an overlay is open. Tracked as a counter because several
   * overlays can stack. See useOverlayGuard in src/lib/overlayGuard.ts.
   */
  overlayCount: number;
  /** Select a sidebar panel and make sure the sidebar is shown. */
  selectSidebar: (view: SidebarView) => void;
  toggleSidebar: () => void;
  setSettingsOpen: (open: boolean) => void;
  setTerminalOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setFileFinderOpen: (open: boolean) => void;
  setPortsPanelOpen: (open: boolean) => void;
  togglePortsPanel: () => void;
  /** Reveal the explorer and open the fuzzy file finder (Cmd/Ctrl+P). */
  openFileFinder: () => void;
  pushOverlay: () => void;
  popOverlay: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarView: "workspaces",
  sidebarVisible: true,
  settingsOpen: false,
  terminalOpen: true,
  fileFinderOpen: false,
  portsPanelOpen: false,
  overlayCount: 0,

  selectSidebar: (view) => set({ sidebarView: view, sidebarVisible: true }),

  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
  setFileFinderOpen: (fileFinderOpen) => set({ fileFinderOpen }),
  setPortsPanelOpen: (portsPanelOpen) => set({ portsPanelOpen }),
  togglePortsPanel: () => set((state) => ({ portsPanelOpen: !state.portsPanelOpen })),

  openFileFinder: () =>
    set({ sidebarView: "explorer", sidebarVisible: true, fileFinderOpen: true }),

  pushOverlay: () => set((state) => ({ overlayCount: state.overlayCount + 1 })),
  popOverlay: () => set((state) => ({ overlayCount: Math.max(0, state.overlayCount - 1) })),
}));

/** True when any full-screen overlay is mounted over the workspace. */
export const selectAnyOverlayOpen = (state: UiState): boolean => state.overlayCount > 0;
