import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "@raptorstack/raptorjs/dom/testing";
import { render, R } from "@raptorstack/raptorjs/dom";
import { state, createRoot } from "@raptorstack/raptorjs";
import { Button, IconButton } from "../../src/ui/button.ts";
import { Input, Textarea, Checkbox, Switch, RadioGroup } from "../../src/ui/input.ts";
import { Select } from "../../src/ui/select.ts";
import { Form, FormField, field, formGroup, validators } from "../../src/ui/form.ts";
import { Dialog, ConfirmDialog, Popover, Tooltip } from "../../src/ui/overlay.ts";
import { createToaster, Toaster } from "../../src/ui/toast.ts";
import { tabs } from "../../src/ui/tabs.ts";

const doc = installMiniDom() as any;
(globalThis as any).document = doc;

function div(): MiniElement {
  return doc.createElement("div") as MiniElement;
}

/** Clears the body between tests that use Portal. */
function clearBody(): void {
  for (const child of doc.body.childNodes.slice()) doc.body.removeChild(child);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/* --------------------------------------------------------------- 29 Button */

test("Button: default type `button`, not `submit`", () => {
  const root = div();
  render(() => Button({ children: "Save" }), root);
  const btn = root.querySelector("button")!;
  assert.equal(btn.getAttribute("type"), "button");
  assert.equal(btn.textContent, "Save");
});

test("Button: async onClick blocks double submit", async () => {
  const root = div();
  let calls = 0;
  let release: (() => void) | null = null;
  render(
    () =>
      Button({
        children: "Submit",
        onClick: () => {
          calls++;
          return new Promise<void>((r) => {
            release = r;
          });
        },
      }),
    root,
  );

  const btn = root.querySelector("button")!;
  btn.click();
  assert.equal(calls, 1);
  assert.equal(btn.getAttribute("aria-busy"), "true");
  assert.equal(btn.getAttribute("disabled"), "");

  btn.click();
  btn.click();
  assert.equal(calls, 1, "clicks during the request are ignored");

  release!();
  await tick();
  assert.equal(btn.getAttribute("aria-busy"), "false");
  btn.click();
  assert.equal(calls, 2, "after finishing it accepts again");
});

test("a disabled Button doesn't run onClick", () => {
  const root = div();
  let calls = 0;
  render(() => Button({ children: "x", disabled: true, onClick: () => void calls++ }), root);
  root.querySelector("button")!.click();
  assert.equal(calls, 0);
});

test("IconButton requires an accessible name", () => {
  const root = div();
  render(() => IconButton({ icon: "✕", label: "Close" }), root);
  assert.equal(root.querySelector("button")!.getAttribute("aria-label"), "Close");
});

/* ------------------------------------------------- 39/60/64/62 controale --- */

test("Input binds the value to the signal in both directions", () => {
  const root = div();
  const value = state("a");
  render(() => Input({ value }), root);

  const input = root.querySelector("input")!;
  assert.equal(input.getAttribute("value"), "a");

  input.dispatch("input", { target: { value: "abc" } });
  assert.equal(value(), "abc");

  value.set("from outside");
  assert.equal(input.getAttribute("value"), "from outside");
});

test("Checkbox: `indeterminate` becomes aria-checked=mixed", () => {
  const root = div();
  const checked = state(false);
  const partial = state(true);
  render(() => Checkbox({ checked, indeterminate: () => partial(), label: "All" }), root);

  const box = root.querySelector("input")!;
  assert.equal(box.getAttribute("aria-checked"), "mixed");

  partial.set(false);
  assert.equal(box.getAttribute("aria-checked"), "false");
  checked.set(true);
  assert.equal(box.getAttribute("aria-checked"), "true");
});

test("Switch has role=switch, not checkbox", () => {
  const root = div();
  const on = state(false);
  render(() => Switch({ checked: on, label: "Notifications" }), root);

  const sw = root.querySelector("button")!;
  assert.equal(sw.getAttribute("role"), "switch");
  assert.equal(sw.getAttribute("aria-checked"), "false");

  sw.click();
  assert.equal(on(), true);
  assert.equal(sw.getAttribute("aria-checked"), "true");

  // The arrows set directly, they don't toggle.
  sw.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(on(), false);
  sw.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(on(), false, "already off, stays off");
  sw.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(on(), true);
});

test("RadioGroup: roving tabindex + arrows", () => {
  const root = div();
  const value = state("b");
  render(
    () =>
      RadioGroup({
        value,
        label: "Size",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
          { value: "c", label: "C", disabled: true },
        ],
      }),
    root,
  );

  const group = root.querySelector("div")!;
  assert.equal(group.getAttribute("role"), "radiogroup");

  const radios = root.querySelectorAll("input");
  // Only the selected one is tabbable.
  assert.deepEqual(radios.map((r) => r.getAttribute("tabindex")), ["-1", "0", "-1"]);

  group.dispatch("keydown", { key: "ArrowDown" });
  assert.equal(value(), "a", "skips C (disabled) and cycles to A");
  assert.deepEqual(radios.map((r) => r.getAttribute("tabindex")), ["0", "-1", "-1"]);

  group.dispatch("keydown", { key: "ArrowUp" });
  assert.equal(value(), "b");
});

