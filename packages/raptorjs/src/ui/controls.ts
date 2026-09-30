/**
 * Form controls, round two.
 *
 * They all take their signal from the outside. The details they handle are the
 * ones that get forgotten when everyone writes their own control: a `NumberInput`
 * that doesn't produce `0.30000000000000004`, a `PinInput` that accepts a code
 * pasted from an SMS, a `SearchInput` that doesn't fire a request on every letter.
 */
import { state, derived, onCleanup, type Accessor, type State } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";
import { type El } from "./primitives/env.ts";
import { Button } from "./button.ts";
import { Tag } from "./display.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

function read(value: Accessor<boolean> | boolean | undefined): boolean {
  if (value === undefined) return false;
  return typeof value === "function" ? value() : value;
}

/* ----------------------------------------------------------- NumberInput -- */

export interface NumberInputProps {
  value: State<number>;
  min?: number;
  max?: number;
  step?: number;
  /** Decimals displayed. Inferred from `step` if omitted. */
  precision?: number;
  disabled?: Accessor<boolean> | boolean;
  id?: string;
  label?: string;
  /** Unit shown after the number (e.g. "kg", "%"). */
  suffix?: Child;
  onChange?: (value: number) => void;
  class?: string;
}

function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

export function NumberInput(props: NumberInputProps): El {
  const id = props.id ?? "rui-num-" + ++idSeq;
  const step = props.step ?? 1;
  const min = props.min ?? Number.NEGATIVE_INFINITY;
  const max = props.max ?? Number.POSITIVE_INFINITY;
  const precision = props.precision ?? decimalsOf(step);

  const clamp = (n: number): number => {
    const bounded = Math.min(max, Math.max(min, n));
    // Floating-point arithmetic: 0.1 + 0.2 = 0.30000000000000004.
    // Round to the step's precision, otherwise the field shows garbage.
    return precision > 0 ? Number(bounded.toFixed(precision)) : Math.round(bounded);
  };

  const write = (n: number): void => {
    if (read(props.disabled) || !Number.isFinite(n)) return;
    const next = clamp(n);
    if (next === props.value.peek()) return;
    props.value.set(next);
    props.onChange?.(next);
  };

  const bump = (delta: number): void => write(props.value.peek() + delta * step);

  const display = derived(() => {
    const v = props.value();
    return precision > 0 ? v.toFixed(precision) : String(v);
  });

  const atMin = (): boolean => props.value() <= min;
  const atMax = (): boolean => props.value() >= max;

  return R.div(
    { class: props.class ? "rui-number " + props.class : "rui-number" },
    R.button({
      type: "button",
      class: "rui-number-step",
      "aria-label": "Decrease",
      tabindex: "-1", // the step is accessible via arrow keys on the input
      disabled: () => read(props.disabled) || atMin(),
      "on:click": () => bump(-1),
    }, "−"),
    R.input({
      id,
      type: "text",
      inputmode: "decimal",
      class: "rui-number-input rui-tabular",
      role: "spinbutton",
      "aria-valuenow": () => String(props.value()),
      ...(Number.isFinite(min) ? { "aria-valuemin": String(min) } : {}),
      ...(Number.isFinite(max) ? { "aria-valuemax": String(max) } : {}),
      ...(props.label ? { "aria-label": props.label } : {}),
      disabled: () => read(props.disabled),
      value: () => display(),
      "on:input": (e: any) => {
        const raw = String(e.target?.value ?? "").replace(",", ".");
        // Don't clamp while typing: you'd block typing "-" or "0.".
        const parsed = Number(raw);
        if (raw !== "" && Number.isFinite(parsed)) props.value.set(parsed);
      },
      // Clamping applies on blur, once the user has finished typing.
      "on:blur": () => write(props.value.peek()),
      "on:keydown": (e: any) => {
        if (e.key === "ArrowUp") {
          e.preventDefault?.();
          bump(e.shiftKey ? 10 : 1);
        } else if (e.key === "ArrowDown") {
          e.preventDefault?.();
          bump(e.shiftKey ? -10 : -1);
        } else if (e.key === "Home" && Number.isFinite(min)) {
          e.preventDefault?.();
          write(min);
        } else if (e.key === "End" && Number.isFinite(max)) {
          e.preventDefault?.();
          write(max);
        }
      },
    }),
    props.suffix !== undefined ? R.span({ class: "rui-number-suffix" }, props.suffix) : null,
    R.button({
      type: "button",
      class: "rui-number-step",
      "aria-label": "Increase",
      tabindex: "-1",
      disabled: () => read(props.disabled) || atMax(),
      "on:click": () => bump(1),
    }, "+"),
  );
}

