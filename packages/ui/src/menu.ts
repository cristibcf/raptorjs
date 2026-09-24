/**
 * DropdownMenu - meniu cu trigger, navigare la tastatura si inchidere la
 * click in afara.
 *
 * Meniul e montat prin `Show`, deci cand e inchis nu exista noduri pentru el.
 * Itemul activ (highlight-ul de la sageti) e un semnal: mutarea selectiei
 * rescrie doua atribute, nu re-randeaza lista.
 *
 * Handlerele globale (click-outside, Escape) sunt inregistrate DOAR cat timp
 * meniul e deschis si scoase in `onCleanup`, ca sa nu ramana atasate de
 * document dupa ce componenta e distrusa.
 */
import { state, derived, effect, onCleanup, type Accessor, type State } from "@raptor/core";
import { R, Show, type Child } from "@raptor/dom";
import { positioner, type Placement } from "./primitives/positioner.ts";
import { isolate } from "./primitives/isolate.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export interface MenuItem {
  kind: "item";
  label: Child;
  onSelect: () => void;
  disabled?: boolean;
  /** Text secundar aliniat la dreapta (ex. "Ctrl+S"). */
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
  /** Continutul butonului care deschide meniul. */
  trigger: Child;
  entries: readonly MenuEntry[] | Accessor<readonly MenuEntry[]>;
  /** Da-i un semnal daca vrei sa controlezi deschiderea din afara. */
  open?: State<boolean>;
  /** Plasament complet (flip + shift). `start`/`end` raman acceptate. */
  placement?: Placement | "start" | "end";
  class?: string;
  label?: string;
}

function asAccessor(
  entries: readonly MenuEntry[] | Accessor<readonly MenuEntry[]>,
): Accessor<readonly MenuEntry[]> {
  return typeof entries === "function" ? entries : () => entries;
}

/** `focus()` lipseste pe DOM-ul headless din teste; nu esuam pentru atat. */
function focus(el: El): void {
  if (el && typeof el.focus === "function") el.focus();
}

export function DropdownMenu(props: DropdownMenuProps): El {
  // Constructia nu aboneaza computatia apelantului; vezi `isolate`.
  return isolate(() => DropdownMenuImpl(props));
}

function DropdownMenuImpl(props: DropdownMenuProps): El {
  const open = props.open ?? state(false);
  const entries = asAccessor(props.entries);
  const active = state(-1);
  let triggerEl: El = null;

  // Pozitionare reala: CSS pur taia meniul la marginea ecranului.
  const placement: Placement =
    props.placement === "end"
      ? "bottom-end"
      : props.placement === "start" || props.placement === undefined
        ? "bottom-start"
        : props.placement;
  const pos = positioner({ placement, offset: 4, enabled: () => open() });

  /** Indicii itemilor selectabili - separatoarele si cele dezactivate sar. */
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
    // Din afara listei pornim de la capatul dinspre care venim; apoi ciclam.
    const next = current === -1 ? (delta > 0 ? 0 : idx.length - 1) : (current + delta + idx.length) % idx.length;
    active.set(idx[next]!);
  };

  const choose = (index: number): void => {
    const entry = entries()[index];
    if (!entry || entry.kind !== "item" || entry.disabled) return;
    close(true);
    entry.onSelect();
  };

  // Handlere globale doar cat timp meniul e deschis.
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
        // `mousedown` ar fura focusul inainte de click; folosim doar click.
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
        // Regiune dinamica, nu `For`: itemii unui meniu nu au identitate stabila
        // intre rulari, deci o lista keyed n-ar reutiliza nimic. Re-run-ul
        // effect-ului face dispose pe effect-urile itemilor vechi.
        () => entries().map(renderEntry),
      ),
    }),
  );
}