test("Textarea writes to the signal", () => {
  const root = div();
  const value = state("");
  render(() => Textarea({ value, rows: 4 }), root);
  const ta = root.querySelector("textarea")!;
  assert.equal(ta.getAttribute("rows"), "4");
  ta.dispatch("input", { target: { value: "long text" } });
  assert.equal(value(), "long text");
});

/* --------------------------------------------------------------- 55 Select */

interface Opt { id: number; name: string }
const OPTS: Opt[] = [
  { id: 1, name: "Alpha" },
  { id: 2, name: "Beta" },
  { id: 3, name: "Gamma" },
];

function mountSelect(extra: Record<string, unknown> = {}) {
  const root = div();
  const value = state<Opt | null>(null);
  render(() => Select<Opt>({ options: () => OPTS, value, label: (o) => o.name, ...extra }), root);
  const trigger = () => root.querySelector("button")!;
  const options = () => root.querySelectorAll("li");
  return { root, value, trigger, options };
}

test("Select: combobox + listbox ARIA, closed with no nodes", () => {
  const { trigger, options } = mountSelect({ ariaLabel: "Letter" });
  assert.equal(trigger().getAttribute("role"), "combobox");
  assert.equal(trigger().getAttribute("aria-haspopup"), "listbox");
  assert.equal(trigger().getAttribute("aria-expanded"), "false");
  assert.equal(options().length, 0, "the list doesn't exist while closed");

  trigger().click();
  assert.equal(trigger().getAttribute("aria-expanded"), "true");
  assert.equal(options().length, 3);
});

test("Select: opening starts from the current value", () => {
  const { trigger, value, options } = mountSelect();
  value.set(OPTS[2]!);
  trigger().click();
  assert.ok(options()[2]!.getAttribute("class")!.includes("rui-active"));
});

test("Select: arrows + Enter choose, Escape closes", () => {
  const { trigger, value } = mountSelect();
  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "Enter" });
  assert.equal(value()!.name, "Beta");

  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "Escape" });
  assert.equal(trigger().getAttribute("aria-expanded"), "false");
});

test("Select: typeahead jumps to an option", () => {
  const { trigger, value } = mountSelect();
  trigger().dispatch("keydown", { key: "g" });
  assert.equal(value()!.name, "Gamma", "closed: typeahead selects directly");
});

test("Select: disabled options are skipped", () => {
  const { trigger, value } = mountSelect({ disabled: (o: Opt) => o.name === "Beta" });
  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "Enter" });
  assert.equal(value()!.name, "Gamma");
});

