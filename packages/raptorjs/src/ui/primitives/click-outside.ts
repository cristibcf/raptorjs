/**
 * clickOutside - runs a handler when a click happens outside the element.
 *
 * Used as a `ref`: `R.div({ ref: clickOutside(() => close()) })`.
 * The global listener exists only while the element lives (removed in
 * `onCleanup`), so it doesn't stay attached to the document after dispose.
 */
import { onCleanup } from "@raptorstack/raptorjs";
import { onDoc, type El } from "./env.ts";

export interface ClickOutsideOptions {
  /** The event type listened for. `pointerdown` reacts earlier. */
  event?: string;
  /** Extra nodes considered "inside" (e.g. a popover's trigger). */
  ignore?: () => readonly El[];
  /** While this returns `false`, the handler does not run. */
  enabled?: () => boolean;
}

export function clickOutside(
  handler: (event: any) => void,
  options?: ClickOutsideOptions,
): (el: El) => void {
  return (el: El) => {
    if (!el) return;
    const unbind = onDoc(options?.event ?? "click", (e: any) => {
      if (options?.enabled && !options.enabled()) return;
      if (contains(el, e.target)) return;
      for (const other of options?.ignore?.() ?? []) {
        if (contains(other, e.target)) return;
      }
      handler(e);
    });
    onCleanup(unbind);
  };
}

function contains(root: El, node: El): boolean {
  if (!root || !node) return false;
  if (typeof root.contains === "function") return root.contains(node);
  let current: El = node;
  while (current) {
    if (current === root) return true;
    current = current.parentNode;
  }
  return false;
}
