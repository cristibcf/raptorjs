import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "@raptorstack/raptorjs/dom/testing";
import { render, R } from "@raptorstack/raptorjs/dom";
import { state, createRoot } from "@raptorstack/raptorjs";
import { Box, Stack, Group, Flex, Grid, SimpleGrid, Container, Center, Spacer, Divider, AspectRatio, ScrollArea } from "../../src/ui/layout.ts";
import { Text, Heading, Link, TextList, Truncate, Mark, CodeBlock } from "../../src/ui/typography.ts";
import { Card, Badge, Tag, Avatar, AvatarGroup, initials, Stat, DescriptionList, Alert, EmptyState, Result, Spinner, Skeleton, LoadingOverlay, Timeline, Image } from "../../src/ui/display.ts";
import { collapsible, accordion } from "../../src/ui/disclosure.ts";
import { NumberInput, PasswordInput, passwordStrength, SearchInput, PinInput, TagsInput, Editable, CheckboxGroup, SegmentedControl, ToggleButton, NativeSelect } from "../../src/ui/controls.ts";
import { persistedState, undoRedo, selectionState } from "../../src/ui/primitives/stores.ts";

const doc = installMiniDom() as any;
(globalThis as any).document = doc;

function div(): MiniElement {
  return doc.createElement("div") as MiniElement;
}
function mount(build: () => unknown): MiniElement {
  const root = div();
  render(build as any, root);
  return root;
}
const byClass = (root: MiniElement, tag: string, cls: string): MiniElement | undefined =>
  root.querySelectorAll(tag).find((e) => (e.getAttribute("class") ?? "").split(" ").includes(cls));

/* ---------------------------------------------------------------- layout -- */

test("Box applies the spacing scale and lets `attrs` through", () => {
  const root = mount(() => Box({ padding: 4, width: "200px", attrs: { id: "x", "aria-label": "box" }, children: "c" }));
  const el = root.querySelector("div")!;
  assert.equal(el.getAttribute("style"), "padding:12px;width:200px");
  assert.equal(el.getAttribute("id"), "x");
  assert.equal(el.getAttribute("aria-label"), "box");
});

test("Box `as` changes the tag", () => {
  const root = mount(() => Box({ as: "section", children: "c" }));
  assert.ok(root.querySelector("section"));
});

test("Stack is vertical by default, Group horizontal", () => {
  const v = mount(() => Stack({ gap: 3, children: "a" })).querySelector("div")!;
  assert.ok(v.getAttribute("style")!.includes("flex-direction:column"));
  assert.ok(v.getAttribute("style")!.includes("gap:8px"));

  const h = mount(() => Group({ gap: 2, children: "a" })).querySelector("div")!;
  assert.ok(!h.getAttribute("style")!.includes("column"));
  assert.ok(h.getAttribute("style")!.includes("align-items:center"));
});

test("Flex translates align/justify into CSS values", () => {
  const el = mount(() => Flex({ align: "center", justify: "between", wrap: true, children: "a" })).querySelector("div")!;
  const style = el.getAttribute("style")!;
  assert.ok(style.includes("align-items:center"));
  assert.ok(style.includes("justify-content:space-between"));
  assert.ok(style.includes("flex-wrap:wrap"));
});

test("Grid: column count or full template", () => {
  const n = mount(() => Grid({ columns: 3, gap: 4, children: "a" })).querySelector("div")!;
  assert.ok(n.getAttribute("style")!.includes("grid-template-columns:repeat(3, minmax(0, 1fr))"));

  const t = mount(() => Grid({ columns: "200px 1fr", children: "a" })).querySelector("div")!;
  assert.ok(t.getAttribute("style")!.includes("grid-template-columns:200px 1fr"));
});

test("SimpleGrid adapts without media queries", () => {
  const el = mount(() => SimpleGrid({ minColumnWidth: "180px", children: "a" })).querySelector("div")!;
  assert.ok(el.getAttribute("style")!.includes("auto-fill"));
  assert.ok(el.getAttribute("style")!.includes("minmax(min(180px, 100%), 1fr)"));
});

