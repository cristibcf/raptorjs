/**
 * Collapsible / Accordion - zone pliabile.
 *
 * Nu folosesc `<details>`: acela nu poate fi animat si nu permite modul
 * "un singur panou deschis". Folosesc butoane cu `aria-expanded` si
 * `aria-controls`, pattern-ul ARIA pentru disclosure.
 *
 * Continutul ramane in DOM cand e inchis (cu `hidden`), nu e demontat: asa
 * Ctrl+F il gaseste si nu pierzi starea din el (input-uri, scroll). Daca vrei
 * demontare - de exemplu pentru un panou scump - pune `unmount: true`.
 */
import { state, type Accessor, type State } from "raptorjs";
import { R, For, Show, type Child } from "raptorjs/dom";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

export interface CollapsibleProps {
  /** Titlul din buton. */
  trigger: Child;
  children: Child;
  /** Semnal propriu daca vrei control din afara. */
  open?: State<boolean>;
  initialOpen?: boolean;
  disabled?: boolean;
  /** Demonteaza continutul cand e inchis. Implicit `false`. */
  unmount?: boolean;
  onToggle?: (open: boolean) => void;
  class?: string;
}

export interface CollapsibleHandle {
  el: El;
  open: Accessor<boolean>;
  toggle: () => void;
}

export function collapsible(props: CollapsibleProps): CollapsibleHandle {
  const id = "rui-col-" + ++idSeq;
  const open = props.open ?? state(props.initialOpen ?? false);

  const toggle = (): void => {
    if (props.disabled) return;
    const next = !open.peek();
    open.set(next);
    props.onToggle?.(next);
  };

  const body = R.div(
    {
      id: id + "-panel",
      class: "rui-collapsible-panel",
      role: "region",
      "aria-labelledby": id + "-trigger",
      hidden: () => !open(),
    },
    props.unmount
      ? Show({ when: () => open(), children: props.children })
      : props.children,
  );

  const el = R.div(
    {
      class: () =>
        "rui-collapsible" + (open() ? " rui-open" : "") + (props.class ? " " + props.class : ""),
    },
    R.button(
      {
        id: id + "-trigger",
        type: "button",
        class: "rui-collapsible-trigger",
        "aria-expanded": () => String(open()),
        "aria-controls": id + "-panel",
        disabled: props.disabled === true,
        "on:click": toggle,
      },
      R.span({ class: "rui-collapsible-icon", "aria-hidden": "true" }, () => (open() ? "▾" : "▸")),
      R.span({ class: "rui-collapsible-label" }, props.trigger),
    ),
    body,
  );

  return { el, open: () => open(), toggle };
}

export function Collapsible(props: CollapsibleProps): El {
  return collapsible(props).el;
}

export interface AccordionSection {
  /** Cheie stabila; intra in id-urile ARIA. */
  key: string;
  title: Child;
  content: Child | (() => Child);
  disabled?: boolean;
}

export interface AccordionProps {
  sections: readonly AccordionSection[];
  /**
   * `single` inchide celelalte panouri la deschiderea unuia, `multiple` le lasa
   * pe toate. Implicit `single`.
   */
  mode?: "single" | "multiple";
  /** Cheile deschise initial. */
  initial?: readonly string[];
  /** Semnal propriu cu cheile deschise. */
  expanded?: State<ReadonlySet<string>>;
  /** In modul `single`, permite inchiderea tuturor. Implicit `true`. */
  collapsible?: boolean;
  unmount?: boolean;
  onChange?: (keys: ReadonlySet<string>) => void;
  class?: string;
}

export interface AccordionHandle {
  el: El;
  expanded: Accessor<ReadonlySet<string>>;
  toggle: (key: string) => void;
  isOpen: (key: string) => boolean;
}

export function accordion(props: AccordionProps): AccordionHandle {
  const id = "rui-acc-" + ++idSeq;
  const expanded = props.expanded ?? state<ReadonlySet<string>>(new Set(props.initial ?? []));
  const mode = props.mode ?? "single";
  const triggers = new Map<string, El>();
  const seen = new Set<string>(props.initial ?? []);

  const isOpen = (key: string): boolean => expanded().has(key);

  const toggle = (key: string): void => {
    const section = props.sections.find((s) => s.key === key);
    if (!section || section.disabled) return;
    seen.add(key);

    expanded.update((prev) => {
      const open = prev.has(key);
      let next: Set<string>;
      if (mode === "single") {
        // Inchiderea ultimului panou e permisa doar daca `collapsible`.
        if (open) next = props.collapsible === false ? new Set(prev) : new Set();
        else next = new Set([key]);
      } else {
        next = new Set(prev);
        if (open) next.delete(key);
        else next.add(key);
      }
      props.onChange?.(next);
      return next;
    });
  };

  /** Sagetile muta focusul intre capete, ca la pattern-ul ARIA accordion. */
  const enabledKeys = (): string[] => props.sections.filter((s) => !s.disabled).map((s) => s.key);

  const focusKey = (key: string): void => {
    const el = triggers.get(key);
    if (el && typeof el.focus === "function") el.focus();
  };

  const onKeydown = (key: string) => (e: any): void => {
    const keys = enabledKeys();
    const at = keys.indexOf(key);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault?.();
        focusKey(keys[(at + 1) % keys.length] ?? key);
        break;
      case "ArrowUp":
        e.preventDefault?.();
        focusKey(keys[(at - 1 + keys.length) % keys.length] ?? key);
        break;
      case "Home":
        e.preventDefault?.();
        focusKey(keys[0] ?? key);
        break;
      case "End":
        e.preventDefault?.();
        focusKey(keys[keys.length - 1] ?? key);
        break;
    }
  };

  const el = R.div(
    { class: props.class ? "rui-accordion " + props.class : "rui-accordion" },
    For({
      each: () => props.sections,
      children: (section: AccordionSection) => {
        const headId = id + "-h-" + section.key;
        const panelId = id + "-p-" + section.key;
        return R.div(
          { class: () => "rui-accordion-item" + (isOpen(section.key) ? " rui-open" : "") },
          // Titlul e un heading cu buton inauntru: asa apare in lista de
          // titluri a screen readerului si ramane si actionabil.
          R.h3(
            { class: "rui-accordion-heading" },
            R.button(
              {
                id: headId,
                type: "button",
                class: "rui-accordion-trigger",
                "aria-expanded": () => String(isOpen(section.key)),
                "aria-controls": panelId,
                disabled: section.disabled === true,
                ref: (node: El) => {
                  if (node) triggers.set(section.key, node);
                },
                "on:click": () => toggle(section.key),
                "on:keydown": onKeydown(section.key),
              },
              R.span({ class: "rui-accordion-icon", "aria-hidden": "true" }, () =>
                isOpen(section.key) ? "▾" : "▸",
              ),
              R.span({ class: "rui-accordion-title" }, section.title),
            ),
          ),
          R.div(
            {
              id: panelId,
              class: "rui-accordion-panel",
              role: "region",
              "aria-labelledby": headId,
              hidden: () => !isOpen(section.key),
            },
            props.unmount
              ? Show({
                  when: () => isOpen(section.key) || seen.has(section.key),
                  children: () =>
                    typeof section.content === "function" ? section.content() : section.content,
                })
              : typeof section.content === "function"
                ? section.content()
                : section.content,
          ),
        );
      },
    }),
  );

  return { el, expanded: () => expanded(), toggle, isOpen };
}

export function Accordion(props: AccordionProps): El {
  return accordion(props).el;
}
