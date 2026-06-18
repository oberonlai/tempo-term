/**
 * True when `href` is a URL we should hand to the system browser / mail client
 * (http, https, or mailto). Local file paths and relative links return false.
 */
export function isWebUrl(href: string): boolean {
  return /^(https?|mailto):/i.test(href.trim());
}