test("Container centers with a gutter", () => {
  const el = mount(() => Container({ maxWidth: "800px", children: "a" })).querySelector("div")!;
  const style = el.getAttribute("style")!;
  assert.ok(style.includes("max-width:800px"));
  assert.ok(style.includes("margin-left:auto"));
  assert.ok(style.includes("padding-left:16px"));
});

test("Center, Spacer, AspectRatio", () => {
  const c = mount(() => Center({ fullHeight: true, children: "a" })).querySelector("div")!;
  assert.ok(c.getAttribute("style")!.includes("height:100%"));

  const flexible = mount(() => Spacer()).querySelector("div")!;
  assert.equal(flexible.getAttribute("style"), "flex:1 1 auto");
  const fixed = mount(() => Spacer({ size: 5 })).querySelector("div")!;
  assert.ok(fixed.getAttribute("style")!.includes("16px"));

  const ar = mount(() => AspectRatio({ ratio: 4 / 3, children: "a" })).querySelector("div")!;
  assert.ok(ar.getAttribute("style")!.startsWith("aspect-ratio:1.33"));
});

test("Divider: separator with orientation, labelled variant", () => {
  const plain = mount(() => Divider({ orientation: "vertical" })).querySelector("div")!;
  assert.equal(plain.getAttribute("role"), "separator");
  assert.equal(plain.getAttribute("aria-orientation"), "vertical");

  const labelled = mount(() => Divider({ label: "or" }));
  assert.ok(labelled.textContent.includes("or"));
});

test("ScrollArea is focusable (WCAG 2.1.1)", () => {
  const el = mount(() => ScrollArea({ maxHeight: "300px", children: "a" })).querySelector("div")!;
  assert.equal(el.getAttribute("tabindex"), "0");
  assert.ok(el.getAttribute("style")!.includes("overflow-y:auto"));
});

/* ------------------------------------------------------------ tipografie -- */

test("Heading separates the semantic level from the visual size", () => {
  const h3 = mount(() => Heading({ level: 3, children: "T" })).querySelector("h3")!;
  assert.ok(h3.getAttribute("class")!.includes("rui-t-xl"));

  // h2 but small: the structure stays correct, the look changes.
  const small = mount(() => Heading({ level: 2, size: "sm", children: "T" })).querySelector("h2")!;
  assert.ok(small.getAttribute("class")!.includes("rui-t-sm"));
});

test("Text: variants in classes", () => {
  const el = mount(() => Text({ size: "lg", tone: "danger", weight: "bold", tabular: true, children: "x" })).querySelector("span")!;
  const cls = el.getAttribute("class")!;
  for (const c of ["rui-t-lg", "rui-tone-danger", "rui-w-bold", "rui-tabular"]) assert.ok(cls.includes(c), c);
});

test("an external Link gets a security rel; onNavigate respects Ctrl+click", () => {
  const ext = mount(() => Link({ href: "https://x.dev", external: true, children: "x" })).querySelector("a")!;
  assert.equal(ext.getAttribute("target"), "_blank");
  assert.equal(ext.getAttribute("rel"), "noopener noreferrer");

  const seen: string[] = [];
  const root = mount(() => Link({ href: "/about", onNavigate: (h) => seen.push(h), children: "x" }));
  const a = root.querySelector("a")!;

  a.dispatch("click", { metaKey: true, preventDefault() {} });
  assert.deepEqual(seen, [], "Ctrl/Cmd+click stays the browser's");

  a.dispatch("click", { preventDefault() {} });
  assert.deepEqual(seen, ["/about"]);
});

test("TextList renders ul or ol", () => {
  assert.ok(mount(() => TextList({ items: ["a", "b"] })).querySelector("ul"));
  const ol = mount(() => TextList({ items: ["a"], ordered: true }));
  assert.ok(ol.querySelector("ol"));
  assert.equal(ol.querySelectorAll("li").length, 1);
});