/* ----------------------------------------------------------------- 88 Form */

test("field: validation is derived, the error appears after blur", () => {
  const f = createRoot(() => field("", { validate: [validators.required(), validators.minLength(3)] }));

  assert.equal(f.error(), "Required field");
  assert.equal(f.visibleError(), null, "untouched => we don't show the error");

  f.touch();
  assert.equal(f.visibleError(), "Required field");

  f.value.set("ab");
  assert.equal(f.visibleError(), "At least 3 characters");

  f.value.set("abc");
  assert.equal(f.error(), null);
  assert.equal(f.valid(), true);
});

test("validators: email, pattern, range, matches", () => {
  createRoot(() => {
    assert.equal(validators.email()("not-an-email"), "Invalid email address");
    assert.equal(validators.email()("a@b.co"), null);
    assert.equal(validators.email()(""), null, "empty is `required`'s job");
    assert.equal(validators.range(1, 10)(11), "Between 1 and 10");
    assert.equal(validators.pattern(/^\d+$/)("12a"), "Invalid format");

    const pass = state("secret");
    assert.equal(validators.matches(() => pass())("secret"), null);
    assert.equal(validators.matches(() => pass())("something else"), "Values do not match");
  });
});

test("formGroup aggregates validity and errors", () => {
  const g = createRoot(() => {
    const email = field("", { validate: validators.email(), label: "Email" });
    const name = field("", { validate: validators.required(), label: "Name" });
    const group = formGroup([email, name]);
    return { email, name, group };
  });

  assert.equal(g.group.valid(), false);
  assert.deepEqual(g.group.errors(), ["Name: Required field"]);

  g.name.value.set("Ann");
  assert.equal(g.group.valid(), true);
  assert.deepEqual(g.group.errors(), []);
  assert.equal(g.group.dirty(), true);
});

test("Form: an invalid submit marks all fields and doesn't run", () => {
  const root = div();
  const f = createRoot(() => {
    const email = field("", { validate: validators.required() });
    const group = formGroup([email]);
    let submitted = 0;
    const el = Form({
      group,
      onSubmit: () => {
        submitted++;
      },
      children: FormField({ field: email, label: "Email", children: Input({ value: email.value }) }),
    });
    return { email, group, el, count: () => submitted };
  });
  render(() => f.el, root);

  root.querySelector("form")!.dispatch("submit");
  assert.equal(f.count(), 0, "it didn't run");
  assert.equal(f.email.touched(), true, "the fields were marked");
  assert.equal(root.querySelector("div")!.textContent.includes("Required field"), true);

  f.email.value.set("something");
  root.querySelector("form")!.dispatch("submit");
  assert.equal(f.count(), 1);
});

test("FormField links label, control and error through ids", () => {
  const root = div();
  const f = createRoot(() => field("", { validate: validators.required() }));
  render(() => FormField({ field: f, label: "Name", children: Input({ value: f.value, id: f.id }) }), root);

  const label = root.querySelector("label")!;
  const input = root.querySelector("input")!;
  assert.equal(label.getAttribute("for"), f.id);
  assert.equal(input.getAttribute("id"), f.id);

  const error = root.querySelectorAll("div").find((d) => d.getAttribute("role") === "alert")!;
  assert.equal(error.getAttribute("id"), f.id + "-err");
  assert.equal(error.getAttribute("aria-live"), "polite");
});

test("THESIS: typing in one field doesn't touch the other 29", () => {
  const root = div();
  const built = createRoot(() => {
    const fields = [];
    for (let i = 0; i < 30; i++) {
      fields.push(field<string>("", { validate: [validators.required(), validators.minLength(3)], label: "Field " + i }));
    }
    return fields;
  });

  render(
    () => R.div(built.map((f) => FormField({ field: f, label: "x", children: Input({ value: f.value, id: f.id }) }))),
    root,
  );

  for (const f of built) f.touch();
  resetStats();

  // A single keystroke in one field.
  built[7]!.value.set("ab");

  assert.equal(stats.createElement, 0, "zero elements");
  assert.equal(stats.createText, 0, "zero text-nodes");
  // A single error text changed + that field's aria-invalid/describedby.
  assert.equal(stats.textUpdate, 1, "exactly one text-node touched");
});

