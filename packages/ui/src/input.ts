/**
 * Input / Textarea / Checkbox / Switch / Radio / RadioGroup.
 *
 * Controale de formular legate de semnale. Toate primesc semnalul din afara:
 * componenta nu tine stare ascunsa, deci valoarea e mereu citibila si
 * scriibila din codul tau.
 *
 * `Checkbox` acopera si starea `indeterminate`, care nu e un atribut HTML ci o
 * proprietate DOM - motiv pentru care e uitata in majoritatea bibliotecilor si
 * arborele de accesibilitate ramane mincinos.
 */
import { type Accessor, type State } from "@raptor/core";
import { R, For, type Child } from "@raptor/dom";
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
  /** Continut inaintea/dupa camp (iconita, unitate de masura). */
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

  // Fara addon-uri nu mai invelim degeaba intr-un div.
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
  /** Creste singur cu continutul. */
  autosize?: boolean;
  maxRows?: number;
}

export function Textarea(props: TextareaProps): El {
  let el: El = null;

  const resize = (): void => {
    if (!props.autosize || !el || !el.style) return;
    // Resetam inaltimea inainte de masurare, altfel nu poate scadea niciodata.
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
  /** Stare partiala (ex. "unele sub-elemente sunt bifate"). */
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
    // `indeterminate` NU e atribut HTML, ci proprietate DOM. Setat ca atribut
    // n-ar avea niciun efect; `aria-checked="mixed"` transmite starea corect.
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
 * Switch - buton cu `role="switch"`, nu checkbox stilizat: un comutator
 * comunica "porneste/opreste acum", nu "bifeaza pentru mai tarziu".
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
      // Space e implicit pe button; adaugam sageti, ca la comutatoare native.
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
  /** Nume HTML al grupului; generat daca lipseste. */
  name?: string;
  label?: string;
  orientation?: "horizontal" | "vertical";
  disabled?: Accessor<boolean> | boolean;
  onChange?: (value: T) => void;
  class?: string;
}

/**
 * RadioGroup - `role="radiogroup"` cu roving tabindex.
 *
 * Doar optiunea selectata e in ordinea de Tab; sagetile muta selectia in
 * interiorul grupului. Asa cere pattern-ul ARIA si asa se comporta radio-urile
 * native - un grup cu 8 optiuni nu trebuie sa coste 8 apasari de Tab.
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
            // Roving tabindex: un singur element al grupului e tabbable.
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