test("Mark highlights the matches while keeping the original text", () => {
  const root = mount(() => Mark({ text: "Raptor is FAST", query: "fa" }));
  const marks = root.querySelectorAll("mark");
  assert.equal(marks.length, 1);
  assert.equal(marks[0]!.textContent, "FA", "keeps the original casing");
  assert.equal(root.textContent, "Raptor is FAST");
});

test("Mark without a query creates no extra nodes", () => {
  const root = mount(() => Mark({ text: "abc", query: "" }));
  assert.equal(root.querySelectorAll("mark").length, 0);
  assert.equal(root.textContent, "abc");
});

test("Truncate at one line vs multiple", () => {
  const one = mount(() => Truncate({ children: "x" })).querySelector("span")!;
  assert.ok(one.getAttribute("class")!.includes("rui-truncate"));
  const many = mount(() => Truncate({ lines: 3, children: "x" })).querySelector("span")!;
  assert.ok(many.getAttribute("style")!.includes("-webkit-line-clamp:3"));
});

test("CodeBlock: header with file and copy button", () => {
  let copied = "";
  const root = mount(() => CodeBlock({ code: "const a = 1", file: "a.ts", onCopy: (c) => { copied = c; } }));
  assert.ok(root.textContent.includes("a.ts"));
  assert.ok(root.querySelector("pre")!.textContent.includes("const a = 1"));
  root.querySelector("button")!.click();
  assert.equal(copied, "const a = 1");
});

/* --------------------------------------------------------------- display -- */

test("an interactive Card responds to Enter and Space", () => {
  let clicks = 0;
  const root = mount(() => Card({ title: "T", children: "c", onClick: () => clicks++, label: "card" }));
  const card = root.querySelector("div")!;
  assert.equal(card.getAttribute("role"), "button");
  assert.equal(card.getAttribute("tabindex"), "0");

  card.click();
  card.dispatch("keydown", { key: "Enter", preventDefault() {} });
  card.dispatch("keydown", { key: " ", preventDefault() {} });
  assert.equal(clicks, 3, "a div with role=button doesn't respond to the keyboard on its own");
});

test("a plain Card doesn't get a button role", () => {
  const card = mount(() => Card({ children: "c" })).querySelector("div")!;
  assert.equal(card.getAttribute("role"), null);
});

test("Badge: `max` threshold, hidden at zero, readable name", () => {
  const n = state(150);
  const root = mount(() => Badge({ count: () => n(), max: 99, label: "notifications" }));
  const badge = root.querySelector("span")!;
  assert.equal(badge.textContent, "99+");
  assert.equal(badge.getAttribute("aria-label"), "notifications");
  assert.equal(badge.getAttribute("role"), "status");

  n.set(3);
  assert.equal(badge.textContent, "3");
  n.set(0);
  assert.ok(badge.getAttribute("class")!.includes("rui-hidden"));
});

test("a dot Badge without a label is decorative", () => {
  const badge = mount(() => Badge({ dot: true })).querySelector("span")!;
  assert.equal(badge.getAttribute("aria-hidden"), "true");
});

test("a removable Tag has a named button", () => {
  let removed = 0;
  const root = mount(() => Tag({ children: "react", onRemove: () => removed++, removeLabel: "Remove react" }));
  const btn = root.querySelector("button")!;
  assert.equal(btn.getAttribute("aria-label"), "Remove react");
  btn.click();
  assert.equal(removed, 1);
});

test("initials: one word, multiple, empty", () => {
  assert.equal(initials("Ana"), "AN");
  assert.equal(initials("Ana Maria Pop"), "AP");
  assert.equal(initials("  "), "");
});

