import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "raptorjs/dom/testing";
import { render } from "raptorjs/dom";
import { state } from "raptorjs";
import { DropdownMenu, menuItem, menuSeparator, type MenuEntry } from "../../src/ui/menu.ts";

const doc = installMiniDom() as any;
(globalThis as any).document = doc;

function setup(entries: readonly MenuEntry[], props: Record<string, unknown> = {}) {
  const root = doc.createElement("div") as MiniElement;
  const dispose = render(() => DropdownMenu({ trigger: "Open", entries, ...props } as any), root);
  const trigger = () => root.querySelector("button")!;
  const menu = () => root.querySelector("ul");
  const items = () => root.querySelectorAll("li").filter((li) => li.getAttribute("role") === "menuitem");
  const active = () => items().findIndex((li) => li.className.includes("rui-active"));
  return { root, dispose, trigger, menu, items, active };
}

test("meniul nu exista in DOM cat timp e inchis", () => {
  const { menu, trigger } = setup([menuItem("A", () => {})]);
  assert.equal(menu(), null);
  assert.equal(trigger().getAttribute("aria-expanded"), "false");
});

test("click pe trigger deschide si inchide; aria-expanded urmeaza", () => {
  const { trigger, menu } = setup([menuItem("A", () => {})]);

  trigger().click();
  assert.ok(menu());
  assert.equal(trigger().getAttribute("aria-expanded"), "true");
  assert.equal(menu()!.getAttribute("role"), "menu");

  trigger().click();
  assert.equal(menu(), null);
  assert.equal(trigger().getAttribute("aria-expanded"), "false");
});

test("selectarea unui item ruleaza onSelect si inchide meniul", () => {
  const picked: string[] = [];
  const { trigger, menu, items } = setup([
    menuItem("Copy", () => picked.push("copy")),
    menuItem("Paste", () => picked.push("paste")),
  ]);

  trigger().click();
  items()[1]!.click();
  assert.deepEqual(picked, ["paste"]);
  assert.equal(menu(), null);
});

test("itemii dezactivati nu se selecteaza si sunt marcati ARIA", () => {
  const picked: string[] = [];
  const { trigger, items } = setup([
    menuItem("Copy", () => picked.push("copy")),
    menuItem("Paste", () => picked.push("paste"), { disabled: true }),
  ]);

  trigger().click();
  assert.equal(items()[1]!.getAttribute("aria-disabled"), "true");
  items()[1]!.click();
  assert.deepEqual(picked, []);
});

test("sagetile ciclesc si sar peste separatoare si itemi dezactivati", () => {
  const { trigger, items, active } = setup([
    menuItem("A", () => {}),
    menuSeparator(),
    menuItem("B", () => {}, { disabled: true }),
    menuItem("C", () => {}),
  ]);

  trigger().click();
  trigger().dispatch("keydown", { key: "ArrowDown" });
  assert.equal(active(), 0); // A

  trigger().dispatch("keydown", { key: "ArrowDown" });
  assert.equal(active(), 2); // sare separatorul si pe B (disabled) -> C

  trigger().dispatch("keydown", { key: "ArrowDown" });
  assert.equal(active(), 0); // cicleaza inapoi la A

  trigger().dispatch("keydown", { key: "ArrowUp" });
  assert.equal(active(), 2);
});

test("Enter selecteaza itemul activ", () => {
  const picked: string[] = [];
  const { trigger, menu } = setup([menuItem("A", () => picked.push("a")), menuItem("B", () => picked.push("b"))]);

  trigger().click();
  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "Enter" });

  assert.deepEqual(picked, ["b"]);
  assert.equal(menu(), null);
});

test("Escape inchide meniul", () => {
  const { trigger, menu } = setup([menuItem("A", () => {})]);
  trigger().click();
  assert.ok(menu());
  trigger().dispatch("keydown", { key: "Escape" });
  assert.equal(menu(), null);
});

test("click in afara inchide; click inauntru nu", () => {
  const outside = doc.createElement("div") as MiniElement;
  const { root, trigger, menu, items } = setup([menuItem("A", () => {})]);
  const page = doc.createElement("div") as MiniElement;
  page.appendChild(root);
  page.appendChild(outside);

  trigger().click();
  assert.ok(menu());

  // Click pe un item nu trebuie sa fie tratat ca "afara".
  items()[0]!.click();
  assert.equal(menu(), null, "itemul isi inchide meniul singur, prin selectie");

  trigger().click();
  assert.ok(menu());
  outside.click();
  assert.equal(menu(), null);
});

test("mutarea itemului activ rescrie atribute, nu recreeaza itemii", () => {
  const { trigger, items } = setup([menuItem("A", () => {}), menuItem("B", () => {}), menuItem("C", () => {})]);
  trigger().click();
  const before = items().map((li) => li.id);

  resetStats();
  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "ArrowDown" });

  assert.equal(stats.createElement, 0);
  assert.equal(stats.createText, 0);
  assert.deepEqual(items().map((li) => li.id), before, "aceleasi noduri");
});

test("dispose scoate handlerele globale", () => {
  const { trigger, dispose, menu } = setup([menuItem("A", () => {})]);
  trigger().click();
  assert.ok(menu());

  dispose();

  // Daca handlerele ar fi ramas, un keydown global ar atinge semnale distruse.
  const other = doc.createElement("div") as MiniElement;
  assert.doesNotThrow(() => other.dispatch("keydown", { key: "Escape" }));
});

test("semnalul `open` controlat din afara deschide meniul", () => {
  const open = state(false);
  const { menu } = setup([menuItem("A", () => {})], { open });

  assert.equal(menu(), null);
  open.set(true);
  assert.ok(menu());
  open.set(false);
  assert.equal(menu(), null);
});
