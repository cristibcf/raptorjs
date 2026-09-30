/**
 * Select - a single-value dropdown, on the ARIA listbox pattern.
 *
 * The difference from `Combobox`: here you don't type freely. The button carries
 * `role="combobox"` with `aria-expanded`, the list is a `listbox`, and focus
 * stays on the button - the highlighted option is signalled via `aria-activedescendant`.
 *
 * It has typeahead: typing "pe" quickly jumps to "Peach", like a native
 * `<select>`. Without this, a list of 200 countries is unusable by keyboard.
 */
import { state, derived, onCleanup, type Accessor, type State } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";
import { clickOutside } from "./primitives/click-outside.ts";
import { positioner, type Placement } from "./primitives/positioner.ts";
import { focus, type El } from "./primitives/env.ts";
import { isolate } from "./primitives/isolate.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

export interface SelectProps<T> {
  options: Accessor<readonly T[]>;
  value: State<T | null>;
  label: (option: T) => string;
  render?: (option: T) => Child;
  disabled?: (option: T) => boolean;
  /** Text when nothing is selected. */
  placeholder?: Child;
  placement?: Placement;
  onChange?: (option: T) => void;
  ariaLabel?: string;
  class?: string;
}

export interface SelectHandle {
  el: El;
  open: Accessor<boolean>;
}

export function select<T>(props: SelectProps<T>): SelectHandle {
  const id = "rui-sel-" + ++idSeq;
  const open = state(false);
  const active = state(-1);
  let triggerEl: El = null;

  /** Typeahead buffer; it clears after a pause, like the native select. */
  let typed = "";
  let typedTimer: ReturnType<typeof setTimeout> | null = null;
  const clearTyped = (): void => {
    if (typedTimer !== null) {
      clearTimeout(typedTimer);
      typedTimer = null;
    }
    typed = "";
  };
  onCleanup(clearTyped);

  const selectable = derived<number[]>(() => {
    const list = props.options();
    const out: number[] = [];
    for (let i = 0; i < list.length; i++) {
      if (!props.disabled?.(list[i]!)) out.push(i);
    }
    return out;
  });

  const pos = positioner({
    placement: props.placement ?? "bottom-start",
    enabled: () => open(),
  });

  const optionId = (index: number): string => id + "-opt-" + index;

  const indexOfValue = (): number => {
    const current = props.value.peek();
    if (current === null) return -1;
    return props.options().indexOf(current);
  };

  const show = (): void => {
    if (open.peek()) return;
    open.set(true);
    // Opening starts from the current value, not from the first element.
    const current = indexOfValue();
    active.set(current >= 0 ? current : (selectable.peek()[0] ?? -1));
  };

  const hide = (refocus: boolean): void => {
    open.set(false);
    active.set(-1);
    clearTyped();
    if (refocus) focus(triggerEl);
  };

  const choose = (index: number): void => {
    const option = props.options()[index];
    if (option === undefined || props.disabled?.(option)) return;
    props.value.set(option);
    props.onChange?.(option);
    hide(true);
  };

  const move = (delta: number): void => {
    const idx = selectable();
    if (idx.length === 0) return;
    const current = idx.indexOf(active());
    const next = current === -1 ? (delta > 0 ? 0 : idx.length - 1) : (current + delta + idx.length) % idx.length;
    active.set(idx[next]!);
  };

  const typeahead = (char: string): void => {
    typed += char.toLowerCase();
    if (typedTimer !== null) clearTimeout(typedTimer);
    typedTimer = setTimeout(clearTyped, 600);

    const list = props.options();
    const start = Math.max(0, active.peek());
    // We search from the current position downward, then cycle.
    for (let step = 1; step <= list.length; step++) {
      const i = (start + step) % list.length;
      const option = list[i]!;
      if (props.disabled?.(option)) continue;
      if (props.label(option).toLowerCase().startsWith(typed)) {
        active.set(i);
        if (!open.peek()) choose(i);
        return;
      }
    }
  };

  const onKeydown = (e: any): void => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault?.();
        if (!open()) show();
        else move(1);
        return;
      case "ArrowUp":
        e.preventDefault?.();
        if (!open()) show();
        else move(-1);
        return;
      case "Home":
        if (open()) {
          e.preventDefault?.();
          active.set(selectable()[0] ?? -1);
        }
        return;
      case "End":
        if (open()) {
          e.preventDefault?.();
          const idx = selectable();
          active.set(idx[idx.length - 1] ?? -1);
        }
        return;
      case "Enter":
      case " ":
        e.preventDefault?.();
        if (open() && active() >= 0) choose(active());
        else show();
        return;
      case "Escape":
        if (open()) {
          e.preventDefault?.();
          hide(true);
        }
        return;
      case "Tab":
        if (open()) hide(false);
        return;
    }
    // Typeahead: a single printable letter.
    if (typeof e.key === "string" && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      typeahead(e.key);
    }
  };

  const el = R.div(
    {
      class: props.class ? "rui-select " + props.class : "rui-select",
      ref: (node: El) => {
        clickOutside(() => hide(false), { enabled: () => open() })(node);
        pos.reference(node);
      },
    },
    R.button({
      id,
      type: "button",
      class: () => "rui-select-trigger" + (open() ? " rui-open" : ""),
      role: "combobox",
      "aria-haspopup": "listbox",
      "aria-expanded": () => String(open()),
      "aria-controls": id + "-list",
      ...(props.ariaLabel ? { "aria-label": props.ariaLabel } : {}),
      "aria-activedescendant": () => (open() && active() >= 0 ? optionId(active()) : ""),
      ref: (node: El) => {
        triggerEl = node;
      },
      "on:click": (e: any) => {
        e.stopPropagation?.();
        if (open()) hide(false);
        else show();
      },
      "on:keydown": onKeydown,
    },
    R.span({ class: () => (props.value() === null ? "rui-select-placeholder" : "rui-select-value") }, () => {
      const current = props.value();
      return current === null ? (props.placeholder ?? "Choose…") : props.label(current);
    }),
    R.span({ class: "rui-select-arrow", "aria-hidden": "true" }, "▾")),
    Show({
      when: () => open(),
      children: R.ul(
        {
          id: id + "-list",
          class: "rui-select-list",
          role: "listbox",
          "aria-labelledby": id,
          ref: pos.floating,
          style: () => pos.style(),
        },
        For({
          each: () => props.options(),
          children: (option: T, index: number) => {
            const disabled = props.disabled?.(option) ?? false;
            return R.li(
              {
                id: optionId(index),
                class: () => {
                  let cls = "rui-select-option";
                  if (active() === index) cls += " rui-active";
                  if (disabled) cls += " rui-disabled";
                  if (props.value() === option) cls += " rui-selected";
                  return cls;
                },
                role: "option",
                "aria-selected": () => String(props.value() === option),
                ...(disabled ? { "aria-disabled": "true" } : {}),
                "on:click": (e: any) => {
                  e.stopPropagation?.();
                  choose(index);
                },
                "on:mouseenter": () => {
                  if (!disabled) active.set(index);
                },
              },
              props.render ? props.render(option) : props.label(option),
            );
          },
        }),
      ),
    }),
  );

  return { el, open: () => open() };
}

/** Component variant. */
export function Select<T>(props: SelectProps<T>): El {
  // Construction doesn't subscribe the caller's computation; see `isolate`.
  return isolate(() => SelectImpl<T>(props));
}

function SelectImpl<T>(props: SelectProps<T>): El {
  return select(props).el;
}
