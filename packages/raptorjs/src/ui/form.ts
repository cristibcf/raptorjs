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
import { state, derived, effect, onCleanup, untracked, type Accessor, type State } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

let idSeq = 0;

/**
 * A rule. May return a promise (v0.2.1): "is this email already registered?"
 * and "is this API key valid?" are fields like any other, and before this they
 * could not live in the form at all.
 */
export type Validator<T> = (value: T) => string | null | Promise<string | null>;

/** The narrow form. Every built-in `validators.*` rule is one of these. */
export type SyncValidator<T> = (value: T) => string | null;

/** The wide form, for when you want to say so in a type. */
export type AsyncValidator<T> = (value: T) => Promise<string | null>;

export interface FieldOptions<T> {
  /** Rules applied in order; the first one that returns a message wins. */
  validate?: Validator<T> | Validator<T>[];
  /** Show the error only after the first exit from the field. Default `true`. */
  validateOnBlur?: boolean;
  label?: string;
  /**
   * How long to wait before re-running an async rule, in ms (default 300).
   * Only async rules are debounced; a sync rule still answers on the keystroke.
   */
  debounceMs?: number;
}

/** A rule that returned a promise, told apart without assuming `instanceof`. */
function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
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
  /** An async rule is in flight: show a spinner, and do not submit yet. */
  validating: Accessor<boolean>;
  touch: () => void;
  reset: () => void;
  /**
   * Validates now, skipping the debounce, and reports the final error.
   * Synchronous when every rule is - which is what a submit needs: a form with
   * only sync rules must not become asynchronous just because the API allows
   * one that is not.
   */
  validate: () => string | null | Promise<string | null>;
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
  const debounceMs = options?.debounceMs ?? 300;

  /**
   * The error as one signal rather than a `derived`: an async verdict arrives
   * later and has to be written, not recomputed. The walk below is still a
   * single reactive computation per field, so the claim this component makes -
   * a keystroke recomputes only the rules that depend on THAT field - holds.
   */
  const message = state<string | null>(null);
  const validating = state(false);

  /**
   * Which rules have been seen to return a promise. Not knowable from a type:
   * a rule is async because of what it RETURNS. So it is learned on the first
   * call and remembered - that first check runs immediately (nothing is
   * wasted) and every later one waits out the debounce.
   */
  const isAsync: boolean[] = rules.map(() => false);

  /**
   * Bumped on every value change. A verdict is applied only while its sequence
   * is still the current one, so a slow answer about an old value can never
   * overwrite a newer one - last-write-wins by sequence, on top of the
   * debounce.
   */
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancelPending(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function publish(mine: number, result: string | null): void {
    if (mine !== seq) return;
    message.set(result);
    validating.set(false);
  }

  /**
   * Walks the rules from `from`. `deferred` means the debounce has already
   * elapsed, so a known-async rule is called instead of being scheduled; the
   * return value is a verdict only in that mode - otherwise the real answer
   * arrives through `publish`.
   */
  function walk(current: T, mine: number, from: number, deferred: boolean): string | null | Promise<string | null> {
    for (let i = from; i < rules.length; i++) {
      if (isAsync[i] && !deferred) {
        // Everything before this passed, and the rest costs a round trip.
        if (mine === seq) {
          message.set(null);
          validating.set(true);
        }
        const at = i;
        timer = setTimeout(() => {
          timer = null;
          if (mine === seq) void walk(current, mine, at, true);
        }, debounceMs);
        return null;
      }
      const verdict = rules[i]!(current);
      if (verdict === null) continue;
      if (!isThenable(verdict)) {
        publish(mine, verdict);
        return verdict;
      }
      isAsync[i] = true;
      if (mine === seq) {
        message.set(null);
        validating.set(true);
      }
      const next = i + 1;
      return verdict.then(
        (result) => {
          if (result !== null) {
            publish(mine, result);
            return result;
          }
          return walk(current, mine, next, true);
        },
        (err: unknown) => {
          // A check that could not run is not a verdict: report it and leave
          // the field valid, rather than blocking a submit on a network blip.
          console.warn("[raptor] form: an async validator failed:", err);
          publish(mine, null);
          return null;
        },
      );
    }
    publish(mine, null);
    return null;
  }

  // One computation per field. It tracks whatever the rules read - the value,
  // and another field signal for `validators.matches` - so the field
  // re-validates when any of it changes.
  effect(() => {
    const current = value();
    seq++;
    cancelPending();
    void walk(current, seq, 0, false);
  });
  onCleanup(cancelPending);

  const onBlur = options?.validateOnBlur ?? true;
  const visibleError = derived<string | null>(() => (!onBlur || touched() ? message() : null));

  const dirty = derived(() => value() !== initial);

  const f: Field<T> = {
    value,
    error: () => message(),
    visibleError: () => visibleError(),
    touched: () => touched(),
    dirty: () => dirty(),
    valid: () => message() === null,
    validating: () => validating(),
    touch: () => touched.set(true),
    reset: () => {
      value.set(initial);
      touched.set(false);
    },
    validate: () => {
      cancelPending();
      return walk(
        untracked(() => value()),
        ++seq,
        0,
        true,
      );
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
  /** `true` while any field has an async rule in flight. */
  validating: Accessor<boolean>;
  /** Marks all fields as touched (on a failed submit). */
  touchAll: () => void;
  reset: () => void;
  errors: Accessor<string[]>;
  /**
   * Validates every field now, skipping the debounce. Synchronous when every
   * rule is, so a purely synchronous form submits exactly as it did before.
   * This is what `Form` waits on, rather than submitting against a verdict
   * that has not arrived.
   */
  validate: () => boolean | Promise<boolean>;
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

  const validating = derived(() => fields.some((f) => f.validating()));

  return {
    valid: () => valid(),
    dirty: () => dirty(),
    validating: () => validating(),
    errors: () => errors(),
    touchAll: () => {
      for (const f of fields) f.touch();
    },
    reset: () => {
      for (const f of fields) f.reset();
    },
    validate: () => {
      const results = fields.map((f) => f.validate());
      // Stays synchronous unless a rule actually went async, so the sync path
      // keeps its exact timing.
      if (!results.some((r) => isThenable(r))) return results.every((r) => r === null);
      return Promise.all(results).then((all) => all.every((r) => r === null));
    },
  };
}

/* ------------------------------------------------------------- validators - */

export const validators = {
  required:
    (message = "Required field"): SyncValidator<unknown> =>
    (value) => {
      if (value === null || value === undefined) return message;
      if (typeof value === "string" && value.trim() === "") return message;
      if (Array.isArray(value) && value.length === 0) return message;
      return null;
    },
  minLength:
    (n: number, message?: string): SyncValidator<string> =>
    (value) => (value.length < n ? message ?? `At least ${n} characters` : null),
  maxLength:
    (n: number, message?: string): SyncValidator<string> =>
    (value) => (value.length > n ? message ?? `At most ${n} characters` : null),
  pattern:
    (re: RegExp, message = "Invalid format"): SyncValidator<string> =>
    (value) => (value === "" || re.test(value) ? null : message),
  /** Pragmatic check, not RFC 5322: an `@` with text on both sides and a dot. */
  email:
    (message = "Invalid email address"): SyncValidator<string> =>
    (value) => (value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : message),
  range:
    (min: number, max: number, message?: string): SyncValidator<number> =>
    (value) => (value < min || value > max ? message ?? `Between ${min} and ${max}` : null),
  /** Compares against another field, without subscribing to it twice. */
  matches:
    (other: Accessor<string>, message = "Values do not match"): SyncValidator<string> =>
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
        "rui-field" +
        (f.visibleError() ? " rui-invalid" : "") +
        // A hook for the spinner an async rule needs; styling is the app.
        (f.validating() ? " rui-validating" : "") +
        (props.class ? " " + props.class : ""),
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

    const fire = (): void => {
      const result = props.onSubmit?.();
      if (result && isThenable(result)) {
        submitting.set(true);
        const done = (): void => submitting.set(false);
        result.then(done, done);
      }
    };

    const group = props.group;
    if (group) {
      // `untracked`: submit reads the validity, it doesn't subscribe to it.
      // `validate()` rather than `valid()`, so an async rule that is still
      // debounced or in flight is resolved here instead of being submitted
      // past. It answers synchronously when every rule is synchronous, so a
      // form without async rules behaves exactly as before.
      const verdict = untracked(() => group.validate());
      if (!isThenable(verdict)) {
        if (!verdict) {
          group.touchAll();
          return;
        }
        fire();
        return;
      }
      submitting.set(true);
      verdict.then(
        (ok) => {
          submitting.set(false);
          if (!ok) {
            group.touchAll();
            return;
          }
          fire();
        },
        () => submitting.set(false),
      );
      return;
    }

    fire();
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