test("Avatar: the name only once in the accessibility tree", () => {
  const root = mount(() => Avatar({ name: "Ann Poe" }));
  const el = root.querySelector("span")!;
  assert.equal(el.getAttribute("role"), "img");
  assert.equal(el.getAttribute("aria-label"), "Ann Poe");
  const inner = root.querySelectorAll("span").find((s) => s.getAttribute("class") === "rui-avatar-initials")!;
  assert.equal(inner.getAttribute("aria-hidden"), "true");
  assert.equal(inner.textContent, "AP");
});

test("AvatarGroup shows +N over the limit", () => {
  const people = [{ name: "A A" }, { name: "B B" }, { name: "C C" }, { name: "D D" }, { name: "E E" }];
  const root = mount(() => AvatarGroup({ people, max: 3 }));
  const more = root.querySelectorAll("span").find((s) => (s.getAttribute("class") ?? "").includes("rui-avatar-more"))!;
  assert.equal(more.textContent, "+2");
  assert.equal(more.getAttribute("aria-label"), "and 2 more");
});

test("Stat: a positive delta is good, but not when `invertDelta`", () => {
  const up = mount(() => Stat({ label: "Revenue", value: "12k", delta: 8.2 }));
  assert.ok(byClass(up, "div", "rui-tone-success"));
  assert.ok(up.textContent.includes("8.2%"));

  const churn = mount(() => Stat({ label: "Churn", value: "3%", delta: 5, invertDelta: true }));
  assert.ok(byClass(churn, "div", "rui-tone-danger"), "a rise in churn is bad");
});

test("DescriptionList produces dt/dd pairs", () => {
  const root = mount(() => DescriptionList({ items: [{ term: "Plan", description: "Pro" }, { term: "Location", description: "Cluj" }] }));
  assert.equal(root.querySelectorAll("dt").length, 2);
  assert.deepEqual(root.querySelectorAll("dd").map((d) => d.textContent), ["Pro", "Cluj"]);
});

test("Alert: only the error interrupts the reader", () => {
  assert.equal(mount(() => Alert({ children: "x", tone: "info" })).querySelector("div")!.getAttribute("role"), "status");
  assert.equal(mount(() => Alert({ children: "x", tone: "danger" })).querySelector("div")!.getAttribute("role"), "alert");
});

test("EmptyState and Result", () => {
  const empty = mount(() => EmptyState({ title: "Nothing here", description: "Add something", icon: "∅" }));
  assert.ok(empty.textContent.includes("Nothing here"));

  const r = mount(() => Result({ status: "404", title: "Not found" }));
  assert.equal(r.querySelector("div")!.getAttribute("role"), "status");
  const err = mount(() => Result({ status: "500", title: "Error" }));
  assert.equal(err.querySelector("div")!.getAttribute("role"), "alert");
});

test("Spinner has text for the screen reader, Skeleton is mute", () => {
  const sp = mount(() => Spinner({ label: "Loading the list" }));
  assert.equal(sp.querySelector("span")!.getAttribute("role"), "status");
  assert.ok(sp.textContent.includes("Loading the list"));

  const sk = mount(() => Skeleton({ lines: 3 }));
  assert.equal(sk.querySelector("span")!.getAttribute("aria-hidden"), "true");
  assert.equal(sk.querySelectorAll("span").filter((s) => (s.getAttribute("class") ?? "").includes("rui-skeleton-text")).length, 3);
  assert.equal(sk.textContent, "", "a placeholder announces nothing");
});

test("LoadingOverlay marks aria-busy and mounts/unmounts the overlay", () => {
  const busy = state(false);
  const root = mount(() => LoadingOverlay({ visible: () => busy(), children: "content" }));
  const host = root.querySelector("div")!;
  assert.equal(host.getAttribute("aria-busy"), "false");
  assert.equal(byClass(root, "div", "rui-loading-overlay"), undefined);

  busy.set(true);
  assert.equal(host.getAttribute("aria-busy"), "true");
  assert.ok(byClass(root, "div", "rui-loading-overlay"));
});

