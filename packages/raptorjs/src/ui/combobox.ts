/**
 * Combobox - an input with a filtered list.
 *
 * A thesis component for filtering. `For` is keyed on the option, and filtering
 * returns a subset of the *same* objects - so while typing, the remaining
 * options keep their nodes and only the ones that dropped out are removed. With
 * a VDOM, every keystroke reconciles the whole list.
 *
 * It follows the ARIA combobox pattern: `role="combobox"` on the input,
 * `aria-expanded`, `aria-controls`, `aria-activedescendant` pointing to the
 * highlighted option (focus stays in the input, so you can keep typing).
 */
import { state, derived, type Accessor, type State } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";
import { clickOutside } from "./primitives/click-outside.ts";
import { positioner, type Placement } from "./primitives/positioner.ts";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

export interface ComboboxProps<T> {
  /** The options. Stable objects => nodes reused while filtering. */
  options: Accessor<readonly T[]>;
  /** The signal you own, with the chosen option. */
  value: State<T | null>;
  /** The text shown for an option. */
  label: (option: T) => string;
  /** Rich rendering of an option. Defaults to `label`. */
  render?: (option: T, query: Accessor<string>) => Child;
  /** Custom filtering. Defaults to case-insensitive matching on `label`. */
  filter?: (option: T, query: string) => boolean;
  disabled?: (option: T) => boolean;
  placeholder?: string;
  /** Allow clearing the selection with Backspace on an empty input. Defaults to `true`. */
  clearable?: boolean;
  /** Text when nothing matches. */
  empty?: Child;
  placement?: Placement;
  onSelect?: (option: T) => void;
  class?: string;
  ariaLabel?: string;
}

export interface Combobox {
  el: El;
  open: Accessor<boolean>;
  query: Accessor<string>;
  /** Test bridge: positioning without real layout. */
  position: ReturnType<typeof positioner>;
}

export function combobox<T>(props: ComboboxProps<T>): Combobox {
  const id = "rui-cb-" + ++idSeq;
  const open = state(false);
  const query = state("");
  const active = state(-1);
  let inputEl: El = null;

  const matches = props.filter ?? ((option: T, q: string) =>
    props.label(option).toLowerCase().includes(q.toLowerCase()));

  const visible = derived<readonly T[]>(() => {
    const q = query();
    const all = props.options();
    if (q === "") return all;
    return all.filter((o) => matches(o, q));
  });

  /** The selectable indices from the visible list (skip the disabled ones). */
  const selectable = derived<number[]>(() => {
    const list = visible();
    const out: number[] = [];
    for (let i = 0; i < list.length; i++) {
      if (!props.disabled?.(list[i]!)) out.push(i);
    }
    return out;
  });

  const position = positioner({
    placement: props.placement ?? "bottom-start",
    enabled: () => open(),
  });

  const optionId = (index: number): string => id + "-opt-" + index;

  const show = (): void => {
    if (open.peek()) return;
    open.set(true);
    active.set(selectable.peek()[0] ?? -1);
  };

  const hide = (restoreText: boolean): void => {
    open.set(false);
    active.set(-1);
    if (restoreText) {
      const current = props.value.peek();
      query.set(current === null ? "" : props.label(current));
    }
  };

  const choose = (index: number): void => {
    const option = visible()[index];
    if (option === undefined || props.disabled?.(option)) return;
    props.value.set(option);
    query.set(props.label(option));
    open.set(false);
    active.set(-1);
    props.onSelect?.(option);
  };

  const move = (delta: number): void => {
    const idx = selectable();
    if (idx.length === 0) return;
    const current = idx.indexOf(active());
    const next = current === -1 ? (delta > 0 ? 0 : idx.length - 1) : (current + delta + idx.length) % idx.length;
    active.set(idx[next]!);
  };

  const onKeydown = (e: any): void => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault?.();
        if (!open()) show();
        else move(1);
        break;
      case "ArrowUp":
        e.preventDefault?.();
        if (!open()) show();
        else move(-1);
        break;
      case "Home":
        if (open()) {
          e.preventDefault?.();
          active.set(selectable()[0] ?? -1);
        }
        break;
      case "End":
        if (open()) {
          e.preventDefault?.();
          const idx = selectable();
          active.set(idx[idx.length - 1] ?? -1);
        }
        break;
      case "Enter":
        if (open() && active() >= 0) {
          e.preventDefault?.();
          choose(active());
        }
        break;
      case "Escape":
        if (open()) {
          e.preventDefault?.();
          hide(true);
        }
        break;
      case "Tab":
        if (open()) hide(true);
        break;
      case "Backspace":
        if ((props.clearable ?? true) && query() === "" && props.value.peek() !== null) {
          props.value.set(null);
        }
        break;
    }
  };

  const onInput = (e: any): void => {
    query.set(String(e.target?.value ?? ""));
    show();
    active.set(selectable.peek()[0] ?? -1);
  };

  const el = R.div(
    {
      class: props.class ? "rui-combobox " + props.class : "rui-combobox",
      ref: (node: El) => {
        clickOutside(() => hide(true), { enabled: () => open() })(node);
        position.reference(node);
      },
    },
    R.input({
      ref: (node: El) => {
        inputEl = node;
      },
      type: "text",
      class: "rui-combobox-input",
      role: "combobox",
      autocomplete: "off",
      "aria-autocomplete": "list",
      "aria-controls": id + "-list",
      "aria-expanded": () => String(open()),
      ...(props.ariaLabel ? { "aria-label": props.ariaLabel } : {}),
      ...(props.placeholder ? { placeholder: props.placeholder } : {}),
      // Focus does NOT leave the input: the active option is signalled by id.
      "aria-activedescendant": () => (open() && active() >= 0 ? optionId(active()) : ""),
      value: () => query(),
      "on:input": onInput,
      "on:keydown": onKeydown,
      "on:focus": () => show(),
    }),
    Show({
      when: () => open(),
      children: R.ul(
        {
          id: id + "-list",
          class: "rui-combobox-list",
          role: "listbox",
          ref: position.floating,
          style: () => position.style(),
        },
        For({
          each: () => visible(),
          children: (option: T, index: number) => {
            const disabled = props.disabled?.(option) ?? false;
            return R.li(
              {
                id: optionId(index),
                class: () => {
                  let cls = "rui-combobox-option";
                  if (active() === index) cls += " rui-active";
                  if (disabled) cls += " rui-disabled";
                  if (props.value() === option) cls += " rui-selected";
                  return cls;
                },
                role: "option",
                "aria-selected": () => String(props.value() === option),
                ...(disabled ? { "aria-disabled": "true" } : {}),
                "on:click": () => choose(index),
                "on:mouseenter": () => {
                  if (!disabled) active.set(index);
                },
              },
              props.render ? props.render(option, () => query()) : props.label(option),
            );
          },
        }),
        Show({
          when: () => visible().length === 0,
          children: R.li({ class: "rui-combobox-empty", role: "presentation" }, props.empty ?? "No results"),
        }),
      ),
    }),
  );

  // The initial text reflects the value given from outside.
  const initial = props.value.peek();
  if (initial !== null) query.set(props.label(initial));
  void inputEl;

  return { el, open: () => open(), query: () => query(), position };
}

/** Component variant. */
export function Combobox<T>(props: ComboboxProps<T>): El {
  return combobox(props).el;
}
