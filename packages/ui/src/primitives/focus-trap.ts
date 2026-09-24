/**
 * focusTrap - tine focusul inauntrul unui element cat timp e activ.
 *
 * Precondiție pentru orice Dialog/Drawer: fara ea, Tab plimba utilizatorul prin
 * pagina de dedesubt, care pentru un screen reader e ca si cum modalul n-ar
 * exista. La dezactivare readuce focusul de unde a plecat.
 */
import { effect, onCleanup } from "@raptor/core";
import { focus, focusable, type El } from "./env.ts";

export interface FocusTrapOptions {
  /** Cat timp intoarce `false`, capcana e inactiva. Implicit mereu activa. */
  active?: () => boolean;
  /** Ce primeste focusul la activare. Implicit primul element focusabil. */
  initial?: () => El | null;
  /** Readu focusul unde a fost la dezactivare. Implicit `true`. */
  restore?: boolean;
}

export function focusTrap(options?: FocusTrapOptions): (el: El) => void {
  return (el: El) => {
    if (!el) return;
    const restore = options?.restore ?? true;
    let previous: El = null;

    const onKeydown = (e: any): void => {
      if (e.key !== "Tab") return;
      const items = focusable(el);
      if (items.length === 0) {
        e.preventDefault?.();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = (globalThis as any).document?.activeElement;
      // Ciclam manual la capete; in interior lasam browserul sa-si faca treaba.
      if (e.shiftKey && (active === first || !contains(el, active))) {
        e.preventDefault?.();
        focus(last);
      } else if (!e.shiftKey && active === last) {
        e.preventDefault?.();
        focus(first);
      }
    };

    el.addEventListener("keydown", onKeydown);
    onCleanup(() => el.removeEventListener("keydown", onKeydown));

    effect(() => {
      const isActive = options?.active ? options.active() : true;
      if (!isActive) return;

      previous = (globalThis as any).document?.activeElement ?? null;
      const target = options?.initial?.() ?? focusable(el)[0] ?? el;
      focus(target);

      onCleanup(() => {
        if (restore && previous) focus(previous);
        previous = null;
      });
    });
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
