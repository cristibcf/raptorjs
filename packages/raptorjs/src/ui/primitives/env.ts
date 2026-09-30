/**
 * Internal helpers for the primitives. Every primitive must also work where the
 * DOM is partial (mini-dom in tests, SSR on the server): we never assume that
 * `window`, `matchMedia` or `focus()` exist.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type El = any;

export function doc(): any | null {
  return (globalThis as any).document ?? null;
}

/** Attaches a listener on the document and removes it on cleanup. Returns an unbind. */
export function onDoc(type: string, handler: (e: any) => void): () => void {
  const d = doc();
  if (!d || typeof d.addEventListener !== "function") return () => {};
  d.addEventListener(type, handler);
  return () => d.removeEventListener(type, handler);
}

/** `focus()` is missing on the headless DOM; we don't fail over that. */
export function focus(el: El): void {
  if (el && typeof el.focus === "function") el.focus();
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * The focusable elements within a container, in document order.
 * On mini-dom (no `querySelectorAll` for CSS selectors) it falls back to a
 * manual walk that recognizes the same cases.
 */
export function focusable(root: El): El[] {
  if (!root) return [];
  if (typeof root.querySelectorAll === "function") {
    try {
      const found = root.querySelectorAll(FOCUSABLE);
      if (found && typeof found.length === "number" && found.length >= 0 && !Array.isArray(found)) {
        return Array.from(found as ArrayLike<El>);
      }
    } catch {
      /* unsupported CSS selector (mini-dom) -> manual walk */
    }
  }
  const out: El[] = [];
  const walk = (el: El): void => {
    for (const child of el.childNodes ?? []) {
      if (child.nodeType !== 1) continue;
      if (isFocusable(child)) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

function isFocusable(el: El): boolean {
  const tag = String(el.tagName ?? "").toLowerCase();
  const tabindex = el.getAttribute?.("tabindex");
  if (tabindex != null && tabindex !== "-1") return true;
  if (el.getAttribute?.("disabled") != null) return false;
  if (tag === "a") return el.getAttribute?.("href") != null;
  return tag === "button" || tag === "input" || tag === "select" || tag === "textarea";
}

/** The coordinates of a pointer/mouse event, whatever its shape. */
export function pointOf(e: any): { x: number; y: number } {
  return { x: Number(e?.clientX ?? 0), y: Number(e?.clientY ?? 0) };
}
