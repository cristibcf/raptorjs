/**
 * focusTrap - keeps focus inside an element while it is active.
 *
 * A precondition for any Dialog/Drawer: without it, Tab walks the user through
 * the page underneath, which for a screen reader is as if the modal didn't
 * exist. On deactivation it returns focus to where it left from.
 */
import { effect, onCleanup } from "@raptorstack/raptorjs";
import { focus, focusable, type El } from "./env.ts";

export interface FocusTrapOptions {
  /** While this returns `false`, the trap is inactive. Active by default. */
  active?: () => boolean;
  /** What receives focus on activation. Defaults to the first focusable element. */
  initial?: () => El | null;
  /** Return focus to where it was on deactivation. Defaults to `true`. */
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
      // We cycle manually at the ends; inside we let the browser do its job.
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