test("Timeline is an ordered list", () => {
  const root = mount(() => Timeline({ items: [{ title: "Created", time: "Monday" }, { title: "Sent" }] }));
  assert.ok(root.querySelector("ol"));
  assert.equal(root.querySelectorAll("li").length, 2);
});

test("Image is lazy by default and keeps alt", () => {
  const img = mount(() => Image({ src: "/a.png", alt: "chart" })).querySelector("img")!;
  assert.equal(img.getAttribute("loading"), "lazy");
  assert.equal(img.getAttribute("alt"), "chart");
});

/* ------------------------------------------------------------ disclosure -- */

test("Collapsible: aria-expanded/controls, hidden content not unmounted", () => {
  const c = createRoot(() => collapsible({ trigger: "Details", children: "secret" }));
  const root = mount(() => c.el);

  const btn = root.querySelector("button")!;
  const panel = byClass(root, "div", "rui-collapsible-panel")!;
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(btn.getAttribute("aria-controls"), panel.getAttribute("id"));
  assert.equal(panel.getAttribute("hidden"), "");
  assert.ok(root.textContent.includes("secret"), "stays in the DOM for Ctrl+F");

  btn.click();
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  assert.equal(panel.getAttribute("hidden"), null);
});

test("Collapsible with `unmount` really unmounts", () => {
  const c = createRoot(() => collapsible({ trigger: "T", children: "secret", unmount: true }));
  const root = mount(() => c.el);
  assert.ok(!root.textContent.includes("secret"));
  c.toggle();
  assert.ok(root.textContent.includes("secret"));
});

test("Accordion `single` closes the other panels", () => {
  const a = createRoot(() =>
    accordion({
      sections: [
        { key: "a", title: "A", content: "ca" },
        { key: "b", title: "B", content: "cb" },
        { key: "c", title: "C", content: "cc", disabled: true },
      ],
    }),
  );
  mount(() => a.el);

  a.toggle("a");
  assert.deepEqual([...a.expanded()], ["a"]);
  a.toggle("b");
  assert.deepEqual([...a.expanded()], ["b"], "single: A closed");
  a.toggle("c");
  assert.deepEqual([...a.expanded()], ["b"], "the disabled section doesn't open");
  a.toggle("b");
  assert.equal(a.expanded().size, 0, "collapsible by default: everything can be closed");
});

test("Accordion `multiple` keeps several open", () => {
  const a = createRoot(() =>
    accordion({ mode: "multiple", sections: [{ key: "a", title: "A", content: "x" }, { key: "b", title: "B", content: "y" }] }),
  );
  mount(() => a.el);
  a.toggle("a");
  a.toggle("b");
  assert.equal(a.expanded().size, 2);
});

test("Accordion: the title is a heading with a button inside", () => {
  const a = createRoot(() => accordion({ sections: [{ key: "a", title: "A", content: "x" }] }));
  const root = mount(() => a.el);
  const h = root.querySelector("h3")!;
  assert.ok(h.querySelector("button"), "the button is in the heading, not the other way around");
});

test("THESIS: opening a section doesn't recreate the panels", () => {
  const a = createRoot(() =>
    accordion({ sections: [{ key: "a", title: "A", content: "x" }, { key: "b", title: "B", content: "y" }] }),
  );
  const root = mount(() => a.el);
  const before = root.querySelectorAll("div").map((d) => d.id);

  resetStats();
  a.toggle("a");

  assert.equal(stats.createElement, 0);
  assert.equal(stats.createText, 0);
  assert.deepEqual(root.querySelectorAll("div").map((d) => d.id), before);
});

/* -------------------------------------------------------------- controale */

test("NumberInput avoids floating-point garbage", () => {
  const v = state(0.1);
  const root = mount(() => NumberInput({ value: v, step: 0.1, min: 0, max: 1 }));
  const input = root.querySelector("input")!;

  input.dispatch("keydown", { key: "ArrowUp", preventDefault() {} });
  assert.equal(v(), 0.2, "not 0.30000000000000004");
  assert.equal(input.getAttribute("value"), "0.2");

  input.dispatch("keydown", { key: "ArrowUp", preventDefault() {} });
  assert.equal(v(), 0.3);
});

