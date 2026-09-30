/** Forms. */
import { state, R } from "@raptorstack/raptorjs/dom";
import { Wizard } from "@raptorstack/raptorjs/ui/advanced";
import { Button } from "@raptorstack/raptorjs/ui/button";
import { Fieldset, HelperText } from "@raptorstack/raptorjs/ui/controls";
import { ErrorMessage, type Field, Form, FormField, FormSection, Label, ValidationSummary, field, formGroup, validators } from "@raptorstack/raptorjs/ui/form";
import { Input } from "@raptorstack/raptorjs/ui/input";
import type { CatalogGroup } from "./types.ts";

/** A field's `props()` are meant for a raw control — apply them and you are done. */
function control(f: Field<string>, placeholder?: string) {
  return R.input({ class: "rui-input", type: "text", placeholder, ...f.props() });
}

export const FORMS: CatalogGroup = {
  slug: "forms",
  title: "Forms",
  blurb:
    "Validation is a derived value over the field's signal. Nothing re-renders when an error appears — one text node and two ARIA attributes change.",
  items: [
    {
      slug: "field",
      name: "field / formGroup / validators",
      tier: "T1",
      thesis:
        "`error` is `derived` from the field's value, and `visibleError` layers `touched` on top of it. Typing recomputes one string; the form around it is never rebuilt, so a 40-field form validates as cheaply as a 2-field one.",
      summary:
        "The model behind every form: a `field` holds value, error, touched, dirty and valid; a `formGroup` aggregates them; `validators` are the usual rules, composable in order.",
      code: `const email = field("", {
  label: "Email",
  validate: [validators.required("Required"), validators.email("Enter a valid email")],
});

const form = formGroup([email]);
form.valid();  // false
form.errors(); // ["Required"]`,
      props: [
        { name: "field(initial, options)", type: "Field<T>", desc: "validate (one rule or a list), validateOnBlur, label." },
        { name: "field.props()", type: "Record<string, unknown>", desc: "Ready-made attributes for a raw input: id, value, on:input, on:blur, aria-invalid, aria-describedby." },
        { name: "formGroup(fields)", type: "FormGroup", desc: "valid, dirty, errors, touchAll, reset across the whole form." },
        { name: "validators", type: "object", desc: "required, minLength, maxLength, pattern, email, range, matches." },
      ],
      demo: () => {
        const email = field("", {
          label: "Email",
          validate: [validators.required("Required"), validators.email("Enter a valid email")],
        });
        const group = formGroup([email]);
        return (
          <div>
            <div class="cmp-row">
              {FormField({ field: email, label: "Email", required: true, children: control(email, "you@example.com") })}
            </div>
            <div class="cmp-row">
              <span class="chip">
                valid = <b>{() => String(email.valid())}</b>
              </span>
              <span class="chip">
                touched = <b>{() => String(email.touched())}</b>
              </span>
              <span class="chip">
                dirty = <b>{() => String(email.dirty())}</b>
              </span>
              <span class="chip">
                group.errors = <b>{() => String(group.errors().length)}</b>
              </span>
            </div>
          </div>
        );
      },
      notes: [
        "The error exists from the first keystroke, but `visibleError` only shows it after the first blur — so a form does not shout at someone who has not finished typing.",
      ],
    },
    {
      slug: "form",
      name: "Form",
      tier: "T1",
      summary:
        "A `<form>` that refuses to submit an invalid group — it marks every field as touched instead — and that blocks a second submit while an async one is still running.",
      code: `Form({
  group,
  onSubmit: async () => { await save(); },
  children: [ …fields, Button({ type: "submit", children: "Save" }) ],
});`,
      demo: () => {
        const name = field("", { validate: validators.required("Tell us your name") });
        const email = field("", {
          validate: [validators.required("Required"), validators.email("Enter a valid email")],
        });
        const group = formGroup([name, email]);
        const saved = state(0);
        return Form({
          group,
          label: "Demo form",
          onSubmit: () =>
            new Promise<void>((resolve) =>
              setTimeout(() => {
                saved.update((n) => n + 1);
                resolve();
              }, 800),
            ),
          children: [
            FormField({ field: name, label: "Name", required: true, children: control(name) }),
            FormField({
              field: email,
              label: "Email",
              required: true,
              hint: "We only use it for the receipt.",
              children: control(email, "you@example.com"),
            }),
            R.div(
              { class: "cmp-row", style: "margin-top:12px" },
              Button({ type: "submit", variant: "primary", children: "Submit" }),
              Button({ children: "Reset", onClick: () => group.reset() }),
              R.span({ class: "chip" }, "submitted ", R.b({}, () => String(saved())), "×"),
            ),
          ],
        });
      },
      notes: ["Submit it empty: nothing is sent, and every field is marked touched so all the errors appear at once."],
    },
    {
      slug: "form-field",
      name: "FormField",
      tier: "T1",
      summary:
        "Wraps a control with its label, hint and error, and wires the ids so the label points at the control and the error is announced.",
      code: `FormField({ field: email, label: "Email", required: true, hint: "Never shared", children: control });`,
      demo: () => {
        const code = field("", { validate: validators.minLength(4, "At least 4 characters") });
        return FormField({
          field: code,
          label: "Invite code",
          hint: "The hint disappears while an error is showing.",
          children: control(code),
        });
      },
    },
    {
      slug: "label",
      name: "Label",
      tier: "T1",
      summary: "A label bound to a control by id, with the required marker hidden from screen readers (they get `aria-required` from the control instead).",
      code: `Label({ for: input.id, required: true, children: "Email" });`,
      demo: () => (
        <div>
          {Label({ for: "demo-label-input", required: true, children: "Email" })}
          {R.input({ id: "demo-label-input", class: "rui-input", type: "email" })}
        </div>
      ),
    },
    {
      slug: "error-message",
      name: "ErrorMessage",
      tier: "T1",
      summary: "An error with `aria-live`, so it is read out when it appears — and nothing is announced when there is no error.",
      code: `ErrorMessage({ message: () => field.visibleError(), id: field.id + "-err" });`,
      demo: () => {
        const msg = state<string | null>(null);
        return (
          <div>
            <div class="cmp-row">
              {Button({ children: "Break something", size: "sm", onClick: () => msg.set("That username is taken") })}
              {Button({ children: "Fix it", size: "sm", onClick: () => msg.set(null) })}
            </div>
            {ErrorMessage({ message: () => msg() })}
          </div>
        );
      },
    },
    {
      slug: "helper-text",
      name: "HelperText",
      tier: "T2",
      summary: "The quiet line under a control that explains the format expected.",
      code: `HelperText({ id: "pw-hint", children: "At least 12 characters." });`,
      demo: () => HelperText({ children: "At least 12 characters, and not your dog's name." }),
    },
    {
      slug: "fieldset",
      name: "Fieldset",
      tier: "T2",
      summary: "A group with a legend — and a `disabled` that really disables every control inside, because it is the platform element.",
      code: `Fieldset({ legend: "Billing address", children: fields });`,
      demo: () => {
        const on = state(false);
        return (
          <div>
            <div class="cmp-row">
              {Button({ children: "Toggle disabled", size: "sm", onClick: () => on.update((v) => !v) })}
            </div>
            {() =>
              Fieldset({
                legend: "Billing address",
                disabled: on(),
                children: R.div({ class: "cmp-row" }, Input({ value: state("Str. Lipscani 12") }), Input({ value: state("Bucharest") })),
              })
            }
          </div>
        );
      },
    },
    {
      slug: "form-section",
      name: "FormSection",
      tier: "T3",
      summary: "A titled block inside a long form, optionally collapsible, so settings pages stay navigable.",
      code: `FormSection({ title: "Notifications", description: "…", collapsible: true, children: fields });`,
      demo: () =>
        FormSection({
          title: "Notifications",
          description: "How we reach you when something breaks.",
          collapsible: true,
          children: R.div({ class: "cmp-row" }, Input({ value: state("ops@example.com"), label: "Alert email" })),
        }),
    },
    {
      slug: "validation-summary",
      name: "ValidationSummary",
      tier: "T3",
      summary:
        "The list of everything wrong, in field order, each entry focusing its field when clicked — what a long form needs after a failed submit.",
      code: `ValidationSummary({ fields: [name, email], visible: () => tried() });`,
      demo: () => {
        const name = field("", { validate: validators.required("Name is required") });
        const email = field("bad", { validate: validators.email("Email looks wrong") });
        const tried = state(true);
        return (
          <div>
            {ValidationSummary({ fields: [name, email], visible: () => tried(), title: "Please fix 2 things" })}
            <div class="cmp-row" style="margin-top:12px">
              {FormField({ field: name, label: "Name", children: control(name) })}
              {FormField({ field: email, label: "Email", children: control(email) })}
            </div>
          </div>
        );
      },
    },
    {
      slug: "wizard",
      name: "Wizard",
      tier: "T3",
      summary:
        "A multi-step flow that validates before it lets you move on: give a step a `FormGroup` and Next stays shut until that group is valid.",
      code: `Wizard({
  steps: [
    { key: "account", title: "Account", group: accountGroup, content: … },
    { key: "done", title: "Done", content: … },
  ],
  onFinish: () => submit(),
});`,
      demo: () => {
        const email = field("", {
          validate: [validators.required("Required"), validators.email("Enter a valid email")],
        });
        const account = formGroup([email]);
        const finished = state(false);
        return (
          <div>
            {Wizard({
              label: "Sign up",
              onFinish: () => finished.set(true),
              steps: [
                {
                  key: "account",
                  title: "Account",
                  group: account,
                  content: FormField({ field: email, label: "Email", required: true, children: control(email, "you@example.com") }),
                },
                {
                  key: "plan",
                  title: "Plan",
                  content: R.div({ style: "font-size:14px" }, "Anything you like — this step has no validation."),
                },
                {
                  key: "review",
                  title: "Review",
                  content: R.div({ style: "font-size:14px" }, "Press Finish."),
                },
              ],
            })}
            <div class="cmp-row" style="margin-top:12px">
              <span class="chip">
                finished = <b>{() => String(finished())}</b>
              </span>
            </div>
          </div>
        );
      },
      notes: ["Leave the email empty and press Next: the step refuses to advance and the field is marked touched."],
    },
  ],
};
