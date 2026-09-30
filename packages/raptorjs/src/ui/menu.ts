/**
 * DropdownMenu - a menu with a trigger, keyboard navigation and close on
 * click outside.
 *
 * The menu is mounted via `Show`, so when it's closed there are no nodes for it.
 * The active item (the arrow-key highlight) is a signal: moving the selection
 * rewrites two attributes, it doesn't re-render the list.
 *
 * The global handlers (click-outside, Escape) are registered ONLY while the
 * menu is open and removed in `onCleanup`, so they don't stay attached to the
 * document after the component is destroyed.
 */
import { state, derived, effect, onCleanup, type Accessor, type State } from "raptorjs";
import { R, Show, type Child } from "raptorjs/dom";
import { positioner, type Placement } from "./primitives/positioner.ts";
import { isolate } from "./primitives/isolate.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export interface MenuItem {
  kind: "item";
  label: Child;
  onSelect: () => void;
  disabled?: boolean;
  /** Secondary text aligned to the right (e.g. "Ctrl+S"). */
  hint?: string;
}

export type MenuEntry = MenuItem | { kind: "separator" };

export function menuItem(
  label: Child,
  onSelect: () => void,
  options?: { disabled?: boolean; hint?: string },
): MenuItem {
  return { kind: "item", label, onSelect, disabled: options?.disabled, hint: options?.hint };
}

export function menuSeparator(): MenuEntry {
  return { kind: "separator" };
}

export interface DropdownMenuProps {
  /** The content of the button that opens the menu. */
  trigger: Child;
  entries: readonly MenuEntry[] | Accessor<readonly MenuEntry[]>;
  /** Pass a signal if you want to control opening from outside. */
  open?: State<boolean>;
  /** Full placement (flip + shift). `start`/`end` are still accepted. */
  placement?: Placement | "start" | "end";
  class?: string;
  label?: string;
}

function asAccessor(
  entries: readonly MenuEntry[] | Accessor<readonly MenuEntry[]>,
): Accessor<readonly MenuEntry[]> {
  return typeof entries === "function" ? entries : () => entries;
}

/** `focus()` is missing on the headless DOM in tests; we don't fail over that. */
function focus(el: El): void {
  if (el && typeof el.focus === "function") el.focus();
}

export function DropdownMenu(props: DropdownMenuProps): El {
  // Construction doesn't subscribe the caller's computation; see `isolate`.
  return isolate(() => DropdownMenuImpl(props));
}

function DropdownMenuImpl(props: DropdownMenuProps): El {
  const open = props.open ?? state(false);
  const entries = asAccessor(props.entries);
  const active = state(-1);
  let triggerEl: El = null;

  // Real positioning: pure CSS clipped the menu at the screen edge.
  const placement: Placement =
    props.placement === "end"
      ? "bottom-end"
      : props.placement === "start" || props.placement === undefined
        ? "bottom-start"
        : props.placement;
  const pos = positioner({ placement, offset: 4, enabled: () => open() });

  /** The indices of the selectable items - separators and disabled ones are skipped. */
  const selectable = derived<number[]>(() => {
    const out: number[] = [];
    const list = entries();
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!;
      if (e.kind === "item" && !e.disabled) out.push(i);
    }
    return out;
  });

  const close = (refocus: boolean): void => {
    open.set(false);
    active.set(-1);
    if (refocus) focus(triggerEl);
  };

  const move = (delta: number): void => {
    const idx = selectable();
    if (idx.length === 0) return;
    const current = idx.indexOf(active());
    // From outside the list we start at the end we come from; then we cycle.
    const next = current === -1 ? (delta > 0 ? 0 : idx.length - 1) : (current + delta + idx.length) % idx.length;
    active.set(idx[next]!);
  };

  const choose = (index: number): void => {
    const entry = entries()[index];
    if (!entry || entry.kind !== "item" || entry.disabled) return;
    close(true);
    entry.onSelect();
  };

  // Global handlers only while the menu is open.
  effect(() => {
    if (!open()) return;
    const doc: any = (globalThis as any).document;
    if (!doc || typeof doc.addEventListener !== "function") return;

    const onDocClick = (e: any): void => {
      const root = triggerEl?.parentNode;
      if (root && typeof root.contains === "function" && root.contains(e.target)) return;
      close(false);
    };
    const onDocKey = (e: any): void => {
      if (e.key === "Escape") close(true);
    };

    doc.addEventListener("click", onDocClick);
    doc.addEventListener("keydown", onDocKey);
    onCleanup(() => {
      doc.removeEventListener("click", onDocClick);
      doc.removeEventListener("keydown", onDocKey);
    });
  });

  const onKeydown = (e: any): void => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault?.();
        if (!open()) open.set(true);
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault?.();
        if (!open()) open.set(true);
        move(-1);
        break;
      case "Home":
        e.preventDefault?.();
        active.set(selectable()[0] ?? -1);
        break;
      case "End": {
        e.preventDefault?.();
        const idx = selectable();
        active.set(idx[idx.length - 1] ?? -1);
        break;
      }
      case "Enter":
      case " ":
        if (open() && active() >= 0) {
          e.preventDefault?.();
          choose(active());
        } else if (!open()) {
          e.preventDefault?.();
          open.set(true);
          move(1);
        }
        break;
      case "Escape":
        if (open()) close(true);
        break;
    }
  };

  function renderEntry(entry: MenuEntry, index: number): El {
    if (entry.kind === "separator") {
      return R.li({ class: "rui-menu-sep", role: "separator" });
    }
    return R.li(
      {
        class: () => {
          const base = "rui-menu-item";
          const cls = active() === index ? base + " rui-active" : base;
          return entry.disabled ? cls + " rui-disabled" : cls;
        },
        role: "menuitem",
        "aria-disabled": entry.disabled ? "true" : undefined,
        tabindex: "-1",
        // `mousedown` would steal focus before click; we use click only.
        "on:click": (e: any) => {
          e.stopPropagation?.();
          choose(index);
        },
        "on:mouseenter": () => {
          if (!entry.disabled) active.set(index);
        },
      },
      R.span({ class: "rui-menu-label" }, entry.label),
      entry.hint ? R.span({ class: "rui-menu-hint" }, entry.hint) : null,
    );
  }

  return R.div(
    { class: props.class ? "rui-menu-root " + props.class : "rui-menu-root" },
    R.button(
      {
        ref: (el: El) => {
          triggerEl = el;
          pos.reference(el);
        },
        type: "button",
        class: "rui-menu-trigger",
        "aria-haspopup": "menu",
        "aria-expanded": () => String(open()),
        ...(props.label ? { "aria-label": props.label } : {}),
        "on:click": (e: any) => {
          e.stopPropagation?.();
          if (open()) close(false);
          else open.set(true);
        },
        "on:keydown": onKeydown,
      },
      props.trigger,
    ),
    Show({
      when: () => open(),
      children: R.ul(
        {
          class: "rui-menu",
          role: "menu",
          ref: pos.floating,
          style: () => pos.style(),
          "on:keydown": onKeydown,
        },
        // Dynamic region, not `For`: a menu's items have no stable identity
        // across runs, so a keyed list wouldn't reuse anything. Re-running the
        // effect disposes the effects of the old items.
        () => entries().map(renderEntry),
      ),
    }),
  );
}