test("NumberInput: cap on blur, not while typing", () => {
  const v = state(5);
  const root = mount(() => NumberInput({ value: v, min: 0, max: 10 }));
  const input = root.querySelector("input")!;

  input.dispatch("input", { target: { value: "50" } });
  assert.equal(v(), 50, "while typing we don't cap");
  input.dispatch("blur");
  assert.equal(v(), 10, "capped on blur");
});

test("NumberInput: ARIA spinbutton, Shift accelerates, the buttons disable", () => {
  const v = state(5);
  const root = mount(() => NumberInput({ value: v, min: 0, max: 100, label: "Quantity" }));
  const input = root.querySelector("input")!;
  assert.equal(input.getAttribute("role"), "spinbutton");
  assert.equal(input.getAttribute("aria-valuemin"), "0");
  assert.equal(input.getAttribute("aria-valuenow"), "5");

  input.dispatch("keydown", { key: "ArrowUp", shiftKey: true, preventDefault() {} });
  assert.equal(v(), 15);

  v.set(0);
  assert.equal(root.querySelectorAll("button")[0]!.getAttribute("disabled"), "", "minus disabled at min");
});

test("passwordStrength gives increasing scores", () => {
  assert.equal(passwordStrength(""), 0);
  assert.equal(passwordStrength("abc"), 0);
  assert.ok(passwordStrength("abcdefgh") >= 1);
  assert.equal(passwordStrength("Abcdefgh1234!"), 4);
});

test("PasswordInput: the toggle describes the action, not the state", () => {
  const v = state("secret");
  const root = mount(() => PasswordInput({ value: v, strength: true }));
  const input = root.querySelector("input")!;
  const toggle = root.querySelector("button")!;

  assert.equal(input.getAttribute("type"), "password");
  assert.equal(toggle.getAttribute("aria-label"), "Show password");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");

  toggle.click();
  assert.equal(input.getAttribute("type"), "text");
  assert.equal(toggle.getAttribute("aria-label"), "Hide password");
});

test("SearchInput debounce: a single search after silence", async () => {
  const v = state("");
  const seen: string[] = [];
  const root = mount(() => SearchInput({ value: v, onSearch: (q) => seen.push(q), debounce: 20 }));
  const input = root.querySelector("input")!;

  for (const text of ["r", "ra", "rap"]) input.dispatch("input", { target: { value: text } });
  assert.deepEqual(seen, [], "nothing while typing");

  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(seen, ["rap"], "a single request, with the last value");
});

