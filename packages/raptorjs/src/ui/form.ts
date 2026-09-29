/**
 * Form / FormField / Label / ErrorMessage - formulare cu validare derivata.
 *
 * Componenta-teza a formularelor. Validarea nu e un pas care ruleaza "la
 * submit" sau la fiecare re-randare: fiecare regula e un `derived` peste
 * semnalul campului, deci o tastare recalculeaza DOAR erorile care depind de
 * acel camp si rescrie DOAR text-node-ul erorii lui. Un formular cu 30 de
 * campuri nu atinge nimic din celelalte 29.
 *
 * Testul verifica exact asta: tastarea intr-un camp face `createElement === 0`
 * si exact o actualizare de text.
 */
import { state, derived, untracked, type Accessor, type State } from "raptorjs";
import { R, For, Show, type Child } from "raptorjs/dom";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

let idSeq = 0;

export type Validator<T> = (value: T) => string | null;

export interface FieldOptions<T> {
  /** Reguli aplicate in ordine; prima care intoarce un mesaj castiga. */
  validate?: Validator<T> | Validator<T>[];
  /** Arata eroarea abia dupa prima iesire din camp. Implicit `true`. */
  validateOnBlur?: boolean;
  label?: string;
}

export interface Field<T> {
  value: State<T>;
  /** Eroarea curenta, indiferent daca e afisata. */
  error: Accessor<string | null>;
  /** Eroarea de AFISAT (tine cont de `touched`). */
  visibleError: Accessor<string | null>;
  touched: Accessor<boolean>;
  dirty: Accessor<boolean>;
  valid: Accessor<boolean>;
  touch: () => void;
  reset: () => void;
  /** Props gata de aplicat pe un `input`. */
  props: () => Record<string, unknown>;
  id: string;
  label?: string;
}

/**
 * Creeaza un camp. Valoarea e un semnal pe care il detii tu; validarea e un
 * `derived` peste el, deci nu exista niciun "ciclu de validare" de declansat.
 *
 * `NoInfer` pe `options`: fara el, un validator de `string` ar fixa `T` la tipul
 * literal al valorii initiale (`field("")` => `Field<"">`), si n-ai mai putea
 * scrie nimic altceva in camp.
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
  /** `true` daca toate campurile sunt valide. */
  valid: Accessor<boolean>;
  /** `true` daca vreun camp a fost modificat. */
  dirty: Accessor<boolean>;
  /** Marcheaza toate campurile ca atinse (la submit esuat). */
  touchAll: () => void;
  reset: () => void;
  errors: Accessor<string[]>;
}

/** Agrega mai multe campuri intr-un grup cu stare globala. */
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

/* ------------------------------------------------------------- validatori -- */

export const validators = {
  required:
    (message = "Câmp obligatoriu"): Validator<unknown> =>
    (value) => {
      if (value === null || value === undefined) return message;
      if (typeof value === "string" && value.trim() === "") return message;
      if (Array.isArray(value) && value.length === 0) return message;
      return null;
    },
  minLength:
    (n: number, message?: string): Validator<string> =>
    (value) => (value.length < n ? message ?? `Minim ${n} caractere` : null),
  maxLength:
    (n: number, message?: string): Validator<string> =>
    (value) => (value.length > n ? message ?? `Maxim ${n} caractere` : null),
  pattern:
    (re: RegExp, message = "Format invalid"): Validator<string> =>
    (value) => (value === "" || re.test(value) ? null : message),
  /** Verificare pragmatica, nu RFC 5322: un `@` cu text de ambele parti si un punct. */
  email:
    (message = "Adresă de email invalidă"): Validator<string> =>
    (value) => (value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : message),
  range:
    (min: number, max: number, message?: string): Validator<number> =>
    (value) => (value < min || value > max ? message ?? `Între ${min} și ${max}` : null),
  /** Compara cu alt camp, fara sa se aboneze la el de doua ori. */
  matches:
    (other: Accessor<string>, message = "Valorile nu coincid"): Validator<string> =>
    (value) => (value === other() ? null : message),
};

/* ------------------------------------------------------------- componente -- */

export interface LabelProps {
  children: Child;
  /** `id`-ul controlului. Fara el eticheta nu e legata de nimic. */
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
  /** Mesajul; `null` inseamna fara eroare. */
  message: Accessor<string | null>;
  id?: string;
  class?: string;
}

export function ErrorMessage(props: ErrorMessageProps): El {
  // `aria-live` pe containerul MEREU montat: daca ar aparea odata cu textul,
  // multe screen readere n-ar anunta nimic.
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
  /** Controlul. Primeste `field.props()` aplicate de tine. */
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
  /** Ruleaza doar daca grupul e valid; altfel marcheaza toate campurile. */
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
      // `untracked`: submit-ul citeste validitatea, nu se aboneaza la ea.
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
  /** Sectiune pliabila. */
  collapsible?: boolean;
  class?: string;
}

/** Grupare vizuala de campuri, cu titlu legat prin `aria-labelledby`. */
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
  /** Campurile urmarite, in ordinea din formular. */
  fields: readonly Field<any>[];
  /** Arata sumarul doar dupa o incercare de trimitere. */
  visible?: Accessor<boolean>;
  title?: Child;
  class?: string;
}

/**
 * ValidationSummary - lista erorilor, cu linkuri catre campuri.
 *
 * Obligatorie pentru formularele lungi: fara ea, dupa un submit esuat
 * utilizatorul trebuie sa caute singur care dintre cele 20 de campuri e rosu.
 * Clickul pe o eroare muta focusul pe campul vinovat.
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
        props.title ?? `${errors().length} ${errors().length === 1 ? "eroare" : "erori"} de corectat`,
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
