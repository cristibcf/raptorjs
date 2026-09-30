/**
 * Input / Textarea / Checkbox / Switch / Radio / RadioGroup.
 *
 * Form controls bound to signals. They all receive the signal from outside: the
 * component keeps no hidden state, so the value is always readable and writable
 * from your code.
 *
 * `Checkbox` also covers the `indeterminate` state, which is not an HTML
 * attribute but a DOM property - which is why it's forgotten in most libraries
 * and the accessibility tree ends up lying.
 */
import { type Accessor, type State } from "@raptorstack/raptorjs";
import { R, For, type Child } from "@raptorstack/raptorjs/dom";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

function read(value: Accessor<boolean> | boolean | undefined): boolean {
  if (value === undefined) return false;
  return typeof value === "function" ? value() : value;
}

export interface InputProps {
  value: State<string>;
  type?: "text" | "email" | "password" | "search" | "tel" | "url" | "number";
  placeholder?: string;
  disabled?: Accessor<boolean> | boolean;
  readonly?: boolean;
  id?: string;
  label?: string;
  /** Content before/after the field (icon, unit of measure). */
  before?: Child;
  after?: Child;
  invalid?: Accessor<boolean>;
  describedBy?: string;
  onInput?: (value: string) => void;
  onBlur?: () => void;
  class?: string;
}

export function Input(props: InputProps): El {
  const input = R.input({
    ...(props.id ? { id: props.id } : {}),
    type: props.type ?? "text",
    class: "rui-input-control",
    value: () => props.value(),
    ...(props.placeholder ? { placeholder: props.placeholder } : {}),
    ...(props.label ? { "aria-label": props.label } : {}),
    ...(props.readonly ? { readonly: "" } : {}),
    ...(props.describedBy ? { "aria-describedby": props.describedBy } : {}),
    disabled: () => read(props.disabled),
    ...(props.invalid ? { "aria-invalid": () => String(props.invalid!()) } : {}),
    "on:input": (e: any) => {
      const next = String(e.target?.value ?? "");
      props.value.set(next);
      props.onInput?.(next);
    },
    ...(props.onBlur ? { "on:blur": props.onBlur } : {}),
  });

  // Without addons we don't wrap in a div for nothing.
  if (props.before === undefined && props.after === undefined && !props.class) return input;

  return R.div(
    { class: props.class ? "rui-input " + props.class : "rui-input" },
    props.before ?? null,
    input,
    props.after ?? null,
  );
}

export interface TextareaProps extends Omit<InputProps, "type" | "before" | "after"> {
  rows?: number;
  /** Grows on its own with the content. */
  autosize?: boolean;
  maxRows?: number;
}

export function Textarea(props: TextareaProps): El {
  let el: El = null;

  const resize = (): void => {
    if (!props.autosize || !el || !el.style) return;
    // We reset the height before measuring, otherwise it can never shrink.
    el.style.height = "auto";
    const max = props.maxRows ? props.maxRows * 20 : Number.POSITIVE_INFINITY;
    const needed = typeof el.scrollHeight === "number" ? el.scrollHeight : 0;
    el.style.height = Math.min(needed, max) + "px";
  };

  return R.textarea({
    ...(props.id ? { id: props.id } : {}),
    class: "rui-textarea",
    rows: String(props.rows ?? 3),
    value: () => props.value(),
    ...(props.placeholder ? { placeholder: props.placeholder } : {}),
    ...(props.label ? { "aria-label": props.label } : {}),
    ...(props.readonly ? { readonly: "" } : {}),
    ...(props.describedBy ? { "aria-describedby": props.describedBy } : {}),
    disabled: () => read(props.disabled),
    ...(props.invalid ? { "aria-invalid": () => String(props.invalid!()) } : {}),
    ref: (node: El) => {
      el = node;
      resize();
    },
    "on:input": (e: any) => {
      const next = String(e.target?.value ?? "");
      props.value.set(next);
      props.onInput?.(next);
      resize();
    },
    ...(props.onBlur ? { "on:blur": props.onBlur } : {}),
  });
}

export interface CheckboxProps {
  checked: State<boolean>;
  label?: Child;
  /** Partial state (e.g. "some sub-items are checked"). */
  indeterminate?: Accessor<boolean>;
  disabled?: Accessor<boolean> | boolean;
  id?: string;
  onChange?: (checked: boolean) => void;
  class?: string;
}

