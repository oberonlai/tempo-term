/**
 * A single shared hover tooltip for terminal links. xterm has no native
 * tooltip, so the web-links addon's hover/leave callbacks drive this. One
 * element is reused across all terminals (only one can be hovered at a time).
 */
let el: HTMLDivElement | null = null;

function ensureEl(): HTMLDivElement {
  if (el) {
    return el;
  }
  const node = document.createElement("div");
  node.className = "terminal-link-tooltip";
  node.setAttribute("aria-hidden", "true");
  document.body.appendChild(node);
  el = node;
  return node;
}

export function showLinkTooltip(text: string, x: number, y: number): void {
  const node = ensureEl();
  node.textContent = text;
  node.style.left = `${x + 12}px`;
  node.style.top = `${y + 12}px`;
  node.style.display = "block";
}

export function hideLinkTooltip(): void {
  if (el) {
    el.style.display = "none";
  }
}