/* --------------------------------------------------------- PasswordInput -- */

export interface PasswordInputProps {
  value: State<string>;
  id?: string;
  label?: string;
  placeholder?: string;
  disabled?: Accessor<boolean> | boolean;
  /** Password strength bar. */
  strength?: boolean;
  class?: string;
}

/** Score 0..4, based on length and character variety. */
export function passwordStrength(value: string): number {
  if (value.length === 0) return 0;
  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value) && /[^\w\s]/.test(value)) score++;
  return Math.min(4, score);
}

const STRENGTH_LABEL = ["", "weak", "acceptable", "good", "strong"];

export function PasswordInput(props: PasswordInputProps): El {
  const id = props.id ?? "rui-pw-" + ++idSeq;
  const visible = state(false);
  const score = derived(() => passwordStrength(props.value()));

  return R.div(
    { class: props.class ? "rui-password " + props.class : "rui-password" },
    R.div(
      { class: "rui-password-row" },
      R.input({
        id,
        // The type changes reactively; the browser keeps the value and cursor.
        type: () => (visible() ? "text" : "password"),
        class: "rui-input-control",
        value: () => props.value(),
        ...(props.placeholder ? { placeholder: props.placeholder } : {}),
        ...(props.label ? { "aria-label": props.label } : {}),
        disabled: () => read(props.disabled),
        autocomplete: "current-password",
        "on:input": (e: any) => props.value.set(String(e.target?.value ?? "")),
      }),
      R.button({
        type: "button",
        class: "rui-password-toggle",
        // The label describes the ACTION, not the state: otherwise the user
        // doesn't know what happens if they press it.
        "aria-label": () => (visible() ? "Hide password" : "Show password"),
        "aria-pressed": () => String(visible()),
        "on:click": () => visible.update((v) => !v),
      }, () => (visible() ? "🙈" : "👁")),
    ),
    props.strength
      ? R.div(
          { class: "rui-password-strength" },
          R.div({
            class: () => "rui-password-bar rui-level-" + score(),
            style: () => "width:" + score() * 25 + "%",
          }),
          R.span({ class: "rui-sr-only", "aria-live": "polite" }, () =>
            score() === 0 ? "" : "Password strength: " + STRENGTH_LABEL[score()],
          ),
        )
      : null,
  );
}

/* ----------------------------------------------------------- SearchInput -- */

export interface SearchInputProps {
  value: State<string>;
  /** Called after `debounce` ms of quiet, not on every keystroke. */
  onSearch?: (query: string) => void;
  /** Ms to wait. Default 250. `0` disables it. */
  debounce?: number;
  placeholder?: string;
  disabled?: Accessor<boolean> | boolean;
  id?: string;
  label?: string;
  class?: string;
}

export function SearchInput(props: SearchInputProps): El {
  const id = props.id ?? "rui-search-" + ++idSeq;
  const wait = props.debounce ?? 250;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  onCleanup(clear);

  const emit = (query: string, immediate: boolean): void => {
    clear();
    if (!props.onSearch) return;
    if (immediate || wait <= 0) {
      props.onSearch(query);
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      props.onSearch!(query);
    }, wait);
  };

  return R.div(
    { class: props.class ? "rui-search " + props.class : "rui-search", role: "search" },
    R.span({ class: "rui-search-icon", "aria-hidden": "true" }, "⌕"),
    R.input({
      id,
      type: "search",
      class: "rui-search-input",
      value: () => props.value(),
      ...(props.placeholder ? { placeholder: props.placeholder } : {}),
      ...(props.label ? { "aria-label": props.label } : {}),
      disabled: () => read(props.disabled),
      "on:input": (e: any) => {
        const next = String(e.target?.value ?? "");
        props.value.set(next);
        emit(next, false);
      },
      "on:keydown": (e: any) => {
        // Enter searches immediately; Escape clears.
        if (e.key === "Enter") emit(props.value.peek(), true);
        else if (e.key === "Escape" && props.value.peek() !== "") {
          e.preventDefault?.();
          props.value.set("");
          emit("", true);
        }
      },
    }),
    Show({
      when: () => props.value() !== "",
      children: R.button({
        type: "button",
        class: "rui-search-clear",
        "aria-label": "Clear search",
        "on:click": () => {
          props.value.set("");
          emit("", true);
        },
      }, "✕"),
    }),
  );
}

