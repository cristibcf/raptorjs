/**
 * Form / FormField / Label / ErrorMessage - forms with derived validation.
 *
 * The thesis component of forms. Validation is not a step that runs "on
 * submit" or on every re-render: each rule is a `derived` over the field's
 * signal, so a keystroke recomputes ONLY the errors that depend on that field
 * and rewrites ONLY that field's error text node. A form with 30 fields
 * touches nothing in the other 29.
 *
 * The test checks exactly this: typing in a field makes `createElement === 0`
 * and exactly one text update.
 */
import { state, derived, untracked, type Accessor, type State } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

let idSeq = 0;

export type Validator<T> = (value: T) => string | null;

export interface FieldOptions<T> {
  /** Rules applied in order; the first one that returns a message wins. */
  validate?: Validator<T> | Validator<T>[];
  /** Show the error only after the first exit from the field. Default `true`. */
  validateOnBlur?: boolean;
  label?: string;
}

export interface Field<T> {
  value: State<T>;
  /** The current error, whether or not it is displayed. */
  error: Accessor<string | null>;
  /** The error to DISPLAY (takes `touched` into account). */
  visibleError: Accessor<string | null>;
  touched: Accessor<boolean>;
  dirty: Accessor<boolean>;
  valid: Accessor<boolean>;
  touch: () => void;
  reset: () => void;
  /** Props ready to apply to an `input`. */
  props: () => Record<string, unknown>;
  id: string;
  label?: string;
}

/**
 * Creates a field. The value is a signal you own; validation is a `derived`
 * over it, so there is no "validation cycle" to trigger.
 *
 * `NoInfer` on `options`: without it, a `string` validator would pin `T` to the
 * literal type of the initial value (`field("")` => `Field<"">`), and you
 * couldn't type anything else into the field.
 */
export function field<T>(initial: T, options?: FieldOptions<NoInfer<T>>): Field<T> {
  const id = "rui-f-" + ++idSeq;
  const value = state<T>(initial);
  const touched = state(false);
  const rules: Validator<T>[] = options?.validate
    ? Array.isArray(options.validate)
      ? options.validate
      : [options.validate]
    : [];

  const error = derived<string | null>(() => {
    const current = value();
    for (const rule of rules) {
      const message = rule(current);
      if (message) return message;
    }
    return null;
  });

  const onBlur = options?.validateOnBlur ?? true;
  const visibleError = derived<string | null>(() =>
    !onBlur || touched() ? error() : null,
  );

  const dirty = derived(() => value() !== initial);

  const f: Field<T> = {
    value,
    error: () => error(),
    visibleError: () => visibleError(),
    touched: () => touched(),
    dirty: () => dirty(),
    valid: () => error() === null,
    touch: () => touched.set(true),
    reset: () => {
      value.set(initial);
      touched.set(false);
    },
    id,
    label: options?.label,
    props: () => ({
      id,
      value: () => String(value() ?? ""),
      "aria-invalid": () => (visibleError() ? "true" : "false"),
      "aria-describedby": () => (visibleError() ? id + "-err" : ""),
      "on:input": (e: any) => value.set(e.target?.value as T),
      "on:blur": () => touched.set(true),
    }),
  };
  return f;
}

export interface FormGroup {
  /** `true` if all fields are valid. */
  valid: Accessor<boolean>;
  /** `true` if any field has been modified. */
  dirty: Accessor<boolean>;
  /** Marks all fields as touched (on a failed submit). */
  touchAll: () => void;
  reset: () => void;
  errors: Accessor<string[]>;
}

/** Aggregates several fields into a group with global state. */
export function formGroup(fields: readonly Field<any>[]): FormGroup {
  const valid = derived(() => fields.every((f) => f.valid()));
  const dirty = derived(() => fields.some((f) => f.dirty()));
  const errors = derived<string[]>(() => {
    const out: string[] = [];
    for (const f of fields) {
      const message = f.error();
      if (message) out.push(f.label ? f.label + ": " + message : message);
    }
    return out;
  });

  return {
    valid: () => valid(),
    dirty: () => dirty(),
    errors: () => errors(),
    touchAll: () => {
      for (const f of fields) f.touch();
    },
    reset: () => {
      for (const f of fields) f.reset();
    },
  };
}

