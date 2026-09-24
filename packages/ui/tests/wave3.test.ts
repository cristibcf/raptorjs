import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "@raptor/dom/testing";
import { render, R } from "@raptor/dom";
import { state, createRoot } from "@raptor/core";
import { Button, IconButton } from "../src/button.ts";
import { Input, Textarea, Checkbox, Switch, RadioGroup } from "../src/input.ts";
import { Select } from "../src/select.ts";
import { Form, FormField, field, formGroup, validators } from "../src/form.ts";
import { Dialog, ConfirmDialog, Popover, Tooltip } from "../src/overlay.ts";
import { createToaster, Toaster } from "../src/toast.ts";
import { tabs } from "../src/tabs.ts";

const doc = installMiniDom() as any;
(globalThis as any).document = doc;

function div(): MiniElement {
  return doc.createElement("div") as MiniElement;
}

/** Curăță body-ul între testele care folosesc Portal. */
function clearBody(): void {
  for (const child of doc.body.childNodes.slice()) doc.body.removeChild(child);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/* --------------------------------------------------------------- 29 Button */

test("Button: tip implicit `button`, nu `submit`", () => {
  const root = div();
  render(() => Button({ children: "Salvează" }), root);
  const btn = root.querySelector("button")!;
  assert.equal(btn.getAttribute("type"), "button");
  assert.equal(btn.textContent, "Salvează");
});

test("Button: onClick asincron blochează dubla trimitere", async () => {
  const root = div();
  let calls = 0;
  let release: (() => void) | null = null;
  render(
    () =>
      Button({
        children: "Trimite",
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
  assert.equal(calls, 1, "clickurile în timpul cererii sunt ignorate");

  release!();
  await tick();
  assert.equal(btn.getAttribute("aria-busy"), "false");
  btn.click();
  assert.equal(calls, 2, "după terminare acceptă din nou");
});

test("Button dezactivat nu rulează onClick", () => {
  const root = div();
  let calls = 0;
  render(() => Button({ children: "x", disabled: true, onClick: () => void calls++ }), root);
  root.querySelector("button")!.click();
  assert.equal(calls, 0);
});

test("IconButton cere nume accesibil", () => {
  const root = div();
  render(() => IconButton({ icon: "✕", label: "Închide" }), root);
  assert.equal(root.querySelector("button")!.getAttribute("aria-label"), "Închide");
});

/* ------------------------------------------------- 39/60/64/62 controale --- */

test("Input leagă valoarea de semnal în ambele sensuri", () => {
  const root = div();
  const value = state("a");
  render(() => Input({ value }), root);

  const input = root.querySelector("input")!;
  assert.equal(input.getAttribute("value"), "a");

  input.dispatch("input", { target: { value: "abc" } });
  assert.equal(value(), "abc");

  value.set("din afară");
  assert.equal(input.getAttribute("value"), "din afară");
});

test("Checkbox: `indeterminate` ajunge în aria-checked=mixed", () => {
  const root = div();
  const checked = state(false);
  const partial = state(true);
  render(() => Checkbox({ checked, indeterminate: () => partial(), label: "Toate" }), root);

  const box = root.querySelector("input")!;
  assert.equal(box.getAttribute("aria-checked"), "mixed");

  partial.set(false);
  assert.equal(box.getAttribute("aria-checked"), "false");
  checked.set(true);
  assert.equal(box.getAttribute("aria-checked"), "true");
});

test("Switch are role=switch, nu checkbox", () => {
  const root = div();
  const on = state(false);
  render(() => Switch({ checked: on, label: "Notificări" }), root);

  const sw = root.querySelector("button")!;
  assert.equal(sw.getAttribute("role"), "switch");
  assert.equal(sw.getAttribute("aria-checked"), "false");

  sw.click();
  assert.equal(on(), true);
  assert.equal(sw.getAttribute("aria-checked"), "true");

  // Săgețile setează direct, nu comută.
  sw.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(on(), false);
  sw.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(on(), false, "deja off, rămâne off");
  sw.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(on(), true);
});

test("RadioGroup: roving tabindex + săgeți", () => {
  const root = div();
  const value = state("b");
  render(
    () =>
      RadioGroup({
        value,
        label: "Mărime",
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
  // Doar cel selectat e tabbable.
  assert.deepEqual(radios.map((r) => r.getAttribute("tabindex")), ["-1", "0", "-1"]);

  group.dispatch("keydown", { key: "ArrowDown" });
  assert.equal(value(), "a", "sare peste C (disabled) și ciclează la A");
  assert.deepEqual(radios.map((r) => r.getAttribute("tabindex")), ["0", "-1", "-1"]);

  group.dispatch("keydown", { key: "ArrowUp" });
  assert.equal(value(), "b");
});

test("Textarea scrie în semnal", () => {
  const root = div();
  const value = state("");
  render(() => Textarea({ value, rows: 4 }), root);
  const ta = root.querySelector("textarea")!;
  assert.equal(ta.getAttribute("rows"), "4");
  ta.dispatch("input", { target: { value: "text lung" } });
  assert.equal(value(), "text lung");
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

test("Select: ARIA de combobox + listbox, închis fără noduri", () => {
  const { trigger, options } = mountSelect({ ariaLabel: "Literă" });
  assert.equal(trigger().getAttribute("role"), "combobox");
  assert.equal(trigger().getAttribute("aria-haspopup"), "listbox");
  assert.equal(trigger().getAttribute("aria-expanded"), "false");
  assert.equal(options().length, 0, "lista nu există cât e închis");

  trigger().click();
  assert.equal(trigger().getAttribute("aria-expanded"), "true");
  assert.equal(options().length, 3);
});

test("Select: deschiderea pornește de la valoarea curentă", () => {
  const { trigger, value, options } = mountSelect();
  value.set(OPTS[2]!);
  trigger().click();
  assert.ok(options()[2]!.getAttribute("class")!.includes("rui-active"));
});

test("Select: săgeți + Enter aleg, Escape închide", () => {
  const { trigger, value } = mountSelect();
  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "Enter" });
  assert.equal(value()!.name, "Beta");

  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "Escape" });
  assert.equal(trigger().getAttribute("aria-expanded"), "false");
});

test("Select: typeahead sare la opțiune", () => {
  const { trigger, value } = mountSelect();
  trigger().dispatch("keydown", { key: "g" });
  assert.equal(value()!.name, "Gamma", "închis: typeahead selectează direct");
});

test("Select: opțiunile dezactivate sunt sărite", () => {
  const { trigger, value } = mountSelect({ disabled: (o: Opt) => o.name === "Beta" });
  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "Enter" });
  assert.equal(value()!.name, "Gamma");
});

/* ----------------------------------------------------------------- 88 Form */

test("field: validarea e derivată, eroarea apare după blur", () => {
  const f = createRoot(() => field("", { validate: [validators.required(), validators.minLength(3)] }));

  assert.equal(f.error(), "Câmp obligatoriu");
  assert.equal(f.visibleError(), null, "netins => nu arătăm eroarea");

  f.touch();
  assert.equal(f.visibleError(), "Câmp obligatoriu");

  f.value.set("ab");
  assert.equal(f.visibleError(), "Minim 3 caractere");

  f.value.set("abc");
  assert.equal(f.error(), null);
  assert.equal(f.valid(), true);
});

test("validators: email, pattern, range, matches", () => {
  createRoot(() => {
    assert.equal(validators.email()("nu-i email"), "Adresă de email invalidă");
    assert.equal(validators.email()("a@b.co"), null);
    assert.equal(validators.email()(""), null, "gol e treaba lui `required`");
    assert.equal(validators.range(1, 10)(11), "Între 1 și 10");
    assert.equal(validators.pattern(/^\d+$/)("12a"), "Format invalid");

    const pass = state("secret");
    assert.equal(validators.matches(() => pass())("secret"), null);
    assert.equal(validators.matches(() => pass())("altceva"), "Valorile nu coincid");
  });
});

test("formGroup agregă validitatea și erorile", () => {
  const g = createRoot(() => {
    const email = field("", { validate: validators.email(), label: "Email" });
    const name = field("", { validate: validators.required(), label: "Nume" });
    const group = formGroup([email, name]);
    return { email, name, group };
  });

  assert.equal(g.group.valid(), false);
  assert.deepEqual(g.group.errors(), ["Nume: Câmp obligatoriu"]);

  g.name.value.set("Ana");
  assert.equal(g.group.valid(), true);
  assert.deepEqual(g.group.errors(), []);
  assert.equal(g.group.dirty(), true);
});

test("Form: submit invalid marchează toate câmpurile și nu rulează", () => {
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
  assert.equal(f.count(), 0, "nu a rulat");
  assert.equal(f.email.touched(), true, "câmpurile au fost marcate");
  assert.equal(root.querySelector("div")!.textContent.includes("Câmp obligatoriu"), true);

  f.email.value.set("ceva");
  root.querySelector("form")!.dispatch("submit");
  assert.equal(f.count(), 1);
});

test("FormField leagă label, control și eroare prin id-uri", () => {
  const root = div();
  const f = createRoot(() => field("", { validate: validators.required() }));
  render(() => FormField({ field: f, label: "Nume", children: Input({ value: f.value, id: f.id }) }), root);

  const label = root.querySelector("label")!;
  const input = root.querySelector("input")!;
  assert.equal(label.getAttribute("for"), f.id);
  assert.equal(input.getAttribute("id"), f.id);

  const error = root.querySelectorAll("div").find((d) => d.getAttribute("role") === "alert")!;
  assert.equal(error.getAttribute("id"), f.id + "-err");
  assert.equal(error.getAttribute("aria-live"), "polite");
});

test("TEZĂ: tastarea într-un câmp nu atinge celelalte 29", () => {
  const root = div();
  const built = createRoot(() => {
    const fields = [];
    for (let i = 0; i < 30; i++) {
      fields.push(field<string>("", { validate: [validators.required(), validators.minLength(3)], label: "Câmp " + i }));
    }
    return fields;
  });

  render(
    () => R.div(built.map((f) => FormField({ field: f, label: "x", children: Input({ value: f.value, id: f.id }) }))),
    root,
  );

  for (const f of built) f.touch();
  resetStats();

  // O tastare într-un singur câmp.
  built[7]!.value.set("ab");

  assert.equal(stats.createElement, 0, "zero elemente");
  assert.equal(stats.createText, 0, "zero text-noduri");
  // Un singur text de eroare schimbat + aria-invalid/describedby ale acelui câmp.
  assert.equal(stats.textUpdate, 1, "exact un text-node atins");
});

/* -------------------------------------------------------- 110/111 Dialog -- */

test("Dialog: montat în body prin Portal, cu aria-modal", () => {
  clearBody();
  const root = div();
  const open = state(false);
  render(() => R.div(Dialog({ open, title: "Titlu", children: "Corp" })), root);

  assert.equal(doc.body.childNodes.length, 0, "închis => niciun nod");

  open.set(true);
  const dialog = (doc.body.querySelectorAll("div") as MiniElement[])
    .find((d: MiniElement) => d.getAttribute("role") === "dialog")!;
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.ok(doc.body.textContent.includes("Corp"));

  open.set(false);
  assert.equal(doc.body.childNodes.length, 0, "curățat complet");
});

test("Dialog: Escape închide, scroll lock pus și scos", () => {
  clearBody();
  const root = div();
  const open = state(false);
  render(() => R.div(Dialog({ open, children: "x" })), root);

  open.set(true);
  assert.equal(doc.body.style.overflow, "hidden");

  div().dispatch("keydown", { key: "Escape" });
  assert.equal(open(), false);
  assert.equal(doc.body.style.overflow, "", "scroll-ul redat");
});

test("Dialog: scroll lock cu contor pentru dialoguri suprapuse", () => {
  clearBody();
  const root = div();
  const a = state(false);
  const b = state(false);
  render(() => R.div(Dialog({ open: a, children: "a", closeOnEscape: false }), Dialog({ open: b, children: "b", closeOnEscape: false })), root);

  a.set(true);
  b.set(true);
  assert.equal(doc.body.style.overflow, "hidden");

  b.set(false);
  assert.equal(doc.body.style.overflow, "hidden", "primul e încă deschis");

  a.set(false);
  assert.equal(doc.body.style.overflow, "");
});

test("ConfirmDialog confirmă și anulează", () => {
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
          message: "Ștergi?",
          variant: "danger",
          onConfirm: () => void confirmed++,
          onCancel: () => void cancelled++,
        }),
      ),
    root,
  );

  const buttons = doc.body.querySelectorAll("button") as MiniElement[];
  const confirm = buttons.find((b: MiniElement) => b.textContent === "Confirmă")!;
  confirm.click();
  assert.equal(confirmed, 1);
  assert.equal(open(), false);

  open.set(true);
  const cancel = (doc.body.querySelectorAll("button") as MiniElement[])
    .find((b: MiniElement) => b.textContent === "Anulează")!;
  cancel.click();
  assert.equal(cancelled, 1);
  assert.equal(open(), false);
});