/* -------------------------------------------------------------- PinInput -- */

export interface PinInputProps {
  value: State<string>;
  length?: number;
  /** Hide the digits. */
  mask?: boolean;
  /** Digits only. Default `true`. */
  numeric?: boolean;
  disabled?: Accessor<boolean> | boolean;
  label?: string;
  onComplete?: (value: string) => void;
  class?: string;
}

/**
 * PinInput - separate boxes for a short code.
 *
 * The part missing from most implementations: **pasting a whole code**. The
 * user copies "123456" from an SMS and pastes it into the first box; if you
 * don't handle `paste`, they get a single "1".
 */
export function PinInput(props: PinInputProps): El {
  const length = props.length ?? 6;
  const numeric = props.numeric !== false;
  const boxes: El[] = [];

  const charAt = (i: number): string => props.value()[i] ?? "";

  const setChar = (i: number, char: string): void => {
    const current = props.value.peek().padEnd(length, " ");
    const next = (current.slice(0, i) + char + current.slice(i + 1)).trimEnd();
    props.value.set(next);
    if (next.length === length && !next.includes(" ")) props.onComplete?.(next);
  };

  const focusBox = (i: number): void => {
    const el = boxes[Math.max(0, Math.min(length - 1, i))];
    if (el && typeof el.focus === "function") el.focus();
  };

  const accept = (text: string): string =>
    numeric ? text.replace(/\D/g, "") : text.replace(/\s/g, "");

  const onPaste = (index: number) => (e: any): void => {
    const text = accept(String(e.clipboardData?.getData?.("text") ?? ""));
    if (text === "") return;
    e.preventDefault?.();
    const current = props.value.peek().padEnd(length, " ");
    const merged = (current.slice(0, index) + text).slice(0, length);
    const next = merged.trimEnd();
    props.value.set(next);
    focusBox(Math.min(length - 1, index + text.length));
    if (next.length === length) props.onComplete?.(next);
  };

  for (let i = 0; i < length; i++) {
    const index = i;
    boxes.push(
      R.input({
        type: props.mask ? "password" : "text",
        class: "rui-pin-box",
        inputmode: numeric ? "numeric" : "text",
        maxlength: "1",
        autocomplete: index === 0 ? "one-time-code" : "off",
        "aria-label": (props.label ?? "Digit") + " " + (index + 1) + " of " + length,
        disabled: () => read(props.disabled),
        value: () => charAt(index),
        ref: (el: El) => {
          if (el) boxes[index] = el;
        },
        "on:paste": onPaste(index),
        "on:input": (e: any) => {
          const char = accept(String(e.target?.value ?? "")).slice(-1);
          if (char === "") return;
          setChar(index, char);
          focusBox(index + 1);
        },
        "on:keydown": (e: any) => {
          if (e.key === "Backspace") {
            e.preventDefault?.();
            if (charAt(index) !== "") setChar(index, " ");
            else focusBox(index - 1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault?.();
            focusBox(index - 1);
          } else if (e.key === "ArrowRight") {
            e.preventDefault?.();
            focusBox(index + 1);
          }
        },
      }),
    );
  }

  return R.div(
    {
      class: props.class ? "rui-pin " + props.class : "rui-pin",
      role: "group",
      ...(props.label ? { "aria-label": props.label } : {}),
    },
    boxes,
  );
}

/* ------------------------------------------------------------- TagsInput -- */

export interface TagsInputProps {
  value: State<readonly string[]>;
  placeholder?: string;
  /** Characters that confirm a tag. Default Enter and comma. */
  separators?: readonly string[];
  max?: number;
  /** Reject duplicates. Default `true`. */
  unique?: boolean;
  disabled?: Accessor<boolean> | boolean;
  label?: string;
  validate?: (tag: string) => boolean;
  class?: string;
}

export function TagsInput(props: TagsInputProps): El {
  const draft = state("");
  const separators = props.separators ?? [",", "Enter"];

  const add = (raw: string): void => {
    const tag = raw.trim();
    if (tag === "") return;
    if (props.validate && !props.validate(tag)) return;
    const current = props.value.peek();
    if (props.unique !== false && current.includes(tag)) {
      draft.set("");
      return;
    }
    if (props.max !== undefined && current.length >= props.max) return;
    props.value.set([...current, tag]);
    draft.set("");
  };

  const removeAt = (index: number): void => {
    props.value.update((prev) => prev.filter((_, i) => i !== index));
  };

  return R.div(
    {
      class: props.class ? "rui-tags " + props.class : "rui-tags",
      role: "group",
      ...(props.label ? { "aria-label": props.label } : {}),
    },
    For({
      each: () => props.value(),
      children: (tag: string, index: number) =>
        Tag({ children: tag, removeLabel: "Remove " + tag, onRemove: () => removeAt(index) }),
    }),
    R.input({
      type: "text",
      class: "rui-tags-input",
      value: () => draft(),
      ...(props.placeholder ? { placeholder: props.placeholder } : {}),
      disabled: () => read(props.disabled),
      "on:input": (e: any) => draft.set(String(e.target?.value ?? "")),
      "on:keydown": (e: any) => {
        if (separators.includes(e.key)) {
          e.preventDefault?.();
          add(draft.peek());
        } else if (e.key === "Backspace" && draft.peek() === "") {
          // Backspace on an empty input removes the last tag - like any email client.
          const current = props.value.peek();
          if (current.length > 0) removeAt(current.length - 1);
        }
      },
      // Whatever is being typed when the field loses focus is confirmed, not lost.
      "on:blur": () => add(draft.peek()),
    }),
  );
}

/* -------------------------------------------------------------- Editable -- */

export interface EditableProps {
  value: State<string>;
  placeholder?: string;
  /** Validation before commit; `false` cancels. */
  validate?: (value: string) => boolean;
  onCommit?: (value: string) => void;
  label?: string;
  class?: string;
}

/**
 * Editable - text that turns into an input on click.
 *
 * Escape cancels and restores the initial value, Enter confirms. Without a
 * cancel, a mistaken edit can only be fixed by retyping.
 */
export function Editable(props: EditableProps): El {
  const editing = state(false);
  const draft = state("");
  let inputEl: El = null;

  const start = (): void => {
    draft.set(props.value.peek());
    editing.set(true);
    // Focus is requested after the input exists in the DOM.
    queueMicrotask(() => {
      if (inputEl && typeof inputEl.focus === "function") inputEl.focus();
    });
  };

  const commit = (): void => {
    const next = draft.peek();
    if (props.validate && !props.validate(next)) {
      editing.set(false);
      return;
    }
    props.value.set(next);
    props.onCommit?.(next);
    editing.set(false);
  };

  const cancel = (): void => editing.set(false);

  return R.span(
    { class: props.class ? "rui-editable " + props.class : "rui-editable" },
    Show({
      when: () => editing(),
      children: R.input({
        type: "text",
        class: "rui-editable-input",
        value: () => draft(),
        ...(props.label ? { "aria-label": props.label } : {}),
        ref: (el: El) => {
          inputEl = el;
        },
        "on:input": (e: any) => draft.set(String(e.target?.value ?? "")),
        "on:keydown": (e: any) => {
          if (e.key === "Enter") {
            e.preventDefault?.();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault?.();
            cancel();
          }
        },
        "on:blur": commit,
      }),
      fallback: R.button(
        {
          type: "button",
          class: "rui-editable-preview",
          "aria-label": (props.label ?? "Edit") + ": " + "click to edit",
          "on:click": start,
        },
        () => props.value() || props.placeholder || "—",
      ),
    }),
  );
}

/* --------------------------------------------------------- small selects -- */

export interface NativeSelectProps<T extends string> {
  value: State<T>;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  id?: string;
  label?: string;
  disabled?: Accessor<boolean> | boolean;
  class?: string;
}

/** A styled native `<select>`. On mobile it's often preferable to a custom one. */
export function NativeSelect<T extends string>(props: NativeSelectProps<T>): El {
  return R.select(
    {
      ...(props.id ? { id: props.id } : {}),
      class: props.class ? "rui-native-select " + props.class : "rui-native-select",
      ...(props.label ? { "aria-label": props.label } : {}),
      disabled: () => read(props.disabled),
      value: () => props.value(),
      "on:change": (e: any) => props.value.set(String(e.target?.value ?? "") as T),
    },
    props.options.map((o) =>
      R.option(
        {
          value: o.value,
          ...(o.disabled ? { disabled: "" } : {}),
          selected: () => props.value() === o.value,
        },
        o.label,
      ),
    ),
  );
}

export interface CheckboxGroupProps<T> {
  value: State<ReadonlySet<T>>;
  options: readonly { value: T; label: Child; disabled?: boolean }[];
  label?: string;
  /** A "select all" checkbox, with an `indeterminate` state. */
  selectAll?: boolean;
  selectAllLabel?: string;
  orientation?: "horizontal" | "vertical";
  class?: string;
}

export function CheckboxGroup<T>(props: CheckboxGroupProps<T>): El {
  const selectable = props.options.filter((o) => !o.disabled);

  const allChecked = derived(() =>
    selectable.length > 0 && selectable.every((o) => props.value().has(o.value)),
  );
  const someChecked = derived(() => selectable.some((o) => props.value().has(o.value)));

  const toggle = (value: T): void => {
    props.value.update((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const toggleAll = (): void => {
    props.value.set(allChecked.peek() ? new Set<T>() : new Set(selectable.map((o) => o.value)));
  };

  return R.div(
    {
      class:
        "rui-checkbox-group rui-" +
        (props.orientation ?? "vertical") +
        (props.class ? " " + props.class : ""),
      role: "group",
      ...(props.label ? { "aria-label": props.label } : {}),
    },
    props.selectAll
      ? R.label(
          { class: "rui-checkbox rui-checkbox-all" },
          R.input({
            type: "checkbox",
            class: "rui-checkbox-box",
            checked: () => allChecked(),
            // The partial state is `mixed`, not "checked" or "unchecked".
            "aria-checked": () => (allChecked() ? "true" : someChecked() ? "mixed" : "false"),
            ref: (el: El) => {
              if (el) el.indeterminate = someChecked() && !allChecked();
            },
            "on:change": toggleAll,
          }),
          R.span({ class: "rui-checkbox-label" }, props.selectAllLabel ?? "Select all"),
        )
      : null,
    props.options.map((option) =>
      R.label(
        { class: () => "rui-checkbox" + (option.disabled ? " rui-disabled" : "") },
        R.input({
          type: "checkbox",
          class: "rui-checkbox-box",
          checked: () => props.value().has(option.value),
          disabled: option.disabled === true,
          "on:change": () => toggle(option.value),
        }),
        R.span({ class: "rui-checkbox-label" }, option.label),
      ),
    ),
  );
}

export interface SegmentedControlProps<T extends string> {
  value: State<T>;
  options: readonly { value: T; label: Child; disabled?: boolean }[];
  label?: string;
  size?: "sm" | "md";
  onChange?: (value: T) => void;
  class?: string;
}

/** Button-tabs for 2-5 exclusive options. Roving tabindex, like RadioGroup. */
export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>): El {
  const enabled = (): typeof props.options => props.options.filter((o) => !o.disabled);

  const move = (delta: number): void => {
    const list = enabled();
    if (list.length === 0) return;
    const at = list.findIndex((o) => o.value === props.value.peek());
    const next = list[(at === -1 ? 0 : at + delta + list.length) % list.length]!;
    props.value.set(next.value);
    props.onChange?.(next.value);
  };

  return R.div(
    {
      class:
        "rui-segmented rui-segmented-" + (props.size ?? "md") + (props.class ? " " + props.class : ""),
      role: "radiogroup",
      ...(props.label ? { "aria-label": props.label } : {}),
      "on:keydown": (e: any) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault?.();
          move(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault?.();
          move(-1);
        }
      },
    },
    props.options.map((option) =>
      R.button({
        type: "button",
        class: () => "rui-segment" + (props.value() === option.value ? " rui-active" : ""),
        role: "radio",
        "aria-checked": () => String(props.value() === option.value),
        tabindex: () => (props.value() === option.value ? "0" : "-1"),
        disabled: option.disabled === true,
        "on:click": () => {
          props.value.set(option.value);
          props.onChange?.(option.value);
        },
      }, option.label),
    ),
  );
}

export interface ToggleButtonProps {
  pressed: State<boolean>;
  children: Child;
  label?: string;
  disabled?: Accessor<boolean> | boolean;
  onChange?: (pressed: boolean) => void;
  class?: string;
}

/** A stateful button. `aria-pressed`, not `aria-checked`: it's a button, not a checkbox. */
export function ToggleButton(props: ToggleButtonProps): El {
  return R.button(
    {
      type: "button",
      class: () => "rui-btn rui-btn-secondary rui-toggle" + (props.pressed() ? " rui-pressed" : "") + (props.class ? " " + props.class : ""),
      "aria-pressed": () => String(props.pressed()),
      ...(props.label ? { "aria-label": props.label } : {}),
      disabled: () => read(props.disabled),
      "on:click": () => {
        const next = !props.pressed.peek();
        props.pressed.set(next);
        props.onChange?.(next);
      },
    },
    props.children,
  );
}

export interface ToggleGroupProps<T extends string> {
  /** `single` holds one value, `multiple` a set. */
  mode?: "single" | "multiple";
  value: State<T | null> | State<ReadonlySet<T>>;
  options: readonly { value: T; label: Child; disabled?: boolean }[];
  label?: string;
  class?: string;
}

export function ToggleGroup<T extends string>(props: ToggleGroupProps<T>): El {
  const multiple = props.mode === "multiple";

  const isOn = (value: T): boolean => {
    const current = (props.value as State<any>)();
    return multiple ? (current as ReadonlySet<T>).has(value) : current === value;
  };

  const toggle = (value: T): void => {
    if (multiple) {
      (props.value as State<ReadonlySet<T>>).update((prev) => {
        const next = new Set(prev);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });
    } else {
      const signal = props.value as State<T | null>;
      signal.set(signal.peek() === value ? null : value);
    }
  };

  return R.div(
    {
      class: props.class ? "rui-btn-group rui-toggle-group " + props.class : "rui-btn-group rui-toggle-group",
      role: "group",
      ...(props.label ? { "aria-label": props.label } : {}),
    },
    props.options.map((option) =>
      R.button({
        type: "button",
        class: () => "rui-btn rui-btn-secondary" + (isOn(option.value) ? " rui-pressed" : ""),
        "aria-pressed": () => String(isOn(option.value)),
        disabled: option.disabled === true,
        "on:click": () => toggle(option.value),
      }, option.label),
    ),
  );
}

/* ----------------------------------------------------------- small bits -- */

export interface CloseButtonProps {
  onClick: () => void;
  label?: string;
  size?: "sm" | "md";
  class?: string;
}

export function CloseButton(props: CloseButtonProps): El {
  return R.button(
    {
      type: "button",
      class: "rui-close rui-close-" + (props.size ?? "md") + (props.class ? " " + props.class : ""),
      "aria-label": props.label ?? "Close",
      "on:click": props.onClick,
    },
    "✕",
  );
}

export interface CopyButtonProps {
  /** The text to copy. */
  text: Accessor<string> | string;
  children?: Child;
  copiedLabel?: Child;
  /** Ms the "copied" state lasts. Default 1500. */
  resetAfter?: number;
  class?: string;
}

export function CopyButton(props: CopyButtonProps): El {
  const copied = state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => {
    if (timer !== null) clearTimeout(timer);
  });

  const copy = async (): Promise<void> => {
    const text = typeof props.text === "function" ? props.text() : props.text;
    try {
      await (globalThis as any).navigator?.clipboard?.writeText(text);
      copied.set(true);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        copied.set(false);
      }, props.resetAfter ?? 1500);
    } catch {
      /* clipboard blocked: the button stays in its initial state */
    }
  };

  return Button({
    variant: "ghost",
    size: "sm",
    class: props.class,
    onClick: copy,
    // `aria-live` on the label: the change "copy" -> "copied" is announced.
    children: R.span({ "aria-live": "polite" }, () =>
      copied() ? (props.copiedLabel ?? "copied ✓") : (props.children ?? "copy"),
    ),
  });
}