/* -------------------------------------------------------- 110/111 Dialog -- */

test("Dialog: mounted in body via Portal, with aria-modal", () => {
  clearBody();
  const root = div();
  const open = state(false);
  render(() => R.div(Dialog({ open, title: "Title", children: "Body" })), root);

  assert.equal(doc.body.childNodes.length, 0, "closed => no node");

  open.set(true);
  const dialog = (doc.body.querySelectorAll("div") as MiniElement[])
    .find((d: MiniElement) => d.getAttribute("role") === "dialog")!;
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.ok(doc.body.textContent.includes("Body"));

  open.set(false);
  assert.equal(doc.body.childNodes.length, 0, "fully cleaned up");
});

test("Dialog: Escape closes, scroll lock added and removed", () => {
  clearBody();
  const root = div();
  const open = state(false);
  render(() => R.div(Dialog({ open, children: "x" })), root);

  open.set(true);
  assert.equal(doc.body.style.overflow, "hidden");

  div().dispatch("keydown", { key: "Escape" });
  assert.equal(open(), false);
  assert.equal(doc.body.style.overflow, "", "scroll restored");
});

test("Dialog: scroll lock with a counter for stacked dialogs", () => {
  clearBody();
  const root = div();
  const a = state(false);
  const b = state(false);
  render(() => R.div(Dialog({ open: a, children: "a", closeOnEscape: false }), Dialog({ open: b, children: "b", closeOnEscape: false })), root);

  a.set(true);
  b.set(true);
  assert.equal(doc.body.style.overflow, "hidden");

  b.set(false);
  assert.equal(doc.body.style.overflow, "hidden", "the first is still open");

  a.set(false);
  assert.equal(doc.body.style.overflow, "");
});

test("ConfirmDialog confirms and cancels", () => {
  clearBody();
  const root = div();
  const open = state(true);
  let confirmed = 0;
  let cancelled = 0;
  render(
    () =>
      R.div(
        ConfirmDialog({
          open,
          message: "Delete?",
          variant: "danger",
          onConfirm: () => void confirmed++,
          onCancel: () => void cancelled++,
        }),
      ),
    root,
  );

  const buttons = doc.body.querySelectorAll("button") as MiniElement[];
  const confirm = buttons.find((b: MiniElement) => b.textContent === "Confirm")!;
  confirm.click();
  assert.equal(confirmed, 1);
  assert.equal(open(), false);

  open.set(true);
  const cancel = (doc.body.querySelectorAll("button") as MiniElement[])
    .find((b: MiniElement) => b.textContent === "Cancel")!;
  cancel.click();
  assert.equal(cancelled, 1);
  assert.equal(open(), false);
});

/* ------------------------------------------------------- 113/114 overlay -- */

test("Popover: opens, aria-expanded, Escape closes", () => {
  clearBody();
  const root = div();
  render(
    () =>
      Popover({
        trigger: (p) => R.button(p, "open"),
        children: "popover content",
      }),
    root,
  );

  const trigger = root.querySelector("button")!;
  assert.equal(trigger.getAttribute("aria-haspopup"), "dialog");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(doc.body.childNodes.length, 0);

  trigger.click();
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.ok(doc.body.textContent.includes("popover content"));

  div().dispatch("keydown", { key: "Escape" });
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(doc.body.childNodes.length, 0);
});