test("SearchInput: Enter searches immediately, Escape clears", async () => {
  const v = state("abc");
  const seen: string[] = [];
  const root = mount(() => SearchInput({ value: v, onSearch: (q) => seen.push(q), debounce: 1000 }));
  const input = root.querySelector("input")!;

  input.dispatch("keydown", { key: "Enter" });
  assert.deepEqual(seen, ["abc"]);

  input.dispatch("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(v(), "");
  assert.deepEqual(seen, ["abc", ""]);
});

test("PinInput accepts a whole pasted code", () => {
  const v = state("");
  let completed = "";
  const root = mount(() => PinInput({ value: v, length: 6, onComplete: (c) => { completed = c; } }));
  const boxes = root.querySelectorAll("input");
  assert.equal(boxes.length, 6);
  assert.equal(boxes[0]!.getAttribute("autocomplete"), "one-time-code");

  boxes[0]!.dispatch("paste", {
    clipboardData: { getData: () => "123456" },
    preventDefault() {},
  });
  assert.equal(v(), "123456");
  assert.equal(completed, "123456");
});

test("PinInput: typing box by box, Backspace deletes", () => {
  const v = state("");
  const root = mount(() => PinInput({ value: v, length: 4 }));
  const boxes = root.querySelectorAll("input");

  boxes[0]!.dispatch("input", { target: { value: "7" } });
  assert.equal(v(), "7");
  boxes[1]!.dispatch("input", { target: { value: "a" } });
  assert.equal(v(), "7", "numeric by default: the letter is ignored");
  boxes[1]!.dispatch("input", { target: { value: "8" } });
  assert.equal(v(), "78");

  boxes[1]!.dispatch("keydown", { key: "Backspace", preventDefault() {} });
  assert.equal(v(), "7");
});

test("TagsInput: comma and Enter confirm, Backspace deletes the last", () => {
  const v = state<readonly string[]>([]);
  const root = mount(() => TagsInput({ value: v }));
  const input = root.querySelector("input")!;

  input.dispatch("input", { target: { value: "react" } });
  input.dispatch("keydown", { key: "Enter", preventDefault() {} });
  assert.deepEqual(v(), ["react"]);

  input.dispatch("input", { target: { value: "vue" } });
  input.dispatch("keydown", { key: ",", preventDefault() {} });
  assert.deepEqual(v(), ["react", "vue"]);

  // Duplicate rejected by default.
  input.dispatch("input", { target: { value: "vue" } });
  input.dispatch("keydown", { key: "Enter", preventDefault() {} });
  assert.deepEqual(v(), ["react", "vue"]);

  input.dispatch("keydown", { key: "Backspace" });
  assert.deepEqual(v(), ["react"]);
});

test("Editable: Enter confirms, Escape cancels", () => {
  const v = state("title");
  const root = mount(() => Editable({ value: v }));

  root.querySelector("button")!.click();
  const input = root.querySelector("input")!;
  input.dispatch("input", { target: { value: "new title" } });
  input.dispatch("keydown", { key: "Enter", preventDefault() {} });
  assert.equal(v(), "new title");

  root.querySelector("button")!.click();
  const again = root.querySelector("input")!;
  again.dispatch("input", { target: { value: "mistake" } });
  again.dispatch("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(v(), "new title", "Escape restores");
});

test("CheckboxGroup: select-all with mixed state", () => {
  const v = state<ReadonlySet<string>>(new Set());
  const root = mount(() =>
    CheckboxGroup({ value: v, selectAll: true, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }),
  );
  const boxes = root.querySelectorAll("input");
  const all = boxes[0]!;

  assert.equal(all.getAttribute("aria-checked"), "false");
  boxes[1]!.dispatch("change");
  assert.equal(all.getAttribute("aria-checked"), "mixed");
  boxes[2]!.dispatch("change");
  assert.equal(all.getAttribute("aria-checked"), "true");

  all.dispatch("change");
  assert.equal(v().size, 0, "checked select-all toggles toward empty");
});

test("SegmentedControl: radiogroup with roving tabindex", () => {
  const v = state<"day" | "month">("day");
  const root = mount(() =>
    SegmentedControl({ value: v, options: [{ value: "day", label: "Day" }, { value: "month", label: "Month" }] }),
  );
  const group = root.querySelector("div")!;
  assert.equal(group.getAttribute("role"), "radiogroup");
  const buttons = root.querySelectorAll("button");
  assert.deepEqual(buttons.map((b) => b.getAttribute("tabindex")), ["0", "-1"]);

  group.dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.equal(v(), "month");
  assert.deepEqual(buttons.map((b) => b.getAttribute("aria-checked")), ["false", "true"]);
});

test("ToggleButton uses aria-pressed", () => {
  const on = state(false);
  const btn = mount(() => ToggleButton({ pressed: on, children: "Bold" })).querySelector("button")!;
  assert.equal(btn.getAttribute("aria-pressed"), "false");
  btn.click();
  assert.equal(on(), true);
  assert.equal(btn.getAttribute("aria-pressed"), "true");
});

test("NativeSelect reflects and writes the signal", () => {
  const v = state<"a" | "b">("a");
  const root = mount(() => NativeSelect({ value: v, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }));
  const sel = root.querySelector("select")!;
  sel.dispatch("change", { target: { value: "b" } });
  assert.equal(v(), "b");
});

/* --------------------------------------------------- primitive de stare -- */

test("persistedState reads, writes and falls back cleanly without storage", () => {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true, writable: true });

  try {
    const s = createRoot(() => persistedState("theme", "light"));
    assert.equal(s(), "light");
    s.set("dark");
    assert.equal(store.get("theme"), '"dark"');

    // A new instance reads what was saved.
    const again = createRoot(() => persistedState("theme", "light"));
    assert.equal(again(), "dark");

    // Corrupt value => fallback, no exception.
    store.set("broken", "{not-json");
    const broken = createRoot(() => persistedState("broken", 42));
    assert.equal(broken(), 42);
  } finally {
    delete (globalThis as any).localStorage;
  }

  // No storage at all: an ordinary signal.
  const plain = createRoot(() => persistedState("x", 1));
  plain.set(2);
  assert.equal(plain(), 2);
});