export interface InputGroupProps {
  children: Child;
  /** Content attached on the left (prefix) and right (suffix). */
  prefix?: Child;
  suffix?: Child;
  class?: string;
}

export function InputGroup(props: InputGroupProps): El {
  return R.div(
    { class: props.class ? "rui-input-group " + props.class : "rui-input-group" },
    props.prefix !== undefined ? R.span({ class: "rui-input-addon" }, props.prefix) : null,
    props.children,
    props.suffix !== undefined ? R.span({ class: "rui-input-addon" }, props.suffix) : null,
  );
}

export interface FieldsetProps {
  legend: Child;
  children: Child;
  disabled?: boolean;
  class?: string;
}

export function Fieldset(props: FieldsetProps): El {
  return R.fieldset(
    {
      class: props.class ? "rui-fieldset " + props.class : "rui-fieldset",
      ...(props.disabled ? { disabled: "" } : {}),
    },
    R.legend({ class: "rui-legend" }, props.legend),
    props.children,
  );
}

export interface HelperTextProps {
  children: Child;
  id?: string;
  class?: string;
}

export function HelperText(props: HelperTextProps): El {
  return R.div(
    {
      ...(props.id ? { id: props.id } : {}),
      class: props.class ? "rui-hint " + props.class : "rui-hint",
    },
    props.children,
  );
}
