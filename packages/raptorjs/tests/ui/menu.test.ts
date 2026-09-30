import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "@raptorstack/raptorjs/dom/testing";
import { render } from "@raptorstack/raptorjs/dom";
import { state } from "@raptorstack/raptorjs";
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

test("the menu doesn't exist in the DOM while it's closed", () => {
  const { menu, trigger } = setup([menuItem("A", () => {})]);
  assert.equal(menu(), null);
  assert.equal(trigger().getAttribute("aria-expanded"), "false");
});

test("clicking the trigger opens and closes; aria-expanded follows", () => {
  const { trigger, menu } = setup([menuItem("A", () => {})]);

  trigger().click();
  assert.ok(menu());
  assert.equal(trigger().getAttribute("aria-expanded"), "true");
  assert.equal(menu()!.getAttribute("role"), "menu");

  trigger().click();
  assert.equal(menu(), null);
  assert.equal(trigger().getAttribute("aria-expanded"), "false");
});

test("selecting an item runs onSelect and closes the menu", () => {
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

test("disabled items don't get selected and are marked in ARIA", () => {
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

test("the arrows cycle and skip separators and disabled items", () => {
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
  assert.equal(active(), 2); // skips the separator and B (disabled) -> C

  trigger().dispatch("keydown", { key: "ArrowDown" });
  assert.equal(active(), 0); // cycles back to A

  trigger().dispatch("keydown", { key: "ArrowUp" });
  assert.equal(active(), 2);
});

test("Enter selects the active item", () => {
  const picked: string[] = [];
  const { trigger, menu } = setup([menuItem("A", () => picked.push("a")), menuItem("B", () => picked.push("b"))]);

  trigger().click();
  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "Enter" });

  assert.deepEqual(picked, ["b"]);
  assert.equal(menu(), null);
});

test("Escape closes the menu", () => {
  const { trigger, menu } = setup([menuItem("A", () => {})]);
  trigger().click();
  assert.ok(menu());
  trigger().dispatch("keydown", { key: "Escape" });
  assert.equal(menu(), null);
});

test("click outside closes; click inside doesn't", () => {
  const outside = doc.createElement("div") as MiniElement;
  const { root, trigger, menu, items } = setup([menuItem("A", () => {})]);
  const page = doc.createElement("div") as MiniElement;
  page.appendChild(root);
  page.appendChild(outside);

  trigger().click();
  assert.ok(menu());

  // A click on an item must not be treated as "outside".
  items()[0]!.click();
  assert.equal(menu(), null, "the item closes its own menu, via selection");

  trigger().click();
  assert.ok(menu());
  outside.click();
  assert.equal(menu(), null);
});

test("moving the active item rewrites attributes, doesn't recreate the items", () => {
  const { trigger, items } = setup([menuItem("A", () => {}), menuItem("B", () => {}), menuItem("C", () => {})]);
  trigger().click();
  const before = items().map((li) => li.id);

  resetStats();
  trigger().dispatch("keydown", { key: "ArrowDown" });
  trigger().dispatch("keydown", { key: "ArrowDown" });

  assert.equal(stats.createElement, 0);
  assert.equal(stats.createText, 0);
  assert.deepEqual(items().map((li) => li.id), before, "the same nodes");
});

test("dispose removes the global handlers", () => {
  const { trigger, dispose, menu } = setup([menuItem("A", () => {})]);
  trigger().click();
  assert.ok(menu());

  dispose();

  // If the handlers had stayed, a global keydown would touch destroyed signals.
  const other = doc.createElement("div") as MiniElement;
  assert.doesNotThrow(() => other.dispatch("keydown", { key: "Escape" }));
});

test("the externally controlled `open` signal opens the menu", () => {
  const open = state(false);
  const { menu } = setup([menuItem("A", () => {})], { open });

  assert.equal(menu(), null);
  open.set(true);
  assert.ok(menu());
  open.set(false);
  assert.equal(menu(), null);
});
