/** The dashed drop-zone outline shown over a pane that can receive a drop. */
export function dropOverlayClassName(ok: boolean): string {
  return `absolute inset-0 z-30 border-2 border-dashed pointer-events-none ${
    ok ? "border-accent/60 bg-accent/[0.07]" : "border-danger/40 bg-danger/[0.04]"
  }`;
}
