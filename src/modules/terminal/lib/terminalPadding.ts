/**
 * @xterm/addon-fit reads padding off the terminal's own root element (the
 * `.xterm` div xterm.js creates), not off its wrapping container. Applying
 * padding to the wrong element leaves the fit calculation unaware of it, so
 * the terminal overflows the container's right/bottom edges while the
 * top/left inset (a side effect of normal box-model flow) looks correct.
 */
export function applyTerminalPadding(element: HTMLElement, paddingPx: number): void {
  element.style.padding = `${paddingPx}px`;
}
