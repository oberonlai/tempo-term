// Pure helpers for the native preview webview. The webview lifecycle itself
// lives in the useNativePreviewWebview hook; these are split out so they can be
// unit-tested without touching Tauri.

// Tauri webview labels must be made of `a-zA-Z0-9-/:_`. Pane ids and window
// labels already fit this set, but sanitise defensively so an unexpected
// character can never produce an invalid label (which would throw on create).
const LABEL_DISALLOWED = /[^a-zA-Z0-9\-/:_]/g;

/**
 * Build the unique label for a preview webview. Includes the host window label
 * so the same pane id in two windows never collides.
 */
export function previewWebviewLabel(windowLabel: string, leafId: string): string {
  return `preview-${windowLabel}-${leafId}`.replace(LABEL_DISALLOWED, "_");
}

export interface PreviewVisibilityInput {
  /** The tab owning this pane is the active tab (and thus its space is active). */
  isActiveTab: boolean;
  /** A split divider is being dragged in this tab. */
  dragging: boolean;
  /** Any full-screen overlay (modal, dialog, context menu) is open. */
  anyOverlay: boolean;
}

/**
 * Decide whether the native preview webview should be visible. It floats above
 * all DOM, so it must stay hidden whenever the pane is not the foremost thing on
 * screen: another tab/space is active, a split is being dragged, or an overlay
 * covers the workspace.
 */
export function shouldShowPreview({
  isActiveTab,
  dragging,
  anyOverlay,
}: PreviewVisibilityInput): boolean {
  return isActiveTab && !dragging && !anyOverlay;
}