test("undoRedo: history, redo invalidated by a new action, limit respected", () => {
  const h = createRoot(() => undoRedo("a", { limit: 3 }));

  h.set("b");
  h.set("c");
  assert.equal(h.value(), "c");
  assert.equal(h.canUndo(), true);
  assert.equal(h.canRedo(), false);

  h.undo();
  assert.equal(h.value(), "b");
  assert.equal(h.canRedo(), true);

  h.redo();
  assert.equal(h.value(), "c");

  h.undo();
  h.set("d");
  assert.equal(h.canRedo(), false, "a new action cuts the redo branch");

  // The limit: after many writes, the history doesn't grow without bound.
  for (let i = 0; i < 20; i++) h.set("v" + i);
  assert.ok(h.size().past <= 3, "limit respected: " + h.size().past);
});

test("undoRedo: `replace` doesn't create a history entry", () => {
  const h = createRoot(() => undoRedo(0));
  h.set(1);
  const before = h.size().past;
  h.replace(2);
  assert.equal(h.value(), 2);
  assert.equal(h.size().past, before);
});

test("selectionState: plain click, Ctrl, Shift", () => {
  const items = ["a", "b", "c", "d", "e"];
  const s = createRoot(() => selectionState({ items: () => items }));

  s.click("b");
  assert.deepEqual([...s.selected()], ["b"]);

  s.click("d", { meta: true });
  assert.deepEqual([...s.selected()].sort(), ["b", "d"]);

  // Shift from the anchor (d, the last click without shift) to a.
  s.click("a", { shift: true });
  assert.deepEqual([...s.selected()].sort(), ["a", "b", "c", "d"]);

  s.click("e");
  assert.deepEqual([...s.selected()], ["e"], "a plain click resets");
});

test("selectionState: an anchor gone after filtering doesn't break the range", () => {
  const list = state<readonly string[]>(["a", "b", "c"]);
  const s = createRoot(() => selectionState({ items: () => list() }));

  s.click("a");
  list.set(["x", "y", "z"]); // the anchor `a` no longer exists
  s.click("z", { shift: true });
  assert.deepEqual([...s.selected()], ["z"], "falls back to a plain click, doesn't select nonsense");
});

test("selectionState: selectAll and allSelected", () => {
  const items = ["a", "b"];
  const s = createRoot(() => selectionState({ items: () => items }));
  assert.equal(s.allSelected(), false);
  s.selectAll();
  assert.equal(s.allSelected(), true);
  assert.equal(s.count(), 2);
  s.clear();
  assert.equal(s.count(), 0);
});

test("selectionState with multiple:false keeps a single item", () => {
  const items = ["a", "b"];
  const s = createRoot(() => selectionState({ items: () => items, multiple: false }));
  s.click("a");
  s.click("b", { meta: true });
  assert.deepEqual([...s.selected()], ["b"]);
});
