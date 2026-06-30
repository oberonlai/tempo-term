import type { WebglAddon } from "@xterm/addon-webgl";

/**
 * The xterm WebGL renderer caches rasterized glyphs in a bounded texture atlas
 * (a few pages, each up to 4096px). It keys glyphs by character AND colour AND
 * style, so a long session with lots of distinct CJK glyphs in varied colours
 * (AI agents, syntax-highlighted output) steadily fills the atlas. Once it hits
 * the page limit the renderer tries to merge pages, and when that fails it
 * starts drawing the WRONG glyph — the garbled CJK text users hit on long
 * sessions. `clearTextureAtlas()` empties the atlas (resetting the glyph cache),
 * which is why changing the font, which rebuilds the atlas, also fixes it. This
 * module clears the atlas automatically before it overflows, so the corruption
 * never appears.
 *
 * Note on the trigger metric: `clearTextureAtlas()` clears each page's CONTENT
 * in place — it keeps the page objects and does NOT fire onRemoveTextureAtlasCanvas
 * (only merges/deletes do). After a clear the renderer re-rasterizes visible
 * glyphs into the now-empty existing pages WITHOUT creating new ones, so onAdd
 * goes quiet.
 *
 * The guard tracks the ABSOLUTE page count (not additions since the last clear).
 * The earlier approach — resetting the counter to zero on each clear — was wrong:
 * after clearing at `threshold` pages the atlas still holds those pages (just
 * emptied), so only `max - threshold` more slots remain before overflow. With
 * the reset-to-zero approach the guard waited for another full `threshold`
 * additions before firing, by which time the atlas had already overflowed.
 * Keeping the count accurate means the guard fires on the very next page that
 * pushes the atlas past the threshold, which is what we want.
 */

/** Hard ceilings from the WebGL renderer's atlas implementation. */
const MAX_SUPPORTED_PAGES = 32;
const SAFETY_MARGIN_PAGES = 4;
const FALLBACK_THRESHOLD = 10;
/** Minimum gap between two clears, so a pathological post-clear redraw can never
 *  spin into a clear loop that freezes the terminal. */
const DEFAULT_COOLDOWN_MS = 500;

/**
 * Decides when to clear the atlas. Pure and synchronous (clock injected) so the
 * policy is unit-testable without a GPU: feed it the renderer's page-added and
 * page-removed signals and it tells you when to clear.
 */
export class AtlasPressureGuard {
  /** Absolute number of atlas pages currently allocated. */
  private pageCount = 0;
  /** Timestamp of the last clear; -1 means we have never cleared. */
  private lastClearAt = -1;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number = DEFAULT_COOLDOWN_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** A new page was added to the atlas. Returns true when the atlas should be
   *  cleared now: the absolute page count has reached the threshold AND the
   *  cooldown has elapsed. Does NOT reset the page count — pages stay allocated
   *  after clearTextureAtlas(), so the count must stay accurate. */
  recordPageAdded(): boolean {
    this.pageCount += 1;
    if (this.pageCount < this.threshold) {
      return false;
    }
    const t = this.now();
    if (this.lastClearAt >= 0 && t - this.lastClearAt < this.cooldownMs) {
      return false;
    }
    this.lastClearAt = t;
    return true;
  }

  /** A page was removed from the atlas (merge or shrink). Decrements the
   *  absolute count so the guard doesn't fire prematurely after a merge. */
  recordPageRemoved(): void {
    this.pageCount = Math.max(0, this.pageCount - 1);
  }
}

let cachedThreshold: number | null = null;

/**
 * Probe the device's fragment-shader texture-unit limit, which caps how many
 * atlas pages the renderer can hold (`min(32, MAX_TEXTURE_IMAGE_UNITS)`); we
 * clear a couple of pages before that ceiling. Cached after the first call:
 * GPU capabilities don't change at runtime, and probing creates a throwaway
 * WebGL context that we release immediately (browsers cap live contexts, and an
 * uncached probe per pane could evict a real terminal's context). Returns a safe
 * fallback when WebGL is unavailable.
 */
export function detectAtlasClearThreshold(fallback: number = FALLBACK_THRESHOLD): number {
  if (cachedThreshold !== null) {
    return cachedThreshold;
  }
  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) {
      cachedThreshold = fallback;
      return fallback;
    }
    const units = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
    const maxPages = Math.min(MAX_SUPPORTED_PAGES, units);
    // Free the probe context right away rather than waiting for GC.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    // Clear before the ceiling so a merge failure can't corrupt glyphs first.
    cachedThreshold = Math.max(2, maxPages - SAFETY_MARGIN_PAGES);
    return cachedThreshold;
  } catch {
    cachedThreshold = fallback;
    return fallback;
  }
}

/**
 * Wire an `AtlasPressureGuard` to a live `WebglAddon`: when the absolute atlas
 * page count reaches the threshold, clear the atlas. Returns a disposer that
 * detaches both listeners; the caller must run it when the addon is disposed.
 */
export function installAtlasPressureGuard(
  addon: WebglAddon,
  threshold: number = detectAtlasClearThreshold(),
): () => void {
  const guard = new AtlasPressureGuard(threshold);
  const added = addon.onAddTextureAtlasCanvas(() => {
    if (guard.recordPageAdded()) {
      addon.clearTextureAtlas();
    }
  });
  const removed = addon.onRemoveTextureAtlasCanvas(() => {
    guard.recordPageRemoved();
  });
  return () => {
    added.dispose();
    removed.dispose();
  };
}