test("Tooltip: appears on focus, not just on hover, and links aria-describedby", async () => {
  clearBody();
  const root = div();
  render(
    () =>
      Tooltip({
        trigger: (p) => R.button(p, "help"),
        content: "explanation",
        delay: 0,
      }),
    root,
  );

  const trigger = root.querySelector("button")!;
  assert.equal(trigger.getAttribute("aria-describedby"), "");

  trigger.dispatch("focus");
  const tip = (doc.body.querySelectorAll("div") as MiniElement[])
    .find((d: MiniElement) => d.getAttribute("role") === "tooltip")!;
  assert.equal(tip.getAttribute("role"), "tooltip");
  assert.equal(trigger.getAttribute("aria-describedby"), tip.getAttribute("id"));

  trigger.dispatch("blur");
  assert.equal(doc.body.childNodes.length, 0);

  // Escape hides even if the pointer is still over it (WCAG requirement).
  trigger.dispatch("pointerenter");
  assert.ok(doc.body.textContent.includes("explanation"));
  div().dispatch("keydown", { key: "Escape" });
  assert.equal(doc.body.childNodes.length, 0);
});

test("Tooltip respects the delay", async () => {
  clearBody();
  const root = div();
  render(() => Tooltip({ trigger: (p) => R.button(p, "x"), content: "tip", delay: 20 }), root);

  root.querySelector("button")!.dispatch("pointerenter");
  assert.equal(doc.body.childNodes.length, 0, "not yet");

  await new Promise((r) => setTimeout(r, 40));
  assert.ok(doc.body.textContent.includes("tip"));
});

/* ---------------------------------------------------------- 118/119 Toast */

test("Toaster: push, auto-dismiss, dedupe by key, limit", async () => {
  const t = createRoot(() => createToaster({ duration: 20, max: 2 }));

  t.info("one");
  t.success("two");
  assert.equal(t.toasts().length, 2);

  t.error("three");
  assert.equal(t.toasts().length, 2, "limit 2");
  assert.equal(t.toasts()[0]!.message, "two", "the oldest was pushed out");

  t.push({ message: "saved", key: "save" });
  t.push({ message: "saved again", key: "save" });
  const saves = t.toasts().filter((x) => x.key === "save");
  assert.equal(saves.length, 1, "dedupe by key");
  assert.equal(saves[0]!.message, "saved again");

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(t.toasts().length, 0, "they expired");
});

test("Toaster: duration 0 stays until manual dismiss", async () => {
  const t = createRoot(() => createToaster({ duration: 10 }));
  const id = t.push({ message: "persistent", duration: 0 });

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(t.toasts().length, 1);

  t.dismiss(id);
  assert.equal(t.toasts().length, 0);
});

test("Toaster: pause on hover stops the timer", async () => {
  const t = createRoot(() => createToaster({ duration: 30 }));
  t.info("read me");

  t.pause();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(t.toasts().length, 1, "while paused it doesn't disappear");

  t.resume();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(t.toasts().length, 0);
});

test("Toaster renders in the body with aria-live", () => {
  clearBody();
  const root = div();
  const t = createRoot(() => createToaster());
  render(() => R.div(Toaster({ toaster: t })), root);

  const region = (doc.body.querySelectorAll("div") as MiniElement[])
    .find((d: MiniElement) => d.getAttribute("role") === "region")!;
  assert.equal(region.getAttribute("aria-live"), "polite");
  assert.equal(region.getAttribute("role"), "region");

  t.error("it failed");
  assert.ok(doc.body.textContent.includes("it failed"));
  // Errors are `alert`, the rest `status`.
  const item = (doc.body.querySelectorAll("div") as MiniElement[])
    .find((d: MiniElement) => d.getAttribute("role") === "alert")!;
  assert.ok(item);
});

/* ----------------------------------------------------------------- 100 Tabs */

