/**
 * clickOutside - ruleaza un handler cand se face click in afara elementului.
 *
 * Se foloseste ca `ref`: `R.div({ ref: clickOutside(() => close()) })`.
 * Listener-ul global exista doar cat traieste elementul (scos in `onCleanup`),
 * ca sa nu ramana agatat de document dupa dispose.
 */
import { onCleanup } from "raptorjs";
import { onDoc, type El } from "./env.ts";

export interface ClickOutsideOptions {
  /** Tipul de eveniment ascultat. `pointerdown` reactioneaza mai devreme. */
  event?: string;
  /** Noduri suplimentare considerate "inauntru" (ex. trigger-ul unui popover). */
  ignore?: () => readonly El[];
  /** Cat timp intoarce `false`, handlerul nu ruleaza. */
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
