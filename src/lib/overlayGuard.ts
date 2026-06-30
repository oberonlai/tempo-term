import { useEffect } from "react";
import { useUiStore } from "@/stores/uiStore";

/**
 * Register a full-screen overlay (modal, dialog, context menu) with the global
 * overlay counter while it is open. The native preview webview floats above all
 * DOM and cannot be covered by it, so it watches this counter and hides itself
 * whenever an overlay is open.
 *
 * Call this from any component that renders a full-screen layer over the
 * workspace, passing whether it is currently open. The count is incremented
 * while `active` is true and decremented when it turns false or the component
 * unmounts.
 */
export function useOverlayGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const { pushOverlay, popOverlay } = useUiStore.getState();
    pushOverlay();
    return popOverlay;
  }, [active]);
}