/* ------------------------------------------------------- 113/114 overlay -- */

test("Popover: deschide, aria-expanded, Escape închide", () => {
  clearBody();
  const root = div();
  render(
    () =>
      Popover({
        trigger: (p) => R.button(p, "deschide"),
        children: "conținut popover",
      }),
    root,
  );

  const trigger = root.querySelector("button")!;
  assert.equal(trigger.getAttribute("aria-haspopup"), "dialog");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(doc.body.childNodes.length, 0);

  trigger.click();
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.ok(doc.body.textContent.includes("conținut popover"));

  div().dispatch("keydown", { key: "Escape" });
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(doc.body.childNodes.length, 0);
});

test("Tooltip: apare la focus, nu doar la hover, și leagă aria-describedby", async () => {
  clearBody();
  const root = div();
  render(
    () =>
      Tooltip({
        trigger: (p) => R.button(p, "ajutor"),
        content: "explicație",
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

  // Escape ascunde chiar dacă pointerul e încă deasupra (cerință WCAG).
  trigger.dispatch("pointerenter");
  assert.ok(doc.body.textContent.includes("explicație"));
  div().dispatch("keydown", { key: "Escape" });
  assert.equal(doc.body.childNodes.length, 0);
});

test("Tooltip respectă întârzierea", async () => {
  clearBody();
  const root = div();
  render(() => Tooltip({ trigger: (p) => R.button(p, "x"), content: "tip", delay: 20 }), root);

  root.querySelector("button")!.dispatch("pointerenter");
  assert.equal(doc.body.childNodes.length, 0, "încă nu");

  await new Promise((r) => setTimeout(r, 40));
  assert.ok(doc.body.textContent.includes("tip"));
});

/* ---------------------------------------------------------- 118/119 Toast */

test("Toaster: push, auto-dismiss, dedupe pe cheie, limită", async () => {
  const t = createRoot(() => createToaster({ duration: 20, max: 2 }));

  t.info("unu");
  t.success("doi");
  assert.equal(t.toasts().length, 2);

  t.error("trei");
  assert.equal(t.toasts().length, 2, "limita 2");
  assert.equal(t.toasts()[0]!.message, "doi", "cel mai vechi a ieșit");

  t.push({ message: "salvat", key: "save" });
  t.push({ message: "salvat din nou", key: "save" });
  const saves = t.toasts().filter((x) => x.key === "save");
  assert.equal(saves.length, 1, "dedupe pe cheie");
  assert.equal(saves[0]!.message, "salvat din nou");

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(t.toasts().length, 0, "au expirat");
});

test("Toaster: durata 0 rămâne până la dismiss manual", async () => {
  const t = createRoot(() => createToaster({ duration: 10 }));
  const id = t.push({ message: "persistent", duration: 0 });

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(t.toasts().length, 1);

  t.dismiss(id);
  assert.equal(t.toasts().length, 0);
});

test("Toaster: pauza la hover oprește cronometrul", async () => {
  const t = createRoot(() => createToaster({ duration: 30 }));
  t.info("citește-mă");

  t.pause();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(t.toasts().length, 1, "cât e pauză nu dispare");

  t.resume();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(t.toasts().length, 0);
});

test("Toaster randează în body cu aria-live", () => {
  clearBody();
  const root = div();
  const t = createRoot(() => createToaster());
  render(() => R.div(Toaster({ toaster: t })), root);

  const region = (doc.body.querySelectorAll("div") as MiniElement[])
    .find((d: MiniElement) => d.getAttribute("role") === "region")!;
  assert.equal(region.getAttribute("aria-live"), "polite");
  assert.equal(region.getAttribute("role"), "region");

  t.error("a picat");
  assert.ok(doc.body.textContent.includes("a picat"));
  // Erorile sunt `alert`, restul `status`.
  const item = (doc.body.querySelectorAll("div") as MiniElement[])
    .find((d: MiniElement) => d.getAttribute("role") === "alert")!;
  assert.ok(item);
});

/* ----------------------------------------------------------------- 100 Tabs */

function mountTabs(extra: Record<string, unknown> = {}) {
  const root = div();
  const handle = createRoot(() =>
    tabs({
      label: "Secțiuni",
      tabs: [
        { key: "a", label: "A", content: "conținut A" },
        { key: "b", label: "B", content: "conținut B" },
        { key: "c", label: "C", content: "conținut C", disabled: true },
      ],
      ...extra,
    }),
  );
  render(() => handle.el, root);
  const tabButtons = () => root.querySelectorAll("button");
  const panels = () => root.querySelectorAll("div").filter((d) => d.getAttribute("role") === "tabpanel");
  return { root, handle, tabButtons, panels };
}

test("Tabs: ARIA tablist/tab/tabpanel legate prin id-uri", () => {
  const { root, tabButtons, panels } = mountTabs();
  const list = root.querySelectorAll("div").find((d) => d.getAttribute("role") === "tablist")!;
  assert.equal(list.getAttribute("aria-label"), "Secțiuni");

  const first = tabButtons()[0]!;
  assert.equal(first.getAttribute("role"), "tab");
  assert.equal(first.getAttribute("aria-selected"), "true");
  assert.equal(first.getAttribute("aria-controls"), panels()[0]!.getAttribute("id"));
  assert.equal(panels()[0]!.getAttribute("aria-labelledby"), first.getAttribute("id"));
});

test("Tabs: panourile inactive rămân în DOM, doar ascunse", () => {
  const { panels } = mountTabs();
  assert.equal(panels().length, 3, "toate panourile există");
  assert.equal(panels()[0]!.getAttribute("hidden"), null, "tabul activ nu e ascuns");
  assert.equal(panels()[1]!.getAttribute("hidden"), "", "cel inactiv e ascuns, dar prezent");
});

test("Tabs: roving tabindex", () => {
  const { tabButtons } = mountTabs();
  assert.deepEqual(tabButtons().map((b) => b.getAttribute("tabindex")), ["0", "-1", "-1"]);
});

test("Tabs: activare manuală mută focusul fără să schimbe panoul", () => {
  const { root, handle, tabButtons } = mountTabs();
  const list = root.querySelectorAll("div").find((d) => d.getAttribute("role") === "tablist")!;

  list.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(handle.active(), "a", "panoul NU s-a schimbat încă");
  assert.deepEqual(tabButtons().map((b) => b.getAttribute("tabindex")), ["-1", "0", "-1"]);

  list.dispatch("keydown", { key: "Enter" });
  assert.equal(handle.active(), "b");
});

test("Tabs: activare automată schimbă panoul la săgeată și sare peste disabled", () => {
  const { root, handle } = mountTabs({ activation: "automatic" });
  const list = root.querySelectorAll("div").find((d) => d.getAttribute("role") === "tablist")!;

  list.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(handle.active(), "b");

  list.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(handle.active(), "a", "sare peste C (disabled) și ciclează");
});

test("Tabs: click selectează, tabul dezactivat nu", () => {
  const { handle, tabButtons } = mountTabs();
  tabButtons()[1]!.click();
  assert.equal(handle.active(), "b");
  tabButtons()[2]!.click();
  assert.equal(handle.active(), "b", "C e dezactivat");
});

test("TEZĂ: schimbarea tabului nu recreează panourile", () => {
  const { handle, panels } = mountTabs();
  const before = panels().map((p) => p.id);

  resetStats();
  handle.select("b");

  assert.equal(stats.createElement, 0, "zero elemente");
  assert.equal(stats.createText, 0, "zero text-noduri");
  assert.deepEqual(panels().map((p) => p.id), before, "aceleași noduri");
});

test("Tabs lazy: panoul se construiește la prima activare și rămâne montat", () => {
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
            return "scump";
          },
        },
      ],
    }),
  );
  render(() => handle.el, root);

  assert.equal(builds, 0, "panoul scump nu s-a construit");
  handle.select("b");
  assert.equal(builds, 1);
  handle.select("a");
  handle.select("b");
  assert.equal(builds, 1, "rămâne montat, nu se reconstruiește");
});