/* ------------------------------------------------------------- validators - */

export const validators = {
  required:
    (message = "Required field"): Validator<unknown> =>
    (value) => {
      if (value === null || value === undefined) return message;
      if (typeof value === "string" && value.trim() === "") return message;
      if (Array.isArray(value) && value.length === 0) return message;
      return null;
    },
  minLength:
    (n: number, message?: string): Validator<string> =>
    (value) => (value.length < n ? message ?? `At least ${n} characters` : null),
  maxLength:
    (n: number, message?: string): Validator<string> =>
    (value) => (value.length > n ? message ?? `At most ${n} characters` : null),
  pattern:
    (re: RegExp, message = "Invalid format"): Validator<string> =>
    (value) => (value === "" || re.test(value) ? null : message),
  /** Pragmatic check, not RFC 5322: an `@` with text on both sides and a dot. */
  email:
    (message = "Invalid email address"): Validator<string> =>
    (value) => (value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : message),
  range:
    (min: number, max: number, message?: string): Validator<number> =>
    (value) => (value < min || value > max ? message ?? `Between ${min} and ${max}` : null),
  /** Compares against another field, without subscribing to it twice. */
  matches:
    (other: Accessor<string>, message = "Values do not match"): Validator<string> =>
    (value) => (value === other() ? null : message),
};

/* ------------------------------------------------------------- components - */

export interface LabelProps {
  children: Child;
  /** The control's `id`. Without it the label isn't tied to anything. */
  for?: string;
  required?: boolean;
  class?: string;
}

export function Label(props: LabelProps): El {
  return R.label(
    {
      class: props.class ? "rui-label " + props.class : "rui-label",
      ...(props.for ? { for: props.for } : {}),
    },
    props.children,
    props.required ? R.span({ class: "rui-required", "aria-hidden": "true" }, " *") : null,
  );
}

export interface ErrorMessageProps {
  /** The message; `null` means no error. */
  message: Accessor<string | null>;
  id?: string;
  class?: string;
}

export function ErrorMessage(props: ErrorMessageProps): El {
  // `aria-live` on the ALWAYS-mounted container: if it appeared together with
  // the text, many screen readers would announce nothing.
  return R.div(
    {
      ...(props.id ? { id: props.id } : {}),
      class: props.class ? "rui-error " + props.class : "rui-error",
      role: "alert",
      "aria-live": "polite",
    },
    () => props.message() ?? "",
  );
}

export interface FormFieldProps {
  field: Field<any>;
  label?: Child;
  required?: boolean;
  hint?: Child;
  /** The control. Receives `field.props()` applied by you. */
  children: Child;
  class?: string;
}

export function FormField(props: FormFieldProps): El {
  const f = props.field;
  return R.div(
    {
      class: () =>
        "rui-field" + (f.visibleError() ? " rui-invalid" : "") + (props.class ? " " + props.class : ""),
    },
    props.label !== undefined
      ? Label({ children: props.label, for: f.id, required: props.required })
      : null,
    props.children,
    props.hint !== undefined
      ? Show({
          when: () => f.visibleError() === null,
          children: R.div({ class: "rui-hint" }, props.hint),
        })
      : null,
    ErrorMessage({ message: () => f.visibleError(), id: f.id + "-err" }),
  );
}

export interface FormProps {
  children: Child;
  group?: FormGroup;
  /** Runs only if the group is valid; otherwise marks all fields. */
  onSubmit?: () => void | Promise<unknown>;
  class?: string;
  label?: string;
}

