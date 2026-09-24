/**
 * Helperi interni pentru primitive. Toate primitivele trebuie sa functioneze
 * si acolo unde DOM-ul e partial (mini-dom in teste, SSR pe server): nu
 * presupunem niciodata ca exista `window`, `matchMedia` sau `focus()`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type El = any;

export function doc(): any | null {
  return (globalThis as any).document ?? null;
}

/** Ataseaza un listener pe document si il scoate la cleanup. Intoarce un unbind. */
export function onDoc(type: string, handler: (e: any) => void): () => void {
  const d = doc();
  if (!d || typeof d.addEventListener !== "function") return () => {};
  d.addEventListener(type, handler);
  return () => d.removeEventListener(type, handler);
}

/** `focus()` lipseste pe DOM-ul headless; nu esuam pentru atat. */
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
 * Elementele focusabile dintr-un container, in ordinea documentului.
 * Pe mini-dom (fara `querySelectorAll` pe selectori CSS) cade pe un walk
 * manual care recunoaste aceleasi cazuri.
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
      /* selector CSS nesuportat (mini-dom) -> walk manual */
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

/** Coordonatele unui pointer/mouse event, indiferent de forma lui. */
export function pointOf(e: any): { x: number; y: number } {
  return { x: Number(e?.clientX ?? 0), y: Number(e?.clientY ?? 0) };
}