function mountTabs(extra: Record<string, unknown> = {}) {
  const root = div();
  const handle = createRoot(() =>
    tabs({
      label: "Sections",
      tabs: [
        { key: "a", label: "A", content: "content A" },
        { key: "b", label: "B", content: "content B" },
        { key: "c", label: "C", content: "content C", disabled: true },
      ],
      ...extra,
    }),
  );
  render(() => handle.el, root);
  const tabButtons = () => root.querySelectorAll("button");
  const panels = () => root.querySelectorAll("div").filter((d) => d.getAttribute("role") === "tabpanel");
  return { root, handle, tabButtons, panels };
}

test("Tabs: ARIA tablist/tab/tabpanel linked through ids", () => {
  const { root, tabButtons, panels } = mountTabs();
  const list = root.querySelectorAll("div").find((d) => d.getAttribute("role") === "tablist")!;
  assert.equal(list.getAttribute("aria-label"), "Sections");

  const first = tabButtons()[0]!;
  assert.equal(first.getAttribute("role"), "tab");
  assert.equal(first.getAttribute("aria-selected"), "true");
  assert.equal(first.getAttribute("aria-controls"), panels()[0]!.getAttribute("id"));
  assert.equal(panels()[0]!.getAttribute("aria-labelledby"), first.getAttribute("id"));
});

test("Tabs: inactive panels stay in the DOM, just hidden", () => {
  const { panels } = mountTabs();
  assert.equal(panels().length, 3, "all panels exist");
  assert.equal(panels()[0]!.getAttribute("hidden"), null, "the active tab isn't hidden");
  assert.equal(panels()[1]!.getAttribute("hidden"), "", "the inactive one is hidden, but present");
});

test("Tabs: roving tabindex", () => {
  const { tabButtons } = mountTabs();
  assert.deepEqual(tabButtons().map((b) => b.getAttribute("tabindex")), ["0", "-1", "-1"]);
});

test("Tabs: manual activation moves focus without changing the panel", () => {
  const { root, handle, tabButtons } = mountTabs();
  const list = root.querySelectorAll("div").find((d) => d.getAttribute("role") === "tablist")!;

  list.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(handle.active(), "a", "the panel did NOT change yet");
  assert.deepEqual(tabButtons().map((b) => b.getAttribute("tabindex")), ["-1", "0", "-1"]);

  list.dispatch("keydown", { key: "Enter" });
  assert.equal(handle.active(), "b");
});

test("Tabs: automatic activation changes the panel on arrow and skips disabled", () => {
  const { root, handle } = mountTabs({ activation: "automatic" });
  const list = root.querySelectorAll("div").find((d) => d.getAttribute("role") === "tablist")!;

  list.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(handle.active(), "b");

  list.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(handle.active(), "a", "skips C (disabled) and cycles");
});

test("Tabs: click selects, a disabled tab doesn't", () => {
  const { handle, tabButtons } = mountTabs();
  tabButtons()[1]!.click();
  assert.equal(handle.active(), "b");
  tabButtons()[2]!.click();
  assert.equal(handle.active(), "b", "C is disabled");
});

test("THESIS: switching tabs doesn't recreate the panels", () => {
  const { handle, panels } = mountTabs();
  const before = panels().map((p) => p.id);

  resetStats();
  handle.select("b");

  assert.equal(stats.createElement, 0, "zero elements");
  assert.equal(stats.createText, 0, "zero text-nodes");
  assert.deepEqual(panels().map((p) => p.id), before, "the same nodes");
});

test("Tabs lazy: the panel is built on first activation and stays mounted", () => {
  let builds = 0;
  const root = div();
  const handle = createRoot(() =>
    tabs({
      lazy: true,
      tabs: [
        { key: "a", label: "A", content: "A" },
        {
          key: "b",
          label: "B",
          content: () => {
            builds++;
            return "expensive";
          },
        },
      ],
    }),
  );
  render(() => handle.el, root);

  assert.equal(builds, 0, "the expensive panel wasn't built");
  handle.select("b");
  assert.equal(builds, 1);
  handle.select("a");
  handle.select("b");
  assert.equal(builds, 1, "stays mounted, isn't rebuilt");
});