export function Form(props: FormProps): El {
  const submitting = state(false);

  const onSubmit = (e: any): void => {
    e.preventDefault?.();
    if (submitting.peek()) return;

    const group = props.group;
    if (group) {
      // `untracked`: submit reads the validity, it doesn't subscribe to it.
      const ok = untracked(() => group.valid());
      if (!ok) {
        group.touchAll();
        return;
      }
    }

    const result = props.onSubmit?.();
    if (result && typeof (result as Promise<unknown>).then === "function") {
      submitting.set(true);
      const done = (): void => submitting.set(false);
      (result as Promise<unknown>).then(done, done);
    }
  };

  return R.form(
    {
      class: props.class ? "rui-form " + props.class : "rui-form",
      novalidate: "",
      ...(props.label ? { "aria-label": props.label } : {}),
      "aria-busy": () => (submitting() ? "true" : "false"),
      "on:submit": onSubmit,
    },
    props.children,
  );
}

/* ---------------------------------------- FormSection / ValidationSummary */

export interface FormSectionProps {
  title: Child;
  description?: Child;
  children: Child;
  /** Collapsible section. */
  collapsible?: boolean;
  class?: string;
}

/** Visual grouping of fields, with a title linked via `aria-labelledby`. */
export function FormSection(props: FormSectionProps): El {
  const id = "rui-fs-" + ++idSeq;
  const open = state(true);

  return R.section(
    {
      class: props.class ? "rui-formsection " + props.class : "rui-formsection",
      "aria-labelledby": id,
    },
    R.div(
      { class: "rui-formsection-head" },
      props.collapsible
        ? R.button(
            {
              id,
              type: "button",
              class: "rui-formsection-toggle",
              "aria-expanded": () => String(open()),
              "aria-controls": id + "-body",
              "on:click": () => open.update((v) => !v),
            },
            R.span({ class: "rui-formsection-caret", "aria-hidden": "true" }, () => (open() ? "▾" : "▸")),
            props.title,
          )
        : R.h3({ id, class: "rui-formsection-title" }, props.title),
      props.description !== undefined
        ? R.p({ class: "rui-formsection-desc" }, props.description)
        : null,
    ),
    R.div(
      { id: id + "-body", class: "rui-formsection-body", hidden: () => props.collapsible === true && !open() },
      props.children,
    ),
  );
}

export interface ValidationSummaryProps {
  /** The tracked fields, in form order. */
  fields: readonly Field<any>[];
  /** Show the summary only after a submit attempt. */
  visible?: Accessor<boolean>;
  title?: Child;
  class?: string;
}

/**
 * ValidationSummary - list of errors, with links to the fields.
 *
 * Required for long forms: without it, after a failed submit the user has to
 * hunt on their own for which of the 20 fields is red. Clicking an error moves
 * focus to the offending field.
 */
export function ValidationSummary(props: ValidationSummaryProps): Child {
  const errors = derived(() =>
    props.fields
      .map((field) => ({ field, message: field.error() }))
      .filter((entry): entry is { field: Field<any>; message: string } => entry.message !== null),
  );

  const show = (): boolean => (props.visible ? props.visible() : true) && errors().length > 0;

  return Show({
    when: show,
    children: R.div(
      {
        class: props.class ? "rui-validation " + props.class : "rui-validation",
        role: "alert",
        "aria-live": "assertive",
        tabindex: "-1",
      },
      R.div({ class: "rui-validation-title" }, () =>
        props.title ?? `${errors().length} ${errors().length === 1 ? "error" : "errors"} to fix`,
      ),
      R.ul(
        { class: "rui-validation-list" },
        For({
          each: () => errors(),
          children: (entry: { field: Field<any>; message: string }) =>
            R.li(
              { class: "rui-validation-item" },
              R.a(
                {
                  href: "#" + entry.field.id,
                  class: "rui-validation-link",
                  "on:click": (e: any) => {
                    e.preventDefault?.();
                    const el = (globalThis as any).document?.getElementById?.(entry.field.id);
                    entry.field.touch();
                    if (el && typeof el.focus === "function") el.focus();
                    el?.scrollIntoView?.({ block: "center" });
                  },
                },
                entry.field.label ? entry.field.label + ": " + entry.message : entry.message,
              ),
            ),
        }),
      ),
    ),
  });
}
