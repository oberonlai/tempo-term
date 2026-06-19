import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useSettingsStore } from "@/stores/settingsStore";
import { useNotesStore } from "@/stores/notesStore";
import { onNotesChanged, startNotesWatch, stopNotesWatch } from "./notesWatch";

const REFRESH_DEBOUNCE_MS = 300;

/**
 * Owns the notes-folder watcher for the whole app: points the store at the
 * configured folder, starts the backend watcher, and refreshes the tree
 * (debounced) when files change on disk. Mounted once at the app root so the
 * watcher runs regardless of which notes UI is visible.
 */
export function useWatchNotes(): void {
  const folder = useSettingsStore((s) => s.notesFolderPath);

  useEffect(() => {
    if (!folder) {
      void useNotesStore.getState().setRoot(null);
      void stopNotesWatch().catch(() => {});
      return;
    }

    void useNotesStore.getState().setRoot(folder);
    // startNotesWatch replaces any previous watcher, so we don't stop the old
    // one on cleanup: doing so is async and could race the next start and clear
    // the new watcher. The watcher is stopped only when the folder is cleared.
    void startNotesWatch(folder).catch(() => {});

    let timer: ReturnType<typeof setTimeout> | null = null;
    let unlisten: UnlistenFn | undefined;
    let disposed = false;

    void onNotesChanged(() => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        void useNotesStore.getState().refresh();
      }, REFRESH_DEBOUNCE_MS);
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
      unlisten?.();
    };
  }, [folder]);
}