export function Checkbox(props: CheckboxProps): El {
  const id = props.id ?? "rui-cb-" + ++idSeq;

  const box = R.input({
    id,
    type: "checkbox",
    class: "rui-checkbox-box",
    checked: () => props.checked(),
    disabled: () => read(props.disabled),
    // `indeterminate` is NOT an HTML attribute, but a DOM property. Set as an
    // attribute it would have no effect; `aria-checked="mixed"` conveys the state correctly.
    ...(props.indeterminate
      ? {
          "aria-checked": () => (props.indeterminate!() ? "mixed" : String(props.checked())),
          ref: (el: El) => {
            if (el) el.indeterminate = props.indeterminate!();
          },
        }
      : {}),
    "on:change": (e: any) => {
      const next = Boolean(e.target?.checked ?? !props.checked.peek());
      props.checked.set(next);
      props.onChange?.(next);
    },
  });

  if (props.label === undefined) return box;
  return R.label(
    { class: props.class ? "rui-checkbox " + props.class : "rui-checkbox", for: id },
    box,
    R.span({ class: "rui-checkbox-label" }, props.label),
  );
}

export interface SwitchProps {
  checked: State<boolean>;
  label?: Child;
  disabled?: Accessor<boolean> | boolean;
  id?: string;
  onChange?: (checked: boolean) => void;
  class?: string;
}

/**
 * Switch - a button with `role="switch"`, not a styled checkbox: a toggle
 * communicates "turn on/off now", not "check for later".
 */
export function Switch(props: SwitchProps): El {
  const id = props.id ?? "rui-sw-" + ++idSeq;

  const toggle = (): void => {
    if (read(props.disabled)) return;
    const next = !props.checked.peek();
    props.checked.set(next);
    props.onChange?.(next);
  };

  const control = R.button({
    id,
    type: "button",
    class: () => "rui-switch-control" + (props.checked() ? " rui-on" : ""),
    role: "switch",
    "aria-checked": () => String(props.checked()),
    disabled: () => read(props.disabled),
    ...(props.label === undefined && !props.id ? {} : {}),
    "on:click": toggle,
    "on:keydown": (e: any) => {
      // Space is implicit on a button; we add arrows, as on native toggles.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault?.();
        const next = e.key === "ArrowRight";
        if (next !== props.checked.peek()) toggle();
      }
    },
  }, R.span({ class: "rui-switch-thumb", "aria-hidden": "true" }));

  if (props.label === undefined) return control;
  return R.span(
    { class: props.class ? "rui-switch " + props.class : "rui-switch" },
    control,
    R.label({ class: "rui-switch-label", for: id }, props.label),
  );
}

export interface RadioOption<T> {
  value: T;
  label: Child;
  disabled?: boolean;
}

export interface RadioGroupProps<T> {
  value: State<T>;
  options: readonly RadioOption<T>[];
  /** The group's HTML name; generated if missing. */
  name?: string;
  label?: string;
  orientation?: "horizontal" | "vertical";
  disabled?: Accessor<boolean> | boolean;
  onChange?: (value: T) => void;
  class?: string;
}

/**
 * RadioGroup - `role="radiogroup"` with roving tabindex.
 *
 * Only the selected option is in the Tab order; the arrows move the selection
 * within the group. That's what the ARIA pattern requires and how native radios
 * behave - a group with 8 options must not cost 8 Tab presses.
 */
export function RadioGroup<T>(props: RadioGroupProps<T>): El {
  const name = props.name ?? "rui-rg-" + ++idSeq;

  const selectable = (): RadioOption<T>[] =>
    props.options.filter((o) => !o.disabled);

  const move = (delta: number): void => {
    if (read(props.disabled)) return;
    const list = selectable();
    if (list.length === 0) return;
    const current = list.findIndex((o) => o.value === props.value.peek());
    const next = current === -1 ? 0 : (current + delta + list.length) % list.length;
    const option = list[next]!;
    props.value.set(option.value);
    props.onChange?.(option.value);
  };

  const onKeydown = (e: any): void => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault?.();
        move(1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault?.();
        move(-1);
        break;
    }
  };

  return R.div(
    {
      class: () =>
        "rui-radio-group rui-" + (props.orientation ?? "vertical") + (props.class ? " " + props.class : ""),
      role: "radiogroup",
      ...(props.label ? { "aria-label": props.label } : {}),
      "on:keydown": onKeydown,
    },
    For({
      each: () => props.options,
      children: (option: RadioOption<T>) => {
        const selected = (): boolean => props.value() === option.value;
        const off = (): boolean => option.disabled === true || read(props.disabled);
        return R.label(
          { class: () => "rui-radio" + (off() ? " rui-disabled" : "") },
          R.input({
            type: "radio",
            name,
            class: "rui-radio-input",
            role: "radio",
            checked: () => selected(),
            disabled: () => off(),
            // Roving tabindex: only a single element of the group is tabbable.
            tabindex: () => (selected() ? "0" : "-1"),
            "aria-checked": () => String(selected()),
            "on:change": () => {
              if (off()) return;
              props.value.set(option.value);
              props.onChange?.(option.value);
            },
          }),
          R.span({ class: "rui-radio-label" }, option.label),
        );
      },
    }),
  );
}
