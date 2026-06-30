import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { debounce } from "@/lib/debounce";
import { useSettingsStore } from "@/stores/settingsStore";
import { resolvePreviewSrc } from "../lib/resolvePreviewSrc";
import { previewWebviewLabel } from "../lib/previewWebview";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Options {
  /** URL or local path to preview. Changing it recreates the webview. */
  url: string;
  /** The owning pane's leaf id; part of the unique webview label. */
  leafId: string;
  /**
   * Whether the webview should be shown. The native webview floats above all
   * DOM, so the caller hides it whenever the pane is not the foremost thing on
   * screen (inactive tab/space, split drag, or an open overlay).
   */
  visible: boolean;
}

function rectOf(el: HTMLElement | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // A hidden ancestor (`display:none`) collapses the host to zero — there is no
  // valid place to put the webview yet, so report nothing and keep it hidden.
  if (r.width <= 0 || r.height <= 0) return null;
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Manage a native Tauri child webview that renders a preview inside a pane.
 *
 * Unlike an `<iframe>`, the child webview is a native layer composited over the
 * window — so it ignores `X-Frame-Options`/`frame-ancestors` (it can show
 * wp-admin etc.), but it is NOT part of the DOM: it must be positioned, shown,
 * and hidden manually to track the pane. `@tauri-apps/api@2.11` has no
 * `navigate`/`reload`, so a URL change or reload recreates the webview.
 *
 * A child webview's position is relative to the window in logical pixels and is
 * NOT affected by the main webview's zoom. The app zooms the main webview via
 * `setZoom(uiZoom)` (App.tsx), so `getBoundingClientRect()` returns page CSS
 * pixels whose on-screen size is `value * uiZoom` window-logical pixels. We
 * therefore multiply the host rect by `uiZoom` before positioning the child.
 *
 * Returns the host ref to attach where the webview should sit, and a `reload`.
 */
export function useNativePreviewWebview({ url, leafId, visible }: Options) {
  const hostRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<Webview | null>(null);
  const visibleRef = useRef(visible);
  const shownRef = useRef(false);
  const lastRectRef = useRef<Rect | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const uiZoom = useSettingsStore((s) => s.uiZoom);
  const zoomRef = useRef(uiZoom);

  visibleRef.current = visible;
  zoomRef.current = uiZoom;

  // Push the webview to match the host's current rect and visibility. Cheap to
  // call often: it no-ops unless something actually changed.
  const sync = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    if (!visibleRef.current) {
      if (shownRef.current) {
        shownRef.current = false;
        void webview.hide();
      }
      return;
    }

    const rect = rectOf(hostRef.current);
    if (!rect) return;

    if (!sameRect(rect, lastRectRef.current)) {
      lastRectRef.current = rect;
      // The host rect is in zoomed page pixels; the child webview lives in
      // unzoomed window pixels, so scale by the UI zoom factor.
      const z = zoomRef.current;
      void webview.setPosition(new LogicalPosition(rect.x * z, rect.y * z));
      void webview.setSize(new LogicalSize(rect.width * z, rect.height * z));
    }
    if (!shownRef.current) {
      shownRef.current = true;
      void webview.show();
    }
  }, []);

  // A zoom change keeps the host rect (page px) the same but moves/resizes its
  // on-screen footprint, so force a reposition when uiZoom changes.
  useEffect(() => {
    lastRectRef.current = null;
    sync();
  }, [uiZoom, sync]);

  // Create the webview, and recreate it whenever the URL changes or reload is
  // requested. A fresh label per instance avoids colliding with the previous
  // webview while it is still closing.
  useEffect(() => {
    let cancelled = false;
    const z = zoomRef.current;
    const initial = rectOf(hostRef.current);
    const label = `${previewWebviewLabel(getCurrentWindow().label, leafId)}-${reloadNonce}`;
    const webview = new Webview(getCurrentWindow(), label, {
      url: resolvePreviewSrc(url),
      // Always pass a rect (in unzoomed window pixels); omitting it makes the
      // webview fill the whole window. Start at 1×1 when the host is not
      // measurable so nothing flashes before the first sync positions and shows it.
      x: initial ? initial.x * z : 0,
      y: initial ? initial.y * z : 0,
      width: initial ? initial.width * z : 1,
      height: initial ? initial.height * z : 1,
    });

    webview.once("tauri://created", () => {
      if (cancelled) {
        void webview.close();
        return;
      }
      webviewRef.current = webview;
      shownRef.current = false;
      lastRectRef.current = null;
      sync();
    });
    webview.once("tauri://error", (e) => {
      // eslint-disable-next-line no-console
      console.error(`[preview] failed to create webview "${label}":`, e.payload);
    });

    return () => {
      cancelled = true;
      if (webviewRef.current === webview) {
        webviewRef.current = null;
      }
      shownRef.current = false;
      lastRectRef.current = null;
      void webview.close();
    };
  }, [url, leafId, reloadNonce, sync]);

  // Re-sync after every render: a split can move the pane without resizing it,
  // which a ResizeObserver would miss. sync() no-ops when nothing changed.
  useLayoutEffect(() => {
    sync();
  });

  // Track size changes (divider drag, window resize) that happen without a
  // React render. Debounced so a fast drag does not spam IPC. The native window
  // resize event is included because a maximize may not surface a DOM resize.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const syncSoon = debounce(sync, 16);
    const observer = new ResizeObserver(syncSoon);
    observer.observe(host);
    window.addEventListener("resize", syncSoon);
    const unlistenResized = getCurrentWindow().onResized(() => syncSoon());
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncSoon);
      void unlistenResized.then((un) => un());
      syncSoon.cancel();
    };
  }, [sync]);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  return { hostRef, reload };
}
